/**
 * Asserts contribution margin changes only by the gatewayFees term.
 * Amazon / TikTok fee fields stay independent (no double-count).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeMetrics } from "./calculations.ts"
import { extractGatewayFeesFromSummary } from "./gateway-fees.ts"

const baseParams = {
  shopifyRevenue: 50000,
  amazonRevenue: 10000,
  tiktokRevenue: 2000,
  shopifyOrdersCount: 500,
  shopifyAOV: 100,
  shopifyNewCustomers: 200,
  shopifyTotalCustomers: 400,
  shopifyCogsByVariantSold: 8000,
  shippingCollected: 500,
  fulfillmentInvoiceTotal: 0,
  amazonFeeInvoiceTotal: 1200,
  tiktokFees: 150,
  gatewayFees: 0,
  adSpend: 15000,
  twLtv: 90,
  fixedCostsMonthly: [20000],
  dateRange: { start: "2026-11-20", end: "2026-11-20" },
}

describe("computeMetrics gatewayFees term", () => {
  it("CM and contributionProfit drop exactly by gatewayFees; other inputs unchanged", () => {
    const gatewayFees = 437.25
    const without = computeMetrics(baseParams)
    const withFees = computeMetrics({ ...baseParams, gatewayFees })

    assert.equal(
      without.trueContributionMargin - withFees.trueContributionMargin,
      gatewayFees,
    )
    assert.equal(
      without.contributionProfit - withFees.contributionProfit,
      gatewayFees,
    )
    assert.equal(without.netProfit - withFees.netProfit, gatewayFees)

    // No other P&L components move
    assert.equal(withFees.revenue, without.revenue)
    assert.equal(withFees.cogs, without.cogs)
    assert.equal(withFees.grossProfit, without.grossProfit)
    assert.equal(withFees.adSpend, without.adSpend)
    assert.equal(withFees.amazonFeeInvoiceTotal, without.amazonFeeInvoiceTotal)
    assert.equal(withFees.tiktokFees, without.tiktokFees)
    assert.equal(withFees.netFulfillmentCost, without.netFulfillmentCost)
    assert.equal(withFees.fixedCosts, without.fixedCosts)
    assert.equal(withFees.gatewayFees, gatewayFees)
  })

  it("does not double-count Amazon or TikTok fees when gatewayFees is set", () => {
    const withAll = computeMetrics({
      ...baseParams,
      gatewayFees: 200,
      amazonFeeInvoiceTotal: 1200,
      tiktokFees: 150,
    })
    // Waterfall: GP − ads − fulfill − amazon − tiktok − gateway
    const expectedContribution =
      withAll.grossProfit -
      withAll.adSpend -
      withAll.netFulfillmentCost -
      1200 -
      150 -
      200
    assert.equal(withAll.contributionProfit, expectedContribution)
    assert.equal(
      withAll.trueContributionMargin,
      withAll.revenue - withAll.adSpend - withAll.cogs - 200,
    )
  })

  it("zero gatewayFees matches prior formula (revenue − ads − cogs)", () => {
    const m = computeMetrics({ ...baseParams, gatewayFees: 0 })
    assert.equal(m.trueContributionMargin, m.revenue - m.adSpend - m.cogs)
  })
})

describe("extractGatewayFeesFromSummary", () => {
  it("reads paymentgatewaycosts id and title variants", () => {
    assert.equal(
      extractGatewayFeesFromSummary({
        metrics: [{ id: "paymentGatewayCosts", values: { current: 88.5 } }],
      }),
      88.5,
    )
    assert.equal(
      extractGatewayFeesFromSummary({
        metrics: [{ title: "Payment Gateway Costs", value: 12 }],
      }),
      12,
    )
    assert.equal(
      extractGatewayFeesFromSummary({
        metrics: [{ id: "payment_gateway_costs", total: 3.5 }],
      }),
      3.5,
    )
    assert.equal(extractGatewayFeesFromSummary(null), 0)
    assert.equal(extractGatewayFeesFromSummary({ metrics: [] }), 0)
  })
})
