import { NextRequest, NextResponse } from "next/server"
import { getBasicAuthHeader, authHeaders } from "@/lib/auth"
import { getLoopMetricsRange } from "@/lib/loop-metrics"

/**
 * GET /api/loop-metrics?start&end
 * Behind existing basic auth (middleware + handler).
 * Returns daily rows for the range, latest cohort snapshot, latest LTV snapshot.
 */
export async function GET(req: NextRequest) {
  const auth = getBasicAuthHeader(req.headers.get("authorization"))
  if (!auth?.valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: authHeaders() })
  }

  try {
    const { searchParams } = new URL(req.url)
    const start = searchParams.get("start") || new Date().toISOString().split("T")[0]
    const end = searchParams.get("end") || start
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return NextResponse.json({ error: "start/end must be YYYY-MM-DD" }, { status: 400 })
    }
    const data = await getLoopMetricsRange(start, end)
    return NextResponse.json({ ok: true, start, end, ...data })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load loop metrics" },
      { status: 500 }
    )
  }
}
