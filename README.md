# pb-command-center

Plants Basically Profit Command Center

See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for TikTok Shop sourcing, contribution-margin formula, subscription → free-gift mapping, and the Loop analytics ingest pipeline.

## Env vars

| Variable | Purpose |
| --- | --- |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Dev Dashboard app client credentials (preferred) |
| `SHOPIFY_STORE_DOMAIN` | e.g. `plantsbasically.myshopify.com` (falls back to `SHOPIFY_STORE_URL`) |
| `SHOPIFY_ACCESS_TOKEN` | Legacy static Admin API token if client id/secret unset |
| `TRIPLEWHALE_API_KEY` | Triple Whale read API |
| `LOOP_API_KEY` | Loop Admin API — active subscribers + subscriber MRR |
| `LOOP_INGEST_SECRET` | Bearer secret for `POST /api/loop-metrics/ingest` and `GET /api/loop-metrics/status` |
| `DATABASE_URL` | Railway Postgres |

## Shopify auth

Prefer Dev Dashboard app client credentials (PB Agents API):

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_STORE_DOMAIN` (e.g. `plantsbasically.myshopify.com`; falls back to `SHOPIFY_STORE_URL`; `https://` and trailing slash optional)

Tokens are minted via `POST /admin/oauth/access_token` (`grant_type=client_credentials`), cached in memory, refreshed ~5 minutes before expiry, and retried once on Admin API 401.

Fallback: if client id/secret are unset, a static `SHOPIFY_ACCESS_TOKEN` (or legacy `SHOPIFY_PASSWORD`) is used as before.
