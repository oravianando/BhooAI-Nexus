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
import { sha512Hex, safeEqual } from '../signature.js';
import { PaymentError } from '../errors.js';

/**
 * PayU India (happy-path). PayU uses a hash-based flow: the merchant computes a
 * SHA-512 hash over the payment params + salt, POSTs to the hosted checkout, and
 * verifies the response hash (the reverse sequence). No REST "create order";
 * `createOrder` builds the params + hash and returns the checkout URL.
 */
interface PayUConfig {
  enabled: boolean;
  sandbox: boolean;
  merchantKey: string;
  salt: string;
}

function checkoutUrl(sandbox: boolean): string {
  return sandbox ? 'https://test.payu.in/_payment' : 'https://secure.payu.in/_payment';
}

/** Request hash = sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf10|salt). */
export function payuRequestHash(
  key: string,
  salt: string,
  p: { txnid: string; amount: string; productinfo: string; firstname: string; email: string; udf: string[] },
): string {
  const fields = [key, p.txnid, p.amount, p.productinfo, p.firstname, p.email, ...p.udf, salt];
  return sha512Hex(fields.join('|'));
}

/** Response hash = sha512(salt|status|udf10..udf1|email|firstname|productinfo|amount|txnid|key). */
export function payuResponseHash(
  key: string,
  salt: string,
  p: { status: string; txnid: string; amount: string; productinfo: string; firstname: string; email: string; udf: string[] },
): string {
  const reversedUdf = [...p.udf].reverse();
  const fields = [salt, p.status, ...reversedUdf, p.email, p.firstname, p.productinfo, p.amount, p.txnid, key];
  return sha512Hex(fields.join('|'));
}

function mapStatus(status: string): OrderStatus {
  switch (status) {
    case 'created': return 'created';
    case 'pending': case 'in progress': return 'pending';
    case 'captured': case 'success': return 'captured';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'refunded': return 'refunded';
    default: return 'pending';
  }
}

export class PayUProvider implements PaymentProvider {
  readonly name = 'payu';
  private readonly cfg: PayUConfig;
  private readonly transport: HttpTransport;

  constructor(cfg: PayUConfig, transport: HttpTransport) {
    this.cfg = cfg;
    this.transport = transport;
    if (!cfg.merchantKey || !cfg.salt) throw new PaymentError('payu merchantKey/salt required', { code: 'CONFIG', provider: 'payu' });
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const amount = input.amount.toFixed(2);
    const firstname = input.customer?.name ?? 'Customer';
    const email = input.customer?.email ?? '';
    const productinfo = input.description ?? input.reference;
    const udf = ['', '', '', '', '', '', '', '', '', '']; // udf1..udf10
    const hash = payuRequestHash(this.cfg.merchantKey, this.cfg.salt, {
      txnid: input.reference, amount, productinfo, firstname, email, udf,
    });
    const params = {
      key: this.cfg.merchantKey,
      txnid: input.reference,
      amount,
      productinfo,
      firstname,
      email,
      udf1: '', udf2: '', udf3: '', udf4: '', udf5: '',
      hash,
      ...(input.returnUrl ? { surl: input.returnUrl, furl: input.returnUrl } : {}),
    };
    return {
      id: input.reference,
      reference: input.reference,
      status: 'created',
      amount: input.amount,
      currency: input.currency,
      // PayU expects a form POST to the checkout URL with `params` — return the
      // endpoint as paymentUrl and the params in `raw` for the client to POST.
      paymentUrl: checkoutUrl(this.cfg.sandbox),
      raw: params,
    };
  }

  /** PayU has no server-side capture; payments auto-capture on the hosted page. */
  async capture(input: CaptureInput): Promise<Order> {
    return this.getOrderStatus(input.orderId);
  }

  /** PayU refunds require the merchant panel / a separate API; v1 returns a stub. */
  async refund(input: RefundInput): Promise<RefundResult> {
    return { id: `refund-${input.paymentId}`, status: 'pending', amount: input.amount ?? 0, raw: { note: 'PayU refund via merchant panel (v1)' } };
  }

  async getOrderStatus(orderId: string): Promise<Order> {
    // Without a live REST credential, status is reconstructed from the webhook
    // payload that updateOrder would have stored. v1 returns a placeholder.
    return { id: orderId, reference: orderId, status: 'pending', amount: 0, currency: '', raw: { note: 'PayU status via webhook (v1)' } };
  }

  /**
   * Verify a PayU webhook/redirect response. The body is form-encoded
   * (key=value&...) with a `hash` field. We recompute the response hash and
   * compare in constant time.
   */
  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookEvent> {
    const raw = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString();
    const fields = parseForm(raw);
    const providedHash = fields.hash;
    if (!providedHash) return { verified: false, provider: this.name, data: 'no hash in payload' };
    const udf = [fields.udf1, fields.udf2, fields.udf3, fields.udf4, fields.udf5, fields.udf6, fields.udf7, fields.udf8, fields.udf9, fields.udf10].map((v) => v ?? '');
    const expected = payuResponseHash(this.cfg.merchantKey, this.cfg.salt, {
      status: fields.status ?? '',
      txnid: fields.txnid ?? '',
      amount: fields.amount ?? '',
      productinfo: fields.productinfo ?? '',
      firstname: fields.firstname ?? '',
      email: fields.email ?? '',
      udf,
    });
    const verified = safeEqual(providedHash, expected);
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