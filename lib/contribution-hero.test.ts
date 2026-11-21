/**
 * Contribution hero must use the selected range, not always Pacific today.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildContributionHero,
  formatContributionRangeLabel,
  formatShortPacificDate,
} from "./contribution-hero.ts"

describe("formatContributionRangeLabel", () => {
  it("labels today-only as Today", () => {
    const r = formatContributionRangeLabel("2026-11-20", "2026-11-20", "2026-11-20")
    assert.equal(r.label, "Today")
    assert.equal(r.isTodayOnly, true)
  })

  it("labels a single non-today day without Today", () => {
    const r = formatContributionRangeLabel("2026-11-19", "2026-11-19", "2026-11-20")
    assert.equal(r.label, "Nov 19")
    assert.equal(r.isTodayOnly, false)
  })

  it("labels a multi-day range as start – end", () => {
    const r = formatContributionRangeLabel("2026-10-21", "2026-11-20", "2026-11-20")
    assert.equal(r.label, "Oct 21 – Nov 20")
    assert.equal(r.isTodayOnly, false)
  })

  it("includes years when the range crosses a year boundary", () => {
    const r = formatContributionRangeLabel("2025-12-20", "2026-01-05", "2026-01-05")
    assert.equal(r.label, "Dec 20, 2025 – Jan 5, 2026")
  })
})

describe("formatShortPacificDate", () => {
  it("formats month day", () => {
    assert.equal(formatShortPacificDate("2026-10-21"), "Oct 21")
  })
})

describe("buildContributionHero", () => {
  const rangeMetrics = {
    trueContributionMargin: 244466,
    trueContributionMarginPct: 14.4,
    contributionProfit: 200000,
    revenue: 1_700_000,
    adSpend: 500000,
    cogs: 400000,
    gatewayFees: 10000,
    netFulfillmentCost: 50000,
    fulfillmentInvoiceTotal: 60000,
    shippingCollected: 10000,
    shopifyRevenue: 1_500_000,
    amazonRevenue: 150000,
    tiktokRevenue: 50000,
    shopifyCOGS: 350000,
    amazonCOGS: 40000,
    tiktokCOGS: 10000,
  }

  const todayMetrics = {
    trueContributionMargin: 7524,
    trueContributionMarginPct: 18.2,
    revenue: 41340,
  }

  it("uses range CM as the hero total, not today's", () => {
    const hero = buildContributionHero({
      dateStart: "2026-10-21",
      dateEnd: "2026-11-20",
      todayISO: "2026-11-20",
      rangeMetrics,
      giftStats: { giftCOGS: 1200, giftRetailDiscounted: 5000 },
      fulfillmentSource: "shipfusion",
      todayMetrics,
    })

    assert.equal(hero.contributionMargin, 244466)
    assert.equal(hero.contributionMarginPct, 14.4)
    assert.equal(hero.revenue, 1_700_000)
    assert.equal(hero.label, "Oct 21 – Nov 20")
    assert.equal(hero.isTodayOnly, false)
    assert.equal(hero.components.giftCOGS, 1200)
    // Today is secondary only
    assert.ok(hero.todaySecondary)
    assert.equal(hero.todaySecondary!.contributionMargin, 7524)
    assert.equal(hero.todaySecondary!.date, "2026-11-20")
  })

  it("today-only range has no secondary today line", () => {
    const hero = buildContributionHero({
      dateStart: "2026-11-20",
      dateEnd: "2026-11-20",
      todayISO: "2026-11-20",
      rangeMetrics: {
        ...rangeMetrics,
        trueContributionMargin: 7524,
        trueContributionMarginPct: 18.2,
        revenue: 41340,
      },
      giftStats: { giftCOGS: 100, giftRetailDiscounted: 400 },
      todayMetrics,
    })
    assert.equal(hero.label, "Today")
    assert.equal(hero.isTodayOnly, true)
    assert.equal(hero.contributionMargin, 7524)
    assert.equal(hero.todaySecondary, null)
  })

  it("does not invent today secondary when todayMetrics omitted", () => {
    const hero = buildContributionHero({
      dateStart: "2026-10-21",
      dateEnd: "2026-11-20",
      todayISO: "2026-11-20",
      rangeMetrics,
      giftStats: { giftCOGS: 0, giftRetailDiscounted: 0 },
    })
    assert.equal(hero.todaySecondary, null)
  })
})
