const API_KEY = proces…_KEY || ""
const BASE_URL = "https://api.triplewhale.com"
const SHOPIFY_DOMAIN = (process.env.SHOPIFY_STORE_URL || process.env.SHOPIFY_ADMIN_API_URL || process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "")

export async function fetchTWData(dateStart: string, dateEnd: string) {
  if (!API_KEY) {
    return { raw: null, error: "Missing TRIPLEWHALE_API_KEY env" }
  }

  const today = new Date()
  const todayHour = today.getHours() + 1
  const shopDomain = SHOPIFY_DOMAIN || "plantsbasically.myshopify.com"

  console.log(`[TW] Key present: ${!!API_KEY}, Domain: "${shopDomain}"`)

  const res = await fetch(`${BASE_URL}/api/v2/summary-page/get-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      shopDomain: shopDomain,
      period: { start: dateStart, end: dateEnd },
      todayHour: Math.min(25, Math.max(1, todayHour)),
    }),
  })

  let raw: any
  try {
    raw = await res.json()
  } catch {
    raw = await res.text()
  }

  console.log(`[TW] Full response (first 500): ${JSON.stringify(raw).slice(0, 500)}`)

  // Also log the first metric object so we can see actual keys
  if (Array.isArray(raw?.metrics) && raw.metrics.length > 0) {
    console.log(`[TW] First metric object keys: ${JSON.stringify(raw.metrics[0])}`)
  }

  if (!res.ok) {
    return { raw, error: `TW API ${res.status}` }
  }

  return raw
}

export interface TWProcessedData {
  adSpend: number
  attributedRevenue: number
  blendedCac: number
  blendedRoas: number
  error?: string
  raw?: any
}

export function processTWData(rawData: any): TWProcessedData {
  if (!rawData) {
    return { adSpend: 0, attributedRevenue: 0, blendedCac: 0, blendedRoas: 0, error: "No response" }
  }

  let adSpend = 0, attributedRevenue = 0, blendedCac = 0, blendedRoas = 0

  if (Array.isArray(rawData?.metrics)) {
    console.log("[TW] Metric count:", rawData.metrics.length)
    console.log("[TW] First metric object:", JSON.stringify(rawData.metrics[0]))
    for (const m of rawData.metrics) {
      const name = m.metricName?.toLowerCase() || m.key?.toLowerCase() || m.name?.toLowerCase() || ((m.label || m.title || "").toLowerCase())
      const val = parseFloat(m.value ?? m.amount ?? m.data?.value ?? m?.metric ?? "0") || 0
      console.log(`[TW] name="${name}" val=${val}`)

      if (name?.includes("adspend") || name?.includes("ad_spend") || name?.includes("ad spend")) adSpend = val
      if (name?.includes("revenue")) attributedRevenue = val
      if (name?.includes("cac")) blendedCac = val
      if (name?.includes("roas")) blendedRoas = val
    }
  } else {
    console.log("[TW] No metrics array. Top-level keys:", JSON.stringify(Object.keys(rawData)))
    // Fallback: try reading top-level fields directly
    for (const [key, val] of Object.entries(rawData)) {
      console.log(`[TW] direct key="${key}" = ${val}`)
    }
  }

  return { adSpend, attributedRevenue, blendedCac, blendedRoas, raw: rawData }
}
