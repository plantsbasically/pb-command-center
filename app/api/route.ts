import { NextRequest, NextResponse } from "next/server"
import { getBasicAuthHeader, authHeaders } from "@/lib/auth"
import { todayPacific } from "@/lib/dates"

// Allow up to 90s — live fallback / missing-day compute can still page Shopify
export const maxDuration = 90

// Module-level cache persists across requests on Railway's long-running server
const cache = new Map<string, { data: any; ts: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function checkAuth(req: NextRequest) {
  const auth = getBasicAuthHeader(req.headers.get("authorization"))
  if (!auth?.valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: authHeaders() })
  }
  return null
}

export async function GET(req: NextRequest) {
  const authError = checkAuth(req)
  if (authError) return authError

  try {
    const { searchParams } = new URL(req.url)
    const dateStart = searchParams.get("start") || todayPacific()
    const dateEnd = searchParams.get("end") || dateStart
    const bust = searchParams.get("bust") === "1"
    const live = searchParams.get("live") === "1"

    const cacheKey = `${dateStart}|${dateEnd}`
    const cached = cache.get(cacheKey)
    if (!bust && !live && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data)
    }

    const today = todayPacific()

    // Prefer stored daily_metrics rows (near-instant). Fall back to live for gaps.
    // ?live=1 forces the legacy full live path (debug / comparison).
    let responseData: any

    if (live) {
      const { buildMetricsForRange } = await import("@/lib/build-metrics")
      const { getLoopMetricsSummary } = await import("@/lib/loop-metrics")
      const needsSeparateDaily = !(dateStart === today && dateEnd === today)
      const [rangeData, dailyData] = await Promise.all([
        buildMetricsForRange(dateStart, dateEnd),
        needsSeparateDaily ? buildMetricsForRange(today, today) : Promise.resolve(null),
      ])
      const dailySource = dailyData || rangeData
      const loopMetrics = await getLoopMetricsSummary(dateStart, dateEnd)
      responseData = assembleResponse({
        range: {
          metrics: rangeData.metrics,
          twData: rangeData.twData,
          subscriptionRevenue: rangeData.subscriptionRevenue,
          subscriptionOrderCount: rangeData.subscriptionOrderCount,
          giftStats: rangeData.giftStats,
          discountStats: rangeData.discountStats,
          gatewayFees: rangeData.gatewayFees,
          gatewayFeesDaily: rangeData.gatewayFeesDaily,
          gatewayFeesSource: rangeData.gatewayFeesSource,
          fulfillmentSource: rangeData.fulfillmentSource,
          fulfillmentBreakdown: rangeData.fulfillmentBreakdown,
          fulfillmentMeta: rangeData.fulfillmentMeta,
          cogsBreakdown: rangeData.cogsBreakdown,
          variants: rangeData.variants,
          fixedCosts: rangeData.fixedCosts,
          fulfillmentInvoices: rangeData.fulfillmentInvoices,
          giftMappings: rangeData.giftMappings,
          loopData: rangeData.loopData,
          dataSources: rangeData.dataSources,
          _shopifyDebug: rangeData._shopifyDebug,
        },
        dailySource: {
          date: today,
          metrics: dailySource.metrics,
          giftStats: dailySource.giftStats,
          fulfillmentSource: dailySource.fulfillmentSource,
          fulfillmentBreakdown: dailySource.fulfillmentBreakdown,
        },
        loopMetrics,
        metricsSource: "live",
      })
    } else {
      const { getMetricsFromDailyStore } = await import("@/lib/daily-metrics")
      const { getLoopMetricsSummary } = await import("@/lib/loop-metrics")
      const store = await getMetricsFromDailyStore(dateStart, dateEnd, { bust })

      const summed = store.summed
      const dailyRow = store.dailyContributionRow
      const loopMetrics = await getLoopMetricsSummary(dateStart, dateEnd)

      // COGS breakdown units are range-specific; when fully from store we show
      // variant list with zero units (edit UI still works). Partial live fallback
      // days don't rebuild a blended breakdown.
      const cogsBreakdown = store.staticMeta.variants.map((v) => ({
        variantKey: v.variantKey,
        variantName: v.variantName,
        totalCost: v.totalCost,
        unitsSold: 0,
        totalCOGS: 0,
      }))

      const apiDatesCovered = summed.fulfillmentDaySources
        .filter((d) => d.source === "shipfusion" || d.source === "mixed")
        .map((d) => d.date)

      responseData = assembleResponse({
        range: {
          metrics: summed.metrics,
          twData: {
            ...summed.twData,
            amazonRevenue: summed.metrics.amazonRevenue,
            amazonOrders: 0,
            tiktokRevenue: summed.metrics.tiktokRevenue,
            tiktokOrderRevenue: 0,
            tiktokOrders: 0,
            tiktokFees: summed.metrics.tiktokFees,
            twCogs: 0,
            twCustomExpenses: 0,
          },
          subscriptionRevenue: summed.subscriptionRevenue,
          subscriptionOrderCount: summed.subscriptionOrderCount,
          giftStats: summed.giftStats,
          discountStats: summed.discountStats,
          gatewayFees: summed.gatewayFees,
          gatewayFeesDaily: summed.gatewayFeesDaily,
          gatewayFeesSource: summed.gatewayFeesSource,
          fulfillmentSource: summed.fulfillmentSource,
          fulfillmentBreakdown: summed.fulfillmentBreakdown,
          fulfillmentMeta: {
            apiContribution: summed.fulfillmentBreakdown.pickPack +
              summed.fulfillmentBreakdown.shipping +
              summed.fulfillmentBreakdown.packaging +
              summed.fulfillmentBreakdown.insurance +
              summed.fulfillmentBreakdown.other,
            manualContribution: summed.fulfillmentBreakdown.storage,
            shipfusionAuthMode: "cached",
            shipfusionError: null,
            shipfusionInvoiceCount: 0,
            shipfusionTransactionCount: 0,
            apiDatesCovered,
            daysUsed: summed.daysUsed,
            missingDays: summed.missingDays,
            fromStore: summed.fromStore,
          },
          cogsBreakdown,
          variants: store.staticMeta.variants,
          fixedCosts: store.staticMeta.fixedCosts,
          fulfillmentInvoices: store.staticMeta.fulfillmentInvoices,
          giftMappings: store.staticMeta.giftMappings,
          loopData: store.staticMeta.loopData,
          dataSources: {
            metricsSource: summed.fromStore ? "daily_metrics" : "daily_metrics+live_fallback",
            contributionMargin: {
              formula: "revenue − adSpend − realCOGS − netFulfillment − gatewayFees",
              note: "Summed from daily_metrics Pacific rows; ratios from totals.",
            },
            fulfillment: {
              primary: "ShipFusion per-shipment charges (daily_metrics breakdown)",
              net: "fulfillment_gross − shipping_collected → shipfusion_fulfillment_cost",
            },
            discounts: {
              note: "Information-only. Never subtracted from revenue or CM.",
            },
          },
          _shopifyDebug: null,
        },
        dailySource: dailyRow
          ? {
              date: dailyRow.date,
              metrics: {
                trueContributionMargin: dailyRow.contributionMargin,
                trueContributionMarginPct:
                  dailyRow.revenue > 0
                    ? (dailyRow.contributionMargin / dailyRow.revenue) * 100
                    : 0,
                contributionProfit: dailyRow.contributionProfit,
                revenue: dailyRow.revenue,
                adSpend: dailyRow.adSpend,
                cogs: dailyRow.cogs,
                gatewayFees: dailyRow.gatewayFees,
                netFulfillmentCost: dailyRow.shipfusionFulfillmentCost,
                fulfillmentInvoiceTotal: dailyRow.fulfillmentGross,
                shippingCollected: dailyRow.shippingCollected,
                shopifyRevenue: dailyRow.shopifyRevenue,
                amazonRevenue: dailyRow.amazonRevenue,
                tiktokRevenue: dailyRow.tiktokRevenue,
                shopifyCOGS: dailyRow.shopifyCogs,
                amazonCOGS: dailyRow.amazonCogs,
                tiktokCOGS: dailyRow.tiktokCogs,
              },
              giftStats: {
                giftCOGS: dailyRow.giftCogs,
                giftRetailDiscounted: dailyRow.giftRetailDiscounted,
              },
              fulfillmentSource: dailyRow.fulfillmentSource,
              fulfillmentBreakdown: {
                pickPack: dailyRow.fulfillmentPickPack,
                shipping: dailyRow.fulfillmentShipping,
                packaging: dailyRow.fulfillmentPackaging,
                insurance: dailyRow.fulfillmentInsurance,
                storage: dailyRow.fulfillmentStorage,
                other: dailyRow.fulfillmentOther,
              },
            }
          : null,
        loopMetrics,
        metricsSource: summed.fromStore ? "daily_metrics" : "daily_metrics+live_fallback",
        fulfillmentCoverage: buildFulfillmentCoverage(summed),
      })
    }

    cache.set(cacheKey, { data: responseData, ts: Date.now() })
    return NextResponse.json(responseData)
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal error" },
      { status: 500 }
    )
  }
}

function buildFulfillmentCoverage(summed: {
  daysUsed: string[]
  missingDays: string[]
  fulfillmentSource: string | null
  fulfillmentBreakdown: {
    pickPack: number
    shipping: number
    packaging: number
    insurance: number
    storage: number
    other: number
  }
  fulfillmentDaySources: { date: string; source: string | null; gross: number }[]
  metrics: { shippingCollected: number; fulfillmentInvoiceTotal: number; netFulfillmentCost: number }
}) {
  const gross =
    summed.fulfillmentBreakdown.pickPack +
    summed.fulfillmentBreakdown.shipping +
    summed.fulfillmentBreakdown.packaging +
    summed.fulfillmentBreakdown.insurance +
    summed.fulfillmentBreakdown.storage +
    summed.fulfillmentBreakdown.other
  const daysWithoutShipFusion = summed.fulfillmentDaySources.filter(
    (d) => d.source === "manual" || d.source == null || d.gross === 0
  ).length
  const hasManualBackup =
    summed.fulfillmentSource === "manual" ||
    summed.fulfillmentSource === "mixed" ||
    summed.fulfillmentDaySources.some((d) => d.source === "manual" || d.source === "mixed")
  const hasShipFusion =
    summed.fulfillmentSource === "shipfusion" ||
    summed.fulfillmentSource === "mixed" ||
    summed.fulfillmentDaySources.some((d) => d.source === "shipfusion" || d.source === "mixed")
  return {
    source: summed.fulfillmentSource,
    gross,
    shippingCollected: summed.metrics.shippingCollected,
    net: summed.metrics.netFulfillmentCost,
    breakdown: summed.fulfillmentBreakdown,
    daysUsed: summed.daysUsed.length,
    missingDays: summed.missingDays,
    daysWithoutShipFusion,
    hasManualBackup,
    hasShipFusion,
    noShipFusionDataYet: gross === 0 && summed.missingDays.length === 0,
  }
}

function assembleResponse(opts: {
  range: any
  dailySource: any
  loopMetrics: any
  metricsSource: string
  fulfillmentCoverage?: any
}) {
  const { range, dailySource, loopMetrics, metricsSource, fulfillmentCoverage } = opts
  return {
    ...range,
    loopMetrics,
    metricsSource,
    fulfillmentCoverage: fulfillmentCoverage || null,
    dailyContribution: dailySource
      ? {
          date: dailySource.date,
          contributionMargin: dailySource.metrics.trueContributionMargin,
          contributionMarginPct: dailySource.metrics.trueContributionMarginPct,
          contributionProfit: dailySource.metrics.contributionProfit,
          revenue: dailySource.metrics.revenue,
          adSpend: dailySource.metrics.adSpend,
          cogs: dailySource.metrics.cogs,
          gatewayFees: dailySource.metrics.gatewayFees,
          netFulfillmentCost: dailySource.metrics.netFulfillmentCost,
          fulfillmentInvoiceTotal: dailySource.metrics.fulfillmentInvoiceTotal,
          shippingCollected: dailySource.metrics.shippingCollected ?? 0,
          fulfillmentSource: dailySource.fulfillmentSource,
          fulfillmentBreakdown: dailySource.fulfillmentBreakdown,
          components: {
            shopifyRevenue: dailySource.metrics.shopifyRevenue,
            amazonRevenue: dailySource.metrics.amazonRevenue,
            tiktokRevenue: dailySource.metrics.tiktokRevenue,
            shopifyCOGS: dailySource.metrics.shopifyCOGS,
            amazonCOGS: dailySource.metrics.amazonCOGS,
            tiktokCOGS: dailySource.metrics.tiktokCOGS,
            giftCOGS: dailySource.giftStats.giftCOGS,
            giftRetailDiscounted: dailySource.giftStats.giftRetailDiscounted,
            gatewayFees: dailySource.metrics.gatewayFees,
            netFulfillmentCost: dailySource.metrics.netFulfillmentCost,
          },
          formula:
            "Contribution margin = revenue − ad spend − real COGS − net fulfillment − payment gateway fees (gifts at COGS, not retail)",
        }
      : null,
    gatewayFees: range.gatewayFees,
    gatewayFeesDaily: range.gatewayFeesDaily,
    gatewayFeesSource: range.gatewayFeesSource,
    fulfillmentSource: range.fulfillmentSource,
    fulfillmentBreakdown: range.fulfillmentBreakdown,
  }
}
