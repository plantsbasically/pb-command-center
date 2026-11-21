import { NextRequest, NextResponse } from "next/server"
import { getLoopMetricsStatus, verifyLoopIngestSecret } from "@/lib/loop-metrics"

/**
 * GET /api/loop-metrics/status
 * Auth: Authorization: Bearer ${LOOP_INGEST_SECRET}
 * Returns latest dates + missing daily dates in the last 90 days (backfill helper).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.LOOP_INGEST_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: "LOOP_INGEST_SECRET is not configured" },
      { status: 503 }
    )
  }
  if (!verifyLoopIngestSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const status = await getLoopMetricsStatus()
    return NextResponse.json({ ok: true, ...status })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Status failed" },
      { status: 500 }
    )
  }
}
