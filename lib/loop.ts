export interface LoopData {
  activeSubscribers: number
  subscriberMRR: number  // sum of totalLineItemDiscountedPrice across all ACTIVE subs
}

/**
 * Fetch all active Loop subscriptions and compute a point-in-time MRR snapshot.
 * Paginates automatically; never throws — returns zeros on any failure so the
 * main dashboard still loads if Loop is unavailable.
 */
export async function fetchLoopData(): Promise<LoopData> {
  const apiKey = process.env.LOOP_API_KEY
  if (!apiKey) {
    console.warn("LOOP_API_KEY not set — returning empty Loop data")
    return { activeSubscribers: 0, subscriberMRR: 0 }
  }

  const baseUrl = "https://api.loopsubscriptions.com/storefront/2023-10/subscription"
  const allSubs: any[] = []
  let cursor: string | null = null
  let page = 1
  const MAX_PAGES = 20  // guard against runaway loops (~5 000 subs max)

  try {
    while (page <= MAX_PAGES) {
      const params = new URLSearchParams({ status: "ACTIVE", limit: "250" })
      if (cursor) params.set("cursor", cursor)

      const res = await fetch(`${baseUrl}?${params}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        // Always fetch fresh — Loop data is a live snapshot, not date-range data
        cache: "no-store",
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        console.error(`Loop API error ${res.status}: ${body}`)
        break
      }

      const json = await res.json()
      const batch: any[] = json.data ?? []
      allSubs.push(...batch)

      // Attempt to find a next-page cursor in common patterns
      cursor =
        json.pageInfo?.endCursor ??
        json.pagination?.nextCursor ??
        json.meta?.nextCursor ??
        null

      // Stop if no cursor or batch was smaller than the page size
      if (!cursor || batch.length < 250) break
      page++
    }
  } catch (err: any) {
    console.error("Loop fetch failed:", err?.message)
  }

  const subscriberMRR = allSubs.reduce(
    (sum, sub) => sum + (parseFloat(sub.totalLineItemDiscountedPrice) || 0),
    0
  )

  return {
    activeSubscribers: allSubs.length,
    subscriberMRR,
  }
}
