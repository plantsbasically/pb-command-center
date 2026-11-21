/**
 * Persisted Loop active-subscriber / MRR cache.
 *
 * Page load must NEVER block on the Loop Admin API page scan (~20s cold).
 * Reads come from `loop_live_cache` (or latest `loop_daily_metrics` row as
 * fallback). The daily-metrics refresh job writes this table in the background.
 */

import type { LoopData } from "./loop"

export async function getCachedLoopData(): Promise<LoopData> {
  try {
    const { getDb } = await import("./db")
    const sql = await getDb()

    const [live] = await sql`
      SELECT active_subscribers, subscriber_mrr
      FROM loop_live_cache
      WHERE id = 1
    `
    if (live) {
      return {
        activeSubscribers: Number(live.active_subscribers) || 0,
        subscriberMRR: Number(live.subscriber_mrr) || 0,
      }
    }

    // Fallback: latest ingested daily row that has active counts / MRR
    const [daily] = await sql`
      SELECT active_subscribers, mrr
      FROM loop_daily_metrics
      WHERE active_subscribers IS NOT NULL OR mrr IS NOT NULL
      ORDER BY date DESC
      LIMIT 1
    `
    if (daily) {
      return {
        activeSubscribers: daily.active_subscribers == null ? 0 : Number(daily.active_subscribers),
        subscriberMRR: daily.mrr == null ? 0 : Number(daily.mrr),
      }
    }
  } catch (err: any) {
    console.warn("getCachedLoopData failed:", err?.message)
  }
  return { activeSubscribers: 0, subscriberMRR: 0 }
}

/** Upsert the single-row live Loop cache (called from refresh job). */
export async function saveLoopLiveCache(
  data: LoopData,
  source = "loop_admin_api"
): Promise<void> {
  const { getDb } = await import("./db")
  const sql = await getDb()
  await sql`
    INSERT INTO loop_live_cache (id, active_subscribers, subscriber_mrr, source, updated_at)
    VALUES (1, ${data.activeSubscribers}, ${data.subscriberMRR}, ${source}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      active_subscribers = EXCLUDED.active_subscribers,
      subscriber_mrr = EXCLUDED.subscriber_mrr,
      source = EXCLUDED.source,
      updated_at = NOW()
  `
}

/**
 * Refresh Loop live cache via Admin API scan. Safe to call from cron —
 * never throws; logs and keeps prior cache on failure.
 */
export async function refreshLoopLiveCache(): Promise<LoopData> {
  try {
    const { fetchLoopData } = await import("./loop")
    const data = await fetchLoopData()
    if (data.activeSubscribers > 0 || data.subscriberMRR > 0) {
      await saveLoopLiveCache(data, "loop_admin_api")
    }
    return data
  } catch (err: any) {
    console.error("refreshLoopLiveCache failed:", err?.message)
    return getCachedLoopData()
  }
}
