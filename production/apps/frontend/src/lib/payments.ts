// Checkout client for the BhooAI Nexus frontend.
//
// Wraps the backend /payments/* browser routes (auth-guarded, CSRF-protected).
// The backend PaymentProvider abstraction returns a hosted `paymentUrl` for
// hosted-checkout providers (PayPal/Skrill/PayU/Payoneer) and a direct order for
// Razorpay; the frontend just follows `paymentUrl` if present.

import { getAccessToken, getCsrfToken, refreshCsrf } from './auth.js';

export interface Order {
  id: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  paymentUrl?: string;
  paymentId?: string;
  raw?: unknown;
}

async function post(path: string, body: unknown): Promise<any> {
  await refreshCsrf();
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken() };
  const t = getAccessToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const r = await fetch(path, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(data.error ?? `${path} failed (${r.status})`);
  return data;
}

export async function createOrder(input: {
  provider: string;
  amount: number;
  currency?: string;
  reference?: string;
  description?: string;
}): Promise<{ provider: string; order: Order }> {
  return post('/payments/order', input);
}

export async function captureOrder(provider: string, orderId: string, amount?: number): Promise<{ provider: string; order: Order }> {
  return post(`/payments/order/${orderId}/capture`, { provider, amount });
}

export async function getOrderStatus(provider: string, orderId: string): Promise<{ provider: string; order: Order }> {
  const r = await fetch(`/payments/order/${orderId}?provider=${encodeURIComponent(provider)}`, {
    credentials: 'include',
    headers: authz(),
  });
  return r.json();
}

function authz(): Record<string, string> {
  const t = getAccessToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}