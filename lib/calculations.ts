export interface COGSVariant {
  variantKey: string
  variantName: string
  shopifyVariantId: string
  lineItems: { name: string; cost: number; quantity: number }[]
  totalCost: number
}

export interface FixedCostLineItem {
  name: string
  monthlyCost: number
}

export interface MetricsResult {
  dateRange: { start: string; end: string }
  revenue: number         // blended total (Shopify + Amazon)
  shopifyRevenue: number
  amazonRevenue: number
  cogs: number
  grossProfit: number
  grossMarginPct: number
  adSpend: number
  contributionProfit: number
  contributionMarginPct: number
  fixedCosts: number
  netProfit: number
  netMarginPct: number
  newCustomers: number
  totalCustomers: number
  cac: number
  ltv: number
  ltvCacRatio: number
  ordersCount: number
  aov: number
}

export function computeCOGSTotal(variant: COGSVariant): number {
  return variant.lineItems.reduce((sum, item) => sum + item.cost * item.quantity, 0)
}

export function computeMetrics(params: {
  shopifyRevenue: number
  amazonRevenue: number
  shopifyOrdersCount: number
  shopifyAOV: number
  shopifyNewCustomers: number
  shopifyTotalCustomers: number
  cogsByVariantSold: number
  adSpend: number
  twLtv: number           // TW all-time avg LTV — not date-range dependent
  fixedCostsMonthly: number[]
  dateRange: { start: string; end: string }
}): MetricsResult {
  const {
    shopifyRevenue,
    amazonRevenue,
    shopifyOrdersCount,
    shopifyAOV,
    shopifyNewCustomers,
    shopifyTotalCustomers,
    cogsByVariantSold,
    adSpend,
    twLtv,
    fixedCostsMonthly,
    dateRange,
  } = params

  const revenue = shopifyRevenue + amazonRevenue
  const cogs = cogsByVariantSold
  const grossProfit = revenue - cogs
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0

  const totalFixedMonthly = fixedCostsMonthly.reduce((s, c) => s + c, 0)

  // Prorate fixed costs based on date range
  const start = new Date(dateRange.start)
  const end = new Date(dateRange.end)
  const daysInRange = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))) + 1
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  const fixedCosts = totalFixedMonthly * (daysInRange / daysInMonth)

  const contributionProfit = grossProfit - adSpend
  const contributionMarginPct = revenue > 0 ? (contributionProfit / revenue) * 100 : 0

  const netProfit = contributionProfit - fixedCosts
  const netMarginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0

  const newCustomers = shopifyNewCustomers
  const totalCustomers = shopifyTotalCustomers

  const cac = newCustomers > 0 ? adSpend / newCustomers : 0
  const ltv = twLtv  // TW all-time avg: not influenced by selected date range
  const ltvCacRatio = cac > 0 ? ltv / cac : 0

  return {
    dateRange,
    revenue,
    shopifyRevenue,
    amazonRevenue,
    cogs,
    grossProfit,
    grossMarginPct,
    adSpend,
    contributionProfit,
    contributionMarginPct,
    fixedCosts,
    netProfit,
    netMarginPct,
    newCustomers,
    totalCustomers,
    cac,
    ltv,
    ltvCacRatio,
    ordersCount: shopifyOrdersCount,
    aov: shopifyAOV,
  }
}
