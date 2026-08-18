import type { HttpTransport, HttpRequest, HttpResponse } from './types.js';

/** Default HTTP transport built on the global `fetch` (Node >= 18). */
export const fetchTransport: HttpTransport = async (req: HttpRequest): Promise<HttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const body = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, body, headers };
};