/**
 * LTV:CAC helpers.
 *
 * LTV (primary): customer-weighted mean of Loop `loop_ltv_snapshot` subscriber
 * segments (Order1Subscriber … Order4AndMoreSubscriber) from the latest snapshot.
 * Also exposes blended all-customer LTV (incl. NonSubscriber) and per-segment rows.
 * Fallback: Triple Whale `uniqueCustomerSales` when no Loop snapshot exists.
 *
 * CAC: Shopify new customers in the selected range ÷ Shopify-attributable ad spend.
 * Shopify-attributable = blended ad spend − Amazon Ads − TikTok ads (channels whose
 * new-customer counts we cannot reliably obtain from TW/Shopify today). Numerator
 * and denominator therefore both describe Shopify acquisition.
 *
 * Contribution-margin math still uses full blended ad spend — unchanged here.
 */

/** Primary LTV:CAC target (each customer ≥ 3× acquisition cost). */
export const TARGET_LTV_CAC = 3.0

/** Warning band: below this shows amber / red zone. */
export const LTV_CAC_WARNING = 1.5

export type LtvSource = "loop_subscriber" | "triple_whale_fallback"

export interface LoopLtvSegmentRow {
  segment: string
  customers: number
  revenuePerCustomer: number
}

export interface LoopLtvComputed {
  snapshotDate: string
  segments: LoopLtvSegmentRow[]
  /** Customer-weighted across Order1…Order4+ subscriber segments */
  subscriberLtv: number
  subscriberCustomers: number
  /** Customer-weighted across all segments including NonSubscriber */
  blendedLtv: number
  blendedCustomers: number
}

export interface ChannelSpendForCac {
  facebook: number
  google: number
  microsoft: number
  tiktok: number
  snapchat: number
  pinterest: number
  amazonAds: number
}

export interface LtvCacResult {
  ltv: number
  ltvSource: LtvSource
  blendedLtv: number | null
  segments: LoopLtvSegmentRow[]
  snapshotDate: string | null
  cac: number
  cacAdSpend: number
  totalAdSpend: number
  excludedAdSpend: number
  newCustomers: number
  newCustomersSource: "shopify"
  cacAdSpendLabel: string
  ratio: number
  target: number
  warningThreshold: number
  explainTooltip: string
  ltvHint: string
  cacHint: string
}

const SUBSCRIBER_SEGMENTS = new Set([
  "order1subscriber",
  "order2subscriber",
  "order3subscriber",
  "order4andmoresubscriber",
])

export function isSubscriberLtvSegment(segment: string): boolean {
  return SUBSCRIBER_SEGMENTS.has(String(segment || "").toLowerCase().replace(/[\s_-]/g, ""))
}

/** Normalize segment key for matching (Order1Subscriber, order_1_subscriber, …). */
export function normalizeLtvSegmentKey(segment: string): string {
  return String(segment || "").toLowerCase().replace(/[\s_-]/g, "")
}

export function weightedAverageLtv(
  rows: { customers: number; revenuePerCustomer: number }[]
): { ltv: number; customers: number } {
  let cust = 0
  let rev = 0
  for (const r of rows) {
    const c = Number(r.customers) || 0
    const rpc = Number(r.revenuePerCustomer) || 0
    if (c <= 0) continue
    cust += c
    rev += c * rpc
  }
  return { ltv: cust > 0 ? rev / cust : 0, customers: cust }
}

export function computeLoopLtv(rows: LoopLtvSegmentRow[], snapshotDate: string): LoopLtvComputed {
  const segments = rows.map((r) => ({
    segment: r.segment,
    customers: Number(r.customers) || 0,
    revenuePerCustomer: Number(r.revenuePerCustomer) || 0,
  }))
  const subscriberRows = segments.filter((r) => isSubscriberLtvSegment(r.segment))
  const sub = weightedAverageLtv(subscriberRows)
  const blend = weightedAverageLtv(segments)
  return {
    snapshotDate,
    segments,
    subscriberLtv: sub.ltv,
    subscriberCustomers: sub.customers,
    blendedLtv: blend.ltv,
    blendedCustomers: blend.customers,
  }
}

/**
 * Ad spend matched to Shopify new-customer denominator:
 * total blended − Amazon Ads − TikTok ads.
 */
export function shopifyAttributableAdSpend(
  totalAdSpend: number,
  channel: Partial<ChannelSpendForCac>
): { cacAdSpend: number; excluded: number } {
  const amazon = Number(channel.amazonAds) || 0
  const tiktok = Number(channel.tiktok) || 0
  const excluded = amazon + tiktok
  const cacAdSpend = Math.max(0, (Number(totalAdSpend) || 0) - excluded)
  return { cacAdSpend, excluded }
}

export function computeCac(cacAdSpend: number, newCustomers: number): number {
  return newCustomers > 0 ? cacAdSpend / newCustomers : 0
}

export function computeLtvCacRatio(ltv: number, cac: number): number {
  return cac > 0 ? ltv / cac : 0
}

export function formatMoneyShort(n: number): string {
  if (!Number.isFinite(n)) return "n/a"
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}

export function buildLtvCacResult(opts: {
  totalAdSpend: number
  channelSpend: Partial<ChannelSpendForCac>
  shopifyNewCustomers: number
  loopLtv: LoopLtvComputed | null
  twLtvFallback: number
}): LtvCacResult {
  const { cacAdSpend, excluded } = shopifyAttributableAdSpend(
    opts.totalAdSpend,
    opts.channelSpend
  )
  const newCustomers = opts.shopifyNewCustomers
  const cac = computeCac(cacAdSpend, newCustomers)

  let ltv: number
  let ltvSource: LtvSource
  let blendedLtv: number | null = null
  let segments: LoopLtvSegmentRow[] = []
  let snapshotDate: string | null = null

  if (opts.loopLtv && opts.loopLtv.subscriberLtv > 0) {
    ltv = opts.loopLtv.subscriberLtv
    ltvSource = "loop_subscriber"
    blendedLtv = opts.loopLtv.blendedLtv
    segments = opts.loopLtv.segments
    snapshotDate = opts.loopLtv.snapshotDate
  } else {
    ltv = opts.twLtvFallback || 0
    ltvSource = "triple_whale_fallback"
  }

  const ratio = computeLtvCacRatio(ltv, cac)
  const cacAdSpendLabel =
    "Facebook + Google + Microsoft + Snapchat + Pinterest (excludes Amazon Ads & TikTok ads)"

  const ltvHint =
    ltvSource === "loop_subscriber"
      ? `Loop subscriber LTV (customer-weighted Order1–Order4+), snapshot ${snapshotDate} · YTD realized revenue/customer. Blended all-customer ${
          blendedLtv != null ? formatMoneyShort(blendedLtv) : "—"
        }.`
      : "Fallback: Triple Whale uniqueCustomerSales (no Loop LTV snapshot available)."

  const cacHint = `CAC = Shopify-attributable ad spend ÷ Shopify new customers. Spend excludes Amazon Ads & TikTok ads so it matches Shopify new-customer counts (TW/Shopify do not expose reliable Amazon/TikTok Shop new-customer counts here).`

  const explainTooltip = buildExplainTooltip({
    ltv,
    ltvSource,
    snapshotDate,
    cac,
    cacAdSpend,
    newCustomers,
    ratio,
    target: TARGET_LTV_CAC,
    warning: LTV_CAC_WARNING,
  })

  return {
    ltv,
    ltvSource,
    blendedLtv,
    segments,
    snapshotDate,
    cac,
    cacAdSpend,
    totalAdSpend: opts.totalAdSpend,
    excludedAdSpend: excluded,
    newCustomers,
    newCustomersSource: "shopify",
    cacAdSpendLabel,
    ratio,
    target: TARGET_LTV_CAC,
    warningThreshold: LTV_CAC_WARNING,
    explainTooltip,
    ltvHint,
    cacHint,
  }
}

/** 2–4 short sentences for the LTV:CAC card tooltip / tap hint. */
export function buildExplainTooltip(opts: {
  ltv: number
  ltvSource: LtvSource
  snapshotDate: string | null
  cac: number
  cacAdSpend: number
  newCustomers: number
  ratio: number
  target: number
  warning: number
}): string {
  const ltvPart =
    opts.ltvSource === "loop_subscriber"
      ? `LTV ($${opts.ltv.toFixed(0)}) is Loop’s customer-weighted subscriber lifetime value${
          opts.snapshotDate ? ` from the ${opts.snapshotDate} snapshot` : ""
        }.`
      : `LTV ($${opts.ltv.toFixed(0)}) is a Triple Whale fallback (uniqueCustomerSales) because no Loop LTV snapshot is available.`

  const cacPart = `CAC ($${opts.cac.toFixed(0)}) is Shopify-attributable ad spend ($${opts.cacAdSpend.toFixed(0)}, excluding Amazon Ads & TikTok ads) ÷ ${opts.newCustomers.toLocaleString()} Shopify new customers.`

  const targetPart = `LTV:CAC is LTV ÷ CAC (now ${opts.ratio.toFixed(2)}×). The ${opts.target.toFixed(1)}× target means each customer should return at least ${opts.target.toFixed(1)}× what it cost to acquire them; under ${opts.warning.toFixed(1)}× is the warning/red zone.`

  return `${ltvPart} ${cacPart} ${targetPart}`
}
