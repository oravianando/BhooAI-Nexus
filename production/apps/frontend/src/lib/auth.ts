// Auth client for the BhooAI Nexus frontend.
//
// Talks to the backend /auth/* + /csrf-token endpoints (proxied to :4000 by Vite
// in dev). CSRF uses the double-submit scheme: a HttpOnly cookie `nexus_csrf`
// is set by GET /csrf-token, and the same value must be echoed in the
// x-csf-token header on every unsafe request. The access token lives in
// memory only (not localStorage) to reduce XSS exposure; refresh uses the
// HttpOnly cookie set by the backend.

export interface NexusUser {
  id: string;
  email: string;
  name?: string;
  roles: string[];
  emailVerified?: boolean;
}

let csrfToken = '';
let accessToken = '';
let currentUser: NexusUser | null = null;

const listeners = new Set<(u: NexusUser | null) => void>();
export function onAuthChange(fn: (u: NexusUser | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { for (const fn of listeners) fn(currentUser); }

export function getAccessToken(): string { return accessToken; }

/** Test-only: clear the in-memory auth + CSRF state so tests don't leak. */
export function __resetAuthState(): void {
  csrfToken = '';
  accessToken = '';
  currentUser = null;
  listeners.clear();
}

/** Current double-submit CSRF token (populated by refreshCsrf). Shared by all
 *  unsafe requests so we don't mint multiple tokens / fight the cookie. */
export function getCsrfToken(): string { return csrfToken; }

export async function refreshCsrf(): Promise<void> {
  if (csrfToken) return;
  const r = await fetch('/csrf-token', { credentials: 'include' });
  if (r.ok) csrfToken = (await r.json()).token ?? '';
}

function csrfHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-csrf-token': csrfToken, ...extra };
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h = { ...extra };
  if (accessToken) h.authorization = `Bearer ${accessToken}`;
  return h;
}

async function postJson(path: string, body: unknown): Promise<any> {
  await refreshCsrf();
  const r = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders(), ...authHeaders() },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(data.error?.message ?? data.error ?? `${path} failed (${r.status})`);
  return data;
}

export async function register(email: string, password: string, name?: string): Promise<NexusUser> {
  const data = await postJson('/auth/register', { email, password, name });
  accessToken = data.accessToken;
  currentUser = data.user;
  emit();
  return data.user;
}

export async function login(email: string, password: string): Promise<NexusUser> {
  const data = await postJson('/auth/login', { email, password });
  accessToken = data.accessToken;
  currentUser = data.user;
  emit();
  return data.user;
}

export async function logout(): Promise<void> {
  try { await postJson('/auth/logout', {}); } catch { /* ignore */ }
  accessToken = '';
  currentUser = null;
  csrfToken = '';
  emit();
}

export async function loadMe(): Promise<NexusUser | null> {
  if (!accessToken) { currentUser = null; emit(); return null; }
  try {
    const r = await fetch('/auth/me', { credentials: 'include', headers: authHeaders() });
    if (!r.ok) { accessToken = ''; currentUser = null; emit(); return null; }
    currentUser = await r.json();
    emit();
    return currentUser;
  } catch {
    currentUser = null; emit(); return null;
  }
}

/** Refresh the access token using the HttpOnly refresh cookie. */
export async function refresh(): Promise<boolean> {
  await refreshCsrf();
  const r = await fetch('/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
  });
  if (!r.ok) { accessToken = ''; currentUser = null; emit(); return false; }
  const data = await r.json();
  accessToken = data.accessToken;
  return true;
}

// OAuth: the backend owns the redirect flow. We just navigate the browser to
// the provider start endpoint; the backend redirects to the provider, which
// calls back into the backend, which sets cookies + redirects here with a
// ?token query that we promote into memory.
export function startOAuth(provider: 'google' | 'facebook'): void {
  const next = window.location.origin + window.location.pathname;
  window.location.assign(`/auth/${provider}?return=${encodeURIComponent(next)}`);
}

/** On page load, if ?token= is present (post-OAuth redirect), promote it. */
export function consumeOAuthToken(): boolean {
  const u = new URL(window.location.href);
  const t = u.searchParams.get('token');
  if (t) {
    accessToken = t;
    u.searchParams.delete('token');
    window.history.replaceState({}, '', u.toString());
    return true;
  }
  return false;
}