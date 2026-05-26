export interface COGSVariant {
  variantKey: string
  variantName: string
  shopifyVariantId: string
  lineItems: LineItem[]
  totalCost: number
}

export interface LineItem {
  name: string
  cost: number
  quantity: number
}

export interface FixedCostLineItem {
  name: string
  monthlyCost: number
}

export interface COGSData {
  variants: COGSVariant[]
}

export interface FixedCostsData {
  lineItems: FixedCostLineItem[]
}

export interface MetricsResult {
  dateRange: { start: string; end: string }
  revenue: number
  cogs: number
  grossProfit: number
  grossMarginPct: number
  adSpend: number
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
