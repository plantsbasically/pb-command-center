/**
 * ShipFusion charge classification + LA date helpers.
 * Run via: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  billingDateToLA,
  classifyShipmentCharges,
  sumBreakdown,
  emptyBreakdown,
} from "./shipfusion.ts"

describe("classifyShipmentCharges", () => {
  it("maps services/shipping/packaging/insurance and tax+residual to other", () => {
    const b = classifyShipmentCharges({
      services: 1.4,
      shipping: 6.82,
      packaging: 0.2,
      insurance: 0,
      tax: 0.5,
      total: 9.42, // known = 8.92; residual 0.5 → other = tax 0.5 + residual 0.5 = 1.0
    })
    assert.equal(b.pickPack, 1.4)
    assert.equal(b.shipping, 6.82)
    assert.equal(b.packaging, 0.2)
    assert.equal(b.insurance, 0)
    assert.equal(b.storage, 0)
    assert.ok(Math.abs(b.other - 1.0) < 1e-9)
    assert.ok(Math.abs(sumBreakdown(b) - (1.4 + 6.82 + 0.2 + 1.0)) < 1e-9)
  })

  it("handles zero / missing fields", () => {
    const b = classifyShipmentCharges({})
    assert.deepEqual(b, emptyBreakdown())
  })

  it("classifies documented sample shipment line", () => {
    const b = classifyShipmentCharges({
      services: 1.4,
      shipping: 79.09,
      packaging: 2,
      insurance: 0,
      tax: 0,
      total: 82.49,
    })
    assert.equal(b.pickPack, 1.4)
    assert.equal(b.shipping, 79.09)
    assert.equal(b.packaging, 2)
    assert.equal(sumBreakdown(b), 82.49)
  })
})

describe("billingDateToLA", () => {
  it("parses YYYYMMDD billingDate", () => {
    assert.equal(billingDateToLA("20260112", null), "2026-01-12")
  })

  it("prefers billingTimestamp in America/Los_Angeles", () => {
    // 2026-01-12 20:48:05 UTC → still 2026-01-12 in LA (UTC-8)
    assert.equal(billingDateToLA("20260112", 1768247285), "2026-01-12")
  })
})
