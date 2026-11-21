/**
 * Apply Loop LTV + Shopify-attributable CAC onto a MetricsResult.
 * CM fields are left untouched.
 */

import type { MetricsResult } from "./calculations"
import type { ChannelSpend } from "./triplewhale"
import {
  buildLtvCacResult,
  computeLoopLtv,
  type LtvCacResult,
} from "./ltv-cac"

export async function applyLtvCacToMetrics(
  metrics: MetricsResult,
  opts: {
    totalAdSpend: number
    channelSpend: ChannelSpend | Partial<ChannelSpend>
    shopifyNewCustomers: number
    twLtvFallback: number
  }
): Promise<{ metrics: MetricsResult; ltvCac: LtvCacResult }> {
  let loopComputed = null
  try {
    const { getLatestLoopLtvSnapshot } = await import("./loop-metrics")
    const snap = await getLatestLoopLtvSnapshot()
    if (snap?.rows?.length) {
      loopComputed = computeLoopLtv(snap.rows, snap.snapshotDate)
    }
  } catch (err: any) {
    console.warn("Loop LTV snapshot unavailable:", err?.message)
  }

  const ltvCac = buildLtvCacResult({
    totalAdSpend: opts.totalAdSpend,
    channelSpend: opts.channelSpend,
    shopifyNewCustomers: opts.shopifyNewCustomers,
    loopLtv: loopComputed,
    twLtvFallback: opts.twLtvFallback,
  })

  return {
    metrics: {
      ...metrics,
      // Keep newCustomers as Shopify count (documented in ltvCac)
      cac: ltvCac.cac,
      ltv: ltvCac.ltv,
      ltvCacRatio: ltvCac.ratio,
    },
    ltvCac,
  }
}

/** Sync apply when Loop LTV is already loaded (range-sum path). */
export function applyLtvCacToMetricsSync(
  metrics: MetricsResult,
  opts: {
    totalAdSpend: number
    channelSpend: ChannelSpend | Partial<ChannelSpend>
    shopifyNewCustomers: number
    twLtvFallback: number
    loopLtv: ReturnType<typeof computeLoopLtv> | null
  }
): { metrics: MetricsResult; ltvCac: LtvCacResult } {
  const ltvCac = buildLtvCacResult({
    totalAdSpend: opts.totalAdSpend,
    channelSpend: opts.channelSpend,
    shopifyNewCustomers: opts.shopifyNewCustomers,
    loopLtv: opts.loopLtv,
    twLtvFallback: opts.twLtvFallback,
  })
  return {
    metrics: {
      ...metrics,
      cac: ltvCac.cac,
      ltv: ltvCac.ltv,
      ltvCacRatio: ltvCac.ratio,
    },
    ltvCac,
  }
}
