const API_KEY = *** || ""
const BASE_URL = "https://api.triplewhale.com"
const SHOPIFY_DOMAIN = *** || ""

export async function fetchTWData(dateStart: string, dateEnd: string) {
  if (!API_KEY) {
    console.error("[TW] No API key configured");
    return null;
  }

  const today = new Date()
  const todayHour = today.getHours() + 1
  const shopDomain = SHOPIFY_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  console.log("[TW] Request:", JSON.stringify({ shopDomain, period: { start: dateStart, end: dateEnd }, todayHour }));

  const res = await fetch(`${BASE_URL}/api/v2/summary-page/get-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({
      shopDomain: shopDomain || "",
      period: { start: dateStart, end: dateEnd },
      todayHour: Math.min(25, Math.max(1, todayHour)),
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[TW] API error ${res.status}: ${errText}`);
    return { error: errText };
  }

  const data = await res.json();
  console.log("[TW] Raw response:", JSON.stringify(data));
  return data;
}

export interface TWProcessedData {
  adSpend: number;
  attributedRevenue: number;
  blendedCac: number;
  blendedRoas: number;
  error?: string;
}

export function processTWData(rawData: any): TWProcessedData {
  if (!rawData) return { adSpend: 0, attributedRevenue: 0, blendedCac: 0, blendedRoas: 0, error: "Triple Whale data unavailable" };
  if (rawData.error) { console.error("[TW] Error:", JSON.stringify(rawData)); return { adSpend: 0, attributedRevenue: 0, blendedCac: 0, blendedRoas: 0, error: String(rawData.error) }; }

  let adSpend = 0, attributedRevenue = 0, blendedCac = 0, blendedRoas = 0, found = false;

  if (Array.isArray(rawData?.metrics)) {
    console.log("[TW] Metrics found:", rawData.metrics.map((m: any) => m.metricName?.toLowerCase()).join(", "));
    for (const m of rawData.metrics) {
      const name = (m.metricName || "").toLowerCase().trim();
      const val = parseFloat(m.value ?? "0") || 0;
      console.log(`[TW] metric="${name}" value=${val}`);
      if (name.includes("adspend") || name.includes("ad spend")) { adSpend = val; found = true; }
      else if (name.includes("revenue")) attributedRevenue = val;
      else if (name.includes("cac")) blendedCac = val;
      else if (name.includes("roas")) blendedRoas = val;
    }
  } else {
    console.log("[TW] No metrics array. Keys:", rawData ? JSON.stringify(Object.keys(rawData)) : "null");
  }

  if (!found) console.warn("[TW] No adspend metric found");
  return { adSpend, attributedRevenue, blendedCac, blendedRoas };
}
