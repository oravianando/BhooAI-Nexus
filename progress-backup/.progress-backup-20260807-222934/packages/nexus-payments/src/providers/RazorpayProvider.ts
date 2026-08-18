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
import { hmacSha256Hex, safeEqual } from '../signature.js';
import { PaymentError } from '../errors.js';

interface RazorpayConfig {
  enabled: boolean;
  sandbox: boolean;
  keyId: string;
  keySecret: string;
  /** Webhook secret configured in the Razorpay dashboard. */
  webhookSecret?: string;
}

const BASE = 'https://api.razorpay.com/v1';

/** Razorpay status → unified status. */
function mapStatus(s: string): OrderStatus {
  switch (s) {
    case 'created': return 'created';
    case 'attempted': return 'pending';
    case 'paid': return 'paid';
    case 'captured': return 'captured';
    case 'failed': return 'failed';
    case 'refunded': return 'refunded';
    default: return 'pending';
  }
}

/** Razorpay uses minor units (paise) for INR; for non-INR it's the smallest unit too. */
function toMinor(amount: number, currency: string): number {
  // Razorpay expects amounts in the smallest currency unit. For currencies with
  // 3 decimal places (KWD/BHD/JOD) the factor is 1000; otherwise 100. v1 handles
  // the common 2-decimal case plus the 0-decimal case (JPY).
  const threeDp = ['KWD', 'BHD', 'JOD', 'OMR', 'TND'];
  const zeroDp = ['JPY', 'KRW', 'VND', 'ISK'];
  if (threeDp.includes(currency)) return Math.round(amount * 1000);
  if (zeroDp.includes(currency)) return Math.round(amount);
  return Math.round(amount * 100);
}
function fromMinor(amount: number, currency: string): number {
  const threeDp = ['KWD', 'BHD', 'JOD', 'OMR', 'TND'];
  const zeroDp = ['JPY', 'KRW', 'VND', 'ISK'];
  if (threeDp.includes(currency)) return amount / 1000;
  if (zeroDp.includes(currency)) return amount;
  return amount / 100;
}

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';
  private readonly cfg: RazorpayConfig;
  private readonly transport: HttpTransport;

  constructor(cfg: RazorpayConfig, transport: HttpTransport) {
    this.cfg = cfg;
    this.transport = transport;
    if (!cfg.keyId || !cfg.keySecret) throw new PaymentError('razorpay keyId/keySecret required', { code: 'CONFIG', provider: 'razorpay' });
  }

  private auth(): string {
    return basicAuth(this.cfg.keyId, this.cfg.keySecret);
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const body = JSON.stringify({
      amount: toMinor(input.amount, input.currency),
      currency: input.currency,
      receipt: input.reference,
      notes: input.description ? { description: input.description } : undefined,
    });
    const res = await jsonRequest(this.transport, this.name, {
      method: 'POST',
      url: `${BASE}/orders`,
      headers: { 'content-type': 'application/json', authorization: this.auth() },
      body,
    });
    return {
      id: res.id,
      reference: res.receipt ?? input.reference,
      status: mapStatus(res.status),
      amount: fromMinor(res.amount, res.currency),
      currency: res.currency,
      raw: res,
    };
  }

  async capture(input: CaptureInput): Promise<Order> {
    const paymentId = input.paymentId;
    if (!paymentId) throw new PaymentError('razorpay capture requires paymentId', { code: 'CONFIG', provider: 'razorpay' });
    // Resolve the order currency once so we can convert a partial-capture amount.
    const order = await this.getOrderStatus(input.orderId);
    const body = JSON.stringify({
      amount: input.amount != null ? toMinor(input.amount, order.currency) : undefined,
      currency: order.currency,
    });
    const res = await jsonRequest(this.transport, this.name, {
      method: 'POST',
      url: `${BASE}/payments/${paymentId}/capture`,
      headers: { 'content-type': 'application/json', authorization: this.auth() },
      body,
    });
    return {
      id: res.order_id ?? input.orderId,
      reference: order.reference,
      status: mapStatus(res.status),
      amount: fromMinor(res.amount, res.currency ?? order.currency),
      currency: res.currency ?? order.currency,
      paymentId: res.id,
      raw: res,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const body = JSON.stringify({
      amount: input.amount != null ? toMinor(input.amount, 'INR') : undefined,
      notes: input.reason ? { reason: input.reason } : undefined,
    });
    const res = await jsonRequest(this.transport, this.name, {
      method: 'POST',
      url: `${BASE}/payments/${input.paymentId}/refund`,
      headers: { 'content-type': 'application/json', authorization: this.auth() },
      body,
    });
    return { id: res.id, status: res.status, amount: fromMinor(res.amount, res.currency || 'INR'), raw: res };
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    const res = await jsonRequest(this.transport, this.name, {
      method: 'GET',
      url: `${BASE}/orders/${orderId}`,
      headers: { authorization: this.auth() },
    });
    return {
      id: res.id,
      reference: res.receipt ?? '',
      status: mapStatus(res.status),
      amount: fromMinor(res.amount, res.currency),
      currency: res.currency,
      raw: res,
    };
  }

  /** Live probe: list orders. Authenticates the key pair without moving money. */
  async testConnection(): Promise<ConnectionTest> {
    const res = await jsonRequest(this.transport, this.name, {
      method: 'GET',
      url: `${BASE}/orders?count=1`,
      headers: { authorization: this.auth() },
    });
    const count = Array.isArray(res.items) ? res.items.length : 0;
    return { ok: true, detail: `authenticated; ${count} order(s) in the first page` };
  }

  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookEvent> {
    const secret = this.cfg.webhookSecret;
    if (!secret) return { verified: false, provider: this.name, data: 'no webhook secret configured' };
    const sig = input.headers['x-razorpay-signature'] ?? input.headers['X-Razorpay-Signature'];
    const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString();
    const expected = hmacSha256Hex(secret, raw);
    const verified = typeof sig === 'string' && safeEqual(sig, expected);
    let event: string | undefined;
    let data: unknown;
    try {
      const parsed = JSON.parse(raw);
      event = parsed.event;
      data = parsed.payload;
    } catch {
      data = raw;
    }
    return { verified, event, data, provider: this.name };
  }
}