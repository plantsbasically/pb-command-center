import { NextRequest, NextResponse } from "next/server"
import {
  parseIngestPayload,
  upsertLoopMetrics,
  verifyLoopIngestSecret,
} from "@/lib/loop-metrics"

export const maxDuration = 60

/**
 * POST /api/loop-metrics/ingest
 * Auth: Authorization: Bearer ${LOOP_INGEST_SECRET}
 * Exempt from basic-auth middleware; rejects if secret unset or wrong.
 */
export async function POST(req: NextRequest) {
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const parsed = parseIngestPayload(body)
    const upserted = await upsertLoopMetrics(parsed)
    return NextResponse.json({ ok: true, upserted })
  } catch (err: any) {
    const msg = err?.message || "Ingest failed"
    const status = /expected|must be|required|Invalid/i.test(msg) ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
