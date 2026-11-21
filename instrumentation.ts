/**
 * Next.js server instrumentation — starts the optional in-process
 * daily_metrics refresh scheduler on Node runtime boot (Railway).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDailyMetricsScheduler } = await import(
      "./lib/daily-metrics-scheduler"
    )
    startDailyMetricsScheduler()
  }
}
