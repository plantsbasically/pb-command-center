/**
 * Loop analytics ingest + read helpers.
 *
 * External assistant pulls Loop MCP metrics (~5 AM PT) and POSTs here.
 * Validation is pure (unit-tested); DB upserts lazy-load getDb() from lib/db.ts
 * so Node's test runner can import validators without resolving postgres.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function getDb() {
  const { getDb: db } = await import("./db")
  return db()
}
const GRANULARITIES = new Set(["day", "week", "month"])

export interface LoopDailyIngestRow {
  date: string
  newSubscribers: number
  reactivated: number
  resumed: number
  churned?: number | null
  activeSubscribers?: number | null
  activeSubscriptions?: number | null
  mrr?: number | null
  source?: string | null
  raw?: unknown
}

export interface LoopCohortIngestRow {
  cohortStart: string
  cohortGranularity: "day" | "week" | "month"
  cohortSize: number
  metric: string
  valuePct: number
  ltv?: number | null
  snapshotDate: string
  raw?: unknown
}

export interface LoopLtvIngestRow {
  snapshotDate: string
  segment: string
  customers: number
  revenuePerCustomer: number
  raw?: unknown
}

export interface LoopIngestPayload {
  daily?: LoopDailyIngestRow[]
  cohorts?: LoopCohortIngestRow[]
  ltv?: LoopLtvIngestRow[]
}

export interface LoopIngestCounts {
  daily: number
  cohorts: number
  ltv: number
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function asFiniteNumber(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`Invalid ${field}: expected finite number`)
  }
  return v
}

function asOptionalNumber(v: unknown, field: string): number | null {
  if (v === undefined || v === null) return null
  return asFiniteNumber(v, field)
}

function asDateString(v: unknown, field: string): string {
  if (typeof v !== "string" || !DATE_RE.test(v)) {
    throw new Error(`Invalid ${field}: expected YYYY-MM-DD`)
  }
  return v
}

function asNonNegInt(v: unknown, field: string): number {
  const n = asFiniteNumber(v, field)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid ${field}: expected non-negative integer`)
  }
  return n
}

/** Map snake_case or camelCase daily row → canonical camelCase. */
export function normalizeDailyRow(raw: unknown, index: number): LoopDailyIngestRow {
  if (!isPlainObject(raw)) throw new Error(`daily[${index}]: expected object`)
  const date = asDateString(raw.date ?? raw.Date, `daily[${index}].date`)
  const newSubscribers = asNonNegInt(
    raw.newSubscribers ?? raw.new_subscribers,
    `daily[${index}].newSubscribers`
  )
  const reactivated = asNonNegInt(
    raw.reactivated ?? raw.Reactivated,
    `daily[${index}].reactivated`
  )
  const resumed = asNonNegInt(raw.resumed ?? raw.Resumed, `daily[${index}].resumed`)
  return {
    date,
    newSubscribers,
    reactivated,
    resumed,
    churned: asOptionalNumber(raw.churned ?? raw.Churned, `daily[${index}].churned`),
    activeSubscribers: asOptionalNumber(
      raw.activeSubscribers ?? raw.active_subscribers,
      `daily[${index}].activeSubscribers`
    ),
    activeSubscriptions: asOptionalNumber(
      raw.activeSubscriptions ?? raw.active_subscriptions,
      `daily[${index}].activeSubscriptions`
    ),
    mrr: asOptionalNumber(raw.mrr ?? raw.MRR, `daily[${index}].mrr`),
    source: raw.source == null ? null : String(raw.source),
    raw: raw.raw !== undefined ? raw.raw : raw,
  }
}

export function normalizeCohortRow(raw: unknown, index: number): LoopCohortIngestRow {
  if (!isPlainObject(raw)) throw new Error(`cohorts[${index}]: expected object`)
  const cohortGranularity = String(
    raw.cohortGranularity ?? raw.cohort_granularity ?? ""
  ).toLowerCase()
  if (!GRANULARITIES.has(cohortGranularity)) {
    throw new Error(`cohorts[${index}].cohortGranularity: expected day|week|month`)
  }
  const metric = String(raw.metric ?? "").trim()
  if (!metric) throw new Error(`cohorts[${index}].metric: required`)
  return {
    cohortStart: asDateString(
      raw.cohortStart ?? raw.cohort_start,
      `cohorts[${index}].cohortStart`
    ),
    cohortGranularity: cohortGranularity as "day" | "week" | "month",
    cohortSize: asNonNegInt(
      raw.cohortSize ?? raw.cohort_size,
      `cohorts[${index}].cohortSize`
    ),
    metric,
    valuePct: asFiniteNumber(raw.valuePct ?? raw.value_pct, `cohorts[${index}].valuePct`),
    ltv: asOptionalNumber(raw.ltv, `cohorts[${index}].ltv`),
    snapshotDate: asDateString(
      raw.snapshotDate ?? raw.snapshot_date,
      `cohorts[${index}].snapshotDate`
    ),
    raw: raw.raw !== undefined ? raw.raw : raw,
  }
}

export function normalizeLtvRow(raw: unknown, index: number): LoopLtvIngestRow {
  if (!isPlainObject(raw)) throw new Error(`ltv[${index}]: expected object`)
  const segment = String(raw.segment ?? "").trim()
  if (!segment) throw new Error(`ltv[${index}].segment: required`)
  return {
    snapshotDate: asDateString(
      raw.snapshotDate ?? raw.snapshot_date,
      `ltv[${index}].snapshotDate`
    ),
    segment,
    customers: asNonNegInt(raw.customers, `ltv[${index}].customers`),
    revenuePerCustomer: asFiniteNumber(
      raw.revenuePerCustomer ?? raw.revenue_per_customer,
      `ltv[${index}].revenuePerCustomer`
    ),
    raw: raw.raw !== undefined ? raw.raw : raw,
  }
}

/** Validate + normalize ingest body. Throws on shape errors. */
export function parseIngestPayload(body: unknown): {
  daily: LoopDailyIngestRow[]
  cohorts: LoopCohortIngestRow[]
  ltv: LoopLtvIngestRow[]
} {
  if (!isPlainObject(body)) throw new Error("Body must be a JSON object")
  const dailyRaw = body.daily
  const cohortsRaw = body.cohorts
  const ltvRaw = body.ltv
  if (dailyRaw !== undefined && !Array.isArray(dailyRaw)) {
    throw new Error("daily must be an array")
  }
  if (cohortsRaw !== undefined && !Array.isArray(cohortsRaw)) {
    throw new Error("cohorts must be an array")
  }
  if (ltvRaw !== undefined && !Array.isArray(ltvRaw)) {
    throw new Error("ltv must be an array")
  }
  return {
    daily: (dailyRaw || []).map(normalizeDailyRow),
    cohorts: (cohortsRaw || []).map(normalizeCohortRow),
    ltv: (ltvRaw || []).map(normalizeLtvRow),
  }
}

function toJsonb(sql: Awaited<ReturnType<typeof getDb>>, value: unknown) {
  return sql.json(JSON.parse(JSON.stringify(value ?? null)) as Parameters<typeof sql.json>[0])
}

export async function upsertLoopMetrics(payload: {
  daily: LoopDailyIngestRow[]
  cohorts: LoopCohortIngestRow[]
  ltv: LoopLtvIngestRow[]
}): Promise<LoopIngestCounts> {
  const sql = await getDb()
  let daily = 0
  let cohorts = 0
  let ltv = 0

  for (const row of payload.daily) {
    const churned = row.churned ?? null
    const activeSubscribers = row.activeSubscribers ?? null
    const activeSubscriptions = row.activeSubscriptions ?? null
    const mrr = row.mrr ?? null
    const source = row.source ?? null
    await sql`
      INSERT INTO loop_daily_metrics (
        date, new_subscribers, reactivated, resumed, churned,
        active_subscribers, active_subscriptions, mrr, source, raw, updated_at
      ) VALUES (
        ${row.date},
        ${row.newSubscribers},
        ${row.reactivated},
        ${row.resumed},
        ${churned},
        ${activeSubscribers},
        ${activeSubscriptions},
        ${mrr},
        ${source},
        ${toJsonb(sql, row.raw)},
        NOW()
      )
      ON CONFLICT (date) DO UPDATE SET
        new_subscribers = EXCLUDED.new_subscribers,
        reactivated = EXCLUDED.reactivated,
        resumed = EXCLUDED.resumed,
        churned = EXCLUDED.churned,
        active_subscribers = EXCLUDED.active_subscribers,
        active_subscriptions = EXCLUDED.active_subscriptions,
        mrr = EXCLUDED.mrr,
        source = EXCLUDED.source,
        raw = EXCLUDED.raw,
        updated_at = NOW()
    `
    daily++
  }

  for (const row of payload.cohorts) {
    const ltv = row.ltv ?? null
    await sql`
      INSERT INTO loop_cohort_retention (
        cohort_start, cohort_granularity, cohort_size, metric,
        value_pct, ltv, snapshot_date, raw
      ) VALUES (
        ${row.cohortStart},
        ${row.cohortGranularity},
        ${row.cohortSize},
        ${row.metric},
        ${row.valuePct},
        ${ltv},
        ${row.snapshotDate},
        ${toJsonb(sql, row.raw)}
      )
      ON CONFLICT (cohort_start, cohort_granularity, metric, snapshot_date) DO UPDATE SET
        cohort_size = EXCLUDED.cohort_size,
        value_pct = EXCLUDED.value_pct,
        ltv = EXCLUDED.ltv,
        raw = EXCLUDED.raw
    `
    cohorts++
  }

  for (const row of payload.ltv) {
    await sql`
      INSERT INTO loop_ltv_snapshot (
        snapshot_date, segment, customers, revenue_per_customer, raw
      ) VALUES (
        ${row.snapshotDate},
        ${row.segment},
        ${row.customers},
        ${row.revenuePerCustomer},
        ${toJsonb(sql, row.raw)}
      )
      ON CONFLICT (snapshot_date, segment) DO UPDATE SET
        customers = EXCLUDED.customers,
        revenue_per_customer = EXCLUDED.revenue_per_customer,
        raw = EXCLUDED.raw
    `
    ltv++
  }

  return { daily, cohorts, ltv }
}

export async function getLoopMetricsStatus(): Promise<{
  empty: boolean
  latestDailyDate: string | null
  latestCohortSnapshotDate: string | null
  latestLtvSnapshotDate: string | null
  missingDailyDatesLast90: string[]
}> {
  const { todayPacific, addDaysISO } = await import("./dates")
  const sql = await getDb()
  const [dailyMax] = await sql`SELECT MAX(date)::text AS d FROM loop_daily_metrics`
  const [cohortMax] = await sql`SELECT MAX(snapshot_date)::text AS d FROM loop_cohort_retention`
  const [ltvMax] = await sql`SELECT MAX(snapshot_date)::text AS d FROM loop_ltv_snapshot`
  const today = todayPacific()
  const presentRows = await sql`
    SELECT date::text AS d FROM loop_daily_metrics
    WHERE date >= ${addDaysISO(today, -90)}::date
  `
  const present = new Set(presentRows.map((r) => r.d as string))
  const missingDailyDatesLast90: string[] = []
  for (let i = 1; i <= 90; i++) {
    const key = addDaysISO(today, -i)
    if (!present.has(key)) missingDailyDatesLast90.push(key)
  }
  missingDailyDatesLast90.sort()

  const latestDailyDate = (dailyMax?.d as string) || null
  const empty = !latestDailyDate && present.size === 0

  return {
    empty,
    latestDailyDate,
    latestCohortSnapshotDate: (cohortMax?.d as string) || null,
    latestLtvSnapshotDate: (ltvMax?.d as string) || null,
    missingDailyDatesLast90,
  }
}

export async function getLoopMetricsRange(start: string, end: string) {
  const sql = await getDb()
  const dailyRows = await sql`
    SELECT
      date::text AS date,
      new_subscribers,
      reactivated,
      resumed,
      churned,
      active_subscribers,
      active_subscriptions,
      mrr,
      source,
      updated_at
    FROM loop_daily_metrics
    WHERE date >= ${start}::date AND date <= ${end}::date
    ORDER BY date ASC
  `

  const [latestCohortSnap] = await sql`
    SELECT MAX(snapshot_date)::text AS d FROM loop_cohort_retention
  `
  const cohortSnapshotDate = (latestCohortSnap?.d as string) || null
  const cohorts = cohortSnapshotDate
    ? await sql`
        SELECT
          cohort_start::text AS cohort_start,
          cohort_granularity,
          cohort_size,
          metric,
          value_pct,
          ltv,
          snapshot_date::text AS snapshot_date
        FROM loop_cohort_retention
        WHERE snapshot_date = ${cohortSnapshotDate}::date
        ORDER BY cohort_start DESC, metric ASC
      `
    : []

  const [latestLtvSnap] = await sql`
    SELECT MAX(snapshot_date)::text AS d FROM loop_ltv_snapshot
  `
  const ltvSnapshotDate = (latestLtvSnap?.d as string) || null
  const ltv = ltvSnapshotDate
    ? await sql`
        SELECT
          snapshot_date::text AS snapshot_date,
          segment,
          customers,
          revenue_per_customer
        FROM loop_ltv_snapshot
        WHERE snapshot_date = ${ltvSnapshotDate}::date
        ORDER BY segment ASC
      `
    : []

  return {
    daily: dailyRows.map((r) => ({
      date: r.date as string,
      newSubscribers: Number(r.new_subscribers),
      reactivated: Number(r.reactivated),
      resumed: Number(r.resumed),
      churned: r.churned == null ? null : Number(r.churned),
      activeSubscribers: r.active_subscribers == null ? null : Number(r.active_subscribers),
      activeSubscriptions: r.active_subscriptions == null ? null : Number(r.active_subscriptions),
      mrr: r.mrr == null ? null : Number(r.mrr),
      source: (r.source as string) || null,
      updatedAt: r.updated_at,
    })),
    cohorts: {
      snapshotDate: cohortSnapshotDate,
      rows: cohorts.map((r) => ({
        cohortStart: r.cohort_start as string,
        cohortGranularity: r.cohort_granularity as string,
        cohortSize: Number(r.cohort_size),
        metric: r.metric as string,
        valuePct: Number(r.value_pct),
        ltv: r.ltv == null ? null : Number(r.ltv),
        snapshotDate: r.snapshot_date as string,
      })),
    },
    ltv: {
      snapshotDate: ltvSnapshotDate,
      rows: ltv.map((r) => ({
        snapshotDate: r.snapshot_date as string,
        segment: r.segment as string,
        customers: Number(r.customers),
        revenuePerCustomer: Number(r.revenue_per_customer),
      })),
    },
  }
}

/** Lightweight summary for main /api — sum of new subscribers in range. */
export async function getLoopMetricsSummary(start: string, end: string): Promise<{
  newSubscribers: number
  reactivated: number
  resumed: number
  days: number
} | null> {
  try {
    const sql = await getDb()
    const [row] = await sql`
      SELECT
        COALESCE(SUM(new_subscribers), 0)::int AS new_subscribers,
        COALESCE(SUM(reactivated), 0)::int AS reactivated,
        COALESCE(SUM(resumed), 0)::int AS resumed,
        COUNT(*)::int AS days
      FROM loop_daily_metrics
      WHERE date >= ${start}::date AND date <= ${end}::date
    `
    if (!row || Number(row.days) === 0) return null
    return {
      newSubscribers: Number(row.new_subscribers),
      reactivated: Number(row.reactivated),
      resumed: Number(row.resumed),
      days: Number(row.days),
    }
  } catch (err: any) {
    console.warn("getLoopMetricsSummary failed:", err?.message)
    return null
  }
}

export function verifyLoopIngestSecret(header: string | null): boolean {
  const secret = process.env.LOOP_INGEST_SECRET
  if (!secret) return false
  if (!header) return false
  const [scheme, token] = header.split(" ")
  if (scheme?.toLowerCase() !== "bearer" || !token) return false
  return token === secret
}
