import { NextRequest, NextResponse } from "next/server"
import {
  refreshSecondOrderStats,
  verifySecondOrderCronSecret,
} from "@/lib/second-order"

export const maxDuration = 300

/**
 * POST/GET /api/second-order/refresh
 * Auth: Authorization: Bearer ${SECOND_ORDER_CRON_SECRET || DAILY_METRICS_CRON_SECRET}
 *
 * Pulls Shopify orders for the lookback window (throttled) and upserts
 * second_order_stats. Does not run on dashboard page load.
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

  let body: Record<string, unknown> = {}
  try {
    const text = await req.text()
    if (text) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const lookbackDays = Number(
    body.lookbackDays ??
      new URL(req.url).searchParams.get("lookbackDays") ??
      process.env.SHOPIFY_SECOND_ORDER_LOOKBACK_DAYS ??
      180
  )

  try {
    const result = await refreshSecondOrderStats({ lookbackDays })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json({
      mode: "refresh",
      skipped: result.skipped || false,
      asOfDate: result.result?.asOfDate,
      lookbackDays: result.result?.lookbackDays,
      firstOrderCustomers: result.result?.all.firstOrderCustomers,
      repeaters: result.result?.all.repeaters,
      medianDaysToSecond: result.result?.all.medianDaysToSecond,
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
