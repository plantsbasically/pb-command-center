const API_KEY = process.env.TRIPLEWHALE_API_KEY || ""
const BASE_URL = "https://api.triplewhale.com"
// Try multiple env var names for the Shopify domain
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

  console.log(`[TW] Status: ${res.status}, Response: ${JSON.stringify(raw).slice(0, 300)}`)

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
  // Raw response is { metrics: [{ metricName, value }] }
  let adSpend = 0, attributedRevenue = 0, blendedCac = 0, blendedRoas = 0

  if (Array.isArray(rawData?.metrics)) {
    console.log("[TW] All metric names:", rawData.metrics.map((m: any) => m.metricName).join(", "))
    for (const m of rawData.metrics) {
      const name = m.metricName?.toLowerCase() || ""
      const val = parseFloat(m.value ?? "0") || 0
      console.log(`[TW] "${name}" = ${val}`)
      if (name.includes("adspend") || name.includes("ad_spend") || name.includes("ad spend")) adSpend = val
      if (name.includes("revenue")) attributedRevenue = val
      if (name.includes("cac")) blendedCac = val
      if (name.includes("roas")) blendedRoas = val
    }
  }

  return { adSpend, attributedRevenue, blendedCac, blendedRoas, raw: rawData }
}
