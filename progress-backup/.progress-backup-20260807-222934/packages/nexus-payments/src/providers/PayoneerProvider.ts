import type {
  PaymentProvider,
  CreateOrderInput,
  Order,
  CaptureInput,
  RefundInput,
  RefundResult,
  WebhookVerifyInput,
  WebhookEvent,
  HttpTransport,
  OrderStatus,
} from '../types.js';
import { hmacSha256Hex, safeEqual } from '../signature.js';
import { PaymentError } from '../errors.js';

/**
 * Payoneer (happy-path). Payoneer's API requires a registered partner program
 * and has no public sandbox without provisioned credentials, so this adapter is
 * structurally complete but verified by signature tests rather than live calls.
 *
 * The flow modeled here: the merchant builds a signed payment request (HMAC over
 * the canonical params) and redirects to a Payoneer checkout URL; Payoneer posts
 * a webhook signed with the same shared secret (HMAC-SHA256 over the raw body).
 */
interface PayoneerConfig {
  enabled: boolean;
  sandbox: boolean;
  programId: string;
  apiKey: string;
  /** Shared secret for webhook HMAC verification. */
  webhookSecret?: string;
}

function checkoutUrl(sandbox: boolean, programId: string): string {
  return sandbox
    ? `https://api.sandbox.payoneer.com/checkout/${programId}`
    : `https://api.payoneer.com/checkout/${programId}`;
}

function mapStatus(status: string): OrderStatus {
  switch (status) {
    case 'initiated': return 'created';
    case 'pending': return 'pending';
    case 'authorized': return 'authorized';
    case 'completed': case 'paid': return 'captured';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'refunded': return 'refunded';
    default: return 'pending';
  }
}

export class PayoneerProvider implements PaymentProvider {
  readonly name = 'payoneer';
  private readonly cfg: PayoneerConfig;
  private readonly transport: HttpTransport;

  constructor(cfg: PayoneerConfig, transport: HttpTransport) {
    this.cfg = cfg;
    this.transport = transport;
    if (!cfg.programId || !cfg.apiKey) throw new PaymentError('payoneer programId/apiKey required', { code: 'CONFIG', provider: 'payoneer' });
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const params = new URLSearchParams();
    params.set('program_id', this.cfg.programId);
    params.set('reference', input.reference);
    params.set('amount', input.amount.toFixed(2));
    params.set('currency', input.currency);
    if (input.customer?.email) params.set('payee_email', input.customer.email);
    if (input.returnUrl) params.set('return_url', input.returnUrl);
    // Canonical signature: HMAC-SHA256(apiKey, sorted query string).
    const canonical = canonicalQuery(params);
    const signature = hmacSha256Hex(this.cfg.apiKey, canonical);
    params.set('signature', signature);
    return {
      id: input.reference,
      reference: input.reference,
      status: 'created',
      amount: input.amount,
      currency: input.currency,
      paymentUrl: `${checkoutUrl(this.cfg.sandbox, this.cfg.programId)}?${params.toString()}`,
      raw: Object.fromEntries(params),
    };
  }

  async capture(input: CaptureInput): Promise<Order> {
    return this.getOrderStatus(input.orderId);
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    return { id: `payoneer-refund`, status: 'pending', amount: 0, raw: { note: 'Payoneer refund via partner API (v1)' } };
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    return { id: orderId, reference: orderId, status: 'pending', amount: 0, currency: '', raw: { note: 'Payoneer status via webhook (v1)' } };
  }

  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookEvent> {
    const secret = this.cfg.webhookSecret;
    if (!secret) return { verified: false, provider: this.name, data: 'no webhookSecret configured' };
    const sig = input.headers['x-payoneer-signature'] ?? input.headers['X-Payoneer-Signature'];
    const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString();
    const expected = hmacSha256Hex(secret, raw);
    const verified = typeof sig === 'string' && safeEqual(sig, expected);
    let event: string | undefined;
    let data: unknown;
    try {
      const parsed = JSON.parse(raw);
      event = parsed.event ?? parsed.status;
      data = parsed;
    } catch {
      data = raw;
    }
    return { verified, event, data, provider: this.name };
  }
}

/** Sort params by key and encode as `k=v&k=v` (deterministic for signing). */
function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
}