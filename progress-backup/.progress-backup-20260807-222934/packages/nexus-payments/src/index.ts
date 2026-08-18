export * from './types.js';
export * from './errors.js';
export * from './http.js';
export * from './signature.js';
export * from './providers/RazorpayProvider.js';
export * from './providers/PayPalProvider.js';
export * from './providers/PayUProvider.js';
export * from './providers/SkrillProvider.js';
export * from './providers/PayoneerProvider.js';
export * from './webhooks.js';

import type { PaymentProvider, HttpTransport, ProviderConfig } from './types.js';
import { fetchTransport } from './http.js';
import { RazorpayProvider } from './providers/RazorpayProvider.js';
import { PayPalProvider } from './providers/PayPalProvider.js';
import { PayUProvider } from './providers/PayUProvider.js';
import { SkrillProvider } from './providers/SkrillProvider.js';
import { PayoneerProvider } from './providers/PayoneerProvider.js';
import { WebhookRouter } from './webhooks.js';
import type { WebhookEvent } from './types.js';

export interface PaymentsOptions {
  /** Override the HTTP transport (tests inject a mock; default uses fetch). */
  transport?: HttpTransport;
}

export interface PaymentsService {
  /** Enabled providers keyed by name (razorpay, paypal, payu, skrill, payoneer). */
  providers: Map<string, PaymentProvider>;
  /** Get a provider by name, or throw if not enabled. */
  get(name: string): PaymentProvider;
  /** Build a webhook router for `POST <webhookPath>`. */
  webhookRouter(onEvent: (event: WebhookEvent) => Promise<void> | void): WebhookRouter;
}

/**
 * Build the payments service from a `payments` config section. A provider
 * activates when `enabled: true` OR all of its credential keys are set — so a
 * user who adds keys (via config or `NEXUS_PAYMENTS_*` env) without remembering
 * the `enabled` flag still gets a working provider. Explicit `enabled: false`
 * with keys is the only way to keep a configured provider off.
 */
export function createPayments(
  config: {
    razorpay?: ProviderConfig;
    paypal?: ProviderConfig;
    payu?: ProviderConfig;
    skrill?: ProviderConfig;
    payoneer?: ProviderConfig;
  },
  opts: PaymentsOptions = {},
): PaymentsService {
  const transport = opts.transport ?? fetchTransport;
  const providers = new Map<string, PaymentProvider>();

  const active = (cfg: ProviderConfig | undefined, keys: string[]): boolean => {
    if (!cfg) return false;
    if (cfg.enabled) return true;
    return keys.every((k) => {
      const v = (cfg as Record<string, unknown>)[k];
      return typeof v === 'string' && v.length > 0;
    });
  };

  if (active(config.razorpay, ['keyId', 'keySecret'])) {
    providers.set('razorpay', new RazorpayProvider(config.razorpay as any, transport));
  }
  if (active(config.paypal, ['clientId', 'clientSecret'])) {
    providers.set('paypal', new PayPalProvider(config.paypal as any, transport));
  }
  if (active(config.payu, ['merchantKey', 'salt'])) {
    providers.set('payu', new PayUProvider(config.payu as any, transport));
  }
  if (active(config.skrill, ['merchantEmail'])) {
    providers.set('skrill', new SkrillProvider(config.skrill as any, transport));
  }
  if (active(config.payoneer, ['programId', 'apiKey'])) {
    providers.set('payoneer', new PayoneerProvider(config.payoneer as any, transport));
  }

  return {
    providers,
    get(name: string): PaymentProvider {
      const p = providers.get(name);
      if (!p) throw new Error(`[nexus-payments] provider not enabled: ${name}`);
      return p;
    },
    webhookRouter(onEvent) {
      return new WebhookRouter(providers, onEvent);
    },
  };
}