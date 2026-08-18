# @bhooai/nexus-ads

Google Ads API client: OAuth2, campaigns, and a GAQL (Google Ads Query Language)
reporting builder.

## Exports

- `createGoogleAds(config, opts)` → `GoogleAdsClient`.
- **GaqlBuilder** — build reporting queries fluently.
- `fetchTransport` — the authenticated transport helper.
- Types for campaigns, reporting, and config.

OAuth2 credentials are configured via `NEXUS_ADS_*` / `nexus.config.ts`. Tests mock
the HTTP transport (no live Google Ads calls).