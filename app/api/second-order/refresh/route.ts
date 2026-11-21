import { NextRequest, NextResponse } from "next/server"
import {
  getSecondOrderStats,
  refreshSecondOrderStats,
  verifySecondOrderCronSecret,
} from "@/lib/second-order"

export const maxDuration = 300

/**
 * POST/GET /api/second-order/refresh
 * Auth: Authorization: Bearer ${SECOND_ORDER_CRON_SECRET || DAILY_METRICS_CRON_SECRET}
 *
 * Default: starts a background windowed Shopify scan and returns 202.
 * Pass `"sync": true` or `?sync=1` to await completion (may hit Railway timeout
 * on a full 180d pull — prefer async + poll GET /api or this endpoint without body).
 *
 * Poll: GET with `?status=1` returns current second_order_stats progress.
 */
export async function POST(req: NextRequest) {
  const secret =
    process.env.SECOND_ORDER_CRON_SECRET || process.env.DAILY_METRICS_CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "SECOND_ORDER_CRON_SECRET (or DAILY_METRICS_CRON_SECRET) is not configured",
      },
      { status: 503 }
    )
  }
  if (!verifySecondOrderCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  if (searchParams.get("status") === "1") {
    const current = await getSecondOrderStats()
    return NextResponse.json({
      mode: "status",
      progress: current?.progress || null,
      asOfDate: current?.asOfDate,
      coveredFrom: current?.coveredFrom,
      coveredTo: current?.coveredTo,
      ordersFetched: current?.ordersFetched,
      firstOrderCustomers: current?.all?.firstOrderCustomers,
      repeaters: current?.all?.repeaters,
    })
  }

  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const lookbackDays = Number(
    body.lookbackDays ??
      searchParams.get("lookbackDays") ??
      process.env.SHOPIFY_SECOND_ORDER_LOOKBACK_DAYS ??
      180
  )
  const sync =
    body.sync === true ||
    searchParams.get("sync") === "1" ||
    searchParams.get("sync") === "true"

  try {
    const result = await refreshSecondOrderStats({ lookbackDays, sync })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    if (result.accepted) {
      return NextResponse.json(
        {
          mode: "async",
          accepted: true,
          status: "running",
          message:
            "Second-order refresh started in background. Poll ?status=1 or wait for dashboard cache.",
          lookbackDays,
        },
        { status: 202 }
      )
    }

    if (result.skipped) {
      return NextResponse.json({
        mode: sync ? "sync" : "async",
        skipped: true,
        status: result.status || result.result?.progress?.status || "running",
        progress: result.result?.progress,
        asOfDate: result.result?.asOfDate,
        coveredFrom: result.result?.coveredFrom,
        coveredTo: result.result?.coveredTo,
        ordersFetched: result.result?.ordersFetched,
      })
    }

    return NextResponse.json({
      mode: "sync",
      status: "complete",
      asOfDate: result.result?.asOfDate,
      lookbackDays: result.result?.lookbackDays,
      coveredFrom: result.result?.coveredFrom,
      coveredTo: result.result?.coveredTo,
      ordersFetched: result.result?.ordersFetched,
      firstOrderCustomers: result.result?.all.firstOrderCustomers,
      repeaters: result.result?.all.repeaters,
      medianDaysToSecond: result.result?.all.medianDaysToSecond,
      progress: result.result?.progress,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Refresh failed" },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
