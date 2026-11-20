/**
 * Triple Whale payment gateway costs for Shopify orders.
 *
 * Primary: SQL API summing orders_table.payment_gateway_costs by day
 *   (event_date is already shop-local; PB shop TZ is America/Los_Angeles).
 * Fallback: summary-page metric payment_gateway_costs / Payment Gateway Costs.
 *
 * Shopify Payments fees are imported actuals from Shopify.
 * PayPal / other gateways are estimates from TW Cost Settings (% + flat).
 * Currency conversion fees are not included (per TW docs).
 *
 * Amazon / TikTok marketplace fees are NOT included here — those stay on
 * amazonFees / tiktokFees. We filter platform = 'Shopify' on the SQL path.
 */

const API_KEY = process.env.TRIPLEWHALE_API_KEY || ""
const BASE_URL = "https://api.triplewhale.com"
const SHOPIFY_DOMAIN =
  (process.env.SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_URL || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "") || "plantsbasically.myshopify.com"

export type GatewayFeesSource = "tw_sql" | "tw_summary" | "none"

export interface GatewayFeesResult {
  total: number
  /** YYYY-MM-DD → fees for that day (LA / shop-local calendar day) */
  daily: Record<string, number>
  source: GatewayFeesSource
  error?: string
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { data: GatewayFeesResult; ts: number }>()

const GATEWAY_SQL = `
SELECT
  toString(toDate(event_date)) AS day,
  sum(payment_gateway_costs) AS gateway_fees
FROM orders_table
WHERE event_date BETWEEN @startDate AND @endDate
  AND lowerUTF8(platform) = 'shopify'
GROUP BY day
ORDER BY day
`.trim()

function metricVal(m: any): number {
  return Number(m.values?.current ?? m.value ?? m.total ?? 0) || 0
}

/** Pure helper — extract blended Payment Gateway Costs from summary-page get-data. */
export function extractGatewayFeesFromSummary(rawData: any): number {
  if (!rawData || rawData.error || !Array.isArray(rawData.metrics)) return 0

  for (const m of rawData.metrics) {
    const id = String(m.id || m.metricId || m.metricName || "")
      .toLowerCase()
      .replace(/[_\s-]/g, "")
    if (id === "paymentgatewaycosts") {
      const val = metricVal(m)
      if (val !== 0) return val
    }
  }

  for (const m of rawData.metrics) {
    const title = String(m.title || m.name || m.metricName || "").toLowerCase().trim()
    if (title === "payment gateway costs" || title.includes("payment gateway cost")) {
      const val = metricVal(m)
      if (val !== 0) return val
    }
  }

  return 0
}

function emptyResult(source: GatewayFeesSource, error?: string): GatewayFeesResult {
  return { total: 0, daily: {}, source, error }
}

function summaryFallback(
  summaryRaw: any,
  dateEnd: string,
  priorError?: string,
): GatewayFeesResult {
  const fromSummary = extractGatewayFeesFromSummary(summaryRaw)
  if (fromSummary !== 0 || (summaryRaw && !summaryRaw.error && Array.isArray(summaryRaw.metrics))) {
    const daily: Record<string, number> = {}
    if (fromSummary !== 0) daily[dateEnd] = fromSummary
    return {
      total: fromSummary,
      daily,
      source: "tw_summary",
      error: fromSummary === 0 ? priorError : undefined,
    }
  }
  return emptyResult("none", priorError || "TW SQL and summary gateway metrics unavailable")
}

/** SQL-only fetch (no summary fallback). Returns null on hard failure. Cached 5m. */
export async function fetchGatewayFeesFromSql(
  dateStart: string,
  dateEnd: string,
): Promise<GatewayFeesResult | null> {
  if (!API_KEY) return null

  const cacheKey = `sql:${dateStart}|${dateEnd}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS && cached.data.source === "tw_sql") {
    return cached.data
  }

  const res = await fetch(`${BASE_URL}/api/v2/orcabase/api/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({
      shopId: SHOPIFY_DOMAIN,
      query: GATEWAY_SQL,
      currency: "USD",
      period: { startDate: dateStart, endDate: dateEnd },
    }),
  })

  const body: any = await res.json().catch(() => null)
  if (!res.ok) return null

  const rows: any[] = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.rows)
      ? body.rows
      : Array.isArray(body)
        ? body
        : []

  if (!Array.isArray(rows)) return null
  // Empty rows is a valid SQL success (zero fees in range)
  if (body?.success === false && rows.length === 0) return null

  const daily: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    const day = String(row.day || row.event_date || "").slice(0, 10)
    const fees = Number(row.gateway_fees ?? row.payment_gateway_costs ?? 0) || 0
    if (!day) continue
    daily[day] = (daily[day] || 0) + fees
    total += fees
  }

  const result: GatewayFeesResult = { total, daily, source: "tw_sql" }
  cache.set(cacheKey, { data: result, ts: Date.now() })
  return result
}

/**
 * Fetch Shopify payment gateway fees for a date range.
 * Prefers TW SQL (daily grain); falls back to summary-page blended metric.
 * Cached 5 minutes like other TW calls — must not slow range switching.
 *
 * Pass `summaryRaw` from the parallel `fetchTWData` call so fallback needs no
 * extra network hop.
 */
export async function fetchGatewayFees(
  dateStart: string,
  dateEnd: string,
  summaryRaw?: any,
): Promise<GatewayFeesResult> {
  const cacheKey = `${dateStart}|${dateEnd}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    // If we cached a none/summary miss but now have summary data, upgrade.
    if (
      cached.data.source === "tw_sql" ||
      (cached.data.source === "tw_summary" && cached.data.total !== 0) ||
      !summaryRaw
    ) {
      return cached.data
    }
  }

  if (!API_KEY) {
    const result = emptyResult("none", "Missing TRIPLEWHALE_API_KEY env")
    cache.set(cacheKey, { data: result, ts: Date.now() })
    return result
  }

  try {
    const sqlResult = await fetchGatewayFeesFromSql(dateStart, dateEnd)
    if (sqlResult) {
      cache.set(cacheKey, { data: sqlResult, ts: Date.now() })
      return sqlResult
    }
  } catch (err: any) {
    const result = summaryFallback(
      summaryRaw,
      dateEnd,
      `TW SQL error: ${err?.message || err}`,
    )
    cache.set(cacheKey, { data: result, ts: Date.now() })
    return result
  }

  const result = summaryFallback(summaryRaw, dateEnd, "TW SQL unavailable")
  cache.set(cacheKey, { data: result, ts: Date.now() })
  return result
}

export interface GatewayRateProbe {
  available: boolean
  note: string
  byGateway?: { gateway: string; orders: number; fees: number }[]
}

/**
 * Read-only probe: infer whether PayPal / other non-Shopify-Payments gateways
 * appear to have Cost Settings rates filled (non-zero payment_gateway_costs).
 * TW has no public Cost Settings GET API — this is the best proxy.
 */
export async function probeGatewayRateConfiguration(
  dateStart: string,
  dateEnd: string,
): Promise<GatewayRateProbe> {
  if (!API_KEY) {
    return {
      available: false,
      note: "No TRIPLEWHALE_API_KEY — cannot probe. Kyle: verify PayPal/other rates in TW Cost Settings → Gateway Costs.",
    }
  }

  const query = `
SELECT
  coalesce(nullIf(arrayElement(payment_gateway_names, 1), ''), 'unknown') AS gateway,
  count() AS orders,
  sum(payment_gateway_costs) AS fees
FROM orders_table
WHERE event_date BETWEEN @startDate AND @endDate
  AND lowerUTF8(platform) = 'shopify'
GROUP BY gateway
ORDER BY fees DESC
`.trim()

  try {
    const res = await fetch(`${BASE_URL}/api/v2/orcabase/api/sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({
        shopId: SHOPIFY_DOMAIN,
        query,
        currency: "USD",
        period: { startDate: dateStart, endDate: dateEnd },
      }),
    })
    const body: any = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        available: false,
        note: `TW SQL probe failed (${res.status}). No Cost Settings read API exists — Kyle: verify PayPal/other rates in TW Cost Settings → Gateway Costs. Shopify Payments actuals are imported automatically.`,
      }
    }
    const rows: any[] = Array.isArray(body?.data) ? body.data : []
    const byGateway = rows.map((r) => ({
      gateway: String(r.gateway || "unknown"),
      orders: Number(r.orders) || 0,
      fees: Number(r.fees) || 0,
    }))

    const nonShopify = byGateway.filter(
      (g) =>
        !/shopify.?payments/i.test(g.gateway) &&
        g.gateway !== "gift_card" &&
        g.gateway !== "unknown",
    )
    const paypalish = nonShopify.filter((g) => /paypal/i.test(g.gateway))
    const paypalConfigured = paypalish.some((g) => g.fees > 0)
    const otherWithFees = nonShopify.filter((g) => g.fees > 0)

    let note: string
    if (byGateway.length === 0) {
      note =
        "No Shopify orders in range for probe. Kyle: verify gateway rates in TW Cost Settings → Gateway Costs."
    } else if (paypalish.length > 0 && !paypalConfigured) {
      note =
        "PayPal orders found with $0 gateway fees — PayPal Cost Settings rate may be empty. Kyle: confirm % + flat fee in TW Cost Settings → Gateway Costs."
    } else if (paypalConfigured || otherWithFees.length > 0) {
      note = `Non-Shopify-Payments gateways with fees: ${
        otherWithFees.map((g) => `${g.gateway}=$${g.fees.toFixed(2)}`).join(", ") || "none"
      }. Shopify Payments actuals are imported; others are Cost Settings estimates.`
    } else {
      note =
        "Only Shopify Payments (or zero-fee gateways) observed. Kyle: still verify PayPal/other rates in TW Cost Settings → Gateway Costs if those gateways are used."
    }

    return { available: true, note, byGateway }
  } catch (err: any) {
    return {
      available: false,
      note: `Probe error: ${err?.message || err}. Kyle: verify PayPal/other rates in TW Cost Settings → Gateway Costs.`,
    }
  }
}

/** Test helper — clear module cache between cases */
export function _clearGatewayFeesCacheForTests() {
  cache.clear()
}
