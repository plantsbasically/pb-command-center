/**
 * Unit tests for Loop ingest validation / upsert mapping and MRR normalization.
 * Run: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  normalizeDailyRow,
  normalizeCohortRow,
  normalizeLtvRow,
  parseIngestPayload,
  verifyLoopIngestSecret,
} from "./loop-metrics.ts"
import {
  normalizeSubscriptionMRR,
  subscriptionMRRContribution,
} from "./loop.ts"

describe("loop ingest validation", () => {
  it("normalizes camelCase daily rows", () => {
    const row = normalizeDailyRow(
      {
        date: "2026-11-19",
        newSubscribers: 12,
        reactivated: 3,
        resumed: 1,
        churned: 4,
        activeSubscribers: 5000,
        activeSubscriptions: 5200,
        mrr: 588000.5,
        source: "loop-mcp",
      },
      0
    )
    assert.equal(row.date, "2026-11-19")
    assert.equal(row.newSubscribers, 12)
    assert.equal(row.reactivated, 3)
    assert.equal(row.resumed, 1)
    assert.equal(row.churned, 4)
    assert.equal(row.activeSubscribers, 5000)
    assert.equal(row.mrr, 588000.5)
    assert.equal(row.source, "loop-mcp")
  })

  it("accepts snake_case daily aliases", () => {
    const row = normalizeDailyRow(
      {
        date: "2026-11-18",
        new_subscribers: 5,
        reactivated: 0,
        resumed: 0,
        active_subscribers: 100,
        active_subscriptions: 110,
      },
      0
    )
    assert.equal(row.newSubscribers, 5)
    assert.equal(row.activeSubscriptions, 110)
    assert.equal(row.churned, null)
  })

  it("rejects bad dates and negative counts", () => {
    assert.throws(() => normalizeDailyRow({ date: "11-19-2026", newSubscribers: 1, reactivated: 0, resumed: 0 }, 0))
    assert.throws(() =>
      normalizeDailyRow({ date: "2026-11-19", newSubscribers: -1, reactivated: 0, resumed: 0 }, 0)
    )
  })

  it("normalizes cohort rows with granularity + metric", () => {
    const row = normalizeCohortRow(
      {
        cohort_start: "2026-09-01",
        cohort_granularity: "month",
        cohort_size: 200,
        metric: "day_30",
        value_pct: 72.5,
        ltv: 145.2,
        snapshot_date: "2026-11-19",
      },
      0
    )
    assert.equal(row.cohortStart, "2026-09-01")
    assert.equal(row.cohortGranularity, "month")
    assert.equal(row.metric, "day_30")
    assert.equal(row.valuePct, 72.5)
  })

  it("rejects invalid cohort granularity", () => {
    assert.throws(() =>
      normalizeCohortRow(
        {
          cohortStart: "2026-09-01",
          cohortGranularity: "quarter",
          cohortSize: 1,
          metric: "day_30",
          valuePct: 10,
          snapshotDate: "2026-11-19",
        },
        0
      )
    )
  })

  it("normalizes LTV rows", () => {
    const row = normalizeLtvRow(
      {
        snapshot_date: "2026-11-19",
        segment: "all_subscribers",
        customers: 8000,
        revenue_per_customer: 210.5,
      },
      0
    )
    assert.equal(row.segment, "all_subscribers")
    assert.equal(row.revenuePerCustomer, 210.5)
  })

  it("parseIngestPayload maps full body and counts arrays", () => {
    const parsed = parseIngestPayload({
      daily: [{ date: "2026-11-19", newSubscribers: 2, reactivated: 0, resumed: 0 }],
      cohorts: [
        {
          cohortStart: "2026-10-01",
          cohortGranularity: "month",
          cohortSize: 50,
          metric: "order_2",
          valuePct: 40,
          snapshotDate: "2026-11-19",
        },
      ],
      ltv: [
        {
          snapshotDate: "2026-11-19",
          segment: "subscribers",
          customers: 10,
          revenuePerCustomer: 99,
        },
      ],
    })
    assert.equal(parsed.daily.length, 1)
    assert.equal(parsed.cohorts.length, 1)
    assert.equal(parsed.ltv.length, 1)
    assert.equal(parsed.cohorts[0].metric, "order_2")
  })

  it("parseIngestPayload allows empty/missing arrays", () => {
    const parsed = parseIngestPayload({})
    assert.deepEqual(parsed, { daily: [], cohorts: [], ltv: [] })
  })

  it("verifyLoopIngestSecret requires env + Bearer match", () => {
    const prev = process.env.LOOP_INGEST_SECRET
    delete process.env.LOOP_INGEST_SECRET
    assert.equal(verifyLoopIngestSecret("Bearer x"), false)
    process.env.LOOP_INGEST_SECRET = "test-secret"
    assert.equal(verifyLoopIngestSecret("Bearer test-secret"), true)
    assert.equal(verifyLoopIngestSecret("Bearer wrong"), false)
    assert.equal(verifyLoopIngestSecret("Basic abc"), false)
    assert.equal(verifyLoopIngestSecret(null), false)
    if (prev === undefined) delete process.env.LOOP_INGEST_SECRET
    else process.env.LOOP_INGEST_SECRET = prev
  })
})

describe("subscription MRR normalization", () => {
  it("monthly / every 2 months / yearly / weekly / daily", () => {
    assert.equal(normalizeSubscriptionMRR(60, "MONTH", 1), 60)
    assert.equal(normalizeSubscriptionMRR(60, "MONTH", 2), 30)
    assert.equal(normalizeSubscriptionMRR(120, "YEAR", 1), 10)
    assert.equal(normalizeSubscriptionMRR(7, "WEEK", 1), 30)
    assert.equal(normalizeSubscriptionMRR(1, "DAY", 1), 30)
  })

  it("assumes monthly when interval missing", () => {
    assert.equal(normalizeSubscriptionMRR(45, null, null), 45)
    assert.equal(normalizeSubscriptionMRR(90, undefined, 2), 45)
  })

  it("subscriptionMRRContribution uses discounted line total and ignores delivery", () => {
    const mrr = subscriptionMRRContribution({
      totalLineItemDiscountedPrice: 153.99,
      deliveryPrice: 9.99,
      billingPolicy: { interval: "MONTH", intervalCount: 1 },
    })
    assert.equal(mrr, 153.99)
  })

  it("prepaid still uses billingPolicy normalization (documented variance)", () => {
    const mrr = subscriptionMRRContribution({
      totalLineItemDiscountedPrice: 180,
      isPrepaid: true,
      billingPolicy: { interval: "MONTH", intervalCount: 3, prepaidIntervalCount: 3 },
    })
    assert.equal(mrr, 60)
  })
})
