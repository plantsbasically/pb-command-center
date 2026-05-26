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

    // Import data & calculations
    const { readJSON } = await import("@/lib/filestore")
    const { computeMetrics } = await import("@/lib/calculations")
    const { processShopifyData } = await import("@/lib/shopify")
    const { fetchTWData, processTWData } = await import("@/lib/triplewhale")

    // Pull COGS data
    const cogsData = (readJSON("cogs.json") as { variants: any[] }) || { variants: [] }
    const fixedCostsData = (readJSON("fixedcosts.json") as { lineItems: any[] }) || { lineItems: [] }

    // Compute COGS per variant
    const cogsMap = new Map<string, number>()
    for (const v of cogsData.variants) {
      cogsMap.set(v.variantKey, v.totalCost || 0)
    }

    // Fetch Shopify and Triple Whale in parallel
    const [shopifyData, twRaw] = await Promise.all([
      processShopifyData(dateStart, dateEnd),
      fetchTWData(dateStart, dateEnd),
    ])

    // Calculate COGS from units sold
    let totalCOGS = 0
    for (const [variantKey, units] of Object.entries(shopifyData.variantUnitsSold)) {
      const unitCOGS = cogsMap.get(variantKey) || cogsMap.get(variantKey.replace(/-\d+$/, "")) || 0
      totalCOGS += units * unitCOGS
    }

    const twData = processTWData(twRaw)

    // Compute metrics
    const metrics = computeMetrics({
      shopifyRevenue: shopifyData.revenue,
      shopifyOrdersCount: shopifyData.ordersCount,
      shopifyAOV: shopifyData.aov,
      shopifyNewCustomers: shopifyData.newCustomers,
      shopifyTotalCustomers: shopifyData.totalCustomers,
      cogsByVariantSold: totalCOGS,
      adSpend: twData.adSpend,
      fixedCostsMonthly: fixedCostsData.lineItems.map((lc) => lc.monthlyCost),
      dateRange: { start: dateStart, end: dateEnd },
    })

    // Include COGS breakdown
    const cogsBreakdown = cogsData.variants.map((v) => ({
      variantKey: v.variantKey,
      variantName: v.variantName,
      totalCost: v.totalCost,
      unitsSold: shopifyData.variantUnitsSold[v.variantKey] || 0,
      totalCOGS: (shopifyData.variantUnitsSold[v.variantKey] || 0) * v.totalCost,
    }))

    const responseData = {
      metrics,
      cogsBreakdown,
      variants: cogsData.variants,
      fixedCosts: fixedCostsData.lineItems,
      twData,
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
