/**
 * Shared live metrics builder used by GET /api and the daily_metrics refresh job.
 * Calculation formulas are unchanged — this only centralizes the assemble step.
 */

import { computeMetrics } from "./calculations"
import { processShopifyData } from "./shopify"
import { fetchTWData, processTWData } from "./triplewhale"
import { fetchGatewayFeesFromSql, extractGatewayFeesFromSummary } from "./gateway-fees"
import { getCogsVariants, getFixedCosts, getFulfillmentInvoices, getGiftMappings } from "./db"
import { buildGiftCogsAliasMap, resolveUnitCogs } from "./gift-mapping"
import { resolveFulfillmentForRange } from "./fulfillment"
import { getCachedLoopData } from "./loop-cache"
import type { LoopData } from "./loop"

export interface BuiltMetrics {
  metrics: ReturnType<typeof computeMetrics>
  ltvCac?: import("./ltv-cac").LtvCacResult
  cogsBreakdown: {
    variantKey: string
    variantName: string
    totalCost: number
    unitsSold: number
    totalCOGS: number
  }[]
  variants: Awaited<ReturnType<typeof getCogsVariants>>
  fixedCosts: Awaited<ReturnType<typeof getFixedCosts>>
  fulfillmentInvoices: Awaited<ReturnType<typeof getFulfillmentInvoices>>
  fulfillmentSource: string
  fulfillmentBreakdown: {
    pickPack: number
    shipping: number
    packaging: number
    insurance: number
    storage: number
    other: number
  }
  fulfillmentMeta: {
    apiContribution: number
    manualContribution: number
    shipfusionAuthMode: string
    shipfusionError: string | null
    shipfusionInvoiceCount: number
    shipfusionTransactionCount: number
    apiDatesCovered: string[]
  }
  twData: ReturnType<typeof processTWData>
  loopData: LoopData
  subscriptionRevenue: number
  subscriptionOrderCount: number
  giftMappings: Awaited<ReturnType<typeof getGiftMappings>>
  giftStats: {
    giftUnitsSold: Record<string, number>
    giftRetailDiscounted: number
    giftCOGS: number
    giftOrderCount: number
    giftCogsAliasHits: Record<string, string>
  }
  discountStats: import("./discounts").DiscountStats
  gatewayFees: number
  gatewayFeesDaily: Record<string, number>
  gatewayFeesSource: "tw_sql" | "tw_summary" | "none"
  dataSources: Record<string, unknown>
  _shopifyDebug: unknown
}

/**
 * Live-compute metrics for an inclusive Pacific date range.
 * Does NOT call the Loop Admin API page scan — reads persisted Loop cache only.
 */
export async function buildMetricsForRange(
  dateStart: string,
  dateEnd: string
): Promise<BuiltMetrics> {
  const fulfillmentInvoicesPromise = getFulfillmentInvoices()
  const [cogsVariants, fixedCostItems, fulfillmentInvoices, giftMappings, shopifyData, twRaw, loopData, fulfillment, gatewaySql] =
    await Promise.all([
      getCogsVariants(),
      getFixedCosts(),
      fulfillmentInvoicesPromise,
      getGiftMappings(),
      processShopifyData(dateStart, dateEnd),
      fetchTWData(dateStart, dateEnd),
      getCachedLoopData(),
      fulfillmentInvoicesPromise.then((invoices) =>
        resolveFulfillmentForRange(dateStart, dateEnd, invoices)
      ),
      fetchGatewayFeesFromSql(dateStart, dateEnd).catch(() => null),
    ])

  const fulfillmentInvoiceTotal = fulfillment.fulfillmentInvoiceTotal

  const cogsMap = new Map<string, number>()
  for (const v of cogsVariants) {
    cogsMap.set(v.variantKey, v.totalCost || 0)
  }
  const giftAliasMap = buildGiftCogsAliasMap(giftMappings)

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

  const gatewayFeesResult = gatewaySql ?? (() => {
    const total = extractGatewayFeesFromSummary(twRaw)
    const daily: Record<string, number> = {}
    if (total !== 0) daily[dateEnd] = total
    return {
      total,
      daily,
      source: (total !== 0 || (twRaw && !twRaw.error && Array.isArray(twRaw.metrics))
        ? "tw_summary"
        : "none") as "tw_summary" | "none",
      error: gatewaySql === null ? "TW SQL unavailable" : undefined,
    }
  })()

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
    gatewayFees: gatewayFeesResult.total,
    adSpend: twData.adSpend,
    twLtv: twData.ltv,
    fixedCostsMonthly: fixedCostItems.map((fc) => fc.monthlyCost),
    dateRange: { start: dateStart, end: dateEnd },
  })

  // LTV:CAC overlay (does not change CM). Loop subscriber LTV + Shopify-attributable CAC.
  const { applyLtvCacToMetrics } = await import("./ltv-cac-apply")
  const { metrics: metricsWithLtv, ltvCac } = await applyLtvCacToMetrics(metrics, {
    totalAdSpend: twData.adSpend,
    channelSpend: twData.channelSpend,
    shopifyNewCustomers: shopifyData.newCustomers,
    twLtvFallback: twData.ltv,
  })

  const cogsBreakdown = cogsVariants.map((v) => ({
    variantKey: v.variantKey,
    variantName: v.variantName,
    totalCost: v.totalCost,
    unitsSold: shopifyData.variantUnitsSold[v.variantKey] || 0,
    totalCOGS: (shopifyData.variantUnitsSold[v.variantKey] || 0) * v.totalCost,
  }))

  return {
    metrics: metricsWithLtv,
    ltvCac,
    cogsBreakdown,
    variants: cogsVariants,
    fixedCosts: fixedCostItems,
    fulfillmentInvoices,
    fulfillmentSource: fulfillment.fulfillmentSource,
    fulfillmentBreakdown: fulfillment.fulfillmentBreakdown,
    fulfillmentMeta: {
      apiContribution: fulfillment.apiContribution,
      manualContribution: fulfillment.manualContribution,
      shipfusionAuthMode: fulfillment.shipfusionAuthMode,
      shipfusionError: fulfillment.shipfusionError || null,
      shipfusionInvoiceCount: fulfillment.shipfusionInvoiceCount,
      shipfusionTransactionCount: fulfillment.shipfusionTransactionCount,
      apiDatesCovered: fulfillment.apiDatesCovered,
    },
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
    discountStats: shopifyData.discountStats,
    gatewayFees: gatewayFeesResult.total,
    gatewayFeesDaily: gatewayFeesResult.daily,
    gatewayFeesSource: gatewayFeesResult.source,
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
        formula: "revenue − adSpend − realCOGS − netFulfillment − gatewayFees",
        revenue: "Shopify subtotal + TW Amazon gross sales + TW TikTok Shop gross sales",
        adSpend: "TW blendedAds",
        cogs: "cogs_variants × units sold (gift lines at COGS via alias map; Amazon/TikTok estimated at Shopify COGS rate)",
        fulfillment:
          "ShipFusion shipment invoices (primary) + manual fulfillment_invoices for storage / uncovered days; net of Shopify shipping collected",
        gatewayFees: "TW orders_table.payment_gateway_costs (Shopify only) or summary payment_gateway_costs",
        note: "Does not modify Triple Whale calculations. Free-gift retail is NOT counted as revenue; gift COGS IS included. Amazon/TikTok marketplace fees stay separate.",
      },
      fulfillment: {
        primary: "ShipFusion GET /invoices + /invoices/{id}?type=shipment",
        auth: "X-SHIPFUSION-TOKEN (OpenAPI); Bearer fallback if token header fails",
        categories: "pickPack←services, shipping, packaging, insurance, other←tax/residual; storage←manual only",
        precedence:
          "API covers pickPack/shipping/packaging/insurance/other on billed dates; manual storage always added; non-storage manuals only on days without API coverage",
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
