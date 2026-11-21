# pb-command-center

Plants Basically Profit Command Center

See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for TikTok Shop sourcing, contribution-margin formula, ShipFusion fulfillment, payment gateway fees, subscription → free-gift mapping, and the Loop analytics ingest pipeline.

See [docs/DAILY_METRICS.md](docs/DAILY_METRICS.md) for the Pacific `daily_metrics` table, cron/backfill, and range summing.

## Env vars

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Preferred Shopify Admin auth (client credentials) |
| `SHOPIFY_STORE_DOMAIN` | Shop host (falls back to `SHOPIFY_STORE_URL`) |
| `SHOPIFY_ACCESS_TOKEN` | Legacy static Admin token if client credentials unset |
| `TRIPLEWHALE_API_KEY` | Triple Whale summary metrics + gateway fee SQL |
| `LOOP_API_KEY` | Loop Admin API — active subscribers + subscriber MRR |
| `LOOP_INGEST_SECRET` | Bearer secret for `POST /api/loop-metrics/ingest` and `GET /api/loop-metrics/status` |
| `DAILY_METRICS_CRON_SECRET` | Bearer secret for `POST/GET /api/daily-metrics/refresh` |
| `DAILY_METRICS_INPROCESS_SCHEDULER` | Set `0` to disable in-process 12m ticker |
| `SHIPFUSION_API_KEY` | ShipFusion billing (primary 3PL cost). Alias: `SHIPFUSION_API_TOKEN` |
| `DATABASE_URL` | Postgres (COGS, fixed costs, daily_metrics, Loop metrics, …) |

## Shopify auth

Prefer Dev Dashboard app client credentials (PB Agents API):

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_STORE_DOMAIN` (e.g. `plantsbasically.myshopify.com`; falls back to `SHOPIFY_STORE_URL`; `https://` and trailing slash optional)

Tokens are minted via `POST /admin/oauth/access_token` (`grant_type=client_credentials`), cached in memory, refreshed ~5 minutes before expiry, and retried once on Admin API 401.

Fallback: if client id/secret are unset, a static `SHOPIFY_ACCESS_TOKEN` (or legacy `SHOPIFY_PASSWORD`) is used as before.

## ShipFusion fulfillment

Primary fulfillment cost source. Auth header `X-SHIPFUSION-TOKEN` (OpenAPI); Bearer fallback on 401/403. Manual `fulfillment_invoices` remain for storage fees and uncovered days — see DATA_SOURCES.md for precedence.
