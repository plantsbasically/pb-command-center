const API_KEY = process.env.TRIPLEWHALE_API_KEY || ""
const BASE_URL = "https://api.triplewhale.com"
const SHOPIFY_DOMAIN = (process.env.SHOPIFY_STORE_URL || "").replace(/^https?:\/\//, "").replace(/\/+$/, "") || "plantsbasically.myshopify.com"

export async function fetchTWData(dateStart: string, dateEnd: string) {
  if (!API_KEY) return { raw: null, error: "Missing TRIPLEWHALE_API_KEY env" }

  const today = new Date()
  const todayHour = today.getHours() + 1

  const res = await fetch(`${BASE_URL}/api/v2/summary-page/get-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({
      shopDomain: SHOPIFY_DOMAIN,
      period: { start: dateStart, end: dateEnd },
      todayHour: Math.min(25, Math.max(1, todayHour)),
    }),
  })

  const raw = await res.json()
  if (!res.ok) return { raw, error: `TW API ${res.status}` }
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
    for (const m of rawData.metrics) {
      const key = ((m.title || "") + " " + (m.id || "") + " " + (m.metricId || "")).toLowerCase()
      const val = m.values?.current ?? 0
console.log(`[TW] key=${key} val=${val}`)
      if (key.includes("blended ad spend") || key.includes("blended_adspend") || key.includes("blendedadspend") || key.includes("adspend")) adSpend = val
      if (key.includes("revenue") && !key.includes("profit")) attributedRevenue = val
      if (key.includes("cac")) blendedCac = val
      if (key.includes("roas")) blendedRoas = val
    }
    console.log(`[TW] adSpend=${adSpend}, rev=${attributedRevenue}, cac=${blendedCac}, roas=${blendedRoas}`)
  }
  return { adSpend, attributedRevenue, blendedCac, blendedRoas, raw: rawData }
}
