/**
 * Pacific date helper tests — midnight UTC edges + DST transitions.
 * Run via: npm test
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  addDaysISO,
  eachDateInclusive,
  formatDateInTimeZone,
  pacificDatePresets,
  pacificDayInstantBounds,
  pacificHour,
  pacificOffsetAtDate,
  shopifyCreatedAtBounds,
  todayPacific,
  tripleWhaleTodayHour,
  yesterdayPacific,
  zonedMidnightUTC,
  PACIFIC_TZ,
} from "./dates.ts"

describe("formatDateInTimeZone / todayPacific", () => {
  it("labels late afternoon PT as the Pacific calendar day, not next UTC day", () => {
    // 2026-11-20 16:10 PT = 2026-11-21 00:10 UTC (PST, UTC-8)
    const lateAfternoonPT = new Date("2026-11-21T00:10:00.000Z")
    assert.equal(lateAfternoonPT.toISOString().slice(0, 10), "2026-11-21")
    assert.equal(formatDateInTimeZone(lateAfternoonPT, PACIFIC_TZ), "2026-11-20")
    assert.equal(todayPacific(lateAfternoonPT), "2026-11-20")
    assert.equal(yesterdayPacific(lateAfternoonPT), "2026-11-19")
  })

  it("around midnight UTC still uses Pacific day", () => {
    // 2026-11-21 07:59 UTC = still Nov 20 evening PT
    const beforePTMidnight = new Date("2026-11-21T07:59:00.000Z")
    assert.equal(todayPacific(beforePTMidnight), "2026-11-20")
    // 2026-11-21 08:00 UTC = Nov 21 00:00 PST
    const atPTMidnight = new Date("2026-11-21T08:00:00.000Z")
    assert.equal(todayPacific(atPTMidnight), "2026-11-21")
  })
})

describe("DST transitions (America/Los_Angeles)", () => {
  it("uses PDT (-07:00) in summer", () => {
    // 2026-07-15
    assert.equal(pacificOffsetAtDate("2026-07-15"), "-07:00")
    const midnight = zonedMidnightUTC("2026-07-15")
    assert.equal(midnight.toISOString(), "2026-07-15T07:00:00.000Z")
  })

  it("uses PST (-08:00) in November", () => {
    assert.equal(pacificOffsetAtDate("2026-11-20"), "-08:00")
    const midnight = zonedMidnightUTC("2026-11-20")
    assert.equal(midnight.toISOString(), "2026-11-20T08:00:00.000Z")
  })

  it("spring forward 2026-03-08: midnight still -08:00; next day after spring is -07:00", () => {
    // US spring forward 2026: 2026-03-08 02:00 → 03:00
    assert.equal(pacificOffsetAtDate("2026-03-08"), "-08:00")
    assert.equal(pacificOffsetAtDate("2026-03-09"), "-07:00")
  })

  it("fall back 2026-11-01: midnight still -07:00; next day after fall is -08:00", () => {
    // US fall back 2026: 2026-11-01 02:00 → 01:00
    assert.equal(pacificOffsetAtDate("2026-11-01"), "-07:00")
    assert.equal(pacificOffsetAtDate("2026-11-02"), "-08:00")
  })
})

describe("shopifyCreatedAtBounds", () => {
  it("emits Pacific offsets (not bare local / not UTC Z)", () => {
    const nov = shopifyCreatedAtBounds("2026-11-20", "2026-11-20")
    assert.equal(nov.createdAtMin, "2026-11-20T00:00:00-08:00")
    assert.equal(nov.createdAtMax, "2026-11-20T23:59:59-08:00")

    const jul = shopifyCreatedAtBounds("2026-07-04", "2026-07-05")
    assert.equal(jul.createdAtMin, "2026-07-04T00:00:00-07:00")
    assert.equal(jul.createdAtMax, "2026-07-05T23:59:59-07:00")
  })
})

describe("pacificDayInstantBounds", () => {
  it("covers the full Pacific day for new-customer comparisons", () => {
    const { start, end } = pacificDayInstantBounds("2026-11-20")
    assert.equal(start.toISOString(), "2026-11-20T08:00:00.000Z")
    assert.equal(end.toISOString(), "2026-11-21T07:59:59.999Z")
  })
})

describe("tripleWhaleTodayHour", () => {
  it("uses Pacific hour + 1, not UTC hour", () => {
    // 2026-11-20 16:10 PT = 00:10 UTC next day → Pacific hour 16 → todayHour 17
    const lateAfternoonPT = new Date("2026-11-21T00:10:00.000Z")
    assert.equal(pacificHour(lateAfternoonPT), 16)
    assert.equal(tripleWhaleTodayHour(lateAfternoonPT), 17)
    // UTC getHours would be 0 → todayHour 1 (wrong — truncates almost all of "today")
    assert.equal(lateAfternoonPT.getUTCHours() + 1, 1)
  })
})

describe("addDaysISO / eachDateInclusive / presets", () => {
  it("iterates calendar days without TZ drift", () => {
    assert.deepEqual(eachDateInclusive("2026-11-19", "2026-11-21"), [
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
    ])
    assert.equal(addDaysISO("2026-11-01", -1), "2026-10-31")
  })

  it("Month to Date uses Pacific today, not UTC", () => {
    const lateAfternoonPT = new Date("2026-11-21T00:10:00.000Z")
    const presets = pacificDatePresets(lateAfternoonPT)
    assert.equal(presets["Month to Date"].end, "2026-11-20")
    assert.equal(presets["Month to Date"].start, "2026-11-01")
    assert.equal(presets["Last 7d"].start, "2026-11-13")
  })
})
