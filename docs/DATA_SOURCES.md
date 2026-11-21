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
trueContributionMargin = revenue − adSpend − realCOGS − netFulfillment − gatewayFees
```

| Component | Source |
| --- | --- |
| **Revenue** | Shopify order `subtotal_price` (gifts already $0 after discount) + TW Amazon gross sales + TW TikTok Shop gross sales |
| **Ad spend** | TW `blendedAds` |
| **Real COGS** | `cogs_variants` × units sold on Shopify line items, including free-gift lines; gift SKUs with $0 COGS resolve via `cogsAlias` (e.g. `JJ33CP-FREE` → `JJ33CP-SS`). Amazon/TikTok COGS estimated at Shopify rate. |
| **Net fulfillment** | 3PL cost (ShipFusion primary + manual backup) − Shopify shipping collected. Zero when no 3PL cost is available (avoids crediting shipping alone). |
| **Payment gateway fees** | TW `orders_table.payment_gateway_costs` (Shopify platform only, daily via SQL API). Fallback: summary-page `payment_gateway_costs`. See below. |

**Gift distortion fix:** TW treats gift retail as discounts. Here gift retail is **not** revenue; gift **COGS is included**. Digital gifts (app / ebook) stay $0 COGS.

Waterfall `contributionProfit` also subtracts Amazon fees, TikTok Shop fees, net fulfillment, and Shopify payment gateway fees. Amazon/TikTok marketplace fees are **not** double-counted into gateway fees (SQL filters `platform = 'Shopify'`).

## Payment gateway fees (Shopify)

| Choice | Detail |
| --- | --- |
| **Primary** | TW SQL `POST /api/v2/orcabase/api/sql` — `sum(payment_gateway_costs)` from `orders_table` grouped by `event_date` (shop-local / America/Los_Angeles), `platform = Shopify` |
| **Fallback** | TW summary-page metric `payment_gateway_costs` (“Payment Gateway Costs”) |
| **API fields** | `gatewayFees`, `gatewayFeesDaily`, `gatewayFeesSource` (`tw_sql` \| `tw_summary` \| `none`) |
| **Shopify Payments** | Imported **actuals** from Shopify into TW |
| **PayPal / other gateways** | **Estimates** from TW Cost Settings → Gateway Costs (percentage + flat fee) |
| **Not included** | Currency conversion fees; Amazon FBA/referral fees; TikTok Shop fees |

TW does **not** expose a public Cost Settings read API for gateway rates. Confirm PayPal / other non-Shopify-Payments rates in the Triple Whale UI (Cost Settings → Gateway Costs).

Implementation: `lib/gateway-fees.ts`.

## Fulfillment / ShipFusion (primary 3PL cost)

| Choice | Detail |
| --- | --- |
| **Primary** | ShipFusion REST API `https://api.shipfusion.com/v1` |
| **Auth** | Prefer header `X-SHIPFUSION-TOKEN` (confirmed in ShipFusion OpenAPI `securitySchemes`). If that returns 401/403, retry once with `Authorization: Bearer <token>` (portal docs mention Bearer as the newer credential style). Whichever mode succeeds is sticky for the process. |
| **Env** | `SHIPFUSION_API_KEY` (preferred) or `SHIPFUSION_API_TOKEN`. If missing, log and fall back to manual `fulfillment_invoices` only. |
| **List** | `GET /invoices?invoicePeriodStart=YYYYMM&invoicePeriodEnd=YYYYMM` (USD filter) |
| **Detail** | `GET /invoices/{id}?type=shipment` (paginated transactions) |
| **Daily grouping** | Prefer `billingTimestamp` → calendar date in `America/Los_Angeles`; else parse `billingDate` `YYYYMMDD`. |
| **Cache** | Closed months ~7d TTL; ranges that include the current month ~1h. Bounded concurrency (3) on per-invoice fetches. |

### Charge classification (per shipment transaction)

| API field | Category |
| --- | --- |
| `services` | `pickPack` |
| `shipping` | `shipping` |
| `packaging` | `packaging` |
| `insurance` | `insurance` |
| `tax` + any residual vs `total` | `other` |
| *(not on shipment invoices)* | `storage` — from manual invoices only |

### Precedence vs manual `fulfillment_invoices`

1. **ShipFusion wins** for `pickPack` / `shipping` / `packaging` / `insurance` / `other` on dates the API returns shipment charges.
2. **Manual storage always added** — labels matching `\bstorage\b` (case-insensitive) are classified as `storage` and included even when the API covers those days (storage is typically billed month-end and may not appear on shipment invoices).
3. **Non-storage manuals** fill only calendar days in the range with **no** ShipFusion coverage (pre-cutover / API gap). Amounts are day-prorated into `other`.
4. **Full manual fallback** when the API key is missing or the range has zero ShipFusion days (legacy Nice Commerce behaviour).

API response includes `fulfillmentSource` (`shipfusion` | `manual` | `mixed`) and `fulfillmentBreakdown` by category.

Net fulfillment for CM remains:

```
netFulfillmentCost = fulfillmentInvoiceTotal > 0
  ? fulfillmentInvoiceTotal − shippingCollected
  : 0
```

### `daily_metrics` (persisted Pacific rollups)

See [DAILY_METRICS.md](./DAILY_METRICS.md). Dashboard date ranges **sum** stored rows (ratios from totals). Includes fulfillment category breakdown + `shipfusion_fulfillment_cost` (net) used in CM and shown as **ShipFusion fulfillment** on the dashboard.

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
| `GET` | `/api` | Basic auth — optional additive `loopMetrics` summary (`sum` of new/reactivated/resumed in range); includes `ltvCac` meta (see below) |

### LTV:CAC (dashboard)

| Piece | Source |
| --- | --- |
| **LTV** | Customer-weighted mean of Loop `loop_ltv_snapshot` **subscriber** segments (`Order1Subscriber` … `Order4AndMoreSubscriber`) from the latest snapshot. Fallback: Triple Whale `uniqueCustomerSales`. |
| **CAC** | Shopify-attributable ad spend ÷ Shopify new customers. Attributable spend = blended ads − Amazon Ads − TikTok ads (no reliable new-customer counts for those channels). |
| **Target** | `TARGET_LTV_CAC = 3.0` (green at/above). Warning/red below `LTV_CAC_WARNING = 1.5`. |
| **CM** | Unchanged — contribution margin still uses **full blended** ad spend. |

API response includes `ltvCac` (`explainTooltip`, `ltvHint`, `cacHint`, snapshot date, segments). See `lib/ltv-cac.ts`.

### Cohort retention + projection (dashboard)

`GET /api` also returns `cohortProjection` built from the latest `loop_cohort_retention` monthly snapshot (`lib/cohort-projection.ts` / `lib/cohort-dashboard.ts`):

- Observed cells: `day_30` / `day_60` / `day_90` (and order metrics when present).
- Projected cells: `day_120`…`day_360` (and missing later days on young cohorts), styled dashed in the UI.
- Decay: average `day60/day30` and `day90/day60` across mature cohorts; forward months multiply by that blended step. Active ≈ size × retention%; revenue ≈ active × Loop subscriber $/customer.
- Does **not** change CM.

### Time to second order (dashboard)

Cached in `second_order_stats` (not computed on page load):

| Piece | Detail |
| --- | --- |
| Refresh | `POST/GET /api/second-order/refresh` — Bearer `SECOND_ORDER_CRON_SECRET` or `DAILY_METRICS_CRON_SECRET`. Default **202 async** background job (poll `?status=1`); `?sync=1` awaits. |
| Source | Shopify via `fetchOrdersWindowed` (15-day chunks, uncapped per chunk, 500ms page delay, 429/THROTTLED exponential backoff) |
| Window | First orders in last N Pacific days (`SHOPIFY_SECOND_ORDER_LOOKBACK_DAYS`, default 180). Payload stores `coveredFrom`/`coveredTo`/`ordersFetched`. |
| Rates | 30/60/90% use **eligible** denominator (first order ≥ N days before as-of) |
| Output | Histogram buckets, cumulative repeat %, median days; subscriber vs one-time split via source/tags heuristics |

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
