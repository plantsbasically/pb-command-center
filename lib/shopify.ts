const STORE_URL = process.env.SHOPIFY_STORE_URL || ""
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_PASSWORD || ""
const BASE = STORE_URL.replace(/\/+$/, "")
const SHOPIFY_API_BASE = `https://${BASE}/admin/api/2025-01`

async function shopifyFetch(endpoint: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString()
  const url = `${SHOPIFY_API_BASE}/${endpoint}${qs ? "?" + qs : ""}`
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ACCESS_TOKEN,
    },
  })
  if (!res.ok) {
    throw new Error(`Shopify API ${res.status}: ${await res.text()}`)
  }
  return res
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

interface ShopifyOrderLineItem {
  id: string
  product_id: string
  variant_id: string
  title: string
  variant_title: string
  quantity: number
  price: string
  total_discount: string
  sku: string
}

interface ShopifyCustomer {
  id: string
  email: string
  orders_count: number
  state: string
  created_at: string
  first_name: string
  last_name: string
}

interface ShopifyOrder {
  id: string
  name: string
  financial_status: string
  total_price: string
  subtotal_price: string
  total_discounts: string
  order_number: number
  created_at: string
  processed_at: string
  line_items: ShopifyOrderLineItem[]
  customer: ShopifyCustomer | null
  tags: string
}

interface OrdersResponse {
  orders: ShopifyOrder[]
}


export async function fetchOrders(dateStart: string, dateEnd: string): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = []

  // First page
  const firstRes = await shopifyFetch("orders.json", {
    status: "any",
    limit: "250",
    created_at_min: `${dateStart}T00:00:00`,
    created_at_max: `${dateEnd}T23:59:59`,
  })
  const firstData: OrdersResponse = await firstRes.json()
  allOrders.push(...firstData.orders)

  // Cursor pagination via Link header — reliable for large stores
  let nextUrl = parseNextLink(firstRes.headers.get("link"))

  while (nextUrl && allOrders.length < 25000) {
    const res = await fetch(nextUrl, {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ACCESS_TOKEN,
      },
    })
    if (!res.ok) throw new Error(`Shopify pagination ${res.status}: ${await res.text()}`)
    const data: OrdersResponse = await res.json()
    if (!data.orders.length) break
    allOrders.push(...data.orders)
    nextUrl = parseNextLink(res.headers.get("link"))
  }

  return allOrders
}


export interface ProcessedShopifyData {
  revenue: number
  ordersCount: number
  aov: number
  totalCOGS: number
  newCustomers: number
  totalCustomers: number
  variantUnitsSold: Record<string, number>
}

export async function processShopifyData(
  dateStart: string,
  dateEnd: string
): Promise<ProcessedShopifyData> {
  const orders = await fetchOrders(dateStart, dateEnd)

  let revenue = 0
  let ordersCount = 0
  const variantUnitsSold: Record<string, number> = {}

  // Exclude only voided/fully-refunded orders; count paid, authorized, partially_refunded, etc.
  const EXCLUDED_STATUSES = new Set(["voided", "refunded"])

  for (const order of orders) {
    if (EXCLUDED_STATUSES.has(order.financial_status)) continue
    revenue += parseFloat(order.subtotal_price) || 0
    ordersCount++

    for (const item of order.line_items) {
      const variantKey = item.sku || item.variant_id
      if (variantKey) {
        variantUnitsSold[variantKey] = (variantUnitsSold[variantKey] || 0) + item.quantity
      }
    }
  }

  const aov = ordersCount > 0 ? revenue / ordersCount : 0

  let newCustomerCount = 0
  const uniqueCustomerIds = new Set<string>()

  for (const order of orders) {
    if (EXCLUDED_STATUSES.has(order.financial_status)) continue
    if (!order.customer) continue

    const customerId = order.customer.id
    if (uniqueCustomerIds.has(customerId)) continue
    uniqueCustomerIds.add(customerId)
    if (order.customer.orders_count === 1) {
      newCustomerCount++
    }
  }

  return {
    revenue,
    ordersCount,
    aov,
    totalCOGS: 0,
    newCustomers: newCustomerCount,
    totalCustomers: uniqueCustomerIds.size,
    variantUnitsSold,
  }
}
