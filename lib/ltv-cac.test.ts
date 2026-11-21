/**
 * LTV:CAC — Loop subscriber LTV + Shopify-attributable CAC.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildExplainTooltip,
  buildLtvCacResult,
  computeLoopLtv,
  isSubscriberLtvSegment,
  shopifyAttributableAdSpend,
  weightedAverageLtv,
  LTV_CAC_WARNING,
  TARGET_LTV_CAC,
} from "./ltv-cac.ts"

const SNAPSHOT_ROWS = [
  { segment: "NonSubscriber", customers: 35464, revenuePerCustomer: 93.14 },
  { segment: "Order1Subscriber", customers: 17132, revenuePerCustomer: 152.09 },
  { segment: "Order2Subscriber", customers: 1176, revenuePerCustomer: 306.5 },
  { segment: "Order3Subscriber", customers: 179, revenuePerCustomer: 415.59 },
  { segment: "Order4AndMoreSubscriber", customers: 52, revenuePerCustomer: 533.89 },
]

describe("isSubscriberLtvSegment", () => {
  it("matches Order1–Order4+ and rejects NonSubscriber", () => {
    assert.equal(isSubscriberLtvSegment("Order1Subscriber"), true)
    assert.equal(isSubscriberLtvSegment("order_4_and_more_subscriber"), true)
    assert.equal(isSubscriberLtvSegment("NonSubscriber"), false)
  })
})

describe("computeLoopLtv", () => {
  it("weights subscriber LTV ~$165.50 and blended ~$118 from the Nov 19 snapshot", () => {
    const computed = computeLoopLtv(SNAPSHOT_ROWS, "2026-11-19")
    assert.equal(computed.snapshotDate, "2026-11-19")
    assert.ok(Math.abs(computed.subscriberLtv - 165.4999) < 0.01)
    assert.equal(computed.subscriberCustomers, 18539)
    assert.ok(Math.abs(computed.blendedLtv - 117.9808) < 0.01)
  })
})

describe("shopifyAttributableAdSpend", () => {
  it("subtracts Amazon Ads and TikTok ads from blended spend", () => {
    const { cacAdSpend, excluded } = shopifyAttributableAdSpend(795403.66, {
      amazonAds: 6028.12,
      tiktok: 2260.8,
    })
    assert.ok(Math.abs(excluded - (6028.12 + 2260.8)) < 0.01)
    assert.ok(Math.abs(cacAdSpend - 787114.74) < 0.01)
  })
})

describe("buildLtvCacResult MTD Nov 1–20", () => {
  it("uses Loop subscriber LTV and Shopify-attributable CAC → ~1.16×", () => {
    const loop = computeLoopLtv(SNAPSHOT_ROWS, "2026-11-19")
    const result = buildLtvCacResult({
      totalAdSpend: 795403.66,
      channelSpend: {
        facebook: 761537.31,
        google: 25577.43,
        microsoft: 0,
        tiktok: 2260.8,
        snapchat: 0,
        pinterest: 0,
        amazonAds: 6028.12,
      },
      shopifyNewCustomers: 5501,
      loopLtv: loop,
      twLtvFallback: 83.92,
    })
    assert.equal(result.ltvSource, "loop_subscriber")
    assert.ok(Math.abs(result.ltv - 165.5) < 0.05)
    assert.ok(Math.abs(result.cac - 143.09) < 0.05)
    assert.ok(Math.abs(result.ratio - 1.157) < 0.01)
    assert.equal(result.target, TARGET_LTV_CAC)
    assert.equal(result.warningThreshold, LTV_CAC_WARNING)
    assert.match(result.explainTooltip, /LTV:CAC is LTV ÷ CAC/)
    assert.match(result.explainTooltip, /3\.0× target/)
    assert.match(result.explainTooltip, /1\.5×/)
    assert.match(result.ltvHint, /2026-11-19/)
  })

  it("falls back to TW LTV when Loop snapshot missing", () => {
    const result = buildLtvCacResult({
      totalAdSpend: 1000,
      channelSpend: { amazonAds: 0, tiktok: 0 },
      shopifyNewCustomers: 10,
      loopLtv: null,
      twLtvFallback: 84,
    })
    assert.equal(result.ltvSource, "triple_whale_fallback")
    assert.equal(result.ltv, 84)
    assert.equal(result.cac, 100)
    assert.equal(result.ratio, 0.84)
    assert.match(result.explainTooltip, /Triple Whale fallback/)
  })
})

describe("buildExplainTooltip", () => {
  it("mentions Loop snapshot, excluded channels, and thresholds", () => {
    const text = buildExplainTooltip({
      ltv: 165.5,
      ltvSource: "loop_subscriber",
      snapshotDate: "2026-11-19",
      cac: 143.09,
      cacAdSpend: 787114.74,
      newCustomers: 5501,
      ratio: 1.16,
      target: 3,
      warning: 1.5,
    })
    assert.match(text, /2026-11-19/)
    assert.match(text, /Amazon Ads/)
    assert.match(text, /TikTok ads/)
    assert.match(text, /Shopify new customers/)
    assert.match(text, /3\.0× target/)
    assert.match(text, /1\.5×/)
  })
})

describe("weightedAverageLtv", () => {
  it("returns 0 for empty", () => {
    assert.deepEqual(weightedAverageLtv([]), { ltv: 0, customers: 0 })
  })
})
