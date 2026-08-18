// Admin API client. Auth/admin/plugin calls go to the backend (proxied by Vite
// in dev); process-control calls go to the supervisor control API
// (default :7474, auto-allotted upward when busy — the backend reports the real port).

const SUPERVISOR_FALLBACK = (import.meta.env.VITE_SUPERVISOR_URL as string | undefined) ?? 'http://localhost:7474';

let supervisorUrl = '';
export async function resolveSupervisor(): Promise<string> {
  if (supervisorUrl) return supervisorUrl;
  if (import.meta.env.VITE_SUPERVISOR_URL) {
    supervisorUrl = import.meta.env.VITE_SUPERVISOR_URL as string;
    return supervisorUrl;
  }
  try {
    const info = await adminFetch('/admin/supervisor');
    if (info?.url) {
      supervisorUrl = info.url;
      return supervisorUrl;
    }
    if (info?.port) {
      supervisorUrl = `http://127.0.0.1:${info.port}`;
      return supervisorUrl;
    }
  } catch { /* fall through to the default */ }
  supervisorUrl = SUPERVISOR_FALLBACK;
  return supervisorUrl;
}

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
  const r = await fetch(path, { credentials: 'include', cache: 'no-store', ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
  if (r.status === 401) throw new Error('Unauthorized');
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// ---- auth ----
/** Extract a friendly message from a failed /auth response (server sends { error: { message } }). */
async function authErrorMessage(r: Response, fallback: string): Promise<string> {
  try {
    const body = await r.json();
    const msg = body?.error?.message ?? body?.message ?? body?.detail;
    if (typeof msg === 'string' && msg.trim()) return msg;
  } catch { /* non-JSON body — fall through */ }
  switch (r.status) {
    case 400: return 'Invalid request — please check the form.';
    case 401: return 'Invalid email or password.';
    case 403: return 'Access denied.';
    case 404: return 'Auth endpoint not found — is the backend running?';
    case 409: return 'A user with that email already exists.';
    case 429: return 'Too many attempts — please wait a moment and retry.';
    case 500: return 'Server error — please try again later.';
    default: return `${fallback} (HTTP ${r.status})`;
  }
}

export async function login(email: string, password: string): Promise<{ user: any; accessToken: string }> {
  await refreshCsrf();
  let r: Response;
  try {
    r = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error('Cannot reach the backend — is the server running?');
  }
  if (!r.ok) throw new Error(await authErrorMessage(r, 'Login failed'));
  const data = await r.json();
  if (!data?.accessToken) throw new Error('Login succeeded but no access token was returned.');
  accessToken = data.accessToken;
  return data;
}

export async function registerAndLogin(email: string, password: string, name: string): Promise<{ user: any; accessToken: string }> {
  await refreshCsrf();
  let r: Response;
  try {
    r = await fetch('/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ email, password, name }),
    });
  } catch {
    throw new Error('Cannot reach the backend — is the server running?');
  }
  if (!r.ok) throw new Error(await authErrorMessage(r, 'Registration failed'));
  const data = await r.json();
  if (!data?.accessToken) throw new Error('Registration succeeded but no access token was returned.');
  accessToken = data.accessToken;
  return data;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Restore the admin session from the HttpOnly refresh cookie (app boot).
 * /auth/refresh returns a fresh access token; the user is then fetched via
 * /auth/me. Single-flight so React StrictMode's double effect-run issues one
 * network request — the backend rotates refresh tokens and revokes a session
 * family on reuse, so concurrent refreshes would log the user out.
 */
export async function refresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      await refreshCsrf();
      const r = await fetch('/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      });
      if (!r.ok) return false;
      const data = await r.json();
      accessToken = data.accessToken;
      const me = await adminFetch('/auth/me');
      return !!me?.user?.email;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

// ---- admin (backend) ----
export interface ConfigFile { path: string; content: string; }
export interface AdminConfig { runtime: Record<string, unknown>; config: Record<string, unknown>; file: ConfigFile | null; project?: { name: string; path: string; dbName: string; status?: string; version?: string }; }
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
export async function updateProfile(name: string): Promise<{ ok: boolean; user: any }> {
  await refreshCsrf();
  return adminFetch('/auth/profile', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ name }) });
}
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  await refreshCsrf();
  return adminFetch('/auth/change-password', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ currentPassword, newPassword }) });
}
export async function updateProject(patch: { name?: string; version?: string }): Promise<{ ok: boolean; project?: AdminConfig['project'] }> {
  await refreshCsrf();
  return adminFetch('/admin/project', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(patch) });
}

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
export interface PaymentProviderField {
  field: string;
  label: string;
  hasValue: boolean;
}
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
  fields?: PaymentProviderField[];
}
export const getPaymentOrders = (provider?: string) => adminFetch(`/admin/payments/orders${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`);
export const getPaymentTransactions = (provider?: string) => adminFetch(`/admin/payments/transactions${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`);
export const getPaymentStatus = () => adminFetch('/admin/payments/status');
export async function updatePaymentProvider(id: string, patch: { enabled?: boolean; sandbox?: boolean }): Promise<{ ok: boolean; provider: { name: string; enabled: boolean; sandbox: boolean } }> {
  await refreshCsrf();
  return adminFetch(`/admin/payments/providers/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(patch) });
}
export async function savePaymentProviderKeys(id: string, keys: Record<string, string>): Promise<{ ok: boolean; savedFields: string[]; persistence: { runtime: boolean; database: boolean }; provider: { name: string; enabled: boolean; sandbox: boolean; configured: boolean } }> {
  await refreshCsrf();
  return adminFetch(`/admin/payments/providers/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(keys) });
}
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

// ---- AI agents playground (admin) ----
export interface AiModelInfo { id: string; owned_by?: string }
export interface AiModelsResponse { provider?: string; data: AiModelInfo[]; error?: string }
export async function getAiModels(provider?: string): Promise<AiModelsResponse> {
  const q = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  return adminFetch(`/ai/models${q}`);
}
export interface AiChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export async function aiChat(model: string, messages: AiChatMessage[], provider?: string): Promise<{ content: string; model: string; raw: any }> {
  await refreshCsrf();
  const res = await fetch('/ai/chat/completions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, ...authHeaders() },
    body: JSON.stringify({ model, messages, stream: false, provider }),
  });
  if (!res.ok) throw new Error(`AI chat failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { content: data?.choices?.[0]?.message?.content ?? '', model: data?.model ?? model, raw: data };
}
export async function aiChatStream(model: string, messages: AiChatMessage[], provider: string | undefined, onChunk: (text: string) => void, signal?: AbortSignal): Promise<void> {
  await refreshCsrf();
  const res = await fetch('/ai/chat/completions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, ...authHeaders() },
    body: JSON.stringify({ model, messages, stream: true, provider }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`AI chat stream failed: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        // Detect error events from the backend (e.g. invalid API key, provider down).
        if (json?.error?.message) throw new Error(String(json.error.message));
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch (e) {
        // Re-throw actual errors (not JSON parse failures) so the UI shows them.
        if (e instanceof Error && e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }
}

// ---- AI provider management (admin) ----
export interface AiProviderView {
  id: string;
  label: string;
  baseUrl: string;
  enabled: boolean;
  apiKey: string;
  hasApiKey: boolean;
  defaultModel?: string;
}
export interface AiProviderPersistence {
  runtime: boolean;
  database: boolean;
}
export async function getAiProviders(): Promise<{ providers: AiProviderView[] }> {
  return adminFetch('/admin/ai/providers');
}
export async function updateAiProvider(id: string, patch: { apiKey?: string; enabled?: boolean; defaultModel?: string; label?: string; baseUrl?: string }): Promise<{ ok: boolean; persistence?: AiProviderPersistence; provider: AiProviderView }> {
  await refreshCsrf();
  return adminFetch(`/admin/ai/providers/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(patch) });
}
export async function addAiProvider(provider: { id: string; label: string; baseUrl: string; apiKey?: string; defaultModel?: string; enabled?: boolean }): Promise<{ ok: boolean; persistence?: AiProviderPersistence; provider: AiProviderView }> {
  await refreshCsrf();
  return adminFetch('/admin/ai/providers', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(provider) });
}
export async function deleteAiProvider(id: string): Promise<{ ok: boolean; persistence?: AiProviderPersistence }> {
  await refreshCsrf();
  return adminFetch(`/admin/ai/providers/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-csrf-token': csrfToken } });
}

/** Result of probing a single provider's connectivity via the Python AI server. */
export interface AiProviderTestResult {
  ok: boolean;
  provider: string;
  modelCount?: number;
  models?: string[];
  error?: string;
  checkedAt: string;
}

/** POST /admin/ai/providers/:id/test — probe a single provider (lists models). */
export async function testAiProvider(id: string): Promise<AiProviderTestResult> {
  await refreshCsrf();
  return adminFetch(`/admin/ai/providers/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
  });
}

// ---- supervisor control API ----
export interface ServiceState { name: string; status: string; pid?: number; startedAt?: number; lastExitCode?: number | null; }
export async function getServices(): Promise<ServiceState[]> {
  const r = await fetch(`${await resolveSupervisor()}/status`);
  return (await r.json()).services ?? [];
}
export async function controlService(action: 'start' | 'stop' | 'restart', name: string): Promise<void> {
  await fetch(`${await resolveSupervisor()}/${action}?name=${encodeURIComponent(name)}`, { method: 'POST' });
}
export async function getServiceLogs(name: string): Promise<string[]> {
  const r = await fetch(`${await resolveSupervisor()}/logs?name=${encodeURIComponent(name)}`);
  return (await r.json()).logs ?? [];
}
/** Structured cross-service log entry from the supervisor's aggregated buffer. */
export interface LogEntry {
  service: string;
  ts: number;
  source: 'stdout' | 'stderr' | 'system';
  level: 'info' | 'warn' | 'error';
  line: string;
}
export async function getAllLogs(opts: { service?: string; level?: 'error' | 'warn' | 'info'; q?: string } = {}): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (opts.service) params.set('service', opts.service);
  if (opts.level) params.set('level', opts.level);
  if (opts.q) params.set('q', opts.q);
  const r = await fetch(`${await resolveSupervisor()}/logs/all${params.toString() ? `?${params}` : ''}`);
  return (await r.json()).logs ?? [];
}
export async function clearLogs(): Promise<void> {
  await fetch(`${await resolveSupervisor()}/logs/clear`, { method: 'POST' });
}
export async function getSupervisorInfo(): Promise<{ port?: number | null; url?: string | null }> {
  return adminFetch('/admin/supervisor');
}

// ---- HTTP request log (backend /admin/requests/*) ----
export interface RequestLogEntry {
  time: number;
  method: string;
  path: string;
  url?: string;
  status: number;
  durationMs: number;
  ip?: string;
  referer?: string;
  userAgent?: string;
  origin?: string;
  requestId?: string;
  route?: string;
}
export type RequestSeriesRange = 'today' | '5d' | 'week' | 'month' | 'year';
export interface RequestSeries {
  range: RequestSeriesRange;
  bucketMs: number;
  start: number;
  end: number;
  total: number;
  points: Array<{ t: number; count: number }>;
}
export async function getRequestLogs(limit = 100): Promise<RequestLogEntry[]> {
  const r = await adminFetch(`/admin/requests?limit=${limit}`);
  return r.requests ?? [];
}
export async function getRequestSeries(range: RequestSeriesRange): Promise<RequestSeries> {
  const r = await adminFetch(`/admin/requests/series?range=${encodeURIComponent(range)}`);
  return r.series;
}

// ---- cluster orchestration (backend /admin/cluster/*) ----
export interface ClusterNodeView {
  id: string;
  role: 'backend' | 'files' | 'database' | 'ai';
  tier: string;
  version: string;
  baseUrl: string;
  serviceUrl?: string;
  status: 'pending' | 'ready' | 'unreachable';
  enabled: boolean;
  registeredAt: string;
  lastSeenAt: string;
  rps: number;
  health?: { ok: boolean; time: string; services?: Record<string, boolean> };
  metrics?: { nodeId: string; rps: number; cpu: number; memoryMb: number; sampledAt: number };
}
export interface ClusterOverview {
  enabled: boolean;
  running: boolean;
  lbHost: string;
  lbPort: number;
  nodeAgentHost: string;
  controlPort: number;
  autoscale: { enabled: boolean; mode: 'auto' | 'manual'; minNodes: number; maxNodes: number; cooldownMs: number; cpuHigh: number; rpsPerNodeHigh: number; rpsPerNodeLow: number };
  nodes: ClusterNodeView[];
}
export interface ClusterSetup {
  master: { enabled: boolean; lbHost: string; lbPort: number; nodeAgentHost: string; nodeAgentPort: number; registryFile: string; serverUrl: string };
  /** This server's own node agent — URL + commands to hand to a remote master. */
  self: { host: string; port: number; agentUrl: string; serve: string; link: string; token: string };
  slaves: Array<{ role: string; label: string; host: string; port: number; serve: string; link: string }>;
  runtime?: Record<string, unknown>;
  note?: string;
}
export async function getClusterOverview(): Promise<ClusterOverview> {
  return adminFetch('/admin/cluster/overview');
}
export async function getClusterSetup(): Promise<ClusterSetup> {
  return adminFetch('/admin/cluster/setup');
}
export async function saveClusterSetup(master: Partial<ClusterSetup['master']>): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ master }) });
}
export async function clusterLink(nodeUrl: string, token?: string): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/link', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ nodeUrl, token }) });
}
export async function generateClusterToken(): Promise<{ token: string }> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/generate-token', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
}
export async function clusterUnlink(id: string): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/unlink', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ id }) });
}
export async function clusterExec(id: string, action: 'start' | 'stop' | 'restart' | 'kill'): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/exec', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ id, action }) });
}
export async function clusterScale(target: number): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/scale', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ target }) });
}
export async function clusterPoll(): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/poll', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
}

export async function clusterStart(): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/start', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
}

export async function clusterStop(): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/stop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
}

export interface ClusterNodeAgentStatus {
  running: boolean;
  pid?: number;
  nodeId?: string;
  role: string;
  port: number;
  agentUrl: string;
  token: string;
  startedAt?: string;
}
export async function getClusterNodeStatus(): Promise<ClusterNodeAgentStatus> {
  return adminFetch('/admin/cluster/node/status');
}
export async function clusterNodeStart(): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/node/start', { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: '{}' });
}
export async function clusterNodeStop(): Promise<any> {
  await refreshCsrf();
  return adminFetch('/admin/cluster/node/stop', { method: 'POST', headers: { 'x-csrf-token': csrfToken }, body: '{}' });
}
