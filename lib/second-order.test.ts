/**
 * Time-to-second-order bucketing + eligible rates + date chunks.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  bucketForDays,
  computeSecondOrderStats,
  daysBetweenPacific,
  eligibleForDay,
  medianSorted,
  repeatRateEligible,
  type CustomerObs,
  type OrderForSecondTiming,
} from "./second-order.ts"
import { dateRangeChunks } from "./shopify.ts"

describe("daysBetweenPacific / bucketForDays / median", () => {
  it("counts Pacific calendar days", () => {
    assert.equal(
      daysBetweenPacific("2026-10-01T18:00:00-07:00", "2026-10-15T10:00:00-07:00"),
      14
    )
  })
  it("buckets day gaps", () => {
    assert.equal(bucketForDays(0), "0-7")
    assert.equal(bucketForDays(7), "0-7")
    assert.equal(bucketForDays(8), "8-14")
    assert.equal(bucketForDays(30), "22-30")
    assert.equal(bucketForDays(45), "31-45")
    assert.equal(bucketForDays(90), "61-90")
    assert.equal(bucketForDays(91), "90+")
  })
  it("median even/odd", () => {
    assert.equal(medianSorted([1, 3, 5]), 3)
    assert.equal(medianSorted([2, 4]), 3)
    assert.equal(medianSorted([]), null)
  })
})

describe("dateRangeChunks", () => {
  it("splits a range into inclusive 15-day windows covering the full span", () => {
    const chunks = dateRangeChunks("2026-05-24", "2026-11-20", 15)
    assert.ok(chunks.length >= 12)
    assert.equal(chunks[0].start, "2026-05-24")
    assert.equal(chunks[chunks.length - 1].end, "2026-11-20")
    // Contiguous: next start = prev end + 1
    for (let i = 1; i < chunks.length; i++) {
      const [y, m, d] = chunks[i - 1].end.split("-").map(Number)
      const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
      assert.equal(chunks[i].start, next)
    }
  })
})

describe("eligible repeat rates", () => {
  it("excludes customers too young for the N-day window", () => {
    const asOf = "2026-11-20"
    const obs: CustomerObs[] = [
      { firstDay: "2026-05-25", gap: 10 }, // old enough for 90
      { firstDay: "2026-06-01", gap: 40 }, // old enough for 90
      { firstDay: "2026-10-01", gap: null }, // ~50d old → eligible 30 only
    ]
    assert.equal(eligibleForDay(obs, asOf, 30).length, 3)
    assert.equal(eligibleForDay(obs, asOf, 60).length, 2)
    assert.equal(eligibleForDay(obs, asOf, 90).length, 2)

    const r30 = repeatRateEligible(obs, asOf, 30)
    assert.equal(r30.eligible, 3)
    assert.equal(r30.repeatersByDay, 1) // only gap 10
    assert.ok(Math.abs(r30.ratePct - (1 / 3) * 100) < 0.1)

    const r60 = repeatRateEligible(obs, asOf, 60)
    assert.equal(r60.eligible, 2)
    assert.equal(r60.repeatersByDay, 2) // 10 and 40
    assert.ok(Math.abs(r60.ratePct - 100) < 0.1)

    const r90 = repeatRateEligible(obs, asOf, 90)
    assert.equal(r90.eligible, 2)
    assert.ok(Math.abs(r90.ratePct - 100) < 0.1)
  })
})

describe("computeSecondOrderStats", () => {
  const asOf = "2026-11-20"

  const orders: OrderForSecondTiming[] = [
    {
      id: "1",
      createdAt: "2026-05-25T12:00:00-07:00",
      customerId: "a",
      isSubscription: true,
    },
    {
      id: "2",
      createdAt: "2026-06-04T12:00:00-07:00",
      customerId: "a",
      isSubscription: true,
    },
    {
      id: "3",
      createdAt: "2026-06-01T12:00:00-07:00",
      customerId: "b",
      isSubscription: false,
    },
    {
      id: "4",
      createdAt: "2026-07-11T12:00:00-07:00",
      customerId: "b",
      isSubscription: false,
    },
    {
      id: "5",
      createdAt: "2026-10-01T12:00:00-07:00",
      customerId: "c",
      isSubscription: true,
    },
    {
      id: "6",
      createdAt: "2026-04-01T12:00:00-07:00",
      customerId: "d",
      isSubscription: false,
    },
    {
      id: "7",
      createdAt: "2026-06-01T12:00:00-07:00",
      customerId: "d",
      isSubscription: false,
    },
  ]

  it("computes median, buckets, eligible 30/60/90 rates, and coverage fields", () => {
    const result = computeSecondOrderStats({
      orders,
      asOfDate: asOf,
      lookbackDays: 180,
      coveredFrom: "2026-05-24",
      coveredTo: "2026-11-20",
      ordersFetched: orders.length,
    })

    assert.equal(result.all.firstOrderCustomers, 3)
    assert.equal(result.all.repeaters, 2)
    assert.equal(result.all.medianDaysToSecond, 25)
    assert.equal(result.coveredFrom, "2026-05-24")
    assert.equal(result.coveredTo, "2026-11-20")
    assert.equal(result.ordersFetched, 7)
    assert.match(result.eligibleNote, /eligible/)

    const b814 = result.all.buckets.find((b) => b.key === "8-14")!
    const b3145 = result.all.buckets.find((b) => b.key === "31-45")!
    assert.equal(b814.count, 1)
    assert.equal(b3145.count, 1)

    // Eligible denominators: 30→3, 60→2, 90→2
    assert.equal(result.all.eligible30, 3)
    assert.equal(result.all.eligible60, 2)
    assert.equal(result.all.eligible90, 2)
    assert.ok(Math.abs(result.all.repeatRate30 - (1 / 3) * 100) < 0.1)
    assert.ok(Math.abs(result.all.repeatRate60 - 100) < 0.1)
    assert.ok(Math.abs(result.all.repeatRate90 - 100) < 0.1)

    assert.equal(result.subscriber.firstOrderCustomers, 2)
    assert.equal(result.oneTime.firstOrderCustomers, 1)

    const cum60 = result.all.cumulative.find((c) => c.day === 60)!
    assert.equal(cum60.eligibleCustomers, 2)
    assert.ok(Math.abs(cum60.repeatRatePct - 100) < 0.01)
  })
})
