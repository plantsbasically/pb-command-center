/**
 * Subscriber count via Shopify Admin GraphQL — no Loop API needed.
 *
 * Loop tags every active subscriber in Shopify with the "active_subscriber" customer tag.
 * Shopify's customersCount GraphQL query lets us count them in a single call.
 *
 * Subscription revenue is tracked separately in lib/shopify.ts by detecting
 * Loop renewal orders in the existing order fetch.
 *
 * Never throws — returns zeros on any failure.
 */

const STORE_URL = process.env.SHOPIFY_STORE_URL || ""
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_PASSWORD || ""

export interface LoopData {
  activeSubscribers: number
  subscriberMRR: number  // always 0 — subscription revenue is derived from Shopify orders instead
}

export async function fetchLoopData(): Promise<LoopData> {
  if (!STORE_URL || !ACCESS_TOKEN) {
    console.warn("Shopify credentials missing — skipping subscriber count")
    return { activeSubscribers: 0, subscriberMRR: 0 }
  }

  const endpoint = `https://${STORE_URL.replace(/\/+$/, "")}/admin/api/2025-01/graphql.json`

  const query = `{
    customersCount(query: "tag:'active_subscriber'") {
      count
      precision
    }
  }`

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ACCESS_TOKEN,
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`Shopify customersCount ${res.status}: ${body}`)
      return { activeSubscribers: 0, subscriberMRR: 0 }
    }

    const json: any = await res.json()

    if (json.errors?.length) {
      console.error("Shopify GQL customersCount errors:", JSON.stringify(json.errors))
      return { activeSubscribers: 0, subscriberMRR: 0 }
    }

    const count = json.data?.customersCount?.count ?? 0
    return { activeSubscribers: count, subscriberMRR: 0 }
  } catch (err: any) {
    console.error("fetchLoopData failed:", err?.message)
    return { activeSubscribers: 0, subscriberMRR: 0 }
  }
}
