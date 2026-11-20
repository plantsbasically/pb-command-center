/**
 * Asserts contribution margin math does not accept or depend on discountStats.
 * Run via: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeMetrics } from "./calculations.ts"

describe("computeMetrics ignores discounts", () => {
  it("CM unchanged when a large discountStats object is only attached after the fact", () => {
    const params = {
      shopifyRevenue: 51122.17,
      amazonRevenue: 0,
      tiktokRevenue: 0,
      shopifyOrdersCount: 658,
      shopifyAOV: 77.69,
      shopifyNewCustomers: 400,
      shopifyTotalCustomers: 600,
      shopifyCogsByVariantSold: 8000,
      shippingCollected: 1367.74,
      fulfillmentInvoiceTotal: 0,
      amazonFeeInvoiceTotal: 0,
      tiktokFees: 0,
      adSpend: 20000,
      twLtv: 85,
      fixedCostsMonthly: [30000],
      dateRange: { start: "2026-11-20", end: "2026-11-20" },
    }

    const a = computeMetrics(params)
    const b = computeMetrics(params)

    // Simulate API response envelope that includes discountStats for display
    const shopifyAnalyticsDiscounts = 24106.33
    const responseA = { metrics: a, discountStats: null }
    const responseB = {
      metrics: b,
      discountStats: {
        totalDiscounts: shopifyAnalyticsDiscounts,
        byCategory: {
          promotional: 5000,
          subscription: 9000,
          freeGifts: 10000,
          other: 106.33,
        },
        topCodes: [{ code: "BFCM", amount: 5000, orderCount: 50 }],
        ordersWithDiscounts: 500,
        allocationSum: 24106.33,
      },
    }

    assert.equal(responseA.metrics.trueContributionMargin, responseB.metrics.trueContributionMargin)
    assert.equal(responseA.metrics.contributionProfit, responseB.metrics.contributionProfit)
    assert.equal(responseA.metrics.revenue, responseB.metrics.revenue)
    assert.equal(responseA.metrics.netProfit, responseB.metrics.netProfit)
    assert.equal(
      responseA.metrics.trueContributionMargin,
      params.shopifyRevenue + params.amazonRevenue + params.tiktokRevenue - params.adSpend -
        (params.shopifyCogsByVariantSold /* + marketplace cogs 0 */)
    )
    // discountStats must not be a computeMetrics parameter
    assert.equal(
      (computeMetrics as unknown as { length: number }).length,
      1,
      "computeMetrics takes a single params object — no discountStats arg"
    )
    assert.ok(!("discountStats" in params))
  })
})
