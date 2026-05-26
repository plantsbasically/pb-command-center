const API_KEY = process.env.TRIPLEWHALE_API_KEY || "";
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

  if (rawData.error) {
    return { adSpend: 0, attributedRevenue: 0, blendedCac: 0, blendedRoas: 0, error: rawData.error }
  }

  let adSpend = 0, attributedRevenue = 0, blendedCac = 0, blendedRoas = 0

  if (Array.isArray(rawData?.metrics)) {
    for (const m of rawData.metrics) {
      const title = String(m.title || m.name || "").toLowerCase().trim()
      const id = String(m.id || "").toLowerCase()
      const mid = String(m.metricId || "").toLowerCase()
      const val = Number(m.values?.current ?? m.value ?? m.total ?? 0) || 0

      const isAdSpend =
        title.includes("ad spend") ||
        title.includes("adspend") ||
        title === "spend" ||
        mid.includes("adspend") ||
        mid.includes("ad_spend") ||
        id.includes("adspend") ||
        id.includes("ad_spend")

      const isRevenue =
        title.includes("revenue") ||
        mid.includes("revenue") ||
        id.includes("revenue")

      const isCac =
        title.includes("cac") ||
        mid.includes("cac") ||
        id.includes("cac")

      const isRoas =
        title.includes("roas") ||
        mid.includes("roas") ||
        id.includes("roas")

      if (isAdSpend && val > 0) adSpend = val
      else if (isRevenue && val > 0) attributedRevenue = val
      else if (isCac && val > 0) blendedCac = val
      else if (isRoas && val > 0) blendedRoas = val
    }
  }

  // TW can also return top-level summary fields
  if (adSpend === 0 && rawData.adSpend) adSpend = Number(rawData.adSpend) || 0
  if (adSpend === 0 && rawData.totalAdSpend) adSpend = Number(rawData.totalAdSpend) || 0
  if (attributedRevenue === 0 && rawData.revenue) attributedRevenue = Number(rawData.revenue) || 0

  return { adSpend, attributedRevenue, blendedCac, blendedRoas, raw: rawData }
}
