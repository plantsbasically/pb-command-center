/**
 * Time-to-second-order bucketing + rates.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  bucketForDays,
  computeSecondOrderStats,
  daysBetweenPacific,
  medianSorted,
  type OrderForSecondTiming,
} from "./second-order.ts"

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

describe("computeSecondOrderStats", () => {
  const asOf = "2026-11-20"
  // lookback 180 → window starts ~2026-05-24

  const orders: OrderForSecondTiming[] = [
    // Customer A — sub, first May 25, second +10d
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
    // Customer B — one-time, first Jun 1, second +40d
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
    // Customer C — sub, first only (no repeat yet)
    {
      id: "5",
      createdAt: "2026-10-01T12:00:00-07:00",
      customerId: "c",
      isSubscription: true,
    },
    // Customer D — first before window (should be excluded even if 2nd in window)
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

  it("computes median, buckets, and 30/60/90 repeat rates", () => {
    const result = computeSecondOrderStats({
      orders,
      asOfDate: asOf,
      lookbackDays: 180,
    })

    // A, B, C in window; D excluded (first before window)
    assert.equal(result.all.firstOrderCustomers, 3)
    assert.equal(result.all.repeaters, 2)
    // gaps 10 and 40 → median 25
    assert.equal(result.all.medianDaysToSecond, 25)

    const b07 = result.all.buckets.find((b) => b.key === "0-7")!
    const b814 = result.all.buckets.find((b) => b.key === "8-14")!
    const b3145 = result.all.buckets.find((b) => b.key === "31-45")!
    assert.equal(b07.count, 0)
    assert.equal(b814.count, 1)
    assert.equal(b3145.count, 1)

    // Both repeaters by day 40 → 2/3 at 30? only A (10d) by 30 → 1/3
    assert.ok(Math.abs(result.all.repeatRate30 - (1 / 3) * 100) < 0.1)
    assert.ok(Math.abs(result.all.repeatRate60 - (2 / 3) * 100) < 0.1)
    assert.ok(Math.abs(result.all.repeatRate90 - (2 / 3) * 100) < 0.1)

    assert.equal(result.subscriber.firstOrderCustomers, 2) // A, C
    assert.equal(result.oneTime.firstOrderCustomers, 1) // B
    assert.equal(result.subscriber.medianDaysToSecond, 10)
    assert.equal(result.oneTime.medianDaysToSecond, 40)

    const cum30 = result.all.cumulative.find((c) => c.day === 30)!
    assert.ok(Math.abs(cum30.repeatRatePct - result.all.repeatRate30) < 0.01)
  })
})
