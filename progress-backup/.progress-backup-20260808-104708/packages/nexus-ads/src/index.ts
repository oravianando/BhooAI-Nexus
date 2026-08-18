export * from './types.js';
export * from './GaqlBuilder.js';
export * from './GoogleAdsClient.js';

import { GoogleAdsClient } from './GoogleAdsClient.js';
import { fetchTransport } from './fetchTransport.js';
import type { GoogleAdsConfig, HttpTransport } from './types.js';

/** Default fetch-based transport (Node >= 18). */
export { fetchTransport };

export interface CreateAdsOptions {
  transport?: HttpTransport;
  apiVersion?: string;
}

/** Build a Google Ads client. Throws at construction if required creds are missing. */
export function createGoogleAds(config: GoogleAdsConfig, opts: CreateAdsOptions = {}): GoogleAdsClient {
  return new GoogleAdsClient(config, opts.transport ?? fetchTransport, opts.apiVersion);
}