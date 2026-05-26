const API_KEY = process.env.TRIPLEWHALE_API_KEY || ""
const BASE_URL = "https://api.triplewhale.com"
const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_URL || ""

export async function fetchTWData(dateStart: string, dateEnd: string) {
  if (!API_KEY) {
    return null
  }

  const today = new Date()
  const todayHour = today.getHours() + 1
  const shopDomain = SHOPIFY_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "")

  const res = await fetch(`${BASE_URL}/api/v2/summary-page/get-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      shopDomain: shopDomain || "",
      period: { start: dateStart, end: dateEnd },
      todayHour: Math.min(25, Math.max(1, todayHour)),
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error(`Triple Whale API ${res.status}: ${errText}`)
    return null
  }

  const data = await res.json()
  return data
}

export interface TWProcessedData {
  adSpend: number
  attributedRevenue: number
  blendedCac: number
  blendedRoas: number
  error?: string
}

export function processTWData(rawData: any): TWProcessedData {
  if (!rawData) {
    return { adSpend: 0, attributedRevenue: 0, blendedCac: 0, blendedRoas: 0, error: "Triple Whale data not available" }
  }

  let adSpend = 0
  let attributedRevenue = 0
  let blendedCac = 0
  let blendedRoas = 0

  if (Array.isArray(rawData?.metrics)) {
    for (const m of rawData.metrics) {
      const name = m.metricName?.toLowerCase() || ""
      const val = parseFloat(m.value ?? "0") || 0
      if (name === "adspend" || name === "ad_spend" || name === "ads_spend" || name === "total_ad_spend") adSpend = val
      else if (name === "revenue" || name === "attributed_revenue") attributedRevenue = val
      else if (name === "cac" || name === "blended_cac" || name === "blendedcac") blendedCac = val
      else if (name === "roas" || name === "blended_roas" || name === "blendedroas") blendedRoas = val
    }
  }

  return { adSpend, attributedRevenue, blendedCac, blendedRoas }
}
