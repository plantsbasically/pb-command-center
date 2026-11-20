/**
 * Information-only discount breakdown from Shopify order discount fields.
 *
 * STRICT: These stats are NEVER fed into revenue, COGS, contribution margin,
 * or net profit. Display / analytics only.
 *
 * Classification (via line_items[].discount_allocations → discount_applications):
 *  - free_gifts: allocations on gift line items (100% off / mapped gift SKUs / _bundle_parent)
 *  - subscription: remaining allocations whose application is a selling-plan /
 *    automatic subscription / Loop-style discount
 *  - promotional: discount_code (and other non-gift, non-subscription) allocations —
 *    real markdowns only; gift retail is excluded so promo is not inflated
 */

export type DiscountCategory = "promotional" | "subscription" | "free_gifts" | "other"

export interface DiscountCodeStat {
  code: string
  amount: number
  orderCount: number
}

export interface DiscountStats {
  /** Sum of order.total_discounts for included orders (Shopify-reported). */
  totalDiscounts: number
  /** Allocated breakdown — sums should approximate totalDiscounts without double-counting. */
  byCategory: {
    promotional: number
    subscription: number
    freeGifts: number
    other: number
  }
  /** Top discount codes by $ (promotional codes only; gift allocations excluded). */
  topCodes: DiscountCodeStat[]
  ordersWithDiscounts: number
  /** True when category allocations reconciling against totalDiscounts look sane. */
  allocationSum: number
}

export interface DiscountApplicationLike {
  type?: string | null
  title?: string | null
  code?: string | null
  description?: string | null
  value?: string | number | null
  value_type?: string | null
  target_type?: string | null
  allocation_method?: string | null
}

export interface DiscountAllocationLike {
  amount?: string | number | null
  discount_application_index?: number | null
}

export interface DiscountLineItemLike {
  sku?: string | null
  title?: string | null
  price?: string | number | null
  total_discount?: string | number | null
  quantity?: number | null
  properties?: { name: string; value: string }[] | null
  discount_allocations?: DiscountAllocationLike[] | null
}

export interface DiscountOrderLike {
  financial_status?: string | null
  total_discounts?: string | number | null
  discount_applications?: DiscountApplicationLike[] | null
  discount_codes?: { code?: string | null; amount?: string | number | null; type?: string | null }[] | null
  line_items?: DiscountLineItemLike[] | null
  tags?: string | null
  source_name?: string | null
}

const EXCLUDED = new Set(["voided", "refunded"])

function money(n: string | number | null | undefined): number {
  const v = typeof n === "number" ? n : parseFloat(String(n ?? "0"))
  return Number.isFinite(v) ? v : 0
}

/**
 * Heuristic: selling-plan / Loop / Subscribe & Save automatic discounts.
 *
 * Observed on Plants Basically (Nov 2026): Loop selling-plan markdowns land as
 * automatic discounts titled "SAVE 25%", "SAVE 30%", "SAVE 35%" — not the word
 * "subscription". Gift apps are titled "Free Welcome Gift".
 */
export function isSubscriptionDiscountApp(app: DiscountApplicationLike | null | undefined): boolean {
  if (!app) return false
  const type = String(app.type || "").toLowerCase()
  const title = `${app.title || ""} ${app.description || ""} ${app.code || ""}`.toLowerCase().trim()

  // PB Loop selling-plan titles: "SAVE 25%" / "SAVE 30%" / "SAVE 35%"
  if (/^save\s*\d+(\.\d+)?%?$/.test(title)) return true

  if (
    title.includes("subscription") ||
    title.includes("subscribe") ||
    title.includes("selling plan") ||
    title.includes("selling-plan") ||
    title.includes("bulk subscription") ||
    title.includes("loop") ||
    title.includes("recurring") ||
    title.includes("s&s") ||
    title.includes("subscribe & save") ||
    title.includes("subscribe and save")
  ) {
    return true
  }

  if (type.includes("subscription") || type.includes("selling_plan")) return true
  return false
}

/** Automatic 100% welcome/gift apps (e.g. title "Free Welcome Gift"). */
export function isFreeGiftDiscountApp(app: DiscountApplicationLike | null | undefined): boolean {
  if (!app) return false
  const title = `${app.title || ""} ${app.description || ""}`.toLowerCase()
  if (title.includes("free welcome gift") || title.includes("welcome gift")) return true
  if (title.includes("free gift") || (title.includes("gift") && title.includes("free"))) return true
  return false
}

export function isDiscountCodeApp(app: DiscountApplicationLike | null | undefined): boolean {
  if (!app) return false
  const type = String(app.type || "").toLowerCase()
  if (type === "discount_code") return true
  if (app.code && String(app.code).trim()) return true
  return false
}

/** Label for top-codes table: explicit code, or manual discount title. */
export function promoCodeLabel(app: DiscountApplicationLike | null | undefined): string {
  if (!app) return ""
  const explicit = String(app.code || "").trim()
  if (explicit) return explicit
  const type = String(app.type || "").toLowerCase()
  if (type === "discount_code" || type === "manual") {
    return String(app.title || app.description || "").trim()
  }
  return ""
}

export function classifyDiscountApplication(
  app: DiscountApplicationLike | null | undefined,
  opts: { onGiftLine: boolean }
): DiscountCategory {
  // Gift lines OR gift-titled apps → free gift retail (excluded from promotional).
  if (opts.onGiftLine || isFreeGiftDiscountApp(app)) return "free_gifts"
  if (isSubscriptionDiscountApp(app)) return "subscription"
  if (isDiscountCodeApp(app)) return "promotional"
  // Other automatic/script/manual markdowns on paid lines → promotional bucket
  // (BFCM codes, sitewide autos that aren't SAVE%/welcome gift).
  const type = String(app?.type || "").toLowerCase()
  if (type === "automatic" || type === "script" || type === "manual") return "promotional"
  return "other"
}

export function emptyDiscountStats(): DiscountStats {
  return {
    totalDiscounts: 0,
    byCategory: { promotional: 0, subscription: 0, freeGifts: 0, other: 0 },
    topCodes: [],
    ordersWithDiscounts: 0,
    allocationSum: 0,
  }
}

/**
 * Compute discountStats from already-fetched Shopify orders.
 * Pure / side-effect free — safe to call without touching P&L inputs.
 */
export function computeDiscountStats(
  orders: DiscountOrderLike[],
  isGiftLine: (item: DiscountLineItemLike) => boolean
): DiscountStats {
  let totalDiscounts = 0
  let promotional = 0
  let subscription = 0
  let freeGifts = 0
  let other = 0
  let allocationSum = 0
  let ordersWithDiscounts = 0

  const codeMap = new Map<string, { amount: number; orders: Set<string> }>()

  for (let oi = 0; oi < orders.length; oi++) {
    const order = orders[oi]
    if (EXCLUDED.has(String(order.financial_status || ""))) continue

    const orderTotal = money(order.total_discounts)
    if (orderTotal > 0) {
      totalDiscounts += orderTotal
      ordersWithDiscounts++
    }

    const apps = order.discount_applications || []
    const lines = order.line_items || []

    // Prefer allocation-based split to avoid double-counting gift vs promo on the same application.
    for (const line of lines) {
      const onGift = isGiftLine(line)
      const allocations = line.discount_allocations || []

      // Fallback when Shopify omits discount_allocations but line.total_discount is set
      // (common for fully-discounted gift children).
      if (allocations.length === 0) {
        const lineDisc = money(line.total_discount)
        if (lineDisc > 0 && onGift) {
          freeGifts += lineDisc
          allocationSum += lineDisc
        }
        continue
      }

      for (const alloc of allocations) {
        const amt = money(alloc.amount)
        if (amt <= 0) continue
        allocationSum += amt
        const idx = alloc.discount_application_index ?? -1
        const app = idx >= 0 ? apps[idx] : undefined
        const cat = classifyDiscountApplication(app, { onGiftLine: onGift })

        if (cat === "free_gifts") freeGifts += amt
        else if (cat === "subscription") subscription += amt
        else if (cat === "promotional") {
          promotional += amt
          const codeKey = promoCodeLabel(app)
          if (codeKey) {
            const entry = codeMap.get(codeKey) || { amount: 0, orders: new Set<string>() }
            entry.amount += amt
            entry.orders.add(String(oi))
            codeMap.set(codeKey, entry)
          }
        } else other += amt
      }
    }

    // Ensure discount_codes[] bump orderCount for known codes (amounts already from allocations).
    for (const dc of order.discount_codes || []) {
      const code = String(dc.code || "").trim()
      if (!code) continue
      const entry = codeMap.get(code) || { amount: 0, orders: new Set<string>() }
      entry.orders.add(String(oi))
      codeMap.set(code, entry)
    }
  }

  const topCodes: DiscountCodeStat[] = [...codeMap.entries()]
    .map(([code, v]) => ({ code, amount: v.amount, orderCount: v.orders.size }))
    .filter((c) => c.amount > 0 || c.orderCount > 0)
    .sort((a, b) => b.amount - a.amount || b.orderCount - a.orderCount)
    .slice(0, 15)

  return {
    totalDiscounts,
    byCategory: { promotional, subscription, freeGifts, other },
    topCodes,
    ordersWithDiscounts,
    allocationSum,
  }
}
