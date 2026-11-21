/**
 * Cohort retention heatmap + forward projection.
 *
 * Data: Loop `loop_cohort_retention` (monthly cohorts, day_30/60/90 and
 * order_2..order_6) plus optional `loop_ltv_snapshot` for $ / retained customer.
 *
 * Method (documented for the UI tooltip):
 * 1. Among mature monthly cohorts that have day_30, day_60, and day_90
 *    observed, compute step ratios day60/day30 and day90/day60.
 * 2. Average those ratios (and order_n / order_(n-1) where available).
 * 3. For each cohort, keep observed cells as actuals. From the last observed
 *    day_* point, extend forward in 30-day steps by multiplying by the average
 *    step ratio (capped so retention never rises). Young cohorts with only
 *    day_30 use the same average decay for day_60+.
 * 4. Active subscribers ≈ cohort_size × retention% / 100.
 *    Projected revenue ≈ active × revenuePerCustomer (Loop subscriber LTV
 *    when provided, else the cohort row’s ltv, else 0).
 *
 * Projection is illustrative — not a forecast model. CM / margin math is untouched.
 */

export const DAY_METRICS = ["day_30", "day_60", "day_90"] as const
export const ORDER_METRICS = [
  "order_2",
  "order_3",
  "order_4",
  "order_5",
  "order_6",
] as const

/** Forward day columns beyond observed day_90 (≈ monthly steps). */
export const PROJECTED_DAY_METRICS = [
  "day_120",
  "day_150",
  "day_180",
  "day_210",
  "day_240",
  "day_270",
  "day_300",
  "day_330",
  "day_360",
] as const

export type DayMetric =
  | (typeof DAY_METRICS)[number]
  | (typeof PROJECTED_DAY_METRICS)[number]

export interface CohortRetentionRow {
  cohortStart: string
  cohortGranularity: string
  cohortSize: number
  metric: string
  valuePct: number
  ltv: number | null
  snapshotDate: string
}

export interface CohortCell {
  metric: string
  valuePct: number
  active: number
  revenue: number
  /** false = observed from Loop; true = projected */
  projected: boolean
}

export interface CohortProjectionRow {
  cohortStart: string
  cohortSize: number
  maturity: "mature" | "partial" | "young"
  /** Observed LTV on any row for this cohort (if Loop sent one). */
  cohortLtv: number | null
  cells: CohortCell[]
}

export interface DecayModel {
  /** Average day_60 / day_30 across mature cohorts (0–1 scale of pct ratios). */
  day30to60: number
  /** Average day_90 / day_60. */
  day60to90: number
  /** Blended monthly step used for day_120+ (mean of the two step ratios). */
  monthlyStep: number
  /** Average order_n / order_(n-1) for n=3..6 where both observed. */
  orderStep: number
  matureCohortCount: number
  methodSummary: string
}

export interface CohortProjectionResult {
  snapshotDate: string | null
  revenuePerCustomer: number
  decay: DecayModel
  dayColumns: string[]
  rows: CohortProjectionRow[]
  /** Sum of projected active / revenue at the farthest projected column. */
  forwardTotals: { metric: string; active: number; revenue: number }[]
}

const DEFAULT_MONTHLY_STEP = 0.85
const DEFAULT_ORDER_STEP = 0.75

function dayIndex(metric: string): number | null {
  const m = /^day_(\d+)$/.exec(metric)
  return m ? Number(m[1]) : null
}

export function average(nums: number[]): number {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

/** Safe ratio of two percentages; returns null if denominator unusable. */
export function pctRatio(nextPct: number, prevPct: number): number | null {
  if (!(prevPct > 0) || !(nextPct >= 0)) return null
  // Retention should not jump up; clamp ratio to ≤ 1 for decay fitting.
  return Math.min(1, nextPct / prevPct)
}

export function fitDecayModel(
  rows: CohortRetentionRow[],
  granularity: string = "month"
): DecayModel {
  const byCohort = groupMonthly(rows, granularity)
  const r3060: number[] = []
  const r6090: number[] = []
  const orderSteps: number[] = []
  let mature = 0

  for (const [, map] of byCohort) {
    const d30 = map.get("day_30")?.valuePct
    const d60 = map.get("day_60")?.valuePct
    const d90 = map.get("day_90")?.valuePct
    if (d30 != null && d60 != null && d90 != null) {
      mature++
      const a = pctRatio(d60, d30)
      const b = pctRatio(d90, d60)
      if (a != null) r3060.push(a)
      if (b != null) r6090.push(b)
    }
    for (let n = 3; n <= 6; n++) {
      const prev = map.get(`order_${n - 1}`)?.valuePct
      const cur = map.get(`order_${n}`)?.valuePct
      if (prev != null && cur != null) {
        const r = pctRatio(cur, prev)
        if (r != null) orderSteps.push(r)
      }
    }
  }

  const day30to60 = r3060.length ? average(r3060) : DEFAULT_MONTHLY_STEP
  const day60to90 = r6090.length ? average(r6090) : DEFAULT_MONTHLY_STEP
  const monthlyStep = average([day30to60, day60to90].filter((x) => x > 0)) || DEFAULT_MONTHLY_STEP
  const orderStep = orderSteps.length ? average(orderSteps) : DEFAULT_ORDER_STEP

  const methodSummary =
    `Average step decay from ${mature} mature monthly cohort(s): ` +
    `day30→60 ×${day30to60.toFixed(2)}, day60→90 ×${day60to90.toFixed(2)} ` +
    `(forward months use ×${monthlyStep.toFixed(2)}/30d). ` +
    `Order-step average ×${orderStep.toFixed(2)}. ` +
    `Young cohorts keep observed cells; missing later days are projected. ` +
    `Active ≈ size × retention%; revenue ≈ active × Loop $/customer.`

  return {
    day30to60,
    day60to90,
    monthlyStep,
    orderStep,
    matureCohortCount: mature,
    methodSummary,
  }
}

function groupMonthly(
  rows: CohortRetentionRow[],
  granularity: string
): Map<string, Map<string, CohortRetentionRow>> {
  const byCohort = new Map<string, Map<string, CohortRetentionRow>>()
  for (const r of rows) {
    if (r.cohortGranularity !== granularity) continue
    if (!byCohort.has(r.cohortStart)) byCohort.set(r.cohortStart, new Map())
    byCohort.get(r.cohortStart)!.set(r.metric, r)
  }
  return byCohort
}

function maturityOf(map: Map<string, CohortRetentionRow>): CohortProjectionRow["maturity"] {
  const has30 = map.has("day_30")
  const has60 = map.has("day_60")
  const has90 = map.has("day_90")
  if (has30 && has60 && has90) return "mature"
  if (has30 && (has60 || has90)) return "partial"
  return "young"
}

function projectDaySeries(
  map: Map<string, CohortRetentionRow>,
  decay: DecayModel,
  columns: string[]
): { metric: string; valuePct: number; projected: boolean }[] {
  const out: { metric: string; valuePct: number; projected: boolean }[] = []
  let lastPct: number | null = null
  let lastDay = 0

  for (const col of columns) {
    const observed = map.get(col)
    const idx = dayIndex(col) ?? 0
    if (observed && Number.isFinite(observed.valuePct)) {
      lastPct = observed.valuePct
      lastDay = idx
      out.push({ metric: col, valuePct: observed.valuePct, projected: false })
      continue
    }

    // Project from last observed day_* using monthlyStep per 30-day gap.
    if (lastPct == null) {
      // No anchor yet — leave blank (0) as unknown
      out.push({ metric: col, valuePct: 0, projected: true })
      continue
    }
    const steps = Math.max(1, Math.round((idx - lastDay) / 30))
    let pct: number = lastPct
    for (let s = 0; s < steps; s++) {
      // Prefer calibrated steps when projecting into day_60 / day_90 specifically
      if (lastDay === 30 && idx === 60) pct = lastPct * decay.day30to60
      else if (lastDay === 60 && idx === 90) pct = lastPct * decay.day60to90
      else pct = pct * decay.monthlyStep
    }
    pct = Math.max(0, Math.min(lastPct, pct))
    lastPct = pct
    lastDay = idx
    out.push({ metric: col, valuePct: pct, projected: true })
  }
  return out
}

export function buildCohortProjection(opts: {
  rows: CohortRetentionRow[]
  snapshotDate: string | null
  /** $/retained customer for revenue projection */
  revenuePerCustomer: number
  /** How many projected 30-day steps past day_90 (default 9 → through day_360). */
  forwardSteps?: number
  granularity?: string
}): CohortProjectionResult {
  const granularity = opts.granularity || "month"
  const forwardSteps = Math.min(
    9,
    Math.max(0, opts.forwardSteps ?? 9)
  )
  const dayColumns = [
    ...DAY_METRICS,
    ...PROJECTED_DAY_METRICS.slice(0, forwardSteps),
  ]
  const decay = fitDecayModel(opts.rows, granularity)
  const byCohort = groupMonthly(opts.rows, granularity)
  const rpc = opts.revenuePerCustomer || 0

  const rows: CohortProjectionRow[] = [...byCohort.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([cohortStart, map]) => {
      const size =
        [...map.values()].find((r) => r.cohortSize > 0)?.cohortSize || 0
      let cohortLtv: number | null = null
      for (const r of map.values()) {
        if (r.ltv != null && r.ltv > 0) {
          cohortLtv = r.ltv
          break
        }
      }
      const series = projectDaySeries(map, decay, dayColumns)
      const cells: CohortCell[] = series.map((s) => {
        const active = (size * s.valuePct) / 100
        const unit = rpc > 0 ? rpc : cohortLtv || 0
        return {
          metric: s.metric,
          valuePct: s.valuePct,
          active,
          revenue: active * unit,
          projected: s.projected,
        }
      })
      return {
        cohortStart,
        cohortSize: size,
        maturity: maturityOf(map),
        cohortLtv,
        cells,
      }
    })

  const forwardTotals = dayColumns.map((metric) => {
    let active = 0
    let revenue = 0
    for (const row of rows) {
      const cell = row.cells.find((c) => c.metric === metric)
      if (cell) {
        active += cell.active
        revenue += cell.revenue
      }
    }
    return { metric, active, revenue }
  })

  return {
    snapshotDate: opts.snapshotDate,
    revenuePerCustomer: rpc,
    decay,
    dayColumns,
    rows,
    forwardTotals,
  }
}

/** Heatmap color 0–100% → light emerald intensity (actuals). */
export function retentionHeatColor(valuePct: number, projected: boolean): string {
  const t = Math.max(0, Math.min(100, valuePct)) / 100
  const alpha = projected ? 0.25 + t * 0.35 : 0.15 + t * 0.75
  return `rgba(16, 185, 129, ${alpha.toFixed(3)})`
}
