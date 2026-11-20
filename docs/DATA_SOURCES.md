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
