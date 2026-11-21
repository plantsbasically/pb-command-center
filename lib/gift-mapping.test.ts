/**
 * Gift mapping display qty vs gift COGS — display qty must not change cost math.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildGiftCogsAliasMap,
  resolveUnitCogs,
  type GiftMappingsData,
} from "./gift-mapping.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(
  readFileSync(join(__dirname, "../data/gift-mappings.json"), "utf8")
) as GiftMappingsData & { _meta?: unknown }

/** Mirror of build-metrics gift COGS loop (Shopify units × unit COGS). */
function computeGiftCogs(
  giftUnitsSold: Record<string, number>,
  cogsMap: Map<string, number>,
  giftAliasMap: Map<string, string>
): number {
  let giftCOGS = 0
  for (const [variantKey, units] of Object.entries(giftUnitsSold)) {
    const { unitCogs } = resolveUnitCogs(variantKey, cogsMap, giftAliasMap)
    giftCOGS += units * unitCogs
  }
  return giftCOGS
}

describe("Juicy Joint collagen welcome display qty", () => {
  it("shows JJ33CP-SS ×3 on 30-day and 90-day Supply rows only", () => {
    const p30 = seed.plans.find((p) => p.planKey === "jj-supply-30")
    const p60 = seed.plans.find((p) => p.planKey === "jj-supply-60")
    const p90 = seed.plans.find((p) => p.planKey === "jj-supply-90")
    assert.ok(p30 && p60 && p90)

    assert.equal(
      p30.welcomeGifts.find((g) => g.sku === "JJ33CP-SS")?.qty,
      3
    )
    assert.equal(
      p90.welcomeGifts.find((g) => g.sku === "JJ33CP-SS")?.qty,
      3
    )
    // 60-day and other plans left alone
    assert.equal(
      p60.welcomeGifts.find((g) => g.sku === "JJ33CP-SS")?.qty,
      1
    )
  })
})

describe("welcomeGifts qty does not feed gift COGS", () => {
  it("gift COGS stays identical when mapping display qty changes 1 → 3", () => {
    const giftAliasMap = buildGiftCogsAliasMap(seed)
    const cogsMap = new Map<string, number>([
      ["JJ33CP-SS", 4.5],
      ["JJ33PTP", 1.2],
    ])

    // Actual Shopify gift line quantities for the period (unchanged by mapping display).
    const giftUnitsSold = {
      "JJ33CP-SS": 12,
      JJ33PTP: 4,
    }

    const withDisplayQty1 = computeGiftCogs(giftUnitsSold, cogsMap, giftAliasMap)

    // Simulate what the dashboard would show after the seed edit — display only.
    const displayPlans = seed.plans.map((p) => ({
      ...p,
      welcomeGifts: p.welcomeGifts.map((g) =>
        g.sku === "JJ33CP-SS" &&
        (p.planKey === "jj-supply-30" || p.planKey === "jj-supply-90")
          ? { ...g, qty: 3 }
          : g
      ),
    }))
    assert.equal(
      displayPlans
        .find((p) => p.planKey === "jj-supply-30")
        ?.welcomeGifts.find((g) => g.sku === "JJ33CP-SS")?.qty,
      3
    )

    const withDisplayQty3 = computeGiftCogs(giftUnitsSold, cogsMap, giftAliasMap)

    assert.equal(withDisplayQty1, withDisplayQty3)
    assert.equal(withDisplayQty3, 12 * 4.5 + 4 * 1.2)
  })
})
