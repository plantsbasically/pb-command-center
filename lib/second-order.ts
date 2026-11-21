/**
 * Time-to-second-order analytics from Shopify orders.
 *
 * Population: customers whose earliest order in the fetched window falls in the
 * lookback (default 180 Pacific days). Days-to-second = calendar days between
 * first and second order by created_at.
 *
 * Repeat rates at day N use an *eligible* denominator: only customers whose
 * first order is at least N days before as-of (they had time to hit the window).
 *
 * Expensive Shopify scans are cached in `second_order_stats` (background refresh),
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
  /** % of *eligible* first-order customers who have reordered by this day. */
  repeatRatePct: number
  eligibleCustomers: number
}

export interface SegmentSecondOrderStats {
  segment: "all" | "subscriber" | "one_time"
  firstOrderCustomers: number
  repeaters: number
  medianDaysToSecond: number | null
  repeatRate30: number
  repeatRate60: number
  repeatRate90: number
  eligible30: number
  eligible60: number
  eligible90: number
  buckets: SecondOrderBucket[]
  cumulative: CumulativePoint[]
}

export type SecondOrderJobStatus = "idle" | "running" | "complete" | "error"

export interface SecondOrderProgress {
  status: SecondOrderJobStatus
  chunksDone: number
  chunksTotal: number
  ordersFetched: number
  coveredFrom: string | null
  coveredTo: string | null
  message?: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

export interface SecondOrderResult {
  asOfDate: string
  lookbackDays: number
  windowStart: string
  windowEnd: string
  /** Actual min/max order dates present in the fetched set (Pacific YMD). */
  coveredFrom: string | null
  coveredTo: string | null
  ordersFetched: number
  splitNote: string
  eligibleNote: string
  all: SegmentSecondOrderStats
  subscriber: SegmentSecondOrderStats
  oneTime: SegmentSecondOrderStats
  methodSummary: string
  progress?: SecondOrderProgress
}

export interface CustomerObs {
  firstDay: string
  gap: number | null
}

export function pacificYmdFromIso(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

export function daysBetweenYmd(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  const aUtc = Date.UTC(ay, am - 1, ad)
  const bUtc = Date.UTC(by, bm - 1, bd)
  return Math.round((bUtc - aUtc) / 86_400_000)
}

export function daysBetweenPacific(aIso: string, bIso: string): number {
  return daysBetweenYmd(pacificYmdFromIso(aIso), pacificYmdFromIso(bIso))
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

/** Eligible = first order at least `day` calendar days before as-of. */
export function eligibleForDay(obs: CustomerObs[], asOfDate: string, day: number): CustomerObs[] {
  return obs.filter((c) => daysBetweenYmd(c.firstDay, asOfDate) >= day)
}

export function repeatRateEligible(
  obs: CustomerObs[],
  asOfDate: string,
  day: number
): { ratePct: number; eligible: number; repeatersByDay: number } {
  const eligible = eligibleForDay(obs, asOfDate, day)
  const repeatersByDay = eligible.filter((c) => c.gap != null && c.gap <= day).length
  return {
    ratePct: eligible.length > 0 ? (repeatersByDay / eligible.length) * 100 : 0,
    eligible: eligible.length,
    repeatersByDay,
  }
}

function buildSegment(
  obs: CustomerObs[],
  asOfDate: string,
  segment: SegmentSecondOrderStats["segment"]
): SegmentSecondOrderStats {
  const gaps = obs
    .map((c) => c.gap)
    .filter((g): g is number => g != null && g >= 0)
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
    const r = repeatRateEligible(obs, asOfDate, day)
    return {
      day,
      repeatRatePct: r.ratePct,
      eligibleCustomers: r.eligible,
    }
  })

  const r30 = repeatRateEligible(obs, asOfDate, 30)
  const r60 = repeatRateEligible(obs, asOfDate, 60)
  const r90 = repeatRateEligible(obs, asOfDate, 90)

  return {
    segment,
    firstOrderCustomers: obs.length,
    repeaters,
    medianDaysToSecond: medianSorted(sorted),
    repeatRate30: r30.ratePct,
    repeatRate60: r60.ratePct,
    repeatRate90: r90.ratePct,
    eligible30: r30.eligible,
    eligible60: r60.eligible,
    eligible90: r90.eligible,
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
  coveredFrom?: string | null
  coveredTo?: string | null
  ordersFetched?: number
}): SecondOrderResult {
  const lookbackDays = opts.lookbackDays ?? 180
  const windowEnd = opts.asOfDate
  const windowStart = addDaysYmd(windowEnd, -lookbackDays)

  type Cust = { orders: OrderForSecondTiming[]; anySub: boolean }
  const byCustomer = new Map<string, Cust>()

  let minDay: string | null = null
  let maxDay: string | null = null

  for (const o of opts.orders) {
    const day = pacificYmdFromIso(o.createdAt)
    if (!minDay || day < minDay) minDay = day
    if (!maxDay || day > maxDay) maxDay = day
    if (!o.customerId) continue
    let c = byCustomer.get(o.customerId)
    if (!c) {
      c = { orders: [], anySub: false }
      byCustomer.set(o.customerId, c)
    }
    c.orders.push(o)
    if (o.isSubscription) c.anySub = true
  }

  const allObs: CustomerObs[] = []
  const subObs: CustomerObs[] = []
  const oneObs: CustomerObs[] = []

  for (const c of byCustomer.values()) {
    c.orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const first = c.orders[0]
    const firstDay = pacificYmdFromIso(first.createdAt)
    if (firstDay < windowStart || firstDay > windowEnd) continue

    const isSub = first.isSubscription || c.anySub
    let gap: number | null = null
    if (c.orders.length >= 2) {
      const g = daysBetweenPacific(first.createdAt, c.orders[1].createdAt)
      if (g >= 0) gap = g
    }
    const obs: CustomerObs = { firstDay, gap }
    allObs.push(obs)
    if (isSub) subObs.push(obs)
    else oneObs.push(obs)
  }

  const coveredFrom = opts.coveredFrom ?? minDay
  const coveredTo = opts.coveredTo ?? maxDay
  const ordersFetched = opts.ordersFetched ?? opts.orders.length

  const splitNote =
    allObs.length > 0
      ? "Split uses order source_name / tags / note_attributes (Loop & subscription_contract heuristics) — not selling-plan line IDs."
      : "No customers in window."

  const eligibleNote =
    "Repeat rates at day N only include customers whose first order is ≥ N days before as-of (eligible denominator)."

  return {
    asOfDate: windowEnd,
    lookbackDays,
    windowStart,
    windowEnd,
    coveredFrom,
    coveredTo,
    ordersFetched,
    splitNote,
    eligibleNote,
    all: buildSegment(allObs, windowEnd, "all"),
    subscriber: buildSegment(subObs, windowEnd, "subscriber"),
    oneTime: buildSegment(oneObs, windowEnd, "one_time"),
    methodSummary:
      `First orders in the last ${lookbackDays} Pacific days (requested ${windowStart}→${windowEnd}; ` +
      `fetched ${ordersFetched} orders covering ${coveredFrom || "—"}→${coveredTo || "—"}). ` +
      `Days-to-second = Pacific calendar days from order 1 → order 2. ` +
      `${eligibleNote} ` +
      `Left-censoring: orders before the window are not visible — treat as approximate.`,
  }
}

const SECOND_ORDER_ADVISORY_LOCK = 872_014_003
const DEFAULT_PAGE_DELAY_MS = 500
const DEFAULT_CHUNK_DAYS = 15

/** In-process guard so we don't start two background jobs in one Node process. */
let inProcessJobRunning = false

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

async function writeProgress(partial: Partial<SecondOrderResult> & { progress: SecondOrderProgress }) {
  const existing = (await getSecondOrderStats()) || null
  const lookbackDays = partial.lookbackDays ?? existing?.lookbackDays ?? 180
  const asOfDate = partial.asOfDate ?? existing?.asOfDate ?? partial.progress.coveredTo ?? "1970-01-01"
  const merged: SecondOrderResult = {
    asOfDate,
    lookbackDays,
    windowStart: partial.windowStart ?? existing?.windowStart ?? asOfDate,
    windowEnd: partial.windowEnd ?? existing?.windowEnd ?? asOfDate,
    coveredFrom: partial.coveredFrom ?? existing?.coveredFrom ?? null,
    coveredTo: partial.coveredTo ?? existing?.coveredTo ?? null,
    ordersFetched: partial.ordersFetched ?? existing?.ordersFetched ?? 0,
    splitNote: partial.splitNote ?? existing?.splitNote ?? "",
    eligibleNote: partial.eligibleNote ?? existing?.eligibleNote ?? "",
    all: partial.all ?? existing?.all ?? emptySegment("all"),
    subscriber: partial.subscriber ?? existing?.subscriber ?? emptySegment("subscriber"),
    oneTime: partial.oneTime ?? existing?.oneTime ?? emptySegment("one_time"),
    methodSummary: partial.methodSummary ?? existing?.methodSummary ?? "",
    progress: partial.progress,
  }
  await saveSecondOrderStats(merged)
}

function emptySegment(segment: SegmentSecondOrderStats["segment"]): SegmentSecondOrderStats {
  return {
    segment,
    firstOrderCustomers: 0,
    repeaters: 0,
    medianDaysToSecond: null,
    repeatRate30: 0,
    repeatRate60: 0,
    repeatRate90: 0,
    eligible30: 0,
    eligible60: 0,
    eligible90: 0,
    buckets: emptyBuckets(),
    cumulative: [],
  }
}

/** Chunk progress callback — closes over windowStart only (never fetch result bindings). */
export function makeSecondOrderChunkProgressHandler(ctx: {
  asOfDate: string
  lookbackDays: number
  windowStart: string
  startedAt: string
  writeProgress: (partial: Partial<SecondOrderResult> & { progress: SecondOrderProgress }) => Promise<void>
}) {
  return async (info: {
    chunkStart: string
    chunkEnd: string
    chunkIndex: number
    chunkCount: number
    ordersInChunk: number
    ordersTotal: number
    createdAtMin?: string
    createdAtMax?: string
  }) => {
    console.log(
      `[second-order] chunk ${info.chunkIndex}/${info.chunkCount} ` +
        `${info.chunkStart}→${info.chunkEnd}: +${info.ordersInChunk} (total ${info.ordersTotal})` +
        (info.createdAtMin && info.createdAtMax
          ? ` · filter ${info.createdAtMin} → ${info.createdAtMax}`
          : "")
    )
    await ctx.writeProgress({
      asOfDate: ctx.asOfDate,
      lookbackDays: ctx.lookbackDays,
      windowStart: ctx.windowStart,
      windowEnd: ctx.asOfDate,
      coveredFrom: ctx.windowStart,
      coveredTo: info.chunkEnd,
      ordersFetched: info.ordersTotal,
      progress: {
        status: "running",
        chunksDone: info.chunkIndex,
        chunksTotal: info.chunkCount,
        ordersFetched: info.ordersTotal,
        coveredFrom: ctx.windowStart,
        coveredTo: info.chunkEnd,
        message: `${info.chunkIndex}/${info.chunkCount} chunks · ${info.ordersTotal} orders`,
        startedAt: ctx.startedAt,
      },
    })
  }
}

/**
 * Run the full windowed Shopify scan and write complete stats.
 * Holds the advisory lock for the duration.
 */
export async function runSecondOrderRefreshJob(opts?: {
  lookbackDays?: number
  asOfDate?: string
  pageDelayMs?: number
  chunkDays?: number
}): Promise<{ ok: boolean; skipped?: boolean; result?: SecondOrderResult; error?: string }> {
  const { getDb } = await import("./db")
  const sql = await getDb()
  const [lock] = await sql`SELECT pg_try_advisory_lock(${SECOND_ORDER_ADVISORY_LOCK}) AS ok`
  if (!lock?.ok) {
    return { ok: true, skipped: true }
  }

  const startedAt = new Date().toISOString()
  try {
    const lookbackDays =
      opts?.lookbackDays != null
        ? opts.lookbackDays
        : Number(process.env.SHOPIFY_SECOND_ORDER_LOOKBACK_DAYS || 180) || 180
    const { todayPacific } = await import("./dates")
    const asOfDate = opts?.asOfDate || todayPacific()
    const windowStart = addDaysYmd(asOfDate, -lookbackDays)
    const pageDelayMs = opts?.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS
    const chunkDays = opts?.chunkDays ?? DEFAULT_CHUNK_DAYS

    await writeProgress({
      asOfDate,
      lookbackDays,
      windowStart,
      windowEnd: asOfDate,
      progress: {
        status: "running",
        chunksDone: 0,
        chunksTotal: 0,
        ordersFetched: 0,
        coveredFrom: windowStart,
        coveredTo: asOfDate,
        message: `Fetching Shopify orders ${windowStart}→${asOfDate} in ${chunkDays}d chunks`,
        startedAt,
      },
    })

    const { fetchOrdersWindowed, dateRangeChunks } = await import("./shopify")
    const chunks = dateRangeChunks(windowStart, asOfDate, chunkDays)

    await writeProgress({
      asOfDate,
      lookbackDays,
      windowStart,
      windowEnd: asOfDate,
      progress: {
        status: "running",
        chunksDone: 0,
        chunksTotal: chunks.length,
        ordersFetched: 0,
        coveredFrom: windowStart,
        coveredTo: asOfDate,
        message: `0/${chunks.length} chunks`,
        startedAt,
      },
    })

    // Progress must not close over the destructured fetch result (TDZ).
    const onChunk = makeSecondOrderChunkProgressHandler({
      asOfDate,
      lookbackDays,
      windowStart,
      startedAt,
      writeProgress,
    })
    const { orders, coveredFrom, coveredTo } = await fetchOrdersWindowed(windowStart, asOfDate, {
      chunkDays,
      pageDelayMs,
      onChunk,
    })

    console.log(
      `[second-order] fetched ${orders.length} orders spanning ${coveredFrom}→${coveredTo} ` +
        `(requested ${windowStart}→${asOfDate})`
    )

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
      coveredFrom,
      coveredTo,
      ordersFetched: orders.length,
    })
    result.progress = {
      status: "complete",
      chunksDone: chunks.length,
      chunksTotal: chunks.length,
      ordersFetched: orders.length,
      coveredFrom,
      coveredTo,
      message: `Complete · ${orders.length} orders · ${coveredFrom}→${coveredTo}`,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    await saveSecondOrderStats(result)
    return { ok: true, result }
  } catch (err: any) {
    const message = err?.message || "refresh failed"
    console.error("[second-order] refresh failed:", message)
    try {
      await writeProgress({
        progress: {
          status: "error",
          chunksDone: 0,
          chunksTotal: 0,
          ordersFetched: 0,
          coveredFrom: null,
          coveredTo: null,
          message,
          error: message,
          startedAt,
          finishedAt: new Date().toISOString(),
        },
      })
    } catch {
      /* ignore */
    }
    return { ok: false, error: message }
  } finally {
    await sql`SELECT pg_advisory_unlock(${SECOND_ORDER_ADVISORY_LOCK})`
    inProcessJobRunning = false
  }
}

/**
 * Kick off a background refresh (for HTTP 202). Returns immediately if started.
 * Use `sync: true` to await the full job in-process (tests / small windows).
 */
export async function refreshSecondOrderStats(opts?: {
  lookbackDays?: number
  asOfDate?: string
  pageDelayMs?: number
  chunkDays?: number
  sync?: boolean
}): Promise<{
  ok: boolean
  accepted?: boolean
  skipped?: boolean
  result?: SecondOrderResult
  error?: string
  status?: SecondOrderJobStatus
}> {
  if (opts?.sync) {
    return runSecondOrderRefreshJob(opts)
  }

  const existing = await getSecondOrderStats()
  if (existing?.progress?.status === "running" || inProcessJobRunning) {
    return {
      ok: true,
      skipped: true,
      accepted: false,
      status: "running",
      result: existing || undefined,
    }
  }

  inProcessJobRunning = true
  // Fire-and-forget — Railway Node keeps the process; response returns 202.
  void runSecondOrderRefreshJob(opts).catch((err) => {
    console.error("[second-order] background job error:", err)
    inProcessJobRunning = false
  })

  return {
    ok: true,
    accepted: true,
    status: "running",
  }
}

export function verifySecondOrderCronSecret(authHeader: string | null): boolean {
  const secret =
    process.env.SECOND_ORDER_CRON_SECRET || process.env.DAILY_METRICS_CRON_SECRET
  if (!secret || !authHeader?.startsWith("Bearer ")) return false
  return authHeader.slice(7) === secret
}
