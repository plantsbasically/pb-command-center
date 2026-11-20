# pb-command-center

Plants Basically Profit Command Center

See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for TikTok Shop sourcing, contribution-margin formula, and subscription → free-gift mapping.

## Shopify auth

Prefer Dev Dashboard app client credentials (PB Agents API):

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_STORE_DOMAIN` (e.g. `plantsbasically.myshopify.com`; falls back to `SHOPIFY_STORE_URL`; `https://` and trailing slash optional)

Tokens are minted via `POST /admin/oauth/access_token` (`grant_type=client_credentials`), cached in memory, refreshed ~5 minutes before expiry, and retried once on Admin API 401.

Fallback: if client id/secret are unset, a static `SHOPIFY_ACCESS_TOKEN` (or legacy `SHOPIFY_PASSWORD`) is used as before.
