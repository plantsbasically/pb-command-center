/**
 * Optional in-process scheduler for Railway's long-running Next server.
 *
 * Prefers an external Railway Cron hitting POST /api/daily-metrics/refresh
 * (see docs/DAILY_METRICS.md). When DAILY_METRICS_CRON_SECRET is set and
 * DAILY_METRICS_INPROCESS_SCHEDULER is not "0", this also ticks every 12 minutes.
 *
 * Safe under concurrency: runCronRefresh uses pg_try_advisory_lock.
 */

const INTERVAL_MS = 12 * 60 * 1000 // ~12 minutes
const STARTUP_DELAY_MS = 45_000 // let the server finish booting

const globalForSched = globalThis as unknown as {
  _dailyMetricsSchedulerStarted?: boolean
  _dailyMetricsSchedulerTimer?: ReturnType<typeof setInterval>
}

async function tick() {
  try {
    const { runCronRefresh } = await import("./daily-metrics")
    const result = await runCronRefresh()
    if (result.skipped) {
      console.log("[daily-metrics] cron skipped:", result.reason)
    } else {
      console.log(
        "[daily-metrics] cron refreshed:",
        result.refreshed.join(", ") || "(none)",
        result.errors.length ? `errors=${result.errors.length}` : ""
      )
    }
  } catch (err: any) {
    console.error("[daily-metrics] in-process tick failed:", err?.message || err)
  }
}

export function startDailyMetricsScheduler() {
  if (process.env.DAILY_METRICS_INPROCESS_SCHEDULER === "0") return
  if (!process.env.DAILY_METRICS_CRON_SECRET) {
    console.warn(
      "[daily-metrics] DAILY_METRICS_CRON_SECRET unset — in-process scheduler not started"
    )
    return
  }
  if (!process.env.DATABASE_URL) return
  if (globalForSched._dailyMetricsSchedulerStarted) return
  globalForSched._dailyMetricsSchedulerStarted = true

  console.log(
    `[daily-metrics] in-process scheduler starting in ${STARTUP_DELAY_MS / 1000}s, then every ${INTERVAL_MS / 60000}m`
  )

  setTimeout(() => {
    void tick()
    globalForSched._dailyMetricsSchedulerTimer = setInterval(() => {
      void tick()
    }, INTERVAL_MS)
    // Don't keep the process alive solely for the timer in edge cases
    if (
      globalForSched._dailyMetricsSchedulerTimer &&
      typeof globalForSched._dailyMetricsSchedulerTimer === "object" &&
      "unref" in globalForSched._dailyMetricsSchedulerTimer
    ) {
      ;(globalForSched._dailyMetricsSchedulerTimer as NodeJS.Timeout).unref?.()
    }
  }, STARTUP_DELAY_MS)
}
