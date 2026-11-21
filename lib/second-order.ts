/**
 * Time-to-second-order analytics from Shopify orders.
 *
 * Population: customers whose earliest order in the fetched window falls in the
 * lookback (default 180 Pacific days). Days-to-second = calendar days between
 * first and second order by created_at.
 *
 * Expensive Shopify scans are cached in `second_order_stats` (daily refresh),
 * not run on page load. CM / margin math is untouched.
 */

/** Calendar-day add without importing lib/dates (Node strip-types tests need .ts paths). */
function addDaysYmd(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export const SECOND_ORDER_BUCKETS = [
  { key: "0-7", min: 0, max: 7 },
  { key: "8-14", min: 8, max: 14 },
  { key: "15-21", min: 15, max: 21 },
  { key: "22-30", min: 22, max: 30 },
  { key: "31-45", min: 31, max: 45 },
  { key: "46-60", min: 46, max: 60 },
  { key: "61-90", min: 61, max: 90 },
  { key: "90+", min: 91, max: Infinity },
] as const

export type SecondOrderBucketKey = (typeof SECOND_ORDER_BUCKETS)[number]["key"]

export interface OrderForSecondTiming {
  id: string
  createdAt: string
  customerId: string | null
  /** Heuristic: Loop / subscription_contract / subscription tags */
  isSubscription: boolean
}

export interface SecondOrderBucket {
  key: SecondOrderBucketKey
  count: number
  /** Share of customers who reordered (among those with a 2nd order). */
  pctOfRepeaters: number
}

export interface CumulativePoint {
  day: number
  /** % of first-order customers who have reordered by this day. */
  repeatRatePct: number
}

export interface SegmentSecondOrderStats {
  segment: "all" | "subscriber" | "one_time"
  firstOrderCustomers: number
  repeaters: number
  medianDaysToSecond: number | null
  repeatRate30: number
  repeatRate60: number
  repeatRate90: number
  buckets: SecondOrderBucket[]
  cumulative: CumulativePoint[]
}

export interface SecondOrderResult {
  asOfDate: string
  lookbackDays: number
  windowStart: string
  windowEnd: string
  splitNote: string
  all: SegmentSecondOrderStats
  subscriber: SegmentSecondOrderStats
  oneTime: SegmentSecondOrderStats
  methodSummary: string
}

export function pacificYmdFromIso(iso: string): string {
  // Order timestamps are ISO with offset; calendar day in America/Los_Angeles.
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

export function daysBetweenPacific(aIso: string, bIso: string): number {
  const a = pacificYmdFromIso(aIso)
  const b = pacificYmdFromIso(bIso)
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  const aUtc = Date.UTC(ay, am - 1, ad)
  const bUtc = Date.UTC(by, bm - 1, bd)
  return Math.round((bUtc - aUtc) / 86_400_000)
}

export function bucketForDays(days: number): SecondOrderBucketKey {
  for (const b of SECOND_ORDER_BUCKETS) {
    if (days >= b.min && days <= b.max) return b.key
  }
  return "90+"
}

export function medianSorted(sorted: number[]): number | null {
  if (!sorted.length) return null
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function isSubscriptionOrderSignals(opts: {
  sourceName?: string | null
  tags?: string | null
  noteAttributes?: { name: string; value: string }[] | null
}): boolean {
  const src = (opts.sourceName || "").toLowerCase()
  if (src === "subscription_contract") return true
  if (src.includes("loop") || src.includes("subscription")) return true
  if ((opts.tags || "").toLowerCase().includes("subscription")) return true
  if (opts.noteAttributes?.some((a) => a.name.toLowerCase().includes("subscription"))) {
    return true
  }
  return false
}

function emptyBuckets(): SecondOrderBucket[] {
  return SECOND_ORDER_BUCKETS.map((b) => ({
    key: b.key,
    count: 0,
    pctOfRepeaters: 0,
  }))
}

function buildSegment(
  gaps: number[],
  firstOrderCount: number,
  segment: SegmentSecondOrderStats["segment"]
): SegmentSecondOrderStats {
  const sorted = [...gaps].sort((a, b) => a - b)
  const buckets = emptyBuckets()
  for (const d of gaps) {
    const key = bucketForDays(d)
    const row = buckets.find((b) => b.key === key)!
    row.count++
  }
  const repeaters = gaps.length
  for (const b of buckets) {
    b.pctOfRepeaters = repeaters > 0 ? (b.count / repeaters) * 100 : 0
  }

  const cumulativeDays = [7, 14, 21, 30, 45, 60, 90, 120, 180]
  const cumulative: CumulativePoint[] = cumulativeDays.map((day) => {
    const n = gaps.filter((g) => g <= day).length
    return {
      day,
      repeatRatePct: firstOrderCount > 0 ? (n / firstOrderCount) * 100 : 0,
    }
  })

  const rateAt = (day: number) => {
    const n = gaps.filter((g) => g <= day).length
    return firstOrderCount > 0 ? (n / firstOrderCount) * 100 : 0
  }

  return {
    segment,
    firstOrderCustomers: firstOrderCount,
    repeaters,
    medianDaysToSecond: medianSorted(sorted),
    repeatRate30: rateAt(30),
    repeatRate60: rateAt(60),
    repeatRate90: rateAt(90),
    buckets,
    cumulative,
  }
}

/**
 * Pure compute from a flat order list (already filtered to the fetch window).
 */
export function computeSecondOrderStats(opts: {
  orders: OrderForSecondTiming[]
  asOfDate: string
  lookbackDays?: number
}): SecondOrderResult {
  const lookbackDays = opts.lookbackDays ?? 180
  const windowEnd = opts.asOfDate
  const windowStart = addDaysYmd(windowEnd, -lookbackDays)

  type Cust = { orders: OrderForSecondTiming[]; anySub: boolean }
  const byCustomer = new Map<string, Cust>()

  for (const o of opts.orders) {
    if (!o.customerId) continue
    let c = byCustomer.get(o.customerId)
    if (!c) {
      c = { orders: [], anySub: false }
      byCustomer.set(o.customerId, c)
    }
    c.orders.push(o)
    if (o.isSubscription) c.anySub = true
  }

  const allGaps: number[] = []
  const subGaps: number[] = []
  const oneGaps: number[] = []
  let allFirst = 0
  let subFirst = 0
  let oneFirst = 0

  for (const c of byCustomer.values()) {
    c.orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const first = c.orders[0]
    const firstDay = pacificYmdFromIso(first.createdAt)
    if (firstDay < windowStart || firstDay > windowEnd) continue

    // Subscriber if first order (or any in window) looks like subscription.
    const isSub = first.isSubscription || c.anySub
    allFirst++
    if (isSub) subFirst++
    else oneFirst++

    if (c.orders.length < 2) continue
    const gap = daysBetweenPacific(first.createdAt, c.orders[1].createdAt)
    if (gap < 0) continue
    allGaps.push(gap)
    if (isSub) subGaps.push(gap)
    else oneGaps.push(gap)
  }

  const splitNote =
    subFirst + oneFirst > 0
      ? "Split uses order source_name / tags / note_attributes (Loop & subscription_contract heuristics) — not selling-plan line IDs."
      : "No customers in window."

  return {
    asOfDate: windowEnd,
    lookbackDays,
    windowStart,
    windowEnd,
    splitNote,
    all: buildSegment(allGaps, allFirst, "all"),
    subscriber: buildSegment(subGaps, subFirst, "subscriber"),
    oneTime: buildSegment(oneGaps, oneFirst, "one_time"),
    methodSummary:
      `First orders in the last ${lookbackDays} Pacific days (fetch window ${windowStart}→${windowEnd}). ` +
      `Days-to-second = Pacific calendar days from order 1 → order 2. ` +
      `Customers with only one order in-window are included in the denominator for repeat rates. ` +
      `Left-censoring: orders before the window are not visible — treat as approximate.`,
  }
}

const SECOND_ORDER_ADVISORY_LOCK = 872_014_003
const DEFAULT_PAGE_DELAY_MS = 500

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Load cached payload (or null). */
export async function getSecondOrderStats(): Promise<SecondOrderResult | null> {
  try {
    const { getDb } = await import("./db")
    const sql = await getDb()
    const rows = await sql`
      SELECT as_of_date::text AS as_of_date, lookback_days, payload, updated_at
      FROM second_order_stats WHERE id = 1
    `
    if (!rows.length) return null
    const payload = rows[0].payload as SecondOrderResult
    return {
      ...payload,
      asOfDate: (rows[0].as_of_date as string) || payload.asOfDate,
      lookbackDays: Number(rows[0].lookback_days) || payload.lookbackDays,
    }
  } catch (err: any) {
    console.warn("getSecondOrderStats failed:", err?.message)
    return null
  }
}

export async function saveSecondOrderStats(result: SecondOrderResult): Promise<void> {
  const { getDb } = await import("./db")
  const sql = await getDb()
  const jsonPayload = JSON.parse(JSON.stringify(result)) as Parameters<typeof sql.json>[0]
  await sql`
    INSERT INTO second_order_stats (id, as_of_date, lookback_days, payload, updated_at)
    VALUES (1, ${result.asOfDate}::date, ${result.lookbackDays}, ${sql.json(jsonPayload)}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      as_of_date = EXCLUDED.as_of_date,
      lookback_days = EXCLUDED.lookback_days,
      payload = EXCLUDED.payload,
      updated_at = NOW()
  `
}

/**
 * Fetch Shopify orders for the lookback window (throttled) and recompute cache.
 */
export async function refreshSecondOrderStats(opts?: {
  lookbackDays?: number
  asOfDate?: string
  pageDelayMs?: number
}): Promise<{ ok: boolean; skipped?: boolean; result?: SecondOrderResult; error?: string }> {
  const { getDb } = await import("./db")
  const sql = await getDb()
  const [lock] = await sql`SELECT pg_try_advisory_lock(${SECOND_ORDER_ADVISORY_LOCK}) AS ok`
  if (!lock?.ok) {
    return { ok: true, skipped: true }
  }

  try {
    const lookbackDays =
      opts?.lookbackDays != null
        ? opts.lookbackDays
        : Number(process.env.SHOPIFY_SECOND_ORDER_LOOKBACK_DAYS || 180) || 180
    const { todayPacific } = await import("./dates")
    const asOfDate = opts?.asOfDate || todayPacific()
    const windowStart = addDaysYmd(asOfDate, -lookbackDays)
    const pageDelayMs = opts?.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS

    const { fetchOrdersThrottled } = await import("./shopify")
    const orders = await fetchOrdersThrottled(windowStart, asOfDate, {
      pageDelayMs,
    })

    const mapped: OrderForSecondTiming[] = orders.map((o: any) => ({
      id: String(o.id),
      createdAt: o.created_at || o.processed_at,
      customerId: o.customer?.id != null ? String(o.customer.id) : null,
      isSubscription: isSubscriptionOrderSignals({
        sourceName: o.source_name,
        tags: o.tags,
        noteAttributes: o.note_attributes,
      }),
    }))

    const result = computeSecondOrderStats({
      orders: mapped,
      asOfDate,
      lookbackDays,
    })
    await saveSecondOrderStats(result)
    return { ok: true, result }
  } catch (err: any) {
    return { ok: false, error: err?.message || "refresh failed" }
  } finally {
    await sql`SELECT pg_advisory_unlock(${SECOND_ORDER_ADVISORY_LOCK})`
  }
}

export function verifySecondOrderCronSecret(authHeader: string | null): boolean {
  const secret =
    process.env.SECOND_ORDER_CRON_SECRET || process.env.DAILY_METRICS_CRON_SECRET
  if (!secret || !authHeader?.startsWith("Bearer ")) return false
  return authHeader.slice(7) === secret
}
