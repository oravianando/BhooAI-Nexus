/**
 * Persistent store for payment orders + transactions.
 *
 * Orders are created/updated from the checkout routes (paymentRoutes.ts); raw
 * provider webhook events are appended as transactions (main.ts). Both are
 * exposed to the admin app under /admin/payments/*.
 *
 * Models register lazily on the default connection, so they work from both the
 * app bootstrap and the admin routes regardless of call order.
 */
import { Schema, model, ObjectId, type DocumentInstance, type Model } from '@bhooai/nexus-data';
import type { Order, WebhookEvent } from '@bhooai/nexus-payments';

export interface OrderDoc {
  _id?: ObjectId;
  /** Provider name (razorpay, paypal, payu, skrill, payoneer). */
  provider: string;
  /** Provider order id (e.g. PayPal order id / Razorpay order id). */
  orderId: string;
  /** Merchant reference echoed back on the order. */
  reference: string;
  status: string;
  amount: number;
  currency: string;
  paymentUrl?: string;
  paymentId?: string;
  customer?: Record<string, unknown>;
  description?: string;
  raw?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TransactionDoc {
  _id?: ObjectId;
  provider: string;
  /** Normalized event (e.g. "payment.captured", "refund.created"). */
  event: string;
  verified: boolean;
  orderId?: string;
  paymentId?: string;
  amount?: number;
  currency?: string;
  status?: string;
  raw?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export type OrderInstance = DocumentInstance & OrderDoc;
export type TransactionInstance = DocumentInstance & TransactionDoc;

const orderSchema = new Schema<OrderDoc>(
  {
    provider: { type: String, required: true },
    orderId: { type: String, required: true },
    reference: { type: String },
    status: { type: String, default: 'created' },
    amount: { type: Number },
    currency: { type: String, default: 'USD' },
    paymentUrl: { type: String },
    paymentId: { type: String },
    customer: { type: Object },
    description: { type: String },
    raw: { type: Object },
  },
  { timestamps: true, collection: 'payment_orders' },
);
orderSchema.indexes.push({ spec: { provider: 1, orderId: 1 }, options: { unique: true } });

const transactionSchema = new Schema<TransactionDoc>(
  {
    provider: { type: String, required: true },
    event: { type: String, required: true },
    verified: { type: Boolean, default: false },
    orderId: { type: String },
    paymentId: { type: String },
    amount: { type: Number },
    currency: { type: String },
    status: { type: String },
    raw: { type: Object },
  },
  { timestamps: true, collection: 'payment_transactions' },
);
transactionSchema.indexes.push({ spec: { createdAt: -1 }, options: {} });

let Order: OrderModel | undefined;
let Transaction: TransactionModel | undefined;

/** Register both payment models on the default connection (idempotent). */
export function initPaymentModels(): void {
  if (Transaction) return;
  Order = model<OrderInstance>('PaymentOrder', orderSchema);
  Transaction = model<TransactionInstance>('PaymentTransaction', transactionSchema);
}

export function getOrderModel(): Model<OrderInstance> {
  if (!Order) initPaymentModels();
  if (!Order) throw new Error('Payment order model unavailable');
  return Order;
}

export function getTransactionModel(): Model<TransactionInstance> {
  if (!Transaction) initPaymentModels();
  if (!Transaction) throw new Error('Payment transaction model unavailable');
  return Transaction;
}

/** Upsert an order from a provider response so we always keep the latest status. */
export async function upsertOrder(
  order: Order,
  provider: string,
  meta: { customer?: Record<string, unknown>; description?: string } = {},
): Promise<void> {
  await getOrderModel().findOneAndUpdate(
    { provider, orderId: order.id },
    {
      $set: {
        provider,
        orderId: order.id,
        reference: order.reference,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        paymentUrl: order.paymentUrl ?? null,
        paymentId: order.paymentId ?? null,
        customer: meta.customer ?? null,
        description: meta.description ?? null,
        raw: order.raw ?? null,
      },
    },
    { upsert: true },
  );
}

/** Append a normalized webhook event as a transaction. */
export async function recordTransaction(provider: string, event: WebhookEvent): Promise<void> {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {
    provider,
    event: event.event ?? 'unknown',
    verified: !!event.verified,
    orderId: firstStr(data, 'orderId', 'order_id', 'orderReference'),
    paymentId: firstStr(data, 'paymentId', 'payment_id', 'id'),
    amount: firstNum(data, 'amount', 'gross_amount', 'total_paid'),
    currency: firstStr(data, 'currency'),
    status: firstStr(data, 'status', 'payment_status', 'state'),
    raw: data,
  };
  await getTransactionModel().create(fields);
}

function firstStr(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.length) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function firstNum(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && !Number.isNaN(Number(v))) return Number(v);
  }
  return undefined;
}

export type OrderModel = Model<OrderInstance>;
export type TransactionModel = Model<TransactionInstance>;