import { NextRequest, NextResponse } from "next/server"
import { getBasicAuthHeader, authHeaders } from "@/lib/auth"

// Allow up to 90s — sequential Shopify cursor pagination can take 20-30s for large date ranges
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

function todayISO(): string {
  return new Date().toISOString().split("T")[0]
}

async function buildMetricsForRange(dateStart: string, dateEnd: string) {
  const { computeMetrics } = await import("@/lib/calculations")
  const { processShopifyData } = await import("@/lib/shopify")
  const { fetchTWData, processTWData } = await import("@/lib/triplewhale")
  const { getCogsVariants, getFixedCosts, getFulfillmentInvoices, getGiftMappings } = await import("@/lib/db")
  const { fetchLoopData } = await import("@/lib/loop")
  const { buildGiftCogsAliasMap, resolveUnitCogs } = await import("@/lib/gift-mapping")

  const [cogsVariants, fixedCostItems, fulfillmentInvoices, giftMappings, shopifyData, twRaw, loopData] = await Promise.all([
    getCogsVariants(),
    getFixedCosts(),
    getFulfillmentInvoices(),
    getGiftMappings(),
    processShopifyData(dateStart, dateEnd),
    fetchTWData(dateStart, dateEnd),
    fetchLoopData(),
  ])

  function prorateInvoices(invoices: typeof fulfillmentInvoices): number {
    const rangeStart = new Date(dateStart)
    const rangeEnd = new Date(dateEnd)
    let total = 0
    for (const inv of invoices) {
      const invStart = new Date(inv.periodStart)
      const invEnd = new Date(inv.periodEnd)
      const overlapStart = new Date(Math.max(rangeStart.getTime(), invStart.getTime()))
      const overlapEnd = new Date(Math.min(rangeEnd.getTime(), invEnd.getTime()))
      if (overlapStart > overlapEnd) continue
      const overlapDays = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1
      const invoiceDays = Math.round((invEnd.getTime() - invStart.getTime()) / 86400000) + 1
      total += inv.amount * (overlapDays / invoiceDays)
    }
    return total
  }

  const fulfillmentInvoiceTotal = prorateInvoices(fulfillmentInvoices)

  const cogsMap = new Map<string, number>()
  for (const v of cogsVariants) {
    cogsMap.set(v.variantKey, v.totalCost || 0)
  }
  const giftAliasMap = buildGiftCogsAliasMap(giftMappings)

  // Real COGS: every sold unit (including free gifts) at cogs_variants cost.
  // Gift SKUs with $0 configured COGS fall back to cogsAlias (e.g. JJ33CP-FREE → JJ33CP-SS).
  let totalCOGS = 0
  let giftCOGS = 0
  const giftCogsAliasHits: Record<string, string> = {}
  for (const [variantKey, units] of Object.entries(shopifyData.variantUnitsSold)) {
    const { unitCogs, usedAlias } = resolveUnitCogs(variantKey, cogsMap, giftAliasMap)
    const line = units * unitCogs
    totalCOGS += line
    if (shopifyData.giftUnitsSold[variantKey]) {
      giftCOGS += (shopifyData.giftUnitsSold[variantKey] || 0) * unitCogs
      if (usedAlias) giftCogsAliasHits[variantKey] = usedAlias
    }
  }

  const twData = processTWData(twRaw)
  const amazonFeeInvoiceTotal = twData.amazonFees
  const tiktokFees = twData.tiktokFees

  const metrics = computeMetrics({
    shopifyRevenue: shopifyData.revenue,
    amazonRevenue: twData.amazonRevenue,
    tiktokRevenue: twData.tiktokRevenue,
    shopifyOrdersCount: shopifyData.ordersCount,
    shopifyAOV: shopifyData.aov,
    shopifyNewCustomers: shopifyData.newCustomers,
    shopifyTotalCustomers: shopifyData.totalCustomers,
    shopifyCogsByVariantSold: totalCOGS,
    shippingCollected: shopifyData.shippingCollected,
    fulfillmentInvoiceTotal,
    amazonFeeInvoiceTotal,
    tiktokFees,
    adSpend: twData.adSpend,
    twLtv: twData.ltv,
    fixedCostsMonthly: fixedCostItems.map((fc) => fc.monthlyCost),
    dateRange: { start: dateStart, end: dateEnd },
  })

  const cogsBreakdown = cogsVariants.map((v) => ({
    variantKey: v.variantKey,
    variantName: v.variantName,
    totalCost: v.totalCost,
    unitsSold: shopifyData.variantUnitsSold[v.variantKey] || 0,
    totalCOGS: (shopifyData.variantUnitsSold[v.variantKey] || 0) * v.totalCost,
  }))

  return {
    metrics,
    cogsBreakdown,
    variants: cogsVariants,
    fixedCosts: fixedCostItems,
    fulfillmentInvoices,
    twData,
    loopData,
    subscriptionRevenue: shopifyData.subscriptionRevenue,
    subscriptionOrderCount: shopifyData.subscriptionOrderCount,
    giftMappings,
    giftStats: {
      giftUnitsSold: shopifyData.giftUnitsSold,
      giftRetailDiscounted: shopifyData.giftRetailDiscounted,
      giftCOGS,
      giftOrderCount: shopifyData._debug.giftOrderCount,
      giftCogsAliasHits,
    },
    // Information-only — never subtracted from revenue or used in CM / net profit.
    discountStats: shopifyData.discountStats,
    dataSources: {
      tiktok: {
        primary: "Triple Whale summary metric tiktokShopsGrossSales (TikTok Shop Gross Sales)",
        parallels: "amazonProductItemPrice for Amazon",
        shopifyCrossCheck: {
          revenue: shopifyData.tiktokShopifyRevenue,
          orders: shopifyData.tiktokShopifyOrderCount,
          note: "Expected ~0. Shopify source 3890849 is Shop Cash, not TikTok. TikTok Shop is a separate TW integration.",
        },
        twOrderRevenue: twData.tiktokOrderRevenue,
        twOrders: twData.tiktokOrders,
        twFees: twData.tiktokFees,
      },
      contributionMargin: {
        formula: "revenue − adSpend − realCOGS",
        revenue: "Shopify subtotal + TW Amazon gross sales + TW TikTok Shop gross sales",
        adSpend: "TW blendedAds",
        cogs: "cogs_variants × units sold (gift lines at COGS via alias map; Amazon/TikTok estimated at Shopify COGS rate)",
        note: "Does not modify Triple Whale calculations. Free-gift retail is NOT counted as revenue; gift COGS IS included.",
      },
      discounts: {
        note: "Information-only display. discountStats is never subtracted from revenue or fed into CM.",
        total: "Sum of order.total_discounts (matches Shopify Analytics Discounts directionally)",
        freeGifts: "Allocations on gift lines / 'Free Welcome Gift' apps — excluded from promotional",
        subscription: "Loop selling-plan autos titled SAVE 25%/30%/35% (and subscription-worded apps)",
        promotional: "discount_code + other non-gift non-subscription markdowns on paid lines",
      },
    },
    _shopifyDebug: shopifyData._debug,
  }
}

export async function GET(req: NextRequest) {
  const authError = checkAuth(req)
  if (authError) return authError

  try {
    const { searchParams } = new URL(req.url)
    const dateStart = searchParams.get("start") || todayISO()
    const dateEnd = searchParams.get("end") || dateStart
    const bust = searchParams.get("bust") === "1"

    const cacheKey = `${dateStart}|${dateEnd}`
    const cached = cache.get(cacheKey)
    if (!bust && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data)
    }

    const today = todayISO()
    const needsSeparateDaily = !(dateStart === today && dateEnd === today)

    const [rangeData, dailyData] = await Promise.all([
      buildMetricsForRange(dateStart, dateEnd),
      needsSeparateDaily ? buildMetricsForRange(today, today) : Promise.resolve(null),
    ])

    const dailySource = dailyData || rangeData
    // Optional Loop ingest summary (additive only — does not alter existing fields/calcs).
    const { getLoopMetricsSummary } = await import("@/lib/loop-metrics")
    const loopMetrics = await getLoopMetricsSummary(dateStart, dateEnd)
    const responseData = {
      ...rangeData,
      loopMetrics,
      dailyContribution: {
        date: today,
        contributionMargin: dailySource.metrics.trueContributionMargin,
        contributionMarginPct: dailySource.metrics.trueContributionMarginPct,
        revenue: dailySource.metrics.revenue,
        adSpend: dailySource.metrics.adSpend,
        cogs: dailySource.metrics.cogs,
        components: {
          shopifyRevenue: dailySource.metrics.shopifyRevenue,
          amazonRevenue: dailySource.metrics.amazonRevenue,
          tiktokRevenue: dailySource.metrics.tiktokRevenue,
          shopifyCOGS: dailySource.metrics.shopifyCOGS,
          amazonCOGS: dailySource.metrics.amazonCOGS,
          tiktokCOGS: dailySource.metrics.tiktokCOGS,
          giftCOGS: dailySource.giftStats.giftCOGS,
          giftRetailDiscounted: dailySource.giftStats.giftRetailDiscounted,
        },
        formula: "Contribution margin = revenue − ad spend − real COGS (gifts at COGS, not retail)",
      },
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
