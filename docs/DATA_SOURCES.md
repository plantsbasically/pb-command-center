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
trueContributionMargin = revenue − adSpend − realCOGS − gatewayFees
```

| Component | Source |
| --- | --- |
| **Revenue** | Shopify order `subtotal_price` (gifts already $0 after discount) + TW Amazon gross sales + TW TikTok Shop gross sales |
| **Ad spend** | TW `blendedAds` |
| **Real COGS** | `cogs_variants` × units sold on Shopify line items, including free-gift lines; gift SKUs with $0 COGS resolve via `cogsAlias` (e.g. `JJ33CP-FREE` → `JJ33CP-SS`). Amazon/TikTok COGS estimated at Shopify rate. |
| **Payment gateway fees** | TW `orders_table.payment_gateway_costs` (Shopify platform only, daily via SQL API). Fallback: summary-page `payment_gateway_costs`. See below. |

**Gift distortion fix:** TW treats gift retail as discounts. Here gift retail is **not** revenue; gift **COGS is included**. Digital gifts (app / ebook) stay $0 COGS.

Waterfall `contributionProfit` also subtracts fulfillment net, Amazon fees, TikTok Shop fees, and Shopify payment gateway fees. Amazon/TikTok marketplace fees are **not** double-counted into gateway fees (SQL filters `platform = 'Shopify'`).

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

Implementation: `lib/gateway-fees.ts` (isolated module to ease merges with fulfillment work).

## TODO — `daily_metrics` table

`daily_metrics` does **not** exist yet in Postgres. When added, include a **`gateway_fees`** numeric column (daily Shopify payment gateway costs from TW) alongside other persisted daily P&L fields.

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
