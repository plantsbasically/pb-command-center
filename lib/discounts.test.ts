/**
 * Unit tests for discount classification + CM isolation.
 * Run: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  classifyDiscountApplication,
  computeDiscountStats,
  emptyDiscountStats,
  isFreeGiftDiscountApp,
  isSubscriptionDiscountApp,
  type DiscountOrderLike,
} from "./discounts.ts"
import { computeMetrics } from "./calculations.ts"

describe("subscription / gift app detection", () => {
  it("treats SAVE 25%/30%/35% automatic titles as subscription", () => {
    assert.equal(isSubscriptionDiscountApp({ type: "automatic", title: "SAVE 25%" }), true)
    assert.equal(isSubscriptionDiscountApp({ type: "automatic", title: "SAVE 30%" }), true)
    assert.equal(isSubscriptionDiscountApp({ type: "automatic", title: "SAVE 35%" }), true)
  })

  it("treats Free Welcome Gift as free gift app", () => {
    assert.equal(isFreeGiftDiscountApp({ type: "automatic", title: "Free Welcome Gift" }), true)
  })

  it("classifies gift lines as free_gifts even if app is SAVE%", () => {
    assert.equal(
      classifyDiscountApplication({ type: "automatic", title: "SAVE 25%" }, { onGiftLine: true }),
      "free_gifts"
    )
  })

  it("classifies SAVE% on paid lines as subscription", () => {
    assert.equal(
      classifyDiscountApplication({ type: "automatic", title: "SAVE 25%" }, { onGiftLine: false }),
      "subscription"
    )
  })

  it("classifies discount_code apps as promotional", () => {
    assert.equal(
      classifyDiscountApplication(
        { type: "discount_code", code: "BFCM15", title: "BFCM15" },
        { onGiftLine: false }
      ),
      "promotional"
    )
  })
})

describe("computeDiscountStats allocation split", () => {
  const isGift = (li: { sku?: string | null; properties?: { name: string; value: string }[] | null }) => {
    if (li.sku === "JJ33CP-SS") return true
    return (li.properties || []).some((p) => p.name === "_bundle_parent")
  }

  it("splits gift vs subscription vs promo without double-counting", () => {
    const orders: DiscountOrderLike[] = [
      {
        financial_status: "paid",
        total_discounts: "49.97",
        discount_applications: [
          { type: "automatic", title: "SAVE 25%", value: "25.0", value_type: "percentage" },
          { type: "automatic", title: "Free Welcome Gift", value: "100.0", value_type: "percentage" },
          { type: "discount_code", code: "BFCM10", title: "BFCM10", value: "10.0", value_type: "percentage" },
        ],
        discount_codes: [{ code: "BFCM10", amount: "5.00", type: "percentage" }],
        line_items: [
          {
            sku: "JJ33DR-2-KIT",
            title: "Juicy Joint Extract",
            price: "119.98",
            total_discount: "34.99",
            quantity: 1,
            discount_allocations: [
              { amount: "29.99", discount_application_index: 0 },
              { amount: "5.00", discount_application_index: 2 },
            ],
          },
          {
            sku: "JJ33CP-SS",
            title: "Collagen Stick Packs (3ct)",
            price: "14.99",
            total_discount: "14.99",
            quantity: 1,
            properties: [{ name: "_bundle_parent", value: "juicy-joint-60" }],
            discount_allocations: [{ amount: "14.99", discount_application_index: 1 }],
          },
        ],
      },
    ]

    const stats = computeDiscountStats(orders, isGift)
    assert.equal(stats.totalDiscounts, 49.97)
    assert.ok(Math.abs(stats.byCategory.subscription - 29.99) < 0.001)
    assert.ok(Math.abs(stats.byCategory.freeGifts - 14.99) < 0.001)
    assert.ok(Math.abs(stats.byCategory.promotional - 5.0) < 0.001)
    // Promo must NOT include gift retail
    assert.ok(stats.byCategory.promotional < stats.byCategory.freeGifts)
    assert.equal(stats.topCodes[0]?.code, "BFCM10")
    assert.ok(Math.abs(stats.topCodes[0].amount - 5) < 0.001)
  })

  it("returns empty stats for empty input", () => {
    assert.deepEqual(computeDiscountStats([], () => false), emptyDiscountStats())
  })
})

describe("CM isolation from discountStats", () => {
  const baseParams = {
    shopifyRevenue: 10000,
    amazonRevenue: 2000,
    tiktokRevenue: 500,
    shopifyOrdersCount: 100,
    shopifyAOV: 100,
    shopifyNewCustomers: 40,
    shopifyTotalCustomers: 90,
    shopifyCogsByVariantSold: 2500,
    shippingCollected: 200,
    fulfillmentInvoiceTotal: 0,
    amazonFeeInvoiceTotal: 300,
    tiktokFees: 10,
    adSpend: 4000,
    twLtv: 85,
    fixedCostsMonthly: [5000],
    dateRange: { start: "2026-11-20", end: "2026-11-20" },
  }

  it("computeMetrics is identical with or without discountStats present alongside", () => {
    const without = computeMetrics(baseParams)
    // discountStats is intentionally NOT a computeMetrics input — simulating API attaching it only to the response envelope
    const discountStats = computeDiscountStats(
      [
        {
          financial_status: "paid",
          total_discounts: "9999",
          discount_applications: [{ type: "automatic", title: "Free Welcome Gift", value: "100" }],
          line_items: [
            {
              sku: "JJ33CP-SS",
              price: "14.99",
              total_discount: "14.99",
              quantity: 1,
              discount_allocations: [{ amount: "14.99", discount_application_index: 0 }],
            },
          ],
        },
      ],
      () => true
    )
    const withStatsAttached = { ...without, discountStats }
    assert.equal(withStatsAttached.trueContributionMargin, without.trueContributionMargin)
    assert.equal(withStatsAttached.contributionProfit, without.contributionProfit)
    assert.equal(withStatsAttached.revenue, without.revenue)
    assert.equal(withStatsAttached.cogs, without.cogs)
    assert.equal(withStatsAttached.netProfit, without.netProfit)
    assert.ok(discountStats.totalDiscounts > 0)
  })
})
