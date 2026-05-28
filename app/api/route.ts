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

export async function GET(req: NextRequest) {
  const authError = checkAuth(req)
  if (authError) return authError

  try {
    const { searchParams } = new URL(req.url)
    const dateStart = searchParams.get("start") || new Date().toISOString().split("T")[0]
    const dateEnd = searchParams.get("end") || dateStart
    const bust = searchParams.get("bust") === "1"

    const cacheKey = `${dateStart}|${dateEnd}`
    const cached = cache.get(cacheKey)
    if (!bust && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(cached.data)
    }

    const { computeMetrics } = await import("@/lib/calculations")
    const { processShopifyData } = await import("@/lib/shopify")
    const { fetchTWData, processTWData } = await import("@/lib/triplewhale")
    const { getCogsVariants, getFixedCosts, getFulfillmentInvoices } = await import("@/lib/db")

    // All fetches run in parallel
    const [cogsVariants, fixedCostItems, fulfillmentInvoices, shopifyData, twRaw] = await Promise.all([
      getCogsVariants(),
      getFixedCosts(),
      getFulfillmentInvoices(),
      processShopifyData(dateStart, dateEnd),
      fetchTWData(dateStart, dateEnd),
    ])

    // Prorate invoices that overlap with the selected date range.
    // e.g. "last 30 days" against a monthly invoice gives the proportional slice.
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

    let totalCOGS = 0
    for (const [variantKey, units] of Object.entries(shopifyData.variantUnitsSold)) {
      const unitCOGS = cogsMap.get(variantKey) || cogsMap.get(variantKey.replace(/-\d+$/, "")) || 0
      totalCOGS += units * unitCOGS
    }

    const twData = processTWData(twRaw)
    // Amazon fees come directly from Triple Whale — no manual invoicing needed
    const amazonFeeInvoiceTotal = twData.amazonFees

    const metrics = computeMetrics({
      shopifyRevenue: shopifyData.revenue,
      amazonRevenue: twData.amazonRevenue,
      shopifyOrdersCount: shopifyData.ordersCount,
      shopifyAOV: shopifyData.aov,
      shopifyNewCustomers: shopifyData.newCustomers,
      shopifyTotalCustomers: shopifyData.totalCustomers,
      shopifyCogsByVariantSold: totalCOGS,
      shippingCollected: shopifyData.shippingCollected,
      fulfillmentInvoiceTotal,
      amazonFeeInvoiceTotal,
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

    const responseData = {
      metrics,
      cogsBreakdown,
      variants: cogsVariants,
      fixedCosts: fixedCostItems,
      fulfillmentInvoices,
      twData,
      _shopifyDebug: shopifyData._debug,
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
