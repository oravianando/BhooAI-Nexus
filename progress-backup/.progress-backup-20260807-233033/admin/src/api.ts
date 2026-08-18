// Admin API client. Auth/admin/plugin calls go to the backend (proxied to :8080
// by Vite in dev); process-control calls go to the supervisor control API (:7474).

const SUPERVISOR = (import.meta.env.VITE_SUPERVISOR_URL as string | undefined) ?? 'http://localhost:7474';

let csrfToken = '';
let accessToken = '';
export function setAccessToken(t: string) { accessToken = t; }
export function getAccessToken() { return accessToken; }

async function refreshCsrf(): Promise<void> {
  // The server rotates the CSRF cookie on EVERY safe request, so a cached
  // token goes stale the moment any other GET runs (status polling, tables…).
  // Always re-fetch so the header matches the current cookie.
  const r = await fetch('/csrf-token', { credentials: 'include' });
  csrfToken = (await r.json()).token ?? '';
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (accessToken) h.authorization = `Bearer ${accessToken}`;
  return h;
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(path, { credentials: 'include', ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  if (r.status === 401) throw new Error('Unauthorized');
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// ---- auth ----
export async function login(email: string, password: string): Promise<{ user: any; accessToken: string }> {
  await refreshCsrf();
  const r = await fetch('/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error('Login failed');
  const data = await r.json();
  accessToken = data.accessToken;
  return data;
}

export async function registerAndLogin(email: string, password: string, name: string): Promise<{ user: any; accessToken: string }> {
  await refreshCsrf();
  const r = await fetch('/auth/register', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ email, password, name }),
  });
  if (!r.ok) throw new Error('Registration failed');
  const data = await r.json();
  accessToken = data.accessToken;
  return data;
}

// ---- admin (backend) ----
export interface ConfigFile { path: string; content: string; }
export interface AdminConfig { runtime: Record<string, unknown>; config: Record<string, unknown>; file: ConfigFile | null; project?: { name: string; path: string; dbName: string; status?: string }; }
export interface EnvEntry { key: string; value: string | null; secret: boolean; configPath?: string; }
export interface AdminEnv { fileName?: string; path: string; exists: boolean; entries: EnvEntry[]; note?: string; }
export interface DatabaseInfo { name: string; sizeOnDisk: number; collections: Array<{ name: string; count: number }>; }
export interface UserRecord { _id: string; email: string; name?: string; roles: string[]; emailVerified?: boolean; createdAt?: string; updatedAt?: string; }
export interface RolePermission { label: string; detail: string; }
export interface RoleDefinition { id: string; label: string; icon: string; accent: string; description: string; grants: RolePermission[]; restricts: RolePermission[]; }
export interface GeneratedSchema {
  collection: string;
  model: string;
  fields: Array<{ name: string; type: string; required?: boolean; unique?: boolean; enum?: string[]; description?: string }>;
  jsonSchema: { $jsonSchema: { bsonType: string; required?: string[]; properties: Record<string, unknown> } };
}

export const getAdminConfig = () => adminFetch('/admin/config');
export const getAdminEnv = (file?: string): Promise<AdminEnv> => adminFetch(file ? `/admin/env?file=${encodeURIComponent(file)}` : '/admin/env');
export async function putAdminEnv(entries: EnvEntry[], file?: string): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/env', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ entries, file }) });
}
export async function putAdminConfig(overrides: Record<string, unknown>): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/config', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(overrides) });
}
export async function putAdminConfigFile(content: string): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/config/file', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ content }) });
}
export const getPlugins = () => adminFetch('/admin/plugins');
export const getUsers = () => adminFetch('/admin/users');
export const getRoles = () => adminFetch('/admin/roles');
export async function putUserRoles(id: string, roles: string[]): Promise<any> {
  await refreshCsrf();
  return adminFetch(`/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ roles }) });
}
export const getMetrics = () => adminFetch('/admin/metrics');

// ---- preflight diagnostics (computed by the Python AI server) ----
export interface PreflightCheck { name: string; kind: string; ok: boolean; latencyMs?: number; status?: number | null; url?: string; host?: string; port?: number; error?: string; errorCategory?: string; }
export interface PreflightReport { ranAt: string; durationMs: number; engineOk?: boolean; passed: number; warnings: number; failed: number; checks: PreflightCheck[]; }
export async function runPreflight(): Promise<PreflightReport> {
  await refreshCsrf();
  return adminFetch('/admin/preflight', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
}

// ---- config / env linting (computed by the Python AI server) ----
export interface LintCheck { key: string; severity: 'error' | 'warning' | 'info' | 'ok'; kind: string; message: string; errorCategory?: string; }
export interface LintReport { ranAt: string; engineOk?: boolean; summary: { error: number; warning: number; info: number; ok: number }; checks: LintCheck[]; }
export async function runLintEnv(file?: string): Promise<LintReport> {
  await refreshCsrf();
  return adminFetch('/admin/lint/env', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(file ? { env: file } : {}) });
}
export async function runLintConfig(): Promise<LintReport> {
  await refreshCsrf();
  return adminFetch('/admin/lint/config', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
}

// ---- payments (admin) ----
export interface PaymentProviderStatus {
  name: string;
  enabled: boolean;
  sandbox: boolean;
  configured: boolean;
  live: boolean;
  ok: boolean;
  detail?: string;
  error?: string;
  note?: string;
}
export const getPaymentOrders = (provider?: string) => adminFetch(`/admin/payments/orders${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`);
export const getPaymentTransactions = (provider?: string) => adminFetch(`/admin/payments/transactions${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`);
export const getPaymentStatus = () => adminFetch('/admin/payments/status');
export async function createPaymentOrder(opts: { provider: string; amount: number; currency?: string; reference?: string; description?: string }): Promise<any> {
  await refreshCsrf();
  return adminFetch('/payments/order', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify({ ...opts, reference: opts.reference ?? `test_${Date.now()}` }),
  });
}

// ---- databases (admin) ----
export const getDatabases = () => adminFetch('/admin/databases');
export async function createDatabase(name: string): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/databases', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ name }) });
}
export async function deleteDatabase(db: string): Promise<any> {
  await refreshCsrf();
  return adminFetch(`/admin/databases/${encodeURIComponent(db)}`, { method: 'DELETE', headers: { 'x-csrf-token': csrfToken } });
}
export async function createCollection(db: string, payload: { name: string; jsonSchema?: unknown }): Promise<any> {
  await refreshCsrf();
  return adminFetch(`/admin/databases/${encodeURIComponent(db)}/collections`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(payload) });
}
export async function modifyCollection(db: string, name: string, payload: { newName?: string; validator?: unknown }): Promise<any> {
  await refreshCsrf();
  return adminFetch(`/admin/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(payload) });
}
export async function dropCollection(db: string, name: string): Promise<any> {
  await refreshCsrf();
  return adminFetch(`/admin/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'x-csrf-token': csrfToken } });
}
export async function getCollectionDocs(db: string, name: string): Promise<{ count: number; docs: unknown[] }> {
  return adminFetch(`/admin/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(name)}/docs`);
}

// ---- AI schema generation (admin) ----
export interface AiStatus {
  checkedAt: string;
  aiServer: { ok: boolean; error?: string; detail?: { status?: string; providers?: string[] } };
  openai: { ok: boolean; error?: string; detail?: { provider?: string; modelCount?: number; models?: string[] } };
  ollama: { ok: boolean; error?: string; detail?: { provider?: string; modelCount?: number; models?: string[] } };
  autoResolvesTo: 'openai' | 'ollama';
}
export const getAiStatus = () => adminFetch('/admin/ai/status');
export async function generateSchema(prompt: string, opts: { model?: string; provider?: string } = {}): Promise<GeneratedSchema> {
  await refreshCsrf();
  return adminFetch('/admin/schemas/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ prompt, ...opts }) });
}

// ---- supervisor control API ----
export interface ServiceState { name: string; status: string; pid?: number; startedAt?: number; lastExitCode?: number | null; }
export async function getServices(): Promise<ServiceState[]> {
  const r = await fetch(`${SUPERVISOR}/status`);
  return (await r.json()).services ?? [];
}
export async function controlService(action: 'start' | 'stop' | 'restart', name: string): Promise<void> {
  await fetch(`${SUPERVISOR}/${action}?name=${encodeURIComponent(name)}`, { method: 'POST' });
}
export async function getServiceLogs(name: string): Promise<string[]> {
  const r = await fetch(`${SUPERVISOR}/logs?name=${encodeURIComponent(name)}`);
  return (await r.json()).logs ?? [];
}
