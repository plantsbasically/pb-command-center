const STORE_URL = process.env.SHOPIFY_STORE_URL || ""
const API_KEY = process.env.SHOPIFY_API_KEY || ""
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_PASSWORD || ""

const BASE = STORE_URL.replace(/\/+$/, "")

async function shopifyRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const url = `https://${BASE}/admin/api/2025-01/${endpoint}${qs ? "?" + qs : ""}`
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ACCESS_TOKEN,
    },
  })
  if (!res.ok) {
    throw new Error(`Shopify API ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
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
  refund_total: string
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

interface CustomersResponse {
  customers: ShopifyCustomer[]
}

export async function fetchOrders(dateStart: string, dateEnd: string): Promise<ShopifyOrder[]> {
  // Fetch up to 10 pages of 250 orders = 2500 orders max per date range
  const allOrders: ShopifyOrder[] = []
  let sinceId: string | null = null
  const sinceIdParam = "since_id"

  for (let page = 0; page < 100; page++) {
    const params: Record<string, string> = {
      status: "any",
      limit: "250",
      created_at_min: dateStart,
      created_at_max: dateEnd,
    }
    if (sinceId) {
      params[sinceIdParam] = sinceId
    }

    const data = await shopifyRequest<OrdersResponse>("orders.json", params)
    if (!data.orders.length) break
    allOrders.push(...data.orders)

    const lastOrder = data.orders[data.orders.length - 1]
    sinceId = lastOrder.id
    if (data.orders.length < 250) break
  }

  return allOrders
}

export async function fetchCustomers(): Promise<ShopifyCustomer[]> {
  const allCustomers: ShopifyCustomer[] = []
  let sinceId: string | null = null

  for (let page = 0; page < 40; page++) {
    const params: Record<string, string> = {
      limit: "250",
    }
    if (sinceId) {
      params["since_id"] = sinceId
    }

    const data = await shopifyRequest<CustomersResponse>("customers.json", params)
    if (!data.customers.length) break
    allCustomers.push(...data.customers)

    const lastCustomer = data.customers[data.customers.length - 1]
    sinceId = lastCustomer.id
    if (data.customers.length < 250) break
  }

  return allCustomers
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
  dateEnd: string,
  customers: ShopifyCustomer[]
): Promise<ProcessedShopifyData> {
  const orders = await fetchOrders(dateStart, dateEnd)

  let revenue = 0
  let ordersCount = 0
  const variantUnitsSold: Record<string, number> = {}

  for (const order of orders) {
    if (!["paid", "partially_refunded"].includes(order.financial_status)) continue
    const price = parseFloat(order.total_price)
    const refundTotal = order.refund_total ? parseFloat(order.refund_total) : 0
    revenue += price - refundTotal
    ordersCount++

    for (const item of order.line_items) {
      const variantKey = item.sku || item.variant_id
      if (variantKey) {
        variantUnitsSold[variantKey] = (variantUnitsSold[variantKey] || 0) + item.quantity
      }
    }
  }

  const aov = ordersCount > 0 ? revenue / ordersCount : 0

  // Customer analysis
  const customerMap = new Map<string, ShopifyCustomer>()
  for (const c of customers) {
    customerMap.set(c.id, c)
  }

  let newCustomerCount = 0
  const uniqueCustomerIds = new Set<string>()

  for (const order of orders) {
    if (!["paid", "partially_refunded"].includes(order.financial_status)) continue
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
    totalCOGS: 0, // Will be computed with COGS data
    newCustomers: newCustomerCount,
    totalCustomers: uniqueCustomerIds.size,
    variantUnitsSold,
  }
}
