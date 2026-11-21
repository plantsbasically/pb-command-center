/**
 * Manual vs ShipFusion precedence + CM isolation through fulfillment term.
 * Run via: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mergeFulfillmentCosts, isStorageManualInvoice } from "./fulfillment-merge.ts"
import { computeMetrics } from "./calculations.ts"
import type { DailyFulfillmentCost } from "./fulfillment-merge.ts"

describe("isStorageManualInvoice", () => {
  it("detects storage in label", () => {
    assert.equal(isStorageManualInvoice("ShipFusion storage — May 2025"), true)
    assert.equal(isStorageManualInvoice("STORAGE FEE"), true)
    assert.equal(isStorageManualInvoice("Nice Commerce Invoice"), false)
  })
})

describe("mergeFulfillmentCosts precedence", () => {
  const apiDay = (date: string, total: number): DailyFulfillmentCost => ({
    date,
    total,
    breakdown: {
      pickPack: total * 0.1,
      shipping: total * 0.7,
      packaging: total * 0.15,
      insurance: total * 0.05,
      storage: 0,
      other: 0,
    },
  })

  it("uses ShipFusion alone when no manuals", () => {
    const merged = mergeFulfillmentCosts({
      dateStart: "2026-01-01",
      dateEnd: "2026-01-02",
      shipfusionDaily: [apiDay("2026-01-01", 100), apiDay("2026-01-02", 50)],
      shipfusionAuthMode: "x-shipfusion-token",
      shipfusionInvoiceCount: 1,
      shipfusionTransactionCount: 2,
      manualInvoices: [],
    })
    assert.equal(merged.fulfillmentSource, "shipfusion")
    assert.equal(merged.fulfillmentInvoiceTotal, 150)
    assert.equal(merged.manualContribution, 0)
  })

  it("always adds storage manuals even when API covers the period", () => {
    const merged = mergeFulfillmentCosts({
      dateStart: "2026-01-01",
      dateEnd: "2026-01-31",
      shipfusionDaily: [apiDay("2026-01-15", 200)],
      shipfusionAuthMode: "x-shipfusion-token",
      shipfusionInvoiceCount: 1,
      shipfusionTransactionCount: 1,
      manualInvoices: [
        {
          id: 1,
          label: "ShipFusion storage — Jan 2026",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          amount: 310,
        },
      ],
    })
    assert.equal(merged.fulfillmentSource, "mixed")
    assert.equal(merged.fulfillmentBreakdown.storage, 310)
    assert.equal(merged.apiContribution, 200)
    assert.equal(merged.fulfillmentInvoiceTotal, 510)
  })

  it("ignores non-storage manuals on API-covered days (no double count)", () => {
    const merged = mergeFulfillmentCosts({
      dateStart: "2026-01-01",
      dateEnd: "2026-01-02",
      shipfusionDaily: [apiDay("2026-01-01", 100), apiDay("2026-01-02", 100)],
      shipfusionAuthMode: "x-shipfusion-token",
      shipfusionInvoiceCount: 1,
      shipfusionTransactionCount: 2,
      manualInvoices: [
        {
          id: 1,
          label: "Nice Commerce Invoice",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-02",
          amount: 500,
        },
      ],
    })
    assert.equal(merged.fulfillmentSource, "shipfusion")
    assert.equal(merged.manualContribution, 0)
    assert.equal(merged.fulfillmentInvoiceTotal, 200)
  })

  it("uses non-storage manuals only on uncovered days", () => {
    const merged = mergeFulfillmentCosts({
      dateStart: "2026-01-01",
      dateEnd: "2026-01-02",
      shipfusionDaily: [apiDay("2026-01-01", 100)],
      shipfusionAuthMode: "x-shipfusion-token",
      shipfusionInvoiceCount: 1,
      shipfusionTransactionCount: 1,
      manualInvoices: [
        {
          id: 1,
          label: "Nice Commerce Invoice",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-02",
          amount: 200, // $100/day
        },
      ],
    })
    assert.equal(merged.fulfillmentSource, "mixed")
    assert.equal(merged.apiContribution, 100)
    assert.equal(merged.manualContribution, 100) // only Jan 2
    assert.equal(merged.fulfillmentInvoiceTotal, 200)
    assert.equal(merged.fulfillmentBreakdown.other, 100)
  })

  it("falls back to full manual when API empty", () => {
    const merged = mergeFulfillmentCosts({
      dateStart: "2026-01-01",
      dateEnd: "2026-01-10",
      shipfusionDaily: [],
      shipfusionError: "missing_api_key",
      shipfusionAuthMode: "none",
      shipfusionInvoiceCount: 0,
      shipfusionTransactionCount: 0,
      manualInvoices: [
        {
          id: 1,
          label: "Nice Commerce Invoice",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-10",
          amount: 1000,
        },
      ],
    })
    assert.equal(merged.fulfillmentSource, "manual")
    assert.equal(merged.fulfillmentInvoiceTotal, 1000)
  })
})

describe("CM changes only through fulfillment term", () => {
  const base = {
    shopifyRevenue: 10000,
    amazonRevenue: 2000,
    tiktokRevenue: 500,
    shopifyOrdersCount: 100,
    shopifyAOV: 100,
    shopifyNewCustomers: 40,
    shopifyTotalCustomers: 90,
    shopifyCogsByVariantSold: 2500,
    shippingCollected: 200,
    amazonFeeInvoiceTotal: 300,
    tiktokFees: 10,
    gatewayFees: 0,
    adSpend: 4000,
    twLtv: 85,
    fixedCostsMonthly: [5000],
    dateRange: { start: "2026-11-20", end: "2026-11-20" },
  }

  it("varying fulfillmentInvoiceTotal changes CM/profit only via net fulfillment", () => {
    const low = computeMetrics({ ...base, fulfillmentInvoiceTotal: 500 })
    const high = computeMetrics({ ...base, fulfillmentInvoiceTotal: 1500 })

    assert.equal(low.revenue, high.revenue)
    assert.equal(low.cogs, high.cogs)
    assert.equal(low.adSpend, high.adSpend)
    assert.equal(low.amazonFeeInvoiceTotal, high.amazonFeeInvoiceTotal)
    assert.equal(low.tiktokFees, high.tiktokFees)
    assert.equal(low.gatewayFees, high.gatewayFees)
    assert.equal(low.shopifyRevenue, high.shopifyRevenue)
    assert.equal(low.grossProfit, high.grossProfit)

    assert.equal(high.netFulfillmentCost - low.netFulfillmentCost, 1000)
    assert.equal(low.contributionProfit - high.contributionProfit, 1000)
    assert.equal(low.trueContributionMargin - high.trueContributionMargin, 1000)

    const netLow = 500 - 200
    const netHigh = 1500 - 200
    assert.equal(low.netFulfillmentCost, netLow)
    assert.equal(high.netFulfillmentCost, netHigh)
    assert.equal(
      low.trueContributionMargin,
      low.revenue - low.adSpend - low.cogs - low.netFulfillmentCost - low.gatewayFees
    )
    assert.equal(
      high.contributionProfit,
      high.grossProfit - high.adSpend - high.netFulfillmentCost - high.amazonFeeInvoiceTotal - high.tiktokFees - high.gatewayFees
    )
  })

  it("zero fulfillment leaves net fulfillment at 0 (no shipping credit alone)", () => {
    const m = computeMetrics({ ...base, fulfillmentInvoiceTotal: 0, gatewayFees: 0 })
    assert.equal(m.netFulfillmentCost, 0)
    assert.equal(m.trueContributionMargin, m.revenue - m.adSpend - m.cogs)
  })
})
