/**
 * Shopify orders list query string + second-order onChunk TDZ contract.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildOrdersListQueryString, dateRangeChunks } from "./shopify.ts"
import { pacificDayInstantBounds } from "./dates.ts"
import { makeSecondOrderChunkProgressHandler } from "./second-order.ts"

describe("buildOrdersListQueryString", () => {
  it("encodes status=any, limit, and UTC Z created_at bounds with encodeURIComponent", () => {
    const min = "2026-05-25T07:00:00.000Z"
    const max = "2026-06-09T06:59:59.999Z"
    const qs = buildOrdersListQueryString(min, max)
    assert.match(qs, /^status=any&limit=250&/)
    assert.ok(qs.includes(`created_at_min=${encodeURIComponent(min)}`))
    assert.ok(qs.includes(`created_at_max=${encodeURIComponent(max)}`))
    assert.equal(qs.includes("created_at_min=2026-05-25T07:00:00.000Z"), false)
    assert.ok(qs.includes("2026-05-25T07%3A00%3A00.000Z"))
  })

  it("encodes + timezone offsets as %2B (never left raw for form +/space pitfalls)", () => {
    const min = "2026-01-15T08:00:00+00:00"
    const qs = buildOrdersListQueryString(min, min)
    assert.ok(qs.includes("%2B00%3A00"))
    assert.equal(qs.includes("T08:00:00+00"), false)
  })

  it("matches Pacific day instant bounds for a May PDT chunk", () => {
    const start = "2026-05-25"
    const end = "2026-06-08"
    const createdAtMin = pacificDayInstantBounds(start).start.toISOString()
    const createdAtMax = pacificDayInstantBounds(end).end.toISOString()
    assert.equal(createdAtMin, "2026-05-25T07:00:00.000Z")
    assert.equal(createdAtMax, "2026-06-09T06:59:59.999Z")
    assert.ok(createdAtMin < createdAtMax)
    const qs = buildOrdersListQueryString(createdAtMin, createdAtMax)
    assert.ok(qs.includes("status=any"))
    assert.ok(qs.includes(encodeURIComponent(createdAtMin)))
  })
})

describe("dateRangeChunks", () => {
  it("covers full lookback without gaps", () => {
    const chunks = dateRangeChunks("2026-05-25", "2026-11-21", 15)
    assert.equal(chunks[0].start, "2026-05-25")
    assert.equal(chunks[chunks.length - 1].end, "2026-11-21")
    assert.ok(chunks.length >= 12)
    for (let i = 1; i < chunks.length; i++) {
      const [y, m, d] = chunks[i - 1].end.split("-").map(Number)
      const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
      assert.equal(chunks[i].start, next)
    }
  })
})

describe("second-order onChunk TDZ", () => {
  it("throws ReferenceError if onChunk closes over destructured coveredFrom (prod bug)", async () => {
    async function fakeWindowed(onChunk: () => Promise<void>) {
      await onChunk()
      return { coveredFrom: "2026-05-25", coveredTo: "2026-06-08" }
    }

    await assert.rejects(
      async () => {
        const pending = fakeWindowed(async () => {
          void coveredFrom
        })
        const { coveredFrom } = await pending
        return coveredFrom
      },
      (err: any) =>
        err instanceof ReferenceError &&
        /before initialization|Cannot access/.test(String(err.message))
    )
  })

  it("makeSecondOrderChunkProgressHandler uses windowStart during in-flight chunks", async () => {
    const writes: any[] = []
    const handler = makeSecondOrderChunkProgressHandler({
      asOfDate: "2026-11-21",
      lookbackDays: 180,
      windowStart: "2026-05-25",
      startedAt: "2026-11-21T00:00:00.000Z",
      writeProgress: async (partial) => {
        writes.push(partial)
      },
    })

    // Called as fetchOrdersWindowed would — before outer const { coveredFrom } exists.
    await handler({
      chunkStart: "2026-05-25",
      chunkEnd: "2026-06-08",
      chunkIndex: 1,
      chunkCount: 13,
      ordersInChunk: 0,
      ordersTotal: 0,
      createdAtMin: "2026-05-25T07:00:00.000Z",
      createdAtMax: "2026-06-09T06:59:59.999Z",
    })

    assert.equal(writes.length, 1)
    assert.equal(writes[0].coveredFrom, "2026-05-25")
    assert.equal(writes[0].coveredTo, "2026-06-08")
    assert.equal(writes[0].progress.coveredFrom, "2026-05-25")
    assert.equal(writes[0].ordersFetched, 0)
  })
})
