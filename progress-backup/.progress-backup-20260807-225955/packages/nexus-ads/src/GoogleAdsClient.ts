import type { GoogleAdsConfig, HttpTransport, AdsRow, Campaign } from './types.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Google Ads REST client (no grpc/native deps). Uses the Google Ads API REST
 * endpoint `googleAds:search` with GAQL. OAuth2 access tokens are acquired via
 * the refresh-token grant and cached until near expiry. The HTTP transport is
 * injectable so tests run without live credentials.
 */
export class GoogleAdsClient {
  private readonly cfg: GoogleAdsConfig;
  private readonly transport: HttpTransport;
  private readonly apiVersion: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(cfg: GoogleAdsConfig, transport: HttpTransport, apiVersion = 'v17') {
    this.cfg = cfg;
    this.transport = transport;
    this.apiVersion = apiVersion;
    if (!cfg.developerToken || !cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
      throw new Error('[nexus-ads] developerToken, clientId, clientSecret, refreshToken all required');
    }
  }

  private baseUrl(): string {
    return `https://googleads.googleapis.com/${this.apiVersion}`;
  }

  /** OAuth2 refresh-token → access token, cached with a 60s safety margin. */
  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: this.cfg.refreshToken,
      grant_type: 'refresh_token',
    }).toString();
    const res = await this.transport({
      method: 'POST',
      url: TOKEN_URL,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const parsed = safeJson(res.body);
    if (res.status !== 200 || !parsed?.access_token) {
      throw new Error(`[nexus-ads] token refresh failed: HTTP ${res.status} ${res.body}`);
    }
    this.token = { value: parsed.access_token, expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async searchHeaders(): Promise<Record<string, string>> {
    return {
      authorization: `Bearer ${await this.accessToken()}`,
      'developer-token': this.cfg.developerToken,
      'content-type': 'application/json',
      ...(this.cfg.loginCustomerId ? { 'login-customer-id': normalizeId(this.cfg.loginCustomerId) } : {}),
    };
  }

  /** Run a GAQL query against a customer and return all rows (handles pagination). */
  async search(customerId: string, query: string): Promise<AdsRow[]> {
    const headers = await this.searchHeaders();
    let pageToken: string | undefined;
    const rows: AdsRow[] = [];
    do {
      const body = JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) });
      const res = await this.transport({
        method: 'POST',
        url: `${this.baseUrl()}/customers/${normalizeId(customerId)}/googleAds:search`,
        headers,
        body,
      });
      const parsed = safeJson(res.body);
      if (res.status !== 200) {
        throw new Error(`[nexus-ads] search failed: HTTP ${res.status} ${res.body}`);
      }
      if (Array.isArray(parsed?.results)) rows.push(...parsed.results);
      pageToken = parsed?.nextPageToken;
    } while (pageToken);
    return rows;
  }

  /** List campaigns on the default customer. */
  async listCampaigns(customerId = this.cfg.customerId, limit = 50): Promise<Campaign[]> {
    const rows = await this.search(customerId, listCampaignsGaql(limit));
    return rows.map(rowToCampaign);
  }

  /** Campaign metrics for a date range (YYYY-MM-DD). */
  async campaignMetrics(fromDate: string, toDate: string, customerId = this.cfg.customerId, limit = 50): Promise<AdsRow[]> {
    const rows = await this.search(customerId, metricsGaql(fromDate, toDate, limit));
    return rows;
  }
}

function listCampaignsGaql(limit: number): string {
  return `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign ORDER BY campaign.id LIMIT ${limit}`;
}
function metricsGaql(from: string, to: string, limit: number): string {
  return `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date >= '${from}' AND segments.date <= '${to}' ORDER BY campaign.id LIMIT ${limit}`;
}

function rowToCampaign(row: AdsRow): Campaign {
  const c = (row.campaign ?? {}) as Record<string, unknown>;
  return {
    id: String(c.id ?? ''),
    name: String(c.name ?? ''),
    status: String(c.status ?? ''),
    advertisingChannelType: c.advertisingChannelType != null ? String(c.advertisingChannelType) : undefined,
  };
}

function normalizeId(id: string): string {
  return id.replace(/-/g, '');
}

function safeJson(body: string): any {
  try { return JSON.parse(body); } catch { return undefined; }
}