import { NextRequest, NextResponse } from "next/server"
import {
  runBackfill,
  runCronRefresh,
  verifyDailyMetricsCronSecret,
} from "@/lib/daily-metrics"

export const maxDuration = 300

/**
 * POST /api/daily-metrics/refresh
 * Auth: Authorization: Bearer ${DAILY_METRICS_CRON_SECRET}
 *
 * Body (optional JSON):
 *   { "mode": "cron" }                         — today + yesterday (default)
 *   { "mode": "backfill", "days": 90, "force": false }
 *
 * Also accepts ?mode=backfill&days=90&force=1 on the query string.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.DAILY_METRICS_CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "DAILY_METRICS_CRON_SECRET is not configured" },
      { status: 503 }
    )
  }
  if (!verifyDailyMetricsCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const mode = String(body.mode || searchParams.get("mode") || "cron")
  const days = Number(body.days ?? searchParams.get("days") ?? 90)
  const force =
    body.force === true ||
    searchParams.get("force") === "1" ||
    searchParams.get("force") === "true"

  try {
    if (mode === "backfill") {
      const result = await runBackfill({ days, force })
      return NextResponse.json({ mode: "backfill", days, force, ...result })
    }

    const result = await runCronRefresh()
    return NextResponse.json({ mode: "cron", ...result })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Refresh failed" },
      { status: 500 }
    )
  }
}

/** GET with same Bearer auth — convenience for Railway cron HTTP pings. */
export async function GET(req: NextRequest) {
  return POST(req)
}
