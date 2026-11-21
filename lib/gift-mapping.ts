/**
 * Subscription plan → free-gift bundle mapping.
 *
 * Free gifts ship as Shopify line items that are 100% discounted (retail shown as
 * discount in Triple Whale). Contribution margin here values those lines at
 * cogs_variants cost (via cogsAlias), never at retail.
 *
 * Seed: data/gift-mappings.json (editable via DB table subscription_gift_mappings).
 */

export type GiftMappingStatus = "confirmed" | "inferred" | "todo"

export interface GiftSkuDef {
  sku: string
  name: string
  aliases: string[]
  /** Look up COGS under this SKU in cogs_variants when the order line SKU has $0 cost. */
  cogsAlias: string
  isDigital: boolean
  notes?: string
}

/**
 * Display quantity for the Subscription → Free Gift Mapping card.
 * Does NOT feed gift COGS — contribution margin uses Shopify line
 * `giftUnitsSold × unitCogs` (see lib/build-metrics.ts).
 */
export interface GiftQty {
  sku: string
  qty: number
}

export interface PlanGiftMapping {
  planKey: string
  planName: string
  status: GiftMappingStatus
  parentSkus: string[]
  bundleParentValues: string[]
  sellingPlanHint: string | null
  welcomeGifts: GiftQty[]
  loyaltyGiftsByOrder: Record<string, GiftQty[]>
  notes?: string
  todos: string[]
}

export interface GiftMappingsData {
  giftSkus: GiftSkuDef[]
  plans: PlanGiftMapping[]
}

/** Known gift SKUs + aliases for line-item detection. */
export function buildGiftSkuSet(data: GiftMappingsData): Set<string> {
  const set = new Set<string>()
  for (const g of data.giftSkus) {
    set.add(g.sku)
    for (const a of g.aliases) set.add(a)
  }
  // Heuristic extras seen on orders
  set.add("JJ33CP-FREE")
  return set
}

/** Map any gift line SKU → COGS lookup key (alias). */
export function buildGiftCogsAliasMap(data: GiftMappingsData): Map<string, string> {
  const map = new Map<string, string>()
  for (const g of data.giftSkus) {
    map.set(g.sku, g.cogsAlias || g.sku)
    for (const a of g.aliases) map.set(a, g.cogsAlias || g.sku)
  }
  return map
}

export function isGiftLineItem(
  item: {
    sku?: string | null
    title?: string | null
    price?: string | number
    total_discount?: string | number
    quantity?: number
    properties?: { name: string; value: string }[] | null
  },
  giftSkus: Set<string>
): boolean {
  const sku = (item.sku || "").trim()
  if (sku && giftSkus.has(sku)) return true

  const price = Number(item.price) || 0
  const discount = Number(item.total_discount) || 0
  const qty = item.quantity || 1
  const fullyDiscounted = price > 0 && discount >= price * qty - 0.01
  const zeroPrice = price === 0

  const title = String(item.title || "").toLowerCase()
  const namedGift =
    title.includes("free gift") ||
    title.includes("gift") ||
    sku.toLowerCase().includes("free")

  const props = (item.properties || [])
    .map((p) => `${p.name}=${p.value}`)
    .join(";")
    .toLowerCase()
  const bundleChild = props.includes("_bundle_parent=")

  return zeroPrice || fullyDiscounted || namedGift || bundleChild
}

/**
 * Resolve unit COGS for a sold variant, applying gift alias fallbacks so
 * free-gift SKUs with missing/zero COGS still carry real product cost.
 */
export function resolveUnitCogs(
  variantKey: string,
  cogsMap: Map<string, number>,
  giftAliasMap: Map<string, string>
): { unitCogs: number; usedAlias: string | null } {
  const direct = cogsMap.get(variantKey)
  if (direct && direct > 0) return { unitCogs: direct, usedAlias: null }

  const alias = giftAliasMap.get(variantKey)
  if (alias && alias !== variantKey) {
    const aliased = cogsMap.get(alias)
    if (aliased && aliased > 0) return { unitCogs: aliased, usedAlias: alias }
  }

  // Soft fallback: strip trailing -N pack suffix
  const stripped = variantKey.replace(/-\d+$/, "")
  if (stripped !== variantKey) {
    const soft = cogsMap.get(stripped)
    if (soft && soft > 0) return { unitCogs: soft, usedAlias: stripped }
  }

  return { unitCogs: direct || 0, usedAlias: null }
}
