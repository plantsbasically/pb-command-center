/**
 * Active subscriber count via Loop Admin API.
 *
 * Loop's /subscription/?status=ACTIVE endpoint is paginated (max 100/page, uses
 * pageNo + pageSize params). Because counting ~4,700 subscribers requires ~48 requests
 * at 3 req/sec, we cache the result for 1 hour in a module-level variable that persists
 * across requests on Railway's long-running server. Cold start takes ~20-25s; subsequent
 * calls within the hour are instant.
 *
 * Base URL: https://api.loopsubscriptions.com/admin/2023-10/
 * Auth: X-Loop-Token header
 * Env var: LOOP_API_KEY
 *
 * Subscription revenue is tracked separately in lib/shopify.ts by detecting
 * Loop renewal orders in the existing order fetch.
 *
 * Never throws — returns zeros on any failure.
 */

const LOOP_API_KEY = process.env.LOOP_API_KEY || ""
const LOOP_BASE = "https://api.loopsubscriptions.com/admin/2023-10"
const LOOP_CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour — subscriber count is slow to fetch

// Module-level cache persists across requests on Railway's long-running server
let loopCache: { count: number; ts: number } | null = null

export interface LoopData {
  activeSubscribers: number
  subscriberMRR: number  // always 0 — subscription revenue is derived from Shopify orders instead
}

export async function fetchLoopData(): Promise<LoopData> {
  if (!LOOP_API_KEY) {
    console.warn("LOOP_API_KEY missing — skipping active subscriber count")
    return { activeSubscribers: 0, subscriberMRR: 0 }
  }

  // Serve from cache if fresh
  if (loopCache && Date.now() - loopCache.ts < LOOP_CACHE_TTL_MS) {
    return { activeSubscribers: loopCache.count, subscriberMRR: 0 }
  }

  try {
    const count = await paginateActiveSubscribers()
    loopCache = { count, ts: Date.now() }
    return { activeSubscribers: count, subscriberMRR: 0 }
  } catch (err: any) {
    console.error("fetchLoopData failed:", err?.message)
    // Return stale cache if available rather than zeros
    if (loopCache) return { activeSubscribers: loopCache.count, subscriberMRR: 0 }
    return { activeSubscribers: 0, subscriberMRR: 0 }
  }
}

/**
 * Paginate through all active subscriptions using Loop's pageNo + pageSize params.
 * Loops up to 200 pages (20,000 subscribers) as a safety cap.
 * Rate limit is 3 req/sec — we add a 350ms sleep between pages to stay safe.
 */
async function paginateActiveSubscribers(): Promise<number> {
  let total = 0
  let pageNo = 1
  const pageSize = 100

  while (pageNo <= 200) {
    const res = await fetch(
      `${LOOP_BASE}/subscription/?status=ACTIVE&pageSize=${pageSize}&pageNo=${pageNo}`,
      {
        headers: {
          "X-Loop-Token": LOOP_API_KEY,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    )

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`Loop API page ${pageNo} failed: ${res.status} ${body}`)
      break
    }

    const json: any = await res.json()
    const items: any[] = json.data ?? []
    total += items.length

    // Stop when we're on the last page
    if (!json.pageInfo?.hasNextPage || items.length < pageSize) break

    pageNo++
    // Respect rate limit: 3 req/sec → 350ms between pages
    await new Promise((r) => setTimeout(r, 350))
  }

  return total
}
