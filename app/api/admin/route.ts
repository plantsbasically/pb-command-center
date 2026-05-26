import { NextRequest, NextResponse } from "next/server"
import { getBasicAuthHeader, authHeaders } from "@/lib/auth"
import { readJSON, writeJSON } from "@/lib/filestore"
import { computeCOGSTotal } from "@/lib/calculations"

function checkAuth(req: NextRequest) {
  const auth = getBasicAuthHeader(req.headers.get("authorization"))
  if (!auth?.valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: authHeaders() })
  }
  return null
}

export async function PUT(req: NextRequest) {
  const authError = checkAuth(req)
  if (authError) return authError

  try {
    const body = await req.json()
    const { action, data } = body

    if (action === "updateCOGS") {
      const variants = data.variants.map((v: any) => ({
        ...v,
        totalCost: v.totalCost ?? v.lineItems.reduce((s: number, i: any) => s + i.cost * i.quantity, 0),
      }))
      writeJSON("cogs.json", { variants })
      const updated = readJSON("cogs.json")
      return NextResponse.json({ ok: true, data: updated })
    }

    if (action === "updateFixedCosts") {
      writeJSON("fixedcosts.json", { lineItems: data.lineItems })
      return NextResponse.json({ ok: true, data: data.lineItems })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
