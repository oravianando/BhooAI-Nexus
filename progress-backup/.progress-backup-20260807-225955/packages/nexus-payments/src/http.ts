import type { HttpTransport, HttpRequest, HttpResponse } from './types.js';
import { PaymentError } from './errors.js';

/**
 * Default HTTP transport built on the global `fetch` (Node >= 18). Providers
 * accept any `HttpTransport`, so tests inject a mock and never touch the network.
 */
export const fetchTransport: HttpTransport = async (req: HttpRequest): Promise<HttpResponse> => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  const text = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return { status: res.status, body: text, headers };
};

/** Run a JSON request through `transport`, parse JSON, and throw PaymentError on non-2xx. */
export async function jsonRequest(
  transport: HttpTransport,
  provider: string,
  req: HttpRequest,
): Promise<any> {
  const res = await transport(req);
  const parsed = safeJson(res.body);
  if (res.status < 200 || res.status >= 300) {
    throw new PaymentError(`${provider} request failed: HTTP ${res.status}`, {
      code: 'HTTP_ERROR',
      provider,
      status: res.status,
      raw: parsed ?? res.body,
    });
  }
  return parsed;
}

function safeJson(body: string): any {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Basic-auth header value from `user:pass`. */
export function basicAuth(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}