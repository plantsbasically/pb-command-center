import { NextRequest, NextResponse } from "next/server"
import { getBasicAuthHeader, authHeaders } from "@/lib/auth"
import { todayPacific } from "@/lib/dates"
import { buildContributionHero } from "@/lib/contribution-hero"

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
        dateStart,
        dateEnd,
        todayISO: today,
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
          ltvCac: rangeData.ltvCac,
        },
        todaySource: {
          date: today,
          metrics: dailySource.metrics,
          giftStats: dailySource.giftStats,
          fulfillmentSource: dailySource.fulfillmentSource,
          fulfillmentBreakdown: dailySource.fulfillmentBreakdown,
        },
        loopMetrics,
        metricsSource: "live",
        ltvCac: rangeData.ltvCac,
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
        dateStart,
        dateEnd,
        todayISO: today,
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
              note: "Summed from daily_metrics Pacific rows; ratios from totals. Hero uses range totals.",
            },
            fulfillment: {
              primary: "ShipFusion per-shipment charges (daily_metrics breakdown)",
              net: "fulfillment_gross − shipping_collected → shipfusion_fulfillment_cost",
            },
            discounts: {
              note: "Information-only. Never subtracted from revenue or CM.",
            },
            ltvCac: {
              ltv: "Loop loop_ltv_snapshot customer-weighted subscriber segments (Order1–Order4+); fallback TW uniqueCustomerSales",
              cac: "Shopify-attributable ad spend (blended − Amazon Ads − TikTok ads) ÷ Shopify new customers",
            },
          },
          _shopifyDebug: null,
          ltvCac: store.ltvCac,
        },
        todaySource: dailyRow
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
        ltvCac: store.ltvCac,
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
  dateStart: string
  dateEnd: string
  todayISO: string
  range: any
  /** Pacific-today snapshot for optional secondary line — NOT the hero total */
  todaySource: any
  loopMetrics: any
  metricsSource: string
  fulfillmentCoverage?: any
  ltvCac?: any
}) {
  const {
    dateStart,
    dateEnd,
    todayISO,
    range,
    todaySource,
    loopMetrics,
    metricsSource,
    fulfillmentCoverage,
    ltvCac,
  } = opts

  // Hero must use the selected range totals (summed daily_metrics / live range).
  // Previously dailyContribution was always Pacific today — that was the bug.
  const contributionMargin = buildContributionHero({
    dateStart,
    dateEnd,
    todayISO,
    rangeMetrics: range.metrics,
    giftStats: {
      giftCOGS: range.giftStats?.giftCOGS ?? 0,
      giftRetailDiscounted: range.giftStats?.giftRetailDiscounted ?? 0,
    },
    fulfillmentSource: range.fulfillmentSource,
    fulfillmentBreakdown: range.fulfillmentBreakdown,
    todayMetrics: todaySource?.metrics
      ? {
          trueContributionMargin: todaySource.metrics.trueContributionMargin,
          trueContributionMarginPct: todaySource.metrics.trueContributionMarginPct,
          revenue: todaySource.metrics.revenue,
        }
      : null,
  })

  return {
    ...range,
    loopMetrics,
    metricsSource,
    fulfillmentCoverage: fulfillmentCoverage || null,
    ltvCac: ltvCac || range.ltvCac || null,
    // Primary hero payload (range). Kept under dailyContribution for UI compat.
    dailyContribution: contributionMargin,
    contributionMargin,
    gatewayFees: range.gatewayFees,
    gatewayFeesDaily: range.gatewayFeesDaily,
    gatewayFeesSource: range.gatewayFeesSource,
    fulfillmentSource: range.fulfillmentSource,
    fulfillmentBreakdown: range.fulfillmentBreakdown,
  }
}
