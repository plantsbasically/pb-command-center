const API_KEY = proces…_KEY || ""
const BASE_URL = "https://api.triplewhale.com"
const SHOPIFY_DOMAIN = (process.env.SHOPIFY_STORE_URL || "").replace(/^https?:\/\//, "").replace(/\/+$/, "") || "plantsbasically.myshopify.com"

export async function fetchTWData(dateStart: string, dateEnd: string) {
  if (!API_KEY) return { raw: null, error: "Missing TRIPLEWHALE_API_KEY env" }

  const today = new Date()
  const todayHour = today.getHours() + 1

  const res = await fetch(
    BASE_URL + "/api/v2/summary-page/get-data",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({
        shopDomain: SHOPIFY_DOMAIN,
        period: { start: dateStart, end: dateEnd },
        todayHour: Math.min(25, Math.max(1, todayHour)),
      }),
    },
  )

  const raw: any = await res.json()
  if (!res.ok) return { raw, error: "TW API " + res.status }

  // Debug: log titles and ids
  if (Array.isArray(raw?.metrics)) {
    console.log("[TW] Titles:", raw.metrics.map((m: any) => m.title).join(" | "))
    console.log("[TW] IDs:", raw.metrics.map((m: any) => m.id).join(" | "))
    console.log("[TW] MetricIDs:", raw.metrics.map((m: any) => m.metricId).join(" | "))
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
      const title = String(m.title || "").toLowerCase()
      const id = String(m.id || "").toLowerCase()
      const mid = String(m.metricId || "").toLowerCase()
      const key = title + "| " + id + "| " + mid
      const val = Number(m.values?.current ?? 0) || 0

      console.log("[TW] key=" + key + " val=" + val)

      if (title.includes("blended ad spend") || title.includes("ad spend") || mid.includes("adspend")) adSpend = val
      else if (title.includes("revenue")) attributedRevenue = val
      else if (title.includes("cac")) blendedCac = val
      else if (title.includes("roas")) blendedRoas = val
    }

    console.log("[TW] Result: adSpend=" + adSpend + " rev=" + attributedRevenue + " cac=" + blendedCac + " roas=" + blendedRoas)
  }

  return { adSpend, attributedRevenue, blendedCac, blendedRoas, raw: rawData }
}
