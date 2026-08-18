/** Injectable HTTP transport so the client is testable without live Google creds. */
export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface HttpResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}
export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

/** Google Ads config as it appears in nexus.config.ts `ads`. */
export interface GoogleAdsConfig {
  enabled: boolean;
  /** Google Ads API developer token. */
  developerToken: string;
  /** OAuth2 client credentials. */
  clientId: string;
  clientSecret: string;
  /** OAuth2 refresh token (long-lived). */
  refreshToken: string;
  /** Login customer ID (MCC account, hyphenated or plain). Required for MCC. */
  loginCustomerId?: string;
  /** Default customer ID to query. */
  customerId: string;
}

/** Minimal campaign shape from `campaign` resource. */
export interface Campaign {
  id: string;
  name: string;
  status: string;
  advertisingChannelType?: string;
  budget?: { amountMicros?: string };
}

/** A row from a GAQL search: a record mapping resource name → fields. */
export type AdsRow = Record<string, unknown>;