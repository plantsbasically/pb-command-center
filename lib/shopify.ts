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

export interface ShopifyVariantSummary {
  variantKey: string        // SKU (preferred) or Shopify variant ID — matches order line items
  variantName: string       // "Product Title" or "Product Title - Variant Title"
  shopifyVariantId: string
  shopifyProductId: string  // Shopify product ID — required for TW COGS enrichment API
}

export async function fetchProducts(): Promise<ShopifyVariantSummary[]> {
  const results: ShopifyVariantSummary[] = []

  const firstRes = await shopifyFetch("products.json", {
    status: "active",
    limit: "250",
    fields: "id,title,variants",
  })
  const firstData: any = await firstRes.json()

  function extractVariants(products: any[]) {
    for (const product of products) {
      for (const variant of product.variants || []) {
        const variantKey = variant.sku?.trim() || String(variant.id)
        const variantTitle = variant.title === "Default Title" ? "" : variant.title
        const variantName = variantTitle ? `${product.title} - ${variantTitle}` : product.title
        results.push({
          variantKey,
          variantName,
          shopifyVariantId: String(variant.id),
          shopifyProductId: String(product.id),
        })
      }
    }
  }

  extractVariants(firstData.products || [])

  let nextUrl = parseNextLink(firstRes.headers.get("link"))
  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": ACCESS_TOKEN },
    })
    if (!res.ok) break
    const data: any = await res.json()
    if (!data.products?.length) break
    extractVariants(data.products)
    nextUrl = parseNextLink(res.headers.get("link"))
  }

  return results
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

interface ShopifyRefundLineItem {
  subtotal: string  // refunded item amount after discounts, before tax
}

interface ShopifyRefund {
  refund_line_items: ShopifyRefundLineItem[]
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
  refunds: ShopifyRefund[]   // product refund amounts — subtract from subtotal_price
  customer: ShopifyCustomer | null
  tags: string
  total_shipping_price_set: { shop_money: { amount: string } } | null
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
  shippingCollected: number
  _debug: {
    totalOrdersFetched: number
    excludedOrders: number        // voided + refunded skipped entirely
    grossSubtotalSum: number      // sum of subtotal_price before refund deduction
    refundLineItemsDeducted: number  // sum of refund_line_items[].subtotal subtracted
    netRevenue: number            // should match revenue
  }
}

export async function processShopifyData(
  dateStart: string,
  dateEnd: string
): Promise<ProcessedShopifyData> {
  const orders = await fetchOrders(dateStart, dateEnd)

  let revenue = 0
  let ordersCount = 0
  let excludedOrders = 0
  let grossSubtotalSum = 0
  let refundLineItemsDeducted = 0
  let shippingCollected = 0
  const variantUnitsSold: Record<string, number> = {}

  // Exclude voided and fully-refunded orders entirely
  const EXCLUDED_STATUSES = new Set(["voided", "refunded"])

  for (const order of orders) {
    if (EXCLUDED_STATUSES.has(order.financial_status)) { excludedOrders++; continue }

    const subtotal = parseFloat(order.subtotal_price) || 0
    grossSubtotalSum += subtotal

    // Subtract every refunded line item amount to get true net product revenue
    let refundTotal = 0
    for (const refund of order.refunds || []) {
      for (const rli of refund.refund_line_items || []) {
        refundTotal += parseFloat(String(rli.subtotal)) || 0
      }
    }
    refundLineItemsDeducted += refundTotal

    const orderRevenue = subtotal - refundTotal
    revenue += orderRevenue
    shippingCollected += parseFloat(order.total_shipping_price_set?.shop_money?.amount || "0") || 0
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
  const rangeStart = new Date(`${dateStart}T00:00:00`)
  const rangeEnd = new Date(`${dateEnd}T23:59:59`)

  for (const order of orders) {
    if (EXCLUDED_STATUSES.has(order.financial_status)) continue
    if (!order.customer) continue

    const customerId = order.customer.id
    if (uniqueCustomerIds.has(customerId)) continue
    uniqueCustomerIds.add(customerId)

    // Use customer.created_at: Shopify creates the customer record on their first-ever order,
    // so this accurately identifies newly acquired customers within the date range.
    // orders_count reflects the *current* total, not the count at order time, so it's
    // always > 1 for repeat buyers and misses almost everyone on a subscription store.
    const customerCreatedAt = new Date(order.customer.created_at)
    if (customerCreatedAt >= rangeStart && customerCreatedAt <= rangeEnd) {
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
    shippingCollected,
    _debug: {
      totalOrdersFetched: orders.length,
      excludedOrders,
      grossSubtotalSum,
      refundLineItemsDeducted,
      netRevenue: revenue,
    },
  }
}
