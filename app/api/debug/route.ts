import { NextRequest, NextResponse } from "next/server"
import { getBasicAuthHeader, authHeaders } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const auth = getBasicAuthHeader(req.headers.get("authorization"))
  if (!auth?.valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: authHeaders() })
  }

  const { searchParams } = new URL(req.url)
  const dateStart = searchParams.get("start") || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0]
  const dateEnd = searchParams.get("end") || new Date().toISOString().split("T")[0]

  const results: Record<string, any> = { dateStart, dateEnd }

  // --- Triple Whale ---
  try {
    const { fetchTWData } = await import("@/lib/triplewhale")
    const twRaw = await fetchTWData(dateStart, dateEnd)
    results.tripleWhale = {
      raw: twRaw,
      metricsTable: Array.isArray(twRaw?.metrics)
        ? twRaw.metrics.map((m: any) => ({
            title: m.title,
            id: m.id,
            metricId: m.metricId,
            value: m.values?.current,
          }))
        : null,
    }
  } catch (e: any) {
    results.tripleWhale = { error: e.message }
  }

  // --- Shopify Orders Sample ---
  try {
    const { getShopifyAccessToken, getShopifyStoreDomain } = await import("@/lib/shopify")
    const token = await getShopifyAccessToken()
    const domain = getShopifyStoreDomain()
    const url = `https://${domain}/admin/api/2025-01/orders.json?status=any&limit=5&created_at_min=${dateStart}T00:00:00&created_at_max=${dateEnd}T23:59:59`
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    })
    // On 401 with client credentials, invalidate + retry once via shared helper
    let finalRes = res
    if (res.status === 401 && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) {
      const retryToken = await getShopifyAccessToken({ forceRefresh: true })
      finalRes = await fetch(url, {
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": retryToken },
      })
    }
    const json = await finalRes.json()
    results.shopify = {
      status: finalRes.status,
      orderCount: json.orders?.length,
      sampleOrders: (json.orders || []).slice(0, 3).map((o: any) => ({
        id: o.id,
        name: o.name,
        financial_status: o.financial_status,
        created_at: o.created_at,
        total_price: o.total_price,
        subtotal_price: o.subtotal_price,
        refund_total: o.refund_total,
        line_items: o.line_items?.map((li: any) => ({
          sku: li.sku,
          variant_id: li.variant_id,
          quantity: li.quantity,
          price: li.price,
        })),
      })),
    }
  } catch (e: any) {
    results.shopify = { error: e.message }
  }

  // --- Env var presence check (never expose values) ---
  results.envCheck = {
    SHOPIFY_STORE_DOMAIN: !!process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_STORE_URL: !!process.env.SHOPIFY_STORE_URL,
    SHOPIFY_CLIENT_ID: !!process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: !!process.env.SHOPIFY_CLIENT_SECRET,
    SHOPIFY_ACCESS_TOKEN: !!(process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_PASSWORD),
    TRIPLEWHALE_API_KEY: !!process.env.TRIPLEWHALE_API_KEY,
  }

  return NextResponse.json(results, { status: 200 })
}
