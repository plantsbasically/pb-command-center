/**
 * Active subscriber count + subscriber MRR via Loop Admin API.
 *
 * Loop's /subscription/?status=ACTIVE endpoint is paginated (max 100/page, uses
 * pageNo + pageSize params). ~11.6k active subscriptions ≈ 117 pages.
 * Rate limit respected: 2 requests / 3 seconds (1500ms between pages).
 * Results cached 1 hour on Railway's long-running server. Auth failures (401)
 * use a short ~5 min cache so a fixed token takes effect without waiting an hour.
 *
 * Base URL: https://api.loopsubscriptions.com/admin/2023-10/
 * Auth: X-Loop-Token header
 * Env var: LOOP_API_KEY
 *
 * MRR method (see docs/DATA_SOURCES.md):
 *   Sum totalLineItemDiscountedPrice for each ACTIVE subscription, normalized
 *   to monthly via billingPolicy.interval + intervalCount. deliveryPrice is
 *   excluded (not part of the line total). Missing interval → assume MONTH/1.
 *   Prepaid (isPrepaid): still normalized by billingPolicy; prepaid weirdness
 *   (full commitment in totalLineItemDiscountedPrice vs Loop's line-level MRR
 *   that excludes isOneTimeAdded) is a known variance vs Loop's ~$588K reference.
 *
 * Never throws — returns zeros on any failure.
 */

const LOOP_API_KEY = process.env.LOOP_API_KEY || ""
const LOOP_BASE = "https://api.loopsubscriptions.com/admin/2023-10"
const LOOP_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour on success
const LOOP_AUTH_FAIL_TTL_MS = 5 * 60 * 1000 // ~5 min so token fixes apply sooner
/** Loop rate limit: 2 requests per 3 seconds → 1500ms gap between pages. */
const LOOP_PAGE_GAP_MS = 1500
const LOOP_PAGE_SIZE = 100

export interface LoopData {
  activeSubscribers: number
  subscriberMRR: number
}

type LoopCacheEntry = { data: LoopData; ts: number; ttl: number }

// Module-level cache persists across requests on Railway's long-running server
let loopCache: LoopCacheEntry | null = null

export type BillingInterval = "DAY" | "WEEK" | "MONTH" | "YEAR"

/**
 * Normalize a subscription charge to monthly recurring revenue.
 * Matches Loop Analytics FAQ:
 *   MONTH: price / intervalCount
 *   YEAR:  price / (12 * intervalCount)
 *   WEEK:  price * (30/7) / intervalCount
 *   DAY:   price * 30 / intervalCount
 */
export function normalizeSubscriptionMRR(
  totalLineItemDiscountedPrice: number,
  interval: string | null | undefined,
  intervalCount: number | null | undefined
): number {
  const price = Number(totalLineItemDiscountedPrice)
  if (!Number.isFinite(price) || price <= 0) return 0
  const count = Number(intervalCount)
  const n = Number.isFinite(count) && count > 0 ? count : 1
  const unit = String(interval || "MONTH").toUpperCase()

  switch (unit) {
    case "DAY":
      return (price * 30) / n
    case "WEEK":
      return (price * (30 / 7)) / n
    case "YEAR":
      return price / (12 * n)
    case "MONTH":
    default:
      return price / n
  }
}

/** Extract MRR contribution from one Loop subscription object (2023-10 shape). */
export function subscriptionMRRContribution(sub: {
  totalLineItemDiscountedPrice?: number | string | null
  deliveryPrice?: number | string | null
  isPrepaid?: boolean
  billingPolicy?: {
    interval?: string | null
    intervalCount?: number | null
    prepaidIntervalCount?: number | null
  } | null
}): number {
  // deliveryPrice is intentionally ignored — Loop Active MRR excludes shipping.
  const price = Number(sub.totalLineItemDiscountedPrice)
  if (!Number.isFinite(price)) return 0
  const policy = sub.billingPolicy
  return normalizeSubscriptionMRR(price, policy?.interval, policy?.intervalCount)
}

export async function fetchLoopData(): Promise<LoopData> {
  if (!LOOP_API_KEY) {
    console.warn("LOOP_API_KEY missing — skipping active subscriber count / MRR")
    return { activeSubscribers: 0, subscriberMRR: 0 }
  }

  if (loopCache && Date.now() - loopCache.ts < loopCache.ttl) {
    return loopCache.data
  }

  try {
    const result = await paginateActiveSubscriptions()
    loopCache = { data: result, ts: Date.now(), ttl: LOOP_CACHE_TTL_MS }
    return result
  } catch (err: any) {
    console.error("fetchLoopData failed:", err?.message)
    const isAuth = /401|unauthorized|forbidden|403/i.test(String(err?.message || ""))
    const zeros: LoopData = { activeSubscribers: 0, subscriberMRR: 0 }
    // Don't cache auth zeros for a full hour — shorten so token fixes take effect.
    if (isAuth) {
      loopCache = { data: zeros, ts: Date.now(), ttl: LOOP_AUTH_FAIL_TTL_MS }
      return zeros
    }
    if (loopCache) return loopCache.data
    loopCache = { data: zeros, ts: Date.now(), ttl: LOOP_AUTH_FAIL_TTL_MS }
    return zeros
  }
}

/**
 * Paginate ACTIVE subscriptions; count + sum normalized MRR.
 * Caps at 200 pages (20,000) as a safety limit.
 */
async function paginateActiveSubscriptions(): Promise<LoopData> {
  let total = 0
  let mrr = 0
  let pageNo = 1

  while (pageNo <= 200) {
    const res = await fetch(
      `${LOOP_BASE}/subscription/?status=ACTIVE&pageSize=${LOOP_PAGE_SIZE}&pageNo=${pageNo}`,
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
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Loop API ${res.status} unauthorized`)
      }
      break
    }

    const json: any = await res.json()
    const items: any[] = json.data ?? []
    total += items.length
    for (const sub of items) {
      mrr += subscriptionMRRContribution(sub)
    }

    if (!json.pageInfo?.hasNextPage || items.length < LOOP_PAGE_SIZE) break

    pageNo++
    await new Promise((r) => setTimeout(r, LOOP_PAGE_GAP_MS))
  }

  return {
    activeSubscribers: total,
    subscriberMRR: Math.round(mrr * 100) / 100,
  }
}

/** Test helper — clear module cache between cases. */
export function _resetLoopCacheForTests() {
  loopCache = null
}
