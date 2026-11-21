/**
 * Cohort retention projection math.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  average,
  buildCohortProjection,
  fitDecayModel,
  pctRatio,
  type CohortRetentionRow,
} from "./cohort-projection.ts"

function row(
  cohortStart: string,
  metric: string,
  valuePct: number,
  size = 100,
  ltv: number | null = 150
): CohortRetentionRow {
  return {
    cohortStart,
    cohortGranularity: "month",
    cohortSize: size,
    metric,
    valuePct,
    ltv,
    snapshotDate: "2026-11-19",
  }
}

const FIXTURE: CohortRetentionRow[] = [
  // Mature A
  row("2026-05-01", "day_30", 80, 200),
  row("2026-05-01", "day_60", 64, 200),
  row("2026-05-01", "day_90", 51.2, 200),
  row("2026-05-01", "order_2", 70, 200),
  row("2026-05-01", "order_3", 49, 200),
  // Mature B — same step ratios 0.8
  row("2026-06-01", "day_30", 70, 150),
  row("2026-06-01", "day_60", 56, 150),
  row("2026-06-01", "day_90", 44.8, 150),
  // Young — only day_30
  row("2026-10-01", "day_30", 75, 120),
  // Partial — day_30 + day_60
  row("2026-09-01", "day_30", 78, 110),
  row("2026-09-01", "day_60", 62.4, 110),
]

describe("pctRatio / average", () => {
  it("clamps rising retention ratios to 1", () => {
    assert.equal(pctRatio(90, 80), 1)
    assert.ok(Math.abs((pctRatio(64, 80) || 0) - 0.8) < 1e-9)
    assert.equal(pctRatio(50, 0), null)
  })
  it("averages", () => {
    assert.equal(average([0.8, 0.8]), 0.8)
  })
})

describe("fitDecayModel", () => {
  it("fits ~0.8 monthly step from mature cohorts", () => {
    const decay = fitDecayModel(FIXTURE)
    assert.equal(decay.matureCohortCount, 2)
    assert.ok(Math.abs(decay.day30to60 - 0.8) < 0.01)
    assert.ok(Math.abs(decay.day60to90 - 0.8) < 0.01)
    assert.ok(Math.abs(decay.monthlyStep - 0.8) < 0.01)
    assert.ok(Math.abs(decay.orderStep - 0.7) < 0.01)
  })
})

describe("buildCohortProjection", () => {
  it("keeps actuals and projects young cohort day_60+", () => {
    const result = buildCohortProjection({
      rows: FIXTURE,
      snapshotDate: "2026-11-19",
      revenuePerCustomer: 165.5,
      forwardSteps: 3,
    })
    assert.deepEqual(result.dayColumns.slice(0, 3), ["day_30", "day_60", "day_90"])
    assert.ok(result.dayColumns.includes("day_120"))

    const may = result.rows.find((r) => r.cohortStart === "2026-05-01")!
    assert.equal(may.maturity, "mature")
    const may30 = may.cells.find((c) => c.metric === "day_30")!
    assert.equal(may30.projected, false)
    assert.equal(may30.valuePct, 80)
    assert.ok(Math.abs(may30.active - 160) < 0.01)

    const may120 = may.cells.find((c) => c.metric === "day_120")!
    assert.equal(may120.projected, true)
    // 51.2 * 0.8 = 40.96
    assert.ok(Math.abs(may120.valuePct - 40.96) < 0.05)

    const oct = result.rows.find((r) => r.cohortStart === "2026-10-01")!
    assert.equal(oct.maturity, "young")
    const oct30 = oct.cells.find((c) => c.metric === "day_30")!
    assert.equal(oct30.projected, false)
    const oct60 = oct.cells.find((c) => c.metric === "day_60")!
    assert.equal(oct60.projected, true)
    assert.ok(Math.abs(oct60.valuePct - 75 * 0.8) < 0.05)

    // Revenue uses Loop $/customer
    assert.ok(Math.abs(may30.revenue - 160 * 165.5) < 0.5)
    assert.match(result.decay.methodSummary, /mature monthly cohort/)
  })

  it("marks projected cells distinctly from actuals", () => {
    const result = buildCohortProjection({
      rows: FIXTURE,
      snapshotDate: "2026-11-19",
      revenuePerCustomer: 100,
      forwardSteps: 1,
    })
    const sep = result.rows.find((r) => r.cohortStart === "2026-09-01")!
    assert.equal(sep.maturity, "partial")
    assert.equal(sep.cells.find((c) => c.metric === "day_60")!.projected, false)
    assert.equal(sep.cells.find((c) => c.metric === "day_90")!.projected, true)
  })
})
