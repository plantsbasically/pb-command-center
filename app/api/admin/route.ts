import { NextRequest, NextResponse } from "next/server"
import { getBasicAuthHeader, authHeaders } from "@/lib/auth"
import { getCogsVariants, saveCogsVariants, getFixedCosts, saveFixedCosts } from "@/lib/db"

function checkAuth(req: NextRequest) {
  const auth = getBasicAuthHeader(req.headers.get("authorization"))
  if (!auth?.valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: authHeaders() })
  }
  return null
}

// GET — fetch all active Shopify product variants for COGS sync
export async function GET(req: NextRequest) {
  const authError = checkAuth(req)
  if (authError) return authError

  try {
    const { fetchProducts } = await import("@/lib/shopify")
    const products = await fetchProducts()
    return NextResponse.json({ ok: true, products })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
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
      await saveCogsVariants(variants)
      const updated = await getCogsVariants()
      return NextResponse.json({ ok: true, data: { variants: updated } })
    }

    if (action === "updateFixedCosts") {
      await saveFixedCosts(data.lineItems)
      const updated = await getFixedCosts()
      return NextResponse.json({ ok: true, data: updated })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
