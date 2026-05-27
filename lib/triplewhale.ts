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

export interface ChannelSpend {
  facebook: number
  google: number
  microsoft: number
  tiktok: number
  snapchat: number
  pinterest: number
  amazonAds: number   // Amazon Ads spend (not Amazon revenue)
}

export interface TWProcessedData {
  adSpend: number
  channelSpend: ChannelSpend
  attributedRevenue: number
  blendedCac: number
  blendedRoas: number
  amazonRevenue: number   // amazonProductItemPrice — gross product sales on Amazon
  amazonOrders: number
  amazonFees: number      // Amazon referral + FBA fees
  error?: string
  raw?: any
}

function metricVal(m: any): number {
  return Number(m.values?.current ?? m.value ?? m.total ?? 0) || 0
}

export function processTWData(rawData: any): TWProcessedData {
  const emptyChannelSpend: ChannelSpend = { facebook: 0, google: 0, microsoft: 0, tiktok: 0, snapchat: 0, pinterest: 0, amazonAds: 0 }
  const empty = { adSpend: 0, channelSpend: emptyChannelSpend, attributedRevenue: 0, blendedCac: 0, blendedRoas: 0, amazonRevenue: 0, amazonOrders: 0, amazonFees: 0 }

  if (!rawData) return { ...empty, error: "No response" }
  if (rawData.error) return { ...empty, error: rawData.error }

  let adSpend = 0, attributedRevenue = 0, blendedCac = 0, blendedRoas = 0
  let amazonRevenue = 0, amazonOrders = 0, amazonFees = 0
  const ch: ChannelSpend = { facebook: 0, google: 0, microsoft: 0, tiktok: 0, snapchat: 0, pinterest: 0, amazonAds: 0 }

  if (Array.isArray(rawData?.metrics)) {
    // Pass 1: exact ID match — no ambiguity, first-write wins per field
    for (const m of rawData.metrics) {
      const id = String(m.id || "").toLowerCase()
      const val = metricVal(m)

      // Blended total
      if (id === "blendedads" && val > 0 && adSpend === 0) adSpend = val

      // Channel spend
      if (id === "facebookads" && val > 0) ch.facebook = val
      if (id === "googleads" && val > 0) ch.google = val
      if (id === "bingadspend" && val > 0) ch.microsoft = val
      if (id === "tiktokads" && val > 0) ch.tiktok = val
      if (id === "snapchatads" && val > 0) ch.snapchat = val
      if (id === "pinterestads" && val > 0) ch.pinterest = val
      if (id === "amazonads" && val > 0) ch.amazonAds = val

      // Amazon revenue metrics
      if (id === "amazonproductitemprice" && val > 0) amazonRevenue = val
      if (id === "amazonorders" && val > 0) amazonOrders = val
      if (id === "amazonfees" && val > 0) amazonFees = val
    }

    // Pass 2: broader matching for anything not caught above (first-match wins)
    for (const m of rawData.metrics) {
      const title = String(m.title || m.name || "").toLowerCase().trim()
      const id = String(m.id || "").toLowerCase()
      const mid = String(m.metricId || "").toLowerCase()
      const val = metricVal(m)

      if (adSpend === 0 && val > 0) {
        const isAdSpend = title === "blended ad spend" || title === "total ad spend" || mid.includes("blended") || id === "totaladspend"
        if (isAdSpend) adSpend = val
      }
      if (attributedRevenue === 0 && val > 0) {
        if (title.includes("revenue") || mid.includes("revenue") || id.includes("revenue")) {
          attributedRevenue = val
        }
      }
      if (blendedCac === 0 && val > 0) {
        if (title.includes("cac") || mid.includes("cac") || id.includes("cac")) blendedCac = val
      }
      if (blendedRoas === 0 && val > 0) {
        if (title.includes("roas") || mid.includes("roas") || id.includes("roas")) blendedRoas = val
      }
    }
  }

  // Top-level fallbacks
  if (adSpend === 0 && rawData.adSpend) adSpend = Number(rawData.adSpend) || 0
  if (adSpend === 0 && rawData.totalAdSpend) adSpend = Number(rawData.totalAdSpend) || 0
  if (attributedRevenue === 0 && rawData.revenue) attributedRevenue = Number(rawData.revenue) || 0

  return { adSpend, channelSpend: ch, attributedRevenue, blendedCac, blendedRoas, amazonRevenue, amazonOrders, amazonFees, raw: rawData }
}
