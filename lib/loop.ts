/**
 * Subscription data via Shopify Admin GraphQL `subscriptionContracts`.
 * Loop (and all Shopify subscription apps) use Shopify's native subscription
 * contracts API under the hood, so we can query Shopify directly — no separate
 * Loop API key required.
 *
 * Required Shopify scope: read_own_subscription_contracts (Loop sets this up
 * automatically on install).
 *
 * Never throws — returns zeros if the API is unavailable so the main dashboard
 * still loads.
 */

const STORE_URL = process.env.SHOPIFY_STORE_URL || ""
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || process.env.SHOPIFY_PASSWORD || ""

export interface LoopData {
  activeSubscribers: number
  subscriberMRR: number  // sum of (currentPrice × qty) for all ACTIVE contracts
}

const GQL_ENDPOINT = `https://${STORE_URL.replace(/\/+$/, "")}/admin/api/2025-01/graphql.json`

function buildQuery(cursor: string | null): string {
  const afterArg = cursor ? `, after: "${cursor}"` : ""
  return `{
    subscriptionContracts(first: 250${afterArg}) {
      edges {
        node {
          status
          lines(first: 20) {
            edges {
              node {
                quantity
                currentPrice {
                  amount
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`
}

export async function fetchLoopData(): Promise<LoopData> {
  if (!STORE_URL || !ACCESS_TOKEN) {
    console.warn("Shopify credentials missing — skipping subscription data")
    return { activeSubscribers: 0, subscriberMRR: 0 }
  }

  let activeCount = 0
  let totalMRR = 0
  let cursor: string | null = null
  let hasNext = true
  let pages = 0
  const MAX_PAGES = 20 // 250 × 20 = 5 000 contracts max

  try {
    while (hasNext && pages < MAX_PAGES) {
      const res: Response = await fetch(GQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": ACCESS_TOKEN,
        },
        body: JSON.stringify({ query: buildQuery(cursor) }),
        cache: "no-store",
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        console.error(`Shopify subscriptionContracts ${res.status}: ${body}`)
        break
      }

      const json: any = await res.json()

      if (json.errors?.length) {
        console.error("Shopify GQL errors:", JSON.stringify(json.errors))
        break
      }

      const contracts: any = json.data?.subscriptionContracts
      if (!contracts) break

      for (const { node } of contracts.edges) {
        if (node.status !== "ACTIVE") continue
        activeCount++
        for (const { node: line } of node.lines.edges) {
          const price = parseFloat(line.currentPrice?.amount ?? "0")
          const qty = line.quantity ?? 1
          totalMRR += price * qty
        }
      }

      hasNext = contracts.pageInfo.hasNextPage
      cursor = contracts.pageInfo.endCursor
      pages++
    }
  } catch (err: any) {
    console.error("fetchLoopData failed:", err?.message)
  }

  return { activeSubscribers: activeCount, subscriberMRR: totalMRR }
}
