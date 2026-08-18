/**
 * Unified payment provider interface. All gateway adapters implement this so the
 * app code is gateway-agnostic. Amounts are expressed in MAJOR units (e.g. 10.50
 * = $10.50); each provider converts to its native representation (Razorpay paise,
 * PayPal decimal string, PayU string, etc.).
 *
 * Tiering (documented in README):
 *   - Razorpay: full (REST + signature verify)
 *   - PayPal:   full (Orders v2 + OAuth2)
 *   - PayU:     happy-path (hash-based create + webhook verify)
 *   - Skrill:   happy-path (Quick Checkout URL + MD5 signature)
 *   - Payoneer: happy-path (signed redirect; Payoneer has no public sandbox
 *               without a registered program — verified structurally, not live)
 */

export type OrderStatus =
  | 'created'
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'captured'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export interface Money {
  /** Amount in major units (e.g. 10.50). */
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
}

export interface CustomerInfo {
  email?: string;
  name?: string;
  phone?: string;
  userId?: string;
}

export interface CreateOrderInput {
  amount: number;
  currency: string;
  /** Merchant order id / receipt reference. */
  reference: string;
  description?: string;
  customer?: CustomerInfo;
  /** Hosted-checkout return URL (PayPal/Skrill/PayU). */
  returnUrl?: string;
  cancelUrl?: string;
}

export interface Order {
  /** Provider order id. */
  id: string;
  /** Merchant reference echoed back. */
  reference: string;
  status: OrderStatus;
  amount: number;
  currency: string;
  /** Hosted checkout / redirect URL, when the provider offers one. */
  paymentUrl?: string;
  /** Provider payment id once a payment exists. */
  paymentId?: string;
  /** Raw provider response for debugging / extra fields. */
  raw: unknown;
}

export interface CaptureInput {
  orderId: string;
  paymentId?: string;
  /** Partial capture amount (major units); omitted = full. */
  amount?: number;
}

export interface RefundInput {
  paymentId: string;
  amount?: number;
  reason?: string;
}

export interface RefundResult {
  id: string;
  status: string;
  amount: number;
  raw: unknown;
}

export interface WebhookVerifyInput {
  rawBody: string | Buffer;
  headers: Record<string, string>;
  /** Route params (e.g. provider name) if mounted on a param route. */
  params?: Record<string, string>;
}

export interface WebhookEvent {
  verified: boolean;
  /** Event type (e.g. "payment.captured", "refund.created"). */
  event?: string;
  /** Normalized payload — provider-specific. */
  data?: unknown;
  /** Provider name that produced the event. */
  provider?: string;
}

/** Result of a live connectivity probe (admin test console). */
export interface ConnectionTest {
  ok: boolean;
  /** Human note on success (e.g. "authenticated as sandbox merchant"). */
  detail?: string;
  /** Error message when ok is false. */
  error?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createOrder(input: CreateOrderInput): Promise<Order>;
  capture(input: CaptureInput): Promise<Order>;
  refund(input: RefundInput): Promise<RefundResult>;
  getOrderStatus(orderId: string): Promise<Order>;
  verifyWebhook(input: WebhookVerifyInput): Promise<WebhookEvent>;
  /**
   * Optional live check that exercises the provider's API (e.g. listing orders /
   * exchanging an OAuth token) WITHOUT creating money movement. Implemented by
   * providers that can be probed anonymously; the admin test console calls it to
   * show a green/red signal. Providers without a safe probe omit it and are
   * reported as "configured — no public probe".
   */
  testConnection?(): Promise<ConnectionTest>;
}

/** Injectable HTTP transport so providers are testable without live gateways. */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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

/** Provider configuration as it appears in nexus.config.ts `payments.<provider>`. */
export interface ProviderConfig {
  enabled: boolean;
  sandbox: boolean;
  [key: string]: unknown;
}