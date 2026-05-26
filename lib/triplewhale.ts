const API_KEY = *** || ""
const BASE_URL = "https://api.triplewhale.com"
const SHOPIFY_DOMAIN = *** || ""

export async function fetchTWData(dateStart: string, dateEnd: string) {
  if (!API_KEY) return { raw: null, error: "Missing TRIPLEWHALE_API_KEY env" }

  const today = new Date()
  const todayHour = today.getHours() + 1
  const shopDomain = SHOPIFY_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "") || "plantsbasically.myshopify.com"

  const res = await fetch(`${BASE_URL}/api/v2/summary-page/get-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({
      shopDomain: shopDomain,
      period: { start: dateStart, end: dateEnd },
      todayHour: Math.min(25, Math.max(1, todayHour)),
    }),
  })

  const raw = await res.json()
  if (!res.ok) return { raw, error: `TW API ${res.status}` }

  // Log all metric titles for debugging
  if (Array.isArray(raw?.metrics)) {
    console.log("[TW] Titles:", raw.metrics.map((m: any) => m.title).join(", "))
    console.log("[TW] IDs:", raw.metrics.map((m: any) => m.id).join(", "))
    console.log("[TW] Metric IDs:", raw.metrics.map((m: any) => m.metricId).join(", "))
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
    for (const m of rawData.metrics) {
      const title = (m.title || "").toLowerCase()
      const id = (m.id || "").toLowerCase()
      const mid = (m.metricId || "").toLowerCase()
      const val = m.values?.current ?? 0

      const key = `${title}|${id}|${mid}`
      if (key.includes("blended ad spend") || key.includes("blended_adspend") || key.includes("blendedadspend") || key.includes("adspend")) adSpend = val
      if (key.includes("revenue") && !key.includes("profit")) attributedRevenue = val
      if (key.includes("cac") || key.includes("blendedcac") || key.includes("blended_cac")) blendedCac = val
      if (key.includes("roas") || key.includes("blendedroas") || key.includes("blended_roas")) blendedRoas = val
    }
    console.log(`[TW] adSpend=${adSpend}, attributedRevenue=${attributedRevenue}, blendedCac=${blendedCac}, blendedRoas=${blendedRoas}`)
  }

  return { adSpend, attributedRevenue, blendedCac, blendedRoas, raw: rawData }
}
