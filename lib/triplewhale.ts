const API_KEY = process.env.TRIPLEWHALE_API_KEY || ""
const BASE_URL = "https://api.triplewhale.com"

export async function fetchTWData(dateStart: string, dateEnd: string) {
  const res = await fetch(`${BASE_URL}/api/v2/summary-page/get-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      dateRange: { start: dateStart, end: dateEnd },
    }),
  })

  if (!res.ok) {
    throw new Error(`Triple Whale API ${res.status}: ${await res.text()}`)
  }

  const data = await res.json()
  return data
}

export interface TWProcessedData {
  adSpend: number
  attributedRevenue: number
  blendedCac: number
  blendedRoas: number
}

export function processTWData(rawData: any): TWProcessedData {
  // Normalize TW response structure - handle both array and object formats
  let adSpend = 0
  let attributedRevenue = 0
  let blendedCac = 0
  let blendedRoas = 0

  // Try multiple response structures TW might return
  if (rawData?.data?.summary) {
    const summary = rawData.data.summary
    adSpend = parseFloat(summary?.adSpend || summary?.marketingSpend || summary?.adSpendTotal || summary?.totalAdSpend || "0")
    attributedRevenue = parseFloat(summary?.attributedRevenue || summary?.revenue || summary?.totalRevenue || "0")
    blendedCac = parseFloat(summary?.cac || summary?.blendedCac || summary?.averageCAC || "0")
    blendedRoas = parseFloat(summary?.roas || summary?.blendedRoaS || summary?.averageRoaS || "0")
  } else if (Array.isArray(rawData?.data)) {
    const summary = rawData.data[0]
    adSpend = parseFloat(summary?.adSpend || summary?.marketingSpend || summary?.adSpendTotal || summary?.totalAdSpend || "0")
    attributedRevenue = parseFloat(summary?.attributedRevenue || summary?.revenue || summary?.totalRevenue || "0")
    blendedCac = parseFloat(summary?.cac || summary?.blendedCac || summary?.averageCAC || "0")
    blendedRoas = parseFloat(summary?.roas || summary?.blendedRoaS || summary?.averageRoaS || "0")
  } else if (rawData?.data) {
    adSpend = parseFloat(rawData.data?.adSpend || rawData.data?.marketingSpend || rawData?.data?.totalAdSpend || "0")
    attributedRevenue = parseFloat(rawData.data?.attributedRevenue || rawData?.data?.revenue || "0")
    blendedCac = parseFloat(rawData.data?.cac || rawData?.data?.blendedCac || "0")
    blendedRoas = parseFloat(rawData?.data?.roas || rawData?.data?.blendedRoaS || "0")
  }

  return { adSpend, attributedRevenue, blendedCac, blendedRoas }
}
