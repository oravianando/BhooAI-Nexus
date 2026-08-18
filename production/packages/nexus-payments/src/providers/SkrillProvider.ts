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
import { md5Hex, safeEqual } from '../signature.js';
import { PaymentError } from '../errors.js';

/**
 * Skrill Quick Checkout (happy-path). The merchant redirects the buyer to
 * https://pay.skrill.com/ with payment params; Skrill posts a status report
 * (IPN) to `status_url` whose `md5sig` we verify.
 *
 * md5sig (status report) = MD5(merchant_email + secret_word + mb_transaction_id
 *                           + amount + currency), sent uppercase by Skrill.
 */
interface SkrillConfig {
  enabled: boolean;
  sandbox: boolean;
  /** Skrill merchant email (the pay_to_email). */
  merchantEmail: string;
  /** Secret word set in the Skrill merchant account. */
  secretWord: string;
}

const CHECKOUT_URL = 'https://pay.skrill.com/';

function mapStatus(status: string): OrderStatus {
  switch (status) {
    case '0': case 'pending': return 'pending';
    case '2': case 'processed': return 'captured';
    case '1': case 'cancelled': return 'cancelled';
    case '-1': case 'failed': return 'failed';
    default: return 'pending';
  }
}

export class SkrillProvider implements PaymentProvider {
  readonly name = 'skrill';
  private readonly cfg: SkrillConfig;
  private readonly transport: HttpTransport;

  constructor(cfg: SkrillConfig, transport: HttpTransport) {
    this.cfg = cfg;
    this.transport = transport;
    if (!cfg.merchantEmail) throw new PaymentError('skrill merchantEmail required', { code: 'CONFIG', provider: 'skrill' });
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const params = new URLSearchParams();
    params.set('pay_to_email', this.cfg.merchantEmail);
    params.set('transaction_id', input.reference);
    params.set('amount', input.amount.toFixed(2));
    params.set('currency', input.currency);
    params.set('detail1_description', input.description ?? 'Order');
    params.set('detail1_text', input.reference);
    if (input.returnUrl) params.set('return_url', input.returnUrl);
    if (input.cancelUrl) params.set('cancel_url', input.cancelUrl);
    if (input.returnUrl) params.set('status_url', input.returnUrl);
    return {
      id: input.reference,
      reference: input.reference,
      status: 'created',
      amount: input.amount,
      currency: input.currency,
      paymentUrl: `${CHECKOUT_URL}?${params.toString()}`,
      raw: Object.fromEntries(params),
    };
  }

  /** Skrill captures on the hosted page; no server-side capture. */
  async capture(input: CaptureInput): Promise<Order> {
    return this.getOrderStatus(input.orderId);
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    return { id: `skrill-refund`, status: 'pending', amount: 0, raw: { note: 'Skrill refund via merchant panel (v1)' } };
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    return { id: orderId, reference: orderId, status: 'pending', amount: 0, currency: '', raw: { note: 'Skrill status via webhook (v1)' } };
  }

  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookEvent> {
    const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString();
    const fields = parseForm(raw);
    const provided = fields.md5sig;
    if (!provided) return { verified: false, provider: this.name, data: 'no md5sig in payload' };
    if (!this.cfg.secretWord) return { verified: false, provider: this.name, data: 'no secretWord configured' };
    const message = `${this.cfg.merchantEmail}${this.cfg.secretWord}${fields.mb_transaction_id ?? ''}${fields.amount ?? ''}${fields.currency ?? ''}`;
    const expected = md5Hex(message).toUpperCase();
    const verified = safeEqual(provided.toUpperCase(), expected);
    return {
      verified,
      event: fields.status ? `payment.${fields.status}` : undefined,
      data: fields,
      provider: this.name,
    };
  }
}

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split('&')) {
    if (!pair) continue;
    const [k, ...rest] = pair.split('=');
    out[decodeURIComponent(k!)] = decodeURIComponent(rest.join('='));
  }
  return out;
}