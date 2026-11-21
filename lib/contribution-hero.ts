/**
 * Pure helpers for the dashboard contribution-margin hero.
 * Hero must reflect the *selected* date range, not always Pacific "today".
 */

export interface ContributionHeroMetrics {
  trueContributionMargin: number
  trueContributionMarginPct: number
  contributionProfit?: number
  revenue: number
  adSpend: number
  cogs: number
  gatewayFees: number
  netFulfillmentCost: number
  fulfillmentInvoiceTotal: number
  shippingCollected?: number
  shopifyRevenue: number
  amazonRevenue: number
  tiktokRevenue: number
  shopifyCOGS: number
  amazonCOGS: number
  tiktokCOGS: number
}

export interface ContributionHeroGiftStats {
  giftCOGS: number
  giftRetailDiscounted: number
}

export interface ContributionHero {
  /** Inclusive range the hero totals represent */
  dateStart: string
  dateEnd: string
  /** Human label: "Today", a single day, or "Oct 21 – Nov 20" */
  label: string
  isTodayOnly: boolean
  contributionMargin: number
  contributionMarginPct: number
  contributionProfit: number
  revenue: number
  adSpend: number
  cogs: number
  gatewayFees: number
  netFulfillmentCost: number
  fulfillmentInvoiceTotal: number
  shippingCollected: number
  fulfillmentSource: string | null
  fulfillmentBreakdown: {
    pickPack: number
    shipping: number
    packaging: number
    insurance: number
    storage: number
    other: number
  } | null
  components: {
    shopifyRevenue: number
    amazonRevenue: number
    tiktokRevenue: number
    shopifyCOGS: number
    amazonCOGS: number
    tiktokCOGS: number
    giftCOGS: number
    giftRetailDiscounted: number
    gatewayFees: number
    netFulfillmentCost: number
  }
  formula: string
  /** Optional Pacific-today snapshot when the selected range is not today-only */
  todaySecondary: {
    date: string
    contributionMargin: number
    contributionMarginPct: number
    revenue: number
  } | null
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** Format YYYY-MM-DD → "Oct 21" (or "Oct 21, 2025" when year ≠ refYear). */
export function formatShortPacificDate(iso: string, refYear?: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  const month = MONTHS[m - 1] || iso.slice(5, 7)
  const day = String(d)
  if (refYear != null && y !== refYear) return `${month} ${day}, ${y}`
  return `${month} ${day}`
}

/** Calendar yesterday of a YYYY-MM-DD (no TZ drift). */
function yesterdayOf(todayISO: string): string {
  const [y, m, d] = todayISO.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/**
 * Label for the hero eyebrow:
 * - today-only → "Today"
 * - yesterday-only → "Yesterday"
 * - single day → "Oct 21"
 * - range → "Oct 21 – Nov 20" (years when range crosses a year)
 */
export function formatContributionRangeLabel(
  dateStart: string,
  dateEnd: string,
  todayISO: string
): { label: string; isTodayOnly: boolean } {
  if (dateStart === dateEnd && dateStart === todayISO) {
    return { label: "Today", isTodayOnly: true }
  }
  if (dateStart === dateEnd && dateStart === yesterdayOf(todayISO)) {
    return { label: "Yesterday", isTodayOnly: false }
  }
  if (dateStart === dateEnd) {
    return { label: formatShortPacificDate(dateStart), isTodayOnly: false }
  }
  const startYear = Number(dateStart.slice(0, 4))
  const endYear = Number(dateEnd.slice(0, 4))
  if (startYear !== endYear) {
    return {
      label: `${formatShortPacificDate(dateStart)}, ${startYear} – ${formatShortPacificDate(dateEnd)}, ${endYear}`,
      isTodayOnly: false,
    }
  }
  return {
    label: `${formatShortPacificDate(dateStart)} – ${formatShortPacificDate(dateEnd)}`,
    isTodayOnly: false,
  }
}

const FORMULA =
  "Contribution margin = revenue − ad spend − real COGS − net fulfillment − payment gateway fees (gifts at COGS, not retail)"

export function buildContributionHero(opts: {
  dateStart: string
  dateEnd: string
  todayISO: string
  rangeMetrics: ContributionHeroMetrics
  giftStats: ContributionHeroGiftStats
  fulfillmentSource?: string | null
  fulfillmentBreakdown?: ContributionHero["fulfillmentBreakdown"]
  /** Pacific-today metrics when available and range is not today-only */
  todayMetrics?: Pick<
    ContributionHeroMetrics,
    "trueContributionMargin" | "trueContributionMarginPct" | "revenue"
  > | null
}): ContributionHero {
  const { dateStart, dateEnd, todayISO, rangeMetrics, giftStats } = opts
  const { label, isTodayOnly } = formatContributionRangeLabel(dateStart, dateEnd, todayISO)

  const todaySecondary =
    !isTodayOnly && opts.todayMetrics
      ? {
          date: todayISO,
          contributionMargin: opts.todayMetrics.trueContributionMargin,
          contributionMarginPct: opts.todayMetrics.trueContributionMarginPct,
          revenue: opts.todayMetrics.revenue,
        }
      : null

  return {
    dateStart,
    dateEnd,
    label,
    isTodayOnly,
    contributionMargin: rangeMetrics.trueContributionMargin,
    contributionMarginPct: rangeMetrics.trueContributionMarginPct,
    contributionProfit: rangeMetrics.contributionProfit ?? 0,
    revenue: rangeMetrics.revenue,
    adSpend: rangeMetrics.adSpend,
    cogs: rangeMetrics.cogs,
    gatewayFees: rangeMetrics.gatewayFees,
    netFulfillmentCost: rangeMetrics.netFulfillmentCost,
    fulfillmentInvoiceTotal: rangeMetrics.fulfillmentInvoiceTotal,
    shippingCollected: rangeMetrics.shippingCollected ?? 0,
    fulfillmentSource: opts.fulfillmentSource ?? null,
    fulfillmentBreakdown: opts.fulfillmentBreakdown ?? null,
    components: {
      shopifyRevenue: rangeMetrics.shopifyRevenue,
      amazonRevenue: rangeMetrics.amazonRevenue,
      tiktokRevenue: rangeMetrics.tiktokRevenue,
      shopifyCOGS: rangeMetrics.shopifyCOGS,
      amazonCOGS: rangeMetrics.amazonCOGS,
      tiktokCOGS: rangeMetrics.tiktokCOGS,
      giftCOGS: giftStats.giftCOGS,
      giftRetailDiscounted: giftStats.giftRetailDiscounted,
      gatewayFees: rangeMetrics.gatewayFees,
      netFulfillmentCost: rangeMetrics.netFulfillmentCost,
    },
    formula: FORMULA,
    todaySecondary,
  }
}
