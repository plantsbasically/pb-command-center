# Data sources (PB Command Center)

All profit logic lives in this app. **Triple Whale is read-only** — we never change how TW calculates.

## TikTok Shop revenue (bar chart + blended revenue)

| Choice | Detail |
| --- | --- |
| **Primary** | Triple Whale summary metric `tiktokShopsGrossSales` (“TikTok Shop Gross Sales”) |
| **Why** | Parallels Amazon’s `amazonProductItemPrice` (gross product sales). TW has a dedicated TikTok Shop integration with orders, fees, and net sales. |
| **Also captured** | `tiktokShopsSales` (order revenue), `tiktokShopsOrders`, `tiktokShopsFees` |
| **Shopify?** | **Not used for TikTok revenue.** Investigated `source_name` values: `3890849` is the **Shop** app (Shop Cash), not TikTok. No TikTok Shop orders appear in Shopify Admin for this store. A defensive Shopify detector remains for future syncs (`tiktokShopifyRevenue` cross-check; expected ~0). |
| **COGS** | Estimated at the Shopify blended COGS rate (same method as Amazon). |

## Contribution margin (hero)

```
trueContributionMargin = revenue − adSpend − realCOGS
```

| Component | Source |
| --- | --- |
| **Revenue** | Shopify order `subtotal_price` (gifts already $0 after discount) + TW Amazon gross sales + TW TikTok Shop gross sales |
| **Ad spend** | TW `blendedAds` |
| **Real COGS** | `cogs_variants` × units sold on Shopify line items, including free-gift lines; gift SKUs with $0 COGS resolve via `cogsAlias` (e.g. `JJ33CP-FREE` → `JJ33CP-SS`). Amazon/TikTok COGS estimated at Shopify rate. |

**Gift distortion fix:** TW treats gift retail as discounts. Here gift retail is **not** revenue; gift **COGS is included**. Digital gifts (app / ebook) stay $0 COGS.

The existing waterfall `contributionProfit` (after fulfillment net + marketplace fees) is unchanged aside from including TikTok fees when present.

## Subscription → free gift mapping

- Config seed: `data/gift-mappings.json`
- DB table: `subscription_gift_mappings` (single JSON row, editable via admin `updateGiftMappings`)
- Seeded from Shopify 100%-discounted `_bundle_parent` child lines + Notion SOP / CS guide (Oct 2026)
- Statuses: `confirmed` | `inferred` | `todo` — TODOs are for Kyle to confirm

## Discounts (information-only)

`discountStats` is computed from the same Shopify REST orders already paged for revenue (fields: `total_discounts`, `discount_applications`, `discount_codes`, `line_items[].discount_allocations`). **Never subtracted from revenue or used in CM / net profit.**

| Category | How classified |
| --- | --- |
| **Free gifts** | Allocations on gift line items, or apps titled “Free Welcome Gift” |
| **Subscription** | Automatic apps titled `SAVE 25%` / `SAVE 30%` / `SAVE 35%` (Loop selling-plan markdowns on PB) plus subscription-worded titles |
| **Promotional** | `discount_code` apps + other non-gift, non-subscription markdowns on **paid** lines only |

Shopify Analytics **Discounts** typically equals order `total_discounts` and **includes** gift 100%-offs + SAVE% subscription markdowns — that is the distortion the promo split corrects for display.

## Loop analytics pipeline (ingest)

Loop MCP analytics (new subscribers by day, cohort retention, LTV) are only reachable from an external assistant. That assistant runs a daily job (~5 AM PT) and **POSTs** snapshots into this app. The dashboard then reads from Postgres.

### Tables

| Table | Key | Purpose |
| --- | --- | --- |
| `loop_daily_metrics` | `date` | Daily new / reactivated / resumed (+ optional churned, active counts, MRR) |
| `loop_cohort_retention` | `(cohort_start, cohort_granularity, metric, snapshot_date)` | Cohort retention % (+ optional LTV) per snapshot |
| `loop_ltv_snapshot` | `(snapshot_date, segment)` | LTV table rows (customers, revenue/customer) |

Schema is created idempotently in `lib/db.ts` `ensureSchema` under a Postgres advisory lock (avoids concurrent `CREATE` races on cold start).

### Env

| Var | Required | Notes |
| --- | --- | --- |
| `LOOP_INGEST_SECRET` | Yes for ingest | Bearer token for `POST /api/loop-metrics/ingest` and `GET /api/loop-metrics/status`. Requests are rejected if unset. |
| `LOOP_API_KEY` | For live Loop Admin API | Active subscriber count + subscriber MRR (`lib/loop.ts`) |
| `DATABASE_URL` | Yes | Railway Postgres |

### Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/loop-metrics/ingest` | `Authorization: Bearer ${LOOP_INGEST_SECRET}` (excluded from basic-auth middleware) |
| `GET` | `/api/loop-metrics/status` | Same Bearer secret — latest dates + missing daily dates (last 90 days) for backfill |
| `GET` | `/api/loop-metrics?start&end` | Basic auth — daily rows for range + latest cohort/LTV snapshots |
| `GET` | `/api` | Basic auth — optional additive `loopMetrics` summary (`sum` of new/reactivated/resumed in range); existing fields unchanged |

### Example ingest payload

```json
{
  "daily": [
    {
      "date": "2026-11-19",
      "newSubscribers": 42,
      "reactivated": 5,
      "resumed": 3,
      "churned": 8,
      "activeSubscribers": 11000,
      "activeSubscriptions": 11683,
      "mrr": 588000,
      "source": "loop-mcp"
    }
  ],
  "cohorts": [
    {
      "cohortStart": "2026-09-01",
      "cohortGranularity": "month",
      "cohortSize": 320,
      "metric": "day_30",
      "valuePct": 71.25,
      "ltv": 148.5,
      "snapshotDate": "2026-11-19"
    },
    {
      "cohortStart": "2026-09-01",
      "cohortGranularity": "month",
      "cohortSize": 320,
      "metric": "order_2",
      "valuePct": 55.0,
      "snapshotDate": "2026-11-19"
    }
  ],
  "ltv": [
    {
      "snapshotDate": "2026-11-19",
      "segment": "all_subscribers",
      "customers": 15000,
      "revenuePerCustomer": 210.4
    }
  ]
}
```

Snake_case aliases (`new_subscribers`, `cohort_start`, …) are accepted. Upserts are idempotent on primary keys. Response: `{ "ok": true, "upserted": { "daily": N, "cohorts": N, "ltv": N } }`.

### Subscriber MRR (`lib/loop.ts`)

Live MRR is computed by paging `GET /subscription/?status=ACTIVE` (`pageSize=100`, **2 req / 3 s**) and summing each subscription’s `totalLineItemDiscountedPrice` normalized to monthly:

| `billingPolicy.interval` | Formula |
| --- | --- |
| `MONTH` (default if missing) | `price / intervalCount` |
| `YEAR` | `price / (12 × intervalCount)` |
| `WEEK` | `price × (30/7) / intervalCount` |
| `DAY` | `price × 30 / intervalCount` |

`deliveryPrice` is **excluded**. Prepaid contracts still use `billingPolicy` normalization; Loop’s own Active MRR uses line-level MRR excluding `isOneTimeAdded` lines, so ours may differ slightly from Loop’s reference (~$588K with ~11,683 active subscriptions). Result cached **1 hour**; **401/auth failures** cache zeros for ~**5 minutes** only so a fixed `LOOP_API_KEY` takes effect quickly.
