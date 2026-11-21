# Daily metrics (Pacific rollups)

Persisted P&L per **America/Los_Angeles** calendar day so date-range switching is near-instant.

## Table: `daily_metrics`

| Column | Notes |
| --- | --- |
| `date` | PK — Pacific business day |
| `revenue`, `shopify_revenue`, `amazon_revenue`, `tiktok_revenue` | Additive |
| `cogs` (+ channel splits), `gift_cogs` | Additive |
| `ad_spend` + per-channel | Additive |
| `gateway_fees` | Shopify payment gateway (TW) |
| `fulfillment_gross` | 3PL before customer shipping |
| `shipfusion_fulfillment_cost` | **Net** fulfillment (same term used in CM) |
| `fulfillment_pick_pack` / `_shipping` / `_packaging` / `_insurance` / `_storage` / `_other` | Category breakdown for UI |
| `fulfillment_source` | `shipfusion` \| `manual` \| `mixed` |
| `contribution_margin` | true CM for that day |
| `orders_count`, `new_customers`, … | Additive dashboard fields |
| `discount_*` | Display-only; never in CM |
| `status` | `in_progress` (today) \| `complete` |
| `updated_at` | Last refresh |

Schema is created in `lib/db.ts` `ensureSchema` (same advisory-lock pattern as Loop tables).

Also: `loop_live_cache` (single row) holds active subscribers + MRR so page load never scans Loop Admin API.

## Env

| Variable | Purpose |
| --- | --- |
| `DAILY_METRICS_CRON_SECRET` | Bearer token for `POST/GET /api/daily-metrics/refresh` |
| `DAILY_METRICS_INPROCESS_SCHEDULER` | Set to `0` to disable the in-process 12‑minute ticker (external Railway cron only) |
| `DATABASE_URL` | Required |

## Scheduling (pick one or both)

### A) Railway Cron (recommended)

Create a Railway cron job (or separate cron service) that hits:

```http
POST https://<your-app>/api/daily-metrics/refresh
Authorization: Bearer ${DAILY_METRICS_CRON_SECRET}
Content-Type: application/json

{"mode":"cron"}
```

Suggested cadence: **every 10–15 minutes**.

### B) In-process scheduler

When `DAILY_METRICS_CRON_SECRET` is set and `DAILY_METRICS_INPROCESS_SCHEDULER` is not `0`, `instrumentation.ts` starts a ~12‑minute ticker on Node boot. Concurrent runs are safe via `pg_try_advisory_lock(872014002)`.

### What cron refreshes

- **Today (PT)** — always, `status=in_progress`
- **Yesterday (PT)** — while hour &lt; 6 PT, and once more around 6 PT to mark `complete`
- **Loop live cache** — background Admin API scan (does not block the dashboard)

## Backfill (last 90 days)

One-shot after deploy:

```bash
curl -X POST "https://<your-app>/api/daily-metrics/refresh" \
  -H "Authorization: Bearer $DAILY_METRICS_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode":"backfill","days":90}'
```

Idempotent: days already `complete` are skipped unless `"force": true`. Today is always written as `in_progress`. Backfill can take many minutes (Shopify + TW + ShipFusion per day) — `maxDuration` is 300s; for large gaps, re-run (skips completes) or use smaller `days` windows.

## Dashboard read path

`GET /api?start&end` sums `daily_metrics` rows for the Pacific range. Ratios (CM %, ROAS, AOV, CAC) are computed from **summed totals**, never averaged. Missing days are live-computed and upserted on demand. `?live=1` forces the legacy full live path. `?bust=1` re-refreshes today.

**Discounts remain display-only** and are never subtracted from revenue or CM.

## ShipFusion note (10k page cap)

Invoice shipment listing previously stopped at 100 pages × 100 = **10,000** transactions. Busy months can exceed that; if the API returns oldest-first, **newest days could be under-counted**. The client now:

- Raises the safety cap to 500 pages
- For narrow ranges (≤3 days, e.g. cron today/yesterday), prefers fetching **newest pages first**

Cost classification math is unchanged.
