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
  ConnectionTest,
} from '../types.js';
import { jsonRequest, basicAuth } from '../http.js';
import { PaymentError } from '../errors.js';

interface PayPalConfig {
  enabled: boolean;
  sandbox: boolean;
  clientId: string;
  clientSecret: string;
  /** Optional webhook id (used by the verify-webhook-signature API). */
  webhookId?: string;
}

function baseUrl(sandbox: boolean): string {
  return sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

function mapStatus(s: string): OrderStatus {
  switch (s) {
    case 'CREATED': return 'created';
    case 'SAVED': case 'PAYER_ACTION_REQUIRED': return 'pending';
    case 'APPROVED': return 'authorized';
    case 'COMPLETED': return 'captured';
    case 'VOIDED': return 'cancelled';
    default: return 'pending';
  }
}

/** Format a major-unit amount as PayPal's 2-decimal string. */
function fmt(amount: number): string {
  return amount.toFixed(2);
}

export class PayPalProvider implements PaymentProvider {
  readonly name = 'paypal';
  private readonly cfg: PayPalConfig;
  private readonly transport: HttpTransport;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(cfg: PayPalConfig, transport: HttpTransport) {
    this.cfg = cfg;
    this.transport = transport;
    if (!cfg.clientId || !cfg.clientSecret) throw new PaymentError('paypal clientId/clientSecret required', { code: 'CONFIG', provider: 'paypal' });
  }

  private base(): string {
    return baseUrl(this.cfg.sandbox);
  }

  /** OAuth2 client-credentials token with a 5-minute safety margin on expiry. */
  private async tokenValue(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 300_000) return this.token.value;
    const res = await jsonRequest(this.transport, this.name, {
      method: 'POST',
      url: `${this.base()}/v1/oauth2/token`,
      headers: { authorization: basicAuth(this.cfg.clientId, this.cfg.clientSecret), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.access_token) throw new PaymentError('paypal token exchange failed', { code: 'AUTH', provider: 'paypal', raw: res });
    this.token = { value: res.access_token, expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { 'content-type': 'application/json', authorization: `Bearer ${await this.tokenValue()}` };
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const body = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: input.reference,
        amount: { currency_code: input.currency, value: fmt(input.amount) },
        ...(input.description ? { description: input.description } : {}),
      }],
      ...(input.returnUrl || input.cancelUrl ? { application_context: { return_url: input.returnUrl, cancel_url: input.cancelUrl } } : {}),
    };
    const res = await jsonRequest(this.transport, this.name, {
      method: 'POST',
      url: `${this.base()}/v2/checkout/orders`,
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });
    const approve = (res.links ?? []).find((l: { rel: string; href: string }) => l.rel === 'approve');
    return {
      id: res.id,
      reference: input.reference,
      status: mapStatus(res.status),
      amount: input.amount,
      currency: input.currency,
      paymentUrl: approve?.href,
      raw: res,
    };
  }

  async capture(input: CaptureInput): Promise<Order> {
    const res = await jsonRequest(this.transport, this.name, {
      method: 'POST',
      url: `${this.base()}/v2/checkout/orders/${input.orderId}/capture`,
      headers: await this.authHeaders(),
      body: '{}',
    });
    const unit = res.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];
    return {
      id: res.id,
      reference: unit?.reference_id ?? '',
      status: mapStatus(res.status),
      amount: capture ? Number(capture.amount.value) : 0,
      currency: capture?.amount?.currency_code ?? '',
      paymentId: capture?.id,
      raw: res,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const body = input.amount != null ? JSON.stringify({ amount: { value: fmt(input.amount), currency_code: 'USD' } }) : '{}';
    const res = await jsonRequest(this.transport, this.name, {
      method: 'POST',
      url: `${this.base()}/v2/payments/captures/${input.paymentId}/refund`,
      headers: await this.authHeaders(),
      body,
    });
    return { id: res.id, status: res.status, amount: res.amount ? Number(res.amount.value) : 0, raw: res };
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    const res = await jsonRequest(this.transport, this.name, {
      method: 'GET',
      url: `${this.base()}/v2/checkout/orders/${orderId}`,
      headers: await this.authHeaders(),
    });
    const unit = res.purchase_units?.[0];
    return {
      id: res.id,
      reference: unit?.reference_id ?? '',
      status: mapStatus(res.status),
      amount: unit ? Number(unit.amount.value) : 0,
      currency: unit?.amount?.currency_code ?? '',
      raw: res,
    };
  }

  /** Live probe: exchange client-credentials for an OAuth token (no order created). */
  async testConnection(): Promise<ConnectionTest> {
    await this.tokenValue();
    return { ok: true, detail: `oauth2 authenticated (${this.cfg.sandbox ? 'sandbox' : 'live'})` };
  }

  /**
   * PayPal webhook verification uses the /v1/notifications/verify-webhook-signature
   * API (PayPal signs with a rotating certificate — local HMAC isn't possible).
   * Requires `webhookId` configured.
   */
  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookEvent> {
    if (!this.cfg.webhookId) return { verified: false, provider: this.name, data: 'no webhookId configured' };
    const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString();
    const body = JSON.stringify({
      auth_algo: input.headers['paypal-auth-algo'] ?? input.headers['PAYPAL-AUTH-ALGO'],
      cert_url: input.headers['paypal-cert-url'] ?? input.headers['PAYPAL-CERT-URL'],
      transmission_id: input.headers['paypal-transmission-id'] ?? input.headers['PAYPAL-TRANSMISSION-ID'],
      transmission_sig: input.headers['paypal-transmission-sig'] ?? input.headers['PAYPAL-TRANSMISSION-SIG'],
      transmission_time: input.headers['paypal-transmission-time'] ?? input.headers['PAYPAL-TRANSMISSION-TIME'],
      webhook_id: this.cfg.webhookId,
      webhook_event: safeParse(raw),
    });
    const res = await jsonRequest(this.transport, this.name, {
      method: 'POST',
      url: `${this.base()}/v1/notifications/verify-webhook-signature`,
      headers: await this.authHeaders(),
      body,
    });
    const verified = res.verification_status === 'SUCCESS';
    return { verified, event: safeParse(raw)?.event_type, data: safeParse(raw), provider: this.name };
  }
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return undefined; }
}