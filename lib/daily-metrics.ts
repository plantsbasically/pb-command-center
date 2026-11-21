/**
 * Persisted Pacific-day P&L rollups (`daily_metrics`) + range summing.
 *
 * Refresh job recomputes today frequently and yesterday after midnight PT.
 * Dashboard ranges SUM stored rows (ratios from totals, never averaged).
 * Missing days fall back to live compute. CM formula unchanged.
 */

import type { BuiltMetrics } from "./build-metrics"
import type { MetricsResult } from "./calculations"
import type { ChannelSpend } from "./triplewhale"
import type { DiscountStats } from "./discounts"

// Date helpers are dynamically imported in async paths so Node's test runner can
// load this module's pure sumDailyMetricsRows without resolving ./dates.

/** Advisory lock key for daily_metrics refresh (distinct from schema lock). */
export const DAILY_METRICS_ADVISORY_LOCK = 872_014_002

export type DailyMetricsStatus = "complete" | "in_progress"

export interface DailyMetricsRow {
  date: string
  revenue: number
  shopifyRevenue: number
  amazonRevenue: number
  tiktokRevenue: number
  cogs: number
  shopifyCogs: number
  amazonCogs: number
  tiktokCogs: number
  giftCogs: number
  giftRetailDiscounted: number
  adSpend: number
  adSpendFacebook: number
  adSpendGoogle: number
  adSpendMicrosoft: number
  adSpendTiktok: number
  adSpendSnapchat: number
  adSpendPinterest: number
  adSpendAmazon: number
  gatewayFees: number
  shippingCollected: number
  fulfillmentGross: number
  shipfusionFulfillmentCost: number
  fulfillmentPickPack: number
  fulfillmentShipping: number
  fulfillmentPackaging: number
  fulfillmentInsurance: number
  fulfillmentStorage: number
  fulfillmentOther: number
  fulfillmentSource: string | null
  amazonFeeInvoiceTotal: number
  tiktokFees: number
  contributionMargin: number
  contributionProfit: number
  fixedCosts: number
  netProfit: number
  ordersCount: number
  newCustomers: number
  totalCustomers: number
  subscriptionRevenue: number
  subscriptionOrderCount: number
  discountTotal: number
  discountPromotional: number
  discountSubscription: number
  discountFreeGifts: number
  discountOther: number
  ltv: number
  attributedRevenue: number
  status: DailyMetricsStatus
  source: string | null
  updatedAt?: string | Date
}

export interface SummedDailyMetrics {
  metrics: MetricsResult
  twData: {
    adSpend: number
    channelSpend: ChannelSpend
    attributedRevenue: number
    blendedCac: number
    blendedRoas: number
    amazonFees: number
    ltv: number
  }
  subscriptionRevenue: number
  subscriptionOrderCount: number
  giftStats: {
    giftCOGS: number
    giftRetailDiscounted: number
    giftUnitsSold: Record<string, number>
    giftOrderCount: number
    giftCogsAliasHits: Record<string, string>
  }
  discountStats: DiscountStats
  gatewayFees: number
  gatewayFeesDaily: Record<string, number>
  gatewayFeesSource: "daily_metrics" | "tw_sql" | "tw_summary" | "none"
  fulfillmentSource: string | null
  fulfillmentBreakdown: {
    pickPack: number
    shipping: number
    packaging: number
    insurance: number
    storage: number
    other: number
  }
  daysUsed: string[]
  missingDays: string[]
  fromStore: boolean
  /** Per-day fulfillment source for UI coverage indicators */
  fulfillmentDaySources: { date: string; source: string | null; gross: number }[]
}

function emptyDiscountStats(): DiscountStats {
  return {
    totalDiscounts: 0,
    byCategory: { promotional: 0, subscription: 0, freeGifts: 0, other: 0 },
    topCodes: [],
    ordersWithDiscounts: 0,
    allocationSum: 0,
  }
}

/** Map a live BuiltMetrics (single day) → DailyMetricsRow. */
export function builtMetricsToDailyRow(
  date: string,
  built: BuiltMetrics,
  status: DailyMetricsStatus
): DailyMetricsRow {
  const m = built.metrics
  const ch = built.twData.channelSpend
  const fb = built.fulfillmentBreakdown
  const ds = built.discountStats
  return {
    date,
    revenue: m.revenue,
    shopifyRevenue: m.shopifyRevenue,
    amazonRevenue: m.amazonRevenue,
    tiktokRevenue: m.tiktokRevenue,
    cogs: m.cogs,
    shopifyCogs: m.shopifyCOGS,
    amazonCogs: m.amazonCOGS,
    tiktokCogs: m.tiktokCOGS,
    giftCogs: built.giftStats.giftCOGS,
    giftRetailDiscounted: built.giftStats.giftRetailDiscounted,
    adSpend: m.adSpend,
    adSpendFacebook: ch.facebook,
    adSpendGoogle: ch.google,
    adSpendMicrosoft: ch.microsoft,
    adSpendTiktok: ch.tiktok,
    adSpendSnapchat: ch.snapchat,
    adSpendPinterest: ch.pinterest,
    adSpendAmazon: ch.amazonAds,
    gatewayFees: m.gatewayFees,
    shippingCollected: m.shippingCollected,
    fulfillmentGross: m.fulfillmentInvoiceTotal,
    shipfusionFulfillmentCost: m.netFulfillmentCost,
    fulfillmentPickPack: fb.pickPack,
    fulfillmentShipping: fb.shipping,
    fulfillmentPackaging: fb.packaging,
    fulfillmentInsurance: fb.insurance,
    fulfillmentStorage: fb.storage,
    fulfillmentOther: fb.other,
    fulfillmentSource: built.fulfillmentSource,
    amazonFeeInvoiceTotal: m.amazonFeeInvoiceTotal,
    tiktokFees: m.tiktokFees,
    contributionMargin: m.trueContributionMargin,
    contributionProfit: m.contributionProfit,
    fixedCosts: m.fixedCosts,
    netProfit: m.netProfit,
    ordersCount: m.ordersCount,
    newCustomers: m.newCustomers,
    totalCustomers: m.totalCustomers,
    subscriptionRevenue: built.subscriptionRevenue,
    subscriptionOrderCount: built.subscriptionOrderCount,
    discountTotal: ds.totalDiscounts,
    discountPromotional: ds.byCategory.promotional,
    discountSubscription: ds.byCategory.subscription,
    discountFreeGifts: ds.byCategory.freeGifts,
    discountOther: ds.byCategory.other,
    ltv: m.ltv,
    attributedRevenue: built.twData.attributedRevenue,
    status,
    source: "live_compute",
  }
}

/**
 * Sum daily rows into range metrics. Ratios (CM %, ROAS, AOV, CAC) are computed
 * from summed totals — never averaged across days.
 */
export function sumDailyMetricsRows(
  rows: DailyMetricsRow[],
  dateRange: { start: string; end: string },
  missingDays: string[] = []
): SummedDailyMetrics {
  const zero: DailyMetricsRow = {
    date: "",
    revenue: 0,
    shopifyRevenue: 0,
    amazonRevenue: 0,
    tiktokRevenue: 0,
    cogs: 0,
    shopifyCogs: 0,
    amazonCogs: 0,
    tiktokCogs: 0,
    giftCogs: 0,
    giftRetailDiscounted: 0,
    adSpend: 0,
    adSpendFacebook: 0,
    adSpendGoogle: 0,
    adSpendMicrosoft: 0,
    adSpendTiktok: 0,
    adSpendSnapchat: 0,
    adSpendPinterest: 0,
    adSpendAmazon: 0,
    gatewayFees: 0,
    shippingCollected: 0,
    fulfillmentGross: 0,
    shipfusionFulfillmentCost: 0,
    fulfillmentPickPack: 0,
    fulfillmentShipping: 0,
    fulfillmentPackaging: 0,
    fulfillmentInsurance: 0,
    fulfillmentStorage: 0,
    fulfillmentOther: 0,
    fulfillmentSource: null,
    amazonFeeInvoiceTotal: 0,
    tiktokFees: 0,
    contributionMargin: 0,
    contributionProfit: 0,
    fixedCosts: 0,
    netProfit: 0,
    ordersCount: 0,
    newCustomers: 0,
    totalCustomers: 0,
    subscriptionRevenue: 0,
    subscriptionOrderCount: 0,
    discountTotal: 0,
    discountPromotional: 0,
    discountSubscription: 0,
    discountFreeGifts: 0,
    discountOther: 0,
    ltv: 0,
    attributedRevenue: 0,
    status: "complete",
    source: null,
  }

  const tot = rows.reduce((acc, r) => {
    acc.revenue += r.revenue
    acc.shopifyRevenue += r.shopifyRevenue
    acc.amazonRevenue += r.amazonRevenue
    acc.tiktokRevenue += r.tiktokRevenue
    acc.cogs += r.cogs
    acc.shopifyCogs += r.shopifyCogs
    acc.amazonCogs += r.amazonCogs
    acc.tiktokCogs += r.tiktokCogs
    acc.giftCogs += r.giftCogs
    acc.giftRetailDiscounted += r.giftRetailDiscounted
    acc.adSpend += r.adSpend
    acc.adSpendFacebook += r.adSpendFacebook
    acc.adSpendGoogle += r.adSpendGoogle
    acc.adSpendMicrosoft += r.adSpendMicrosoft
    acc.adSpendTiktok += r.adSpendTiktok
    acc.adSpendSnapchat += r.adSpendSnapchat
    acc.adSpendPinterest += r.adSpendPinterest
    acc.adSpendAmazon += r.adSpendAmazon
    acc.gatewayFees += r.gatewayFees
    acc.shippingCollected += r.shippingCollected
    acc.fulfillmentGross += r.fulfillmentGross
    acc.shipfusionFulfillmentCost += r.shipfusionFulfillmentCost
    acc.fulfillmentPickPack += r.fulfillmentPickPack
    acc.fulfillmentShipping += r.fulfillmentShipping
    acc.fulfillmentPackaging += r.fulfillmentPackaging
    acc.fulfillmentInsurance += r.fulfillmentInsurance
    acc.fulfillmentStorage += r.fulfillmentStorage
    acc.fulfillmentOther += r.fulfillmentOther
    acc.amazonFeeInvoiceTotal += r.amazonFeeInvoiceTotal
    acc.tiktokFees += r.tiktokFees
    acc.contributionMargin += r.contributionMargin
    acc.contributionProfit += r.contributionProfit
    acc.fixedCosts += r.fixedCosts
    acc.netProfit += r.netProfit
    acc.ordersCount += r.ordersCount
    acc.newCustomers += r.newCustomers
    acc.totalCustomers += r.totalCustomers
    acc.subscriptionRevenue += r.subscriptionRevenue
    acc.subscriptionOrderCount += r.subscriptionOrderCount
    acc.discountTotal += r.discountTotal
    acc.discountPromotional += r.discountPromotional
    acc.discountSubscription += r.discountSubscription
    acc.discountFreeGifts += r.discountFreeGifts
    acc.discountOther += r.discountOther
    acc.attributedRevenue += r.attributedRevenue
    // LTV is all-time — keep the latest non-zero
    if (r.ltv > 0) acc.ltv = r.ltv
    return acc
  }, { ...zero })

  const revenue = tot.revenue
  const grossProfit = revenue - tot.cogs
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0
  const contributionMarginPct =
    revenue > 0 ? (tot.contributionMargin / revenue) * 100 : 0
  const contributionProfitPct =
    revenue > 0 ? (tot.contributionProfit / revenue) * 100 : 0
  const netMarginPct = revenue > 0 ? (tot.netProfit / revenue) * 100 : 0
  const aov = tot.ordersCount > 0 ? tot.shopifyRevenue / tot.ordersCount : 0
  // Provisional CAC/LTV — overwritten by applyLtvCac after Loop snapshot load.
  // Keep Shopify-attributable spend basis even in the provisional numbers.
  const provisionalCacSpend = Math.max(
    0,
    tot.adSpend - tot.adSpendAmazon - tot.adSpendTiktok
  )
  const cac = tot.newCustomers > 0 ? provisionalCacSpend / tot.newCustomers : 0
  const ltvCacRatio = cac > 0 ? tot.ltv / cac : 0
  const blendedRoas =
    tot.adSpend > 0 ? tot.attributedRevenue / tot.adSpend : 0
  const blendedCac = cac

  let fulfillmentSource: string | null = null
  const sources = new Set(
    rows.map((r) => r.fulfillmentSource).filter(Boolean) as string[]
  )
  if (sources.size === 1) fulfillmentSource = [...sources][0]
  else if (sources.size > 1) fulfillmentSource = "mixed"

  const gatewayFeesDaily: Record<string, number> = {}
  for (const r of rows) {
    if (r.gatewayFees !== 0) gatewayFeesDaily[r.date] = r.gatewayFees
  }

  const metrics: MetricsResult = {
    dateRange,
    revenue,
    shopifyRevenue: tot.shopifyRevenue,
    amazonRevenue: tot.amazonRevenue,
    tiktokRevenue: tot.tiktokRevenue,
    cogs: tot.cogs,
    shopifyCOGS: tot.shopifyCogs,
    amazonCOGS: tot.amazonCogs,
    tiktokCOGS: tot.tiktokCogs,
    grossProfit,
    grossMarginPct,
    shippingCollected: tot.shippingCollected,
    fulfillmentInvoiceTotal: tot.fulfillmentGross,
    netFulfillmentCost: tot.shipfusionFulfillmentCost,
    amazonFeeInvoiceTotal: tot.amazonFeeInvoiceTotal,
    tiktokFees: tot.tiktokFees,
    gatewayFees: tot.gatewayFees,
    adSpend: tot.adSpend,
    contributionProfit: tot.contributionProfit,
    contributionMarginPct: contributionProfitPct,
    trueContributionMargin: tot.contributionMargin,
    trueContributionMarginPct: contributionMarginPct,
    fixedCosts: tot.fixedCosts,
    netProfit: tot.netProfit,
    netMarginPct,
    newCustomers: tot.newCustomers,
    totalCustomers: tot.totalCustomers,
    cac,
    ltv: tot.ltv,
    ltvCacRatio,
    ordersCount: tot.ordersCount,
    aov,
  }

  return {
    metrics,
    twData: {
      adSpend: tot.adSpend,
      channelSpend: {
        facebook: tot.adSpendFacebook,
        google: tot.adSpendGoogle,
        microsoft: tot.adSpendMicrosoft,
        tiktok: tot.adSpendTiktok,
        snapchat: tot.adSpendSnapchat,
        pinterest: tot.adSpendPinterest,
        amazonAds: tot.adSpendAmazon,
      },
      attributedRevenue: tot.attributedRevenue,
      blendedCac,
      blendedRoas,
      amazonFees: tot.amazonFeeInvoiceTotal,
      ltv: tot.ltv,
    },
    subscriptionRevenue: tot.subscriptionRevenue,
    subscriptionOrderCount: tot.subscriptionOrderCount,
    giftStats: {
      giftCOGS: tot.giftCogs,
      giftRetailDiscounted: tot.giftRetailDiscounted,
      giftUnitsSold: {},
      giftOrderCount: 0,
      giftCogsAliasHits: {},
    },
    discountStats: {
      totalDiscounts: tot.discountTotal,
      byCategory: {
        promotional: tot.discountPromotional,
        subscription: tot.discountSubscription,
        freeGifts: tot.discountFreeGifts,
        other: tot.discountOther,
      },
      topCodes: [],
      ordersWithDiscounts: 0,
      allocationSum: tot.discountTotal,
    },
    gatewayFees: tot.gatewayFees,
    gatewayFeesDaily,
    gatewayFeesSource: "daily_metrics",
    fulfillmentSource,
    fulfillmentBreakdown: {
      pickPack: tot.fulfillmentPickPack,
      shipping: tot.fulfillmentShipping,
      packaging: tot.fulfillmentPackaging,
      insurance: tot.fulfillmentInsurance,
      storage: tot.fulfillmentStorage,
      other: tot.fulfillmentOther,
    },
    daysUsed: rows.map((r) => r.date).sort(),
    missingDays,
    fromStore: missingDays.length === 0 && rows.length > 0,
    fulfillmentDaySources: rows.map((r) => ({
      date: r.date,
      source: r.fulfillmentSource,
      gross: r.fulfillmentGross,
    })),
  }
}

function mapRow(r: Record<string, unknown>): DailyMetricsRow {
  return {
    date: String(r.date).slice(0, 10),
    revenue: Number(r.revenue) || 0,
    shopifyRevenue: Number(r.shopify_revenue) || 0,
    amazonRevenue: Number(r.amazon_revenue) || 0,
    tiktokRevenue: Number(r.tiktok_revenue) || 0,
    cogs: Number(r.cogs) || 0,
    shopifyCogs: Number(r.shopify_cogs) || 0,
    amazonCogs: Number(r.amazon_cogs) || 0,
    tiktokCogs: Number(r.tiktok_cogs) || 0,
    giftCogs: Number(r.gift_cogs) || 0,
    giftRetailDiscounted: Number(r.gift_retail_discounted) || 0,
    adSpend: Number(r.ad_spend) || 0,
    adSpendFacebook: Number(r.ad_spend_facebook) || 0,
    adSpendGoogle: Number(r.ad_spend_google) || 0,
    adSpendMicrosoft: Number(r.ad_spend_microsoft) || 0,
    adSpendTiktok: Number(r.ad_spend_tiktok) || 0,
    adSpendSnapchat: Number(r.ad_spend_snapchat) || 0,
    adSpendPinterest: Number(r.ad_spend_pinterest) || 0,
    adSpendAmazon: Number(r.ad_spend_amazon) || 0,
    gatewayFees: Number(r.gateway_fees) || 0,
    shippingCollected: Number(r.shipping_collected) || 0,
    fulfillmentGross: Number(r.fulfillment_gross) || 0,
    shipfusionFulfillmentCost: Number(r.shipfusion_fulfillment_cost) || 0,
    fulfillmentPickPack: Number(r.fulfillment_pick_pack) || 0,
    fulfillmentShipping: Number(r.fulfillment_shipping) || 0,
    fulfillmentPackaging: Number(r.fulfillment_packaging) || 0,
    fulfillmentInsurance: Number(r.fulfillment_insurance) || 0,
    fulfillmentStorage: Number(r.fulfillment_storage) || 0,
    fulfillmentOther: Number(r.fulfillment_other) || 0,
    fulfillmentSource: (r.fulfillment_source as string) || null,
    amazonFeeInvoiceTotal: Number(r.amazon_fee_invoice_total) || 0,
    tiktokFees: Number(r.tiktok_fees) || 0,
    contributionMargin: Number(r.contribution_margin) || 0,
    contributionProfit: Number(r.contribution_profit) || 0,
    fixedCosts: Number(r.fixed_costs) || 0,
    netProfit: Number(r.net_profit) || 0,
    ordersCount: Number(r.orders_count) || 0,
    newCustomers: Number(r.new_customers) || 0,
    totalCustomers: Number(r.total_customers) || 0,
    subscriptionRevenue: Number(r.subscription_revenue) || 0,
    subscriptionOrderCount: Number(r.subscription_order_count) || 0,
    discountTotal: Number(r.discount_total) || 0,
    discountPromotional: Number(r.discount_promotional) || 0,
    discountSubscription: Number(r.discount_subscription) || 0,
    discountFreeGifts: Number(r.discount_free_gifts) || 0,
    discountOther: Number(r.discount_other) || 0,
    ltv: Number(r.ltv) || 0,
    attributedRevenue: Number(r.attributed_revenue) || 0,
    status: (r.status as DailyMetricsStatus) || "complete",
    source: (r.source as string) || null,
    updatedAt: r.updated_at as string | Date | undefined,
  }
}

export async function getDailyMetricsRange(
  start: string,
  end: string
): Promise<DailyMetricsRow[]> {
  const { getDb } = await import("./db")
  const sql = await getDb()
  const rows = await sql`
    SELECT
      date::text AS date,
      revenue, shopify_revenue, amazon_revenue, tiktok_revenue,
      cogs, shopify_cogs, amazon_cogs, tiktok_cogs,
      gift_cogs, gift_retail_discounted,
      ad_spend, ad_spend_facebook, ad_spend_google, ad_spend_microsoft,
      ad_spend_tiktok, ad_spend_snapchat, ad_spend_pinterest, ad_spend_amazon,
      gateway_fees, shipping_collected,
      fulfillment_gross, shipfusion_fulfillment_cost,
      fulfillment_pick_pack, fulfillment_shipping, fulfillment_packaging,
      fulfillment_insurance, fulfillment_storage, fulfillment_other,
      fulfillment_source,
      amazon_fee_invoice_total, tiktok_fees,
      contribution_margin, contribution_profit, fixed_costs, net_profit,
      orders_count, new_customers, total_customers,
      subscription_revenue, subscription_order_count,
      discount_total, discount_promotional, discount_subscription,
      discount_free_gifts, discount_other,
      ltv, attributed_revenue, status, source, updated_at
    FROM daily_metrics
    WHERE date >= ${start}::date AND date <= ${end}::date
    ORDER BY date ASC
  `
  return rows.map((r) => mapRow(r as Record<string, unknown>))
}

export async function upsertDailyMetricsRow(row: DailyMetricsRow): Promise<void> {
  const { getDb } = await import("./db")
  const sql = await getDb()
  await sql`
    INSERT INTO daily_metrics (
      date, revenue, shopify_revenue, amazon_revenue, tiktok_revenue,
      cogs, shopify_cogs, amazon_cogs, tiktok_cogs,
      gift_cogs, gift_retail_discounted,
      ad_spend, ad_spend_facebook, ad_spend_google, ad_spend_microsoft,
      ad_spend_tiktok, ad_spend_snapchat, ad_spend_pinterest, ad_spend_amazon,
      gateway_fees, shipping_collected,
      fulfillment_gross, shipfusion_fulfillment_cost,
      fulfillment_pick_pack, fulfillment_shipping, fulfillment_packaging,
      fulfillment_insurance, fulfillment_storage, fulfillment_other,
      fulfillment_source,
      amazon_fee_invoice_total, tiktok_fees,
      contribution_margin, contribution_profit, fixed_costs, net_profit,
      orders_count, new_customers, total_customers,
      subscription_revenue, subscription_order_count,
      discount_total, discount_promotional, discount_subscription,
      discount_free_gifts, discount_other,
      ltv, attributed_revenue, status, source, updated_at
    ) VALUES (
      ${row.date}::date,
      ${row.revenue}, ${row.shopifyRevenue}, ${row.amazonRevenue}, ${row.tiktokRevenue},
      ${row.cogs}, ${row.shopifyCogs}, ${row.amazonCogs}, ${row.tiktokCogs},
      ${row.giftCogs}, ${row.giftRetailDiscounted},
      ${row.adSpend}, ${row.adSpendFacebook}, ${row.adSpendGoogle}, ${row.adSpendMicrosoft},
      ${row.adSpendTiktok}, ${row.adSpendSnapchat}, ${row.adSpendPinterest}, ${row.adSpendAmazon},
      ${row.gatewayFees}, ${row.shippingCollected},
      ${row.fulfillmentGross}, ${row.shipfusionFulfillmentCost},
      ${row.fulfillmentPickPack}, ${row.fulfillmentShipping}, ${row.fulfillmentPackaging},
      ${row.fulfillmentInsurance}, ${row.fulfillmentStorage}, ${row.fulfillmentOther},
      ${row.fulfillmentSource},
      ${row.amazonFeeInvoiceTotal}, ${row.tiktokFees},
      ${row.contributionMargin}, ${row.contributionProfit}, ${row.fixedCosts}, ${row.netProfit},
      ${row.ordersCount}, ${row.newCustomers}, ${row.totalCustomers},
      ${row.subscriptionRevenue}, ${row.subscriptionOrderCount},
      ${row.discountTotal}, ${row.discountPromotional}, ${row.discountSubscription},
      ${row.discountFreeGifts}, ${row.discountOther},
      ${row.ltv}, ${row.attributedRevenue}, ${row.status}, ${row.source}, NOW()
    )
    ON CONFLICT (date) DO UPDATE SET
      revenue = EXCLUDED.revenue,
      shopify_revenue = EXCLUDED.shopify_revenue,
      amazon_revenue = EXCLUDED.amazon_revenue,
      tiktok_revenue = EXCLUDED.tiktok_revenue,
      cogs = EXCLUDED.cogs,
      shopify_cogs = EXCLUDED.shopify_cogs,
      amazon_cogs = EXCLUDED.amazon_cogs,
      tiktok_cogs = EXCLUDED.tiktok_cogs,
      gift_cogs = EXCLUDED.gift_cogs,
      gift_retail_discounted = EXCLUDED.gift_retail_discounted,
      ad_spend = EXCLUDED.ad_spend,
      ad_spend_facebook = EXCLUDED.ad_spend_facebook,
      ad_spend_google = EXCLUDED.ad_spend_google,
      ad_spend_microsoft = EXCLUDED.ad_spend_microsoft,
      ad_spend_tiktok = EXCLUDED.ad_spend_tiktok,
      ad_spend_snapchat = EXCLUDED.ad_spend_snapchat,
      ad_spend_pinterest = EXCLUDED.ad_spend_pinterest,
      ad_spend_amazon = EXCLUDED.ad_spend_amazon,
      gateway_fees = EXCLUDED.gateway_fees,
      shipping_collected = EXCLUDED.shipping_collected,
      fulfillment_gross = EXCLUDED.fulfillment_gross,
      shipfusion_fulfillment_cost = EXCLUDED.shipfusion_fulfillment_cost,
      fulfillment_pick_pack = EXCLUDED.fulfillment_pick_pack,
      fulfillment_shipping = EXCLUDED.fulfillment_shipping,
      fulfillment_packaging = EXCLUDED.fulfillment_packaging,
      fulfillment_insurance = EXCLUDED.fulfillment_insurance,
      fulfillment_storage = EXCLUDED.fulfillment_storage,
      fulfillment_other = EXCLUDED.fulfillment_other,
      fulfillment_source = EXCLUDED.fulfillment_source,
      amazon_fee_invoice_total = EXCLUDED.amazon_fee_invoice_total,
      tiktok_fees = EXCLUDED.tiktok_fees,
      contribution_margin = EXCLUDED.contribution_margin,
      contribution_profit = EXCLUDED.contribution_profit,
      fixed_costs = EXCLUDED.fixed_costs,
      net_profit = EXCLUDED.net_profit,
      orders_count = EXCLUDED.orders_count,
      new_customers = EXCLUDED.new_customers,
      total_customers = EXCLUDED.total_customers,
      subscription_revenue = EXCLUDED.subscription_revenue,
      subscription_order_count = EXCLUDED.subscription_order_count,
      discount_total = EXCLUDED.discount_total,
      discount_promotional = EXCLUDED.discount_promotional,
      discount_subscription = EXCLUDED.discount_subscription,
      discount_free_gifts = EXCLUDED.discount_free_gifts,
      discount_other = EXCLUDED.discount_other,
      ltv = EXCLUDED.ltv,
      attributed_revenue = EXCLUDED.attributed_revenue,
      status = EXCLUDED.status,
      source = EXCLUDED.source,
      updated_at = NOW()
  `
}

/** Live-compute one Pacific day and upsert. */
export async function refreshDay(
  date: string,
  status: DailyMetricsStatus
): Promise<DailyMetricsRow> {
  const { buildMetricsForRange } = await import("./build-metrics")
  const built = await buildMetricsForRange(date, date)
  const row = builtMetricsToDailyRow(date, built, status)
  await upsertDailyMetricsRow(row)
  return row
}

export interface RefreshResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  refreshed: string[]
  skippedComplete: string[]
  errors: { date: string; error: string }[]
  loopCache?: { activeSubscribers: number; subscriberMRR: number }
}

/**
 * Cron refresh: today (in_progress) always; yesterday a few times after
 * midnight PT (until ~06:00 PT) then mark complete. Uses advisory lock.
 */
export async function runCronRefresh(now: Date = new Date()): Promise<RefreshResult> {
  const { getDb } = await import("./db")
  const { todayPacific, yesterdayPacific, pacificHour } = await import("./dates")
  const sql = await getDb()

  const locked = await sql`SELECT pg_try_advisory_lock(${DAILY_METRICS_ADVISORY_LOCK}) AS ok`
  if (!locked[0]?.ok) {
    return {
      ok: true,
      skipped: true,
      reason: "another refresh holds the advisory lock",
      refreshed: [],
      skippedComplete: [],
      errors: [],
    }
  }

  const refreshed: string[] = []
  const skippedComplete: string[] = []
  const errors: { date: string; error: string }[] = []

  try {
    const today = todayPacific(now)
    const yesterday = yesterdayPacific(now)
    const hour = pacificHour(now)

    // Always refresh today as in_progress
    try {
      await refreshDay(today, "in_progress")
      refreshed.push(today)
    } catch (err: any) {
      errors.push({ date: today, error: err?.message || String(err) })
    }

    // Yesterday: refresh while early morning PT (catch late data), then complete
    const yesterdayStatus: DailyMetricsStatus = hour < 6 ? "in_progress" : "complete"
    // Also refresh yesterday a few times in the first hours; after 6am PT once more if still in_progress
    const existing = await getDailyMetricsRange(yesterday, yesterday)
    const needsYesterday =
      hour < 6 ||
      existing.length === 0 ||
      existing[0].status === "in_progress" ||
      hour === 6

    if (needsYesterday) {
      try {
        await refreshDay(yesterday, yesterdayStatus)
        refreshed.push(yesterday)
      } catch (err: any) {
        errors.push({ date: yesterday, error: err?.message || String(err) })
      }
    } else {
      skippedComplete.push(yesterday)
    }

    // Background Loop cache refresh (does not block on failure)
    let loopCache: RefreshResult["loopCache"]
    try {
      const { refreshLoopLiveCache } = await import("./loop-cache")
      const loop = await refreshLoopLiveCache()
      loopCache = {
        activeSubscribers: loop.activeSubscribers,
        subscriberMRR: loop.subscriberMRR,
      }
    } catch (err: any) {
      console.warn("Loop cache refresh during cron failed:", err?.message)
    }

    return { ok: errors.length === 0, refreshed, skippedComplete, errors, loopCache }
  } finally {
    await sql`SELECT pg_advisory_unlock(${DAILY_METRICS_ADVISORY_LOCK})`
  }
}

/**
 * Backfill last N Pacific days. Idempotent: skips days already `complete`
 * unless `force` is true. Today is always written as `in_progress`.
 */
export async function runBackfill(opts: {
  days?: number
  force?: boolean
  now?: Date
}): Promise<RefreshResult> {
  const days = Math.max(1, Math.min(opts.days ?? 90, 366))
  const force = opts.force === true
  const now = opts.now ?? new Date()

  const { getDb } = await import("./db")
  const { todayPacific, addDaysISO, eachDateInclusive } = await import("./dates")
  const sql = await getDb()

  const locked = await sql`SELECT pg_try_advisory_lock(${DAILY_METRICS_ADVISORY_LOCK}) AS ok`
  if (!locked[0]?.ok) {
    return {
      ok: true,
      skipped: true,
      reason: "another refresh holds the advisory lock",
      refreshed: [],
      skippedComplete: [],
      errors: [],
    }
  }

  const refreshed: string[] = []
  const skippedComplete: string[] = []
  const errors: { date: string; error: string }[] = []

  try {
    const today = todayPacific(now)
    const start = addDaysISO(today, -(days - 1))
    const allDates = eachDateInclusive(start, today)
    const existing = await getDailyMetricsRange(start, today)
    const byDate = new Map(existing.map((r) => [r.date, r]))

    for (const date of allDates) {
      const isToday = date === today
      const row = byDate.get(date)
      if (!force && !isToday && row?.status === "complete") {
        skippedComplete.push(date)
        continue
      }
      try {
        await refreshDay(date, isToday ? "in_progress" : "complete")
        refreshed.push(date)
      } catch (err: any) {
        errors.push({ date, error: err?.message || String(err) })
      }
    }

    try {
      const { refreshLoopLiveCache } = await import("./loop-cache")
      await refreshLoopLiveCache()
    } catch {
      /* ignore */
    }

    return { ok: errors.length === 0, refreshed, skippedComplete, errors }
  } finally {
    await sql`SELECT pg_advisory_unlock(${DAILY_METRICS_ADVISORY_LOCK})`
  }
}

/**
 * Load range from store; live-compute + upsert any missing days; return sum.
 * Today's in_progress row is used as-is (cron keeps it fresh); if missing,
 * live-compute it.
 */
export async function getMetricsFromDailyStore(
  dateStart: string,
  dateEnd: string,
  opts?: { bust?: boolean }
): Promise<{
  summed: SummedDailyMetrics
  ltvCac: import("./ltv-cac").LtvCacResult
  staticMeta: {
    variants: BuiltMetrics["variants"]
    fixedCosts: BuiltMetrics["fixedCosts"]
    fulfillmentInvoices: BuiltMetrics["fulfillmentInvoices"]
    giftMappings: BuiltMetrics["giftMappings"]
    loopData: Awaited<ReturnType<typeof import("./loop-cache").getCachedLoopData>>
  }
  dailyContributionRow: DailyMetricsRow | null
}> {
  const { todayPacific, eachDateInclusive } = await import("./dates")
  const today = todayPacific()
  const dates = eachDateInclusive(dateStart, dateEnd)
  let stored = await getDailyMetricsRange(dateStart, dateEnd)
  const present = new Set(stored.map((r) => r.date))

  const missing = dates.filter((d) => {
    if (opts?.bust && d === today) return true
    return !present.has(d)
  })

  // Also re-fetch today if busted
  for (const d of missing) {
    try {
      const status: DailyMetricsStatus = d === today ? "in_progress" : "complete"
      await refreshDay(d, status)
    } catch (err: any) {
      console.warn(`live fallback for ${d} failed:`, err?.message)
    }
  }

  if (missing.length > 0 || opts?.bust) {
    stored = await getDailyMetricsRange(dateStart, dateEnd)
  }

  const stillMissing = dates.filter((d) => !stored.some((r) => r.date === d))
  const summed = sumDailyMetricsRows(stored, { start: dateStart, end: dateEnd }, stillMissing)

  // Static meta (COGS variants etc.) — cheap DB reads, not Shopify
  const { getCogsVariants, getFixedCosts, getFulfillmentInvoices, getGiftMappings } =
    await import("./db")
  const { getCachedLoopData } = await import("./loop-cache")
  const [variants, fixedCosts, fulfillmentInvoices, giftMappings, loopData] =
    await Promise.all([
      getCogsVariants(),
      getFixedCosts(),
      getFulfillmentInvoices(),
      getGiftMappings(),
      getCachedLoopData(),
    ])

  let dailyContributionRow: DailyMetricsRow | null =
    stored.find((r) => r.date === today) || null
  if (!dailyContributionRow) {
    try {
      dailyContributionRow = await refreshDay(today, "in_progress")
    } catch {
      dailyContributionRow = null
    }
  }

  // Overlay Loop LTV + Shopify-attributable CAC on the summed range metrics.
  const { applyLtvCacToMetricsSync } = await import("./ltv-cac-apply")
  const { computeLoopLtv } = await import("./ltv-cac")
  let loopLtv = null
  try {
    const { getLatestLoopLtvSnapshot } = await import("./loop-metrics")
    const snap = await getLatestLoopLtvSnapshot()
    if (snap?.rows?.length) loopLtv = computeLoopLtv(snap.rows, snap.snapshotDate)
  } catch {
    /* ignore */
  }
  const { metrics: metricsWithLtv, ltvCac } = applyLtvCacToMetricsSync(summed.metrics, {
    totalAdSpend: summed.metrics.adSpend,
    channelSpend: summed.twData.channelSpend,
    shopifyNewCustomers: summed.metrics.newCustomers,
    twLtvFallback: summed.metrics.ltv,
    loopLtv,
  })
  summed.metrics = metricsWithLtv
  summed.twData.ltv = metricsWithLtv.ltv
  summed.twData.blendedCac = metricsWithLtv.cac

  return {
    summed,
    ltvCac,
    staticMeta: { variants, fixedCosts, fulfillmentInvoices, giftMappings, loopData },
    dailyContributionRow,
  }
}

export function verifyDailyMetricsCronSecret(header: string | null): boolean {
  const secret = process.env.DAILY_METRICS_CRON_SECRET
  if (!secret) return false
  if (!header) return false
  const [scheme, token] = header.split(" ")
  if (scheme?.toLowerCase() !== "bearer" || !token) return false
  return token === secret
}

/** @internal test helper */
export function _emptyDiscountStatsForTests() {
  return emptyDiscountStats()
}
