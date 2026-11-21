/**
 * Range summing: additive totals + ratios from totals (never averaged).
 * Run via: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  sumDailyMetricsRows,
  type DailyMetricsRow,
} from "./daily-metrics.ts"

function row(partial: Partial<DailyMetricsRow> & { date: string }): DailyMetricsRow {
  return {
    revenue: 0,
    shopifyRevenue: 0,
    amazonRevenue: 0,
    tiktokRevenue: 0,
    cogs: 0,
    shopifyCogs: 0,
    amazonCogs: 0,
    tiktokCogs: 0,
    giftCogs: 0,
    giftRetailDiscounted: 0,
    adSpend: 0,
    adSpendFacebook: 0,
    adSpendGoogle: 0,
    adSpendMicrosoft: 0,
    adSpendTiktok: 0,
    adSpendSnapchat: 0,
    adSpendPinterest: 0,
    adSpendAmazon: 0,
    gatewayFees: 0,
    shippingCollected: 0,
    fulfillmentGross: 0,
    shipfusionFulfillmentCost: 0,
    fulfillmentPickPack: 0,
    fulfillmentShipping: 0,
    fulfillmentPackaging: 0,
    fulfillmentInsurance: 0,
    fulfillmentStorage: 0,
    fulfillmentOther: 0,
    fulfillmentSource: "shipfusion",
    amazonFeeInvoiceTotal: 0,
    tiktokFees: 0,
    contributionMargin: 0,
    contributionProfit: 0,
    fixedCosts: 0,
    netProfit: 0,
    ordersCount: 0,
    newCustomers: 0,
    totalCustomers: 0,
    subscriptionRevenue: 0,
    subscriptionOrderCount: 0,
    discountTotal: 0,
    discountPromotional: 0,
    discountSubscription: 0,
    discountFreeGifts: 0,
    discountOther: 0,
    ltv: 90,
    attributedRevenue: 0,
    status: "complete",
    source: "test",
    ...partial,
  }
}

describe("sumDailyMetricsRows", () => {
  it("sums additive fields and computes CM% / AOV / ROAS from totals", () => {
    const rows = [
      row({
        date: "2026-11-18",
        revenue: 10000,
        shopifyRevenue: 8000,
        amazonRevenue: 1500,
        tiktokRevenue: 500,
        cogs: 2000,
        adSpend: 3000,
        gatewayFees: 100,
        shipfusionFulfillmentCost: 400,
        contributionMargin: 10000 - 3000 - 2000 - 400 - 100, // 4500
        ordersCount: 80,
        newCustomers: 40,
        attributedRevenue: 9000,
        adSpendFacebook: 2000,
        adSpendGoogle: 1000,
      }),
      row({
        date: "2026-11-19",
        revenue: 20000,
        shopifyRevenue: 16000,
        amazonRevenue: 3000,
        tiktokRevenue: 1000,
        cogs: 5000,
        adSpend: 5000,
        gatewayFees: 200,
        shipfusionFulfillmentCost: 600,
        contributionMargin: 20000 - 5000 - 5000 - 600 - 200, // 9200
        ordersCount: 120,
        newCustomers: 60,
        attributedRevenue: 18000,
        adSpendFacebook: 3000,
        adSpendGoogle: 2000,
      }),
    ]

    const summed = sumDailyMetricsRows(rows, {
      start: "2026-11-18",
      end: "2026-11-19",
    })

    assert.equal(summed.metrics.revenue, 30000)
    assert.equal(summed.metrics.shopifyRevenue, 24000)
    assert.equal(summed.metrics.tiktokRevenue, 1500)
    assert.equal(summed.metrics.cogs, 7000)
    assert.equal(summed.metrics.adSpend, 8000)
    assert.equal(summed.metrics.gatewayFees, 300)
    assert.equal(summed.metrics.netFulfillmentCost, 1000)
    assert.equal(summed.metrics.trueContributionMargin, 4500 + 9200)
    assert.equal(summed.metrics.ordersCount, 200)

    // CM% from summed totals — NOT average of daily %s
    const expectedCmPct = ((4500 + 9200) / 30000) * 100
    assert.ok(
      Math.abs(summed.metrics.trueContributionMarginPct - expectedCmPct) < 1e-9
    )
    // Averaging daily CM%s would be wrong:
    const avgOfDailyPcts =
      ((4500 / 10000) * 100 + (9200 / 20000) * 100) / 2
    assert.notEqual(
      Math.round(summed.metrics.trueContributionMarginPct * 100),
      Math.round(avgOfDailyPcts * 100)
    )

    // AOV from summed shopify revenue / orders
    assert.equal(summed.metrics.aov, 24000 / 200)

    // ROAS from summed attributed / ad spend
    assert.equal(summed.twData.blendedRoas, 27000 / 8000)

    // Provisional CAC uses Shopify-attributable spend (excludes Amazon Ads + TikTok ads)
    // facebook 5000 + google 3000 = 8000; no amazon/tiktok in these fixtures → still 8000/100
    assert.equal(summed.metrics.cac, 8000 / 100)

    // Channel spend summed
    assert.equal(summed.twData.channelSpend.facebook, 5000)
    assert.equal(summed.twData.channelSpend.google, 3000)

    assert.deepEqual(summed.daysUsed, ["2026-11-18", "2026-11-19"])
    assert.equal(summed.fromStore, true)
  })

  it("tracks missing days and still sums what is present", () => {
    const rows = [row({ date: "2026-11-20", revenue: 1000, contributionMargin: 100 })]
    const summed = sumDailyMetricsRows(
      rows,
      { start: "2026-11-19", end: "2026-11-20" },
      ["2026-11-19"]
    )
    assert.equal(summed.metrics.revenue, 1000)
    assert.deepEqual(summed.missingDays, ["2026-11-19"])
    assert.equal(summed.fromStore, false)
  })

  it("discounts are display-only sums and do not alter CM", () => {
    const rows = [
      row({
        date: "2026-11-20",
        revenue: 5000,
        contributionMargin: 1000,
        discountTotal: 2000,
        discountPromotional: 500,
        discountFreeGifts: 1500,
      }),
    ]
    const summed = sumDailyMetricsRows(rows, {
      start: "2026-11-20",
      end: "2026-11-20",
    })
    assert.equal(summed.discountStats.totalDiscounts, 2000)
    assert.equal(summed.metrics.trueContributionMargin, 1000)
    assert.equal(summed.metrics.revenue, 5000)
  })
})
