/**
 * Load Loop cohort + LTV snapshots and build the dashboard projection payload.
 */
import { buildCohortProjection, type CohortProjectionResult } from "./cohort-projection"
import { computeLoopLtv } from "./ltv-cac"

export async function getCohortProjectionForDashboard(): Promise<CohortProjectionResult | null> {
  try {
    const { getLoopMetricsRange } = await import("./loop-metrics")
    const { todayPacific } = await import("./dates")
    // Range unused for cohorts (latest snapshot); pass a dummy Pacific range.
    const end = todayPacific()
    const data = await getLoopMetricsRange(end, end)

    const cohortRows = (data.cohorts.rows || []).map((r) => ({
      cohortStart: r.cohortStart,
      cohortGranularity: r.cohortGranularity,
      cohortSize: r.cohortSize,
      metric: r.metric,
      valuePct: r.valuePct,
      ltv: r.ltv,
      snapshotDate: r.snapshotDate,
    }))

    if (!cohortRows.length) return null

    let revenuePerCustomer = 0
    if (data.ltv.rows?.length) {
      const loop = computeLoopLtv(
        data.ltv.rows.map((r) => ({
          segment: r.segment,
          customers: r.customers,
          revenuePerCustomer: r.revenuePerCustomer,
        })),
        data.ltv.snapshotDate || end
      )
      revenuePerCustomer = loop.subscriberLtv || loop.blendedLtv || 0
    }

    return buildCohortProjection({
      rows: cohortRows,
      snapshotDate: data.cohorts.snapshotDate,
      revenuePerCustomer,
      forwardSteps: 9,
      granularity: "month",
    })
  } catch (err: any) {
    console.warn("getCohortProjectionForDashboard failed:", err?.message)
    return null
  }
}
