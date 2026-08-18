/**
 * AI-enabled schema generation for MongoDB + AI provider management.
 *
 * Routes:
 *   GET  /admin/ai/status            — probe the Python AI server / OpenAI / Ollama
 *   POST /admin/schemas/generate     — generate a MongoDB $jsonSchema from text
 *   GET  /admin/ai/providers         — list configured providers (keys masked)
 *   POST /admin/ai/providers         — add a custom provider
 *   PUT  /admin/ai/providers/:id     — update a provider (key, enabled, model…)
 *   DELETE /admin/ai/providers/:id   — remove a provider + its .env key
 *   POST /admin/ai/providers/:id/test — probe a single provider's connectivity
 *
 * Provider data is persisted in three places:
 *   - in-memory aiConfig.providers array (live, so the AI proxy sees changes
 *     without a restart),
 *   - nexus.runtime.json `ai.providers` override (survives restarts; secrets
 *     are NOT written here — only id/label/baseUrl/enabled/defaultModel),
 *   - nexus_projects.settings.aiProviders (MongoDB, for cross-project visibility),
 *   - API keys → .env as NEXUS_AI_<ID>_API_KEY (never in the config file).
 */
import type { Router, Middleware } from '@bhooai/nexus-core';
import type { AiProviderConfig } from '@bhooai/nexus-core';
import { AiClient } from '@bhooai/nexus-ai-client';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getProjectInfoCollection } from '@bhooai/nexus-data';

export interface SchemaAIConfig {
  serverUrl: string;
  timeoutMs: number;
  /** Model to use for generation (config: `ai.schemaModel`). */
  model?: string;
  /** Pre-built client (tests inject a stub). */
  client?: Pick<AiClient, 'chat' | 'listModels'>;
  /** AI providers from config (mutable — the admin endpoints update this in
   *  place so the AI proxy sees new keys/enabled state without a restart). */
  providers?: AiProviderConfig[];
  /** Project root — used to read/write the .env file + nexus.runtime.json. */
  root?: string;
  /** Canonical project name — used to persist settings to nexus_projects. */
  projectName?: string;
}

export const DEFAULT_SCHEMA_MODEL = 'gpt-4o-mini';

/** Per-check result for the AI status probe. */
export interface AiProbeResult<T = unknown> {
  ok: boolean;
  error?: string;
  detail?: T;
}

export interface AiStatus {
  checkedAt: string;
  /** Python AI server reachable? */
  aiServer: AiProbeResult<{ status?: string; providers?: string[] }>;
  openai: AiProbeResult<{ provider?: string; modelCount?: number; models?: string[] }>;
  ollama: AiProbeResult<{ provider?: string; modelCount?: number; models?: string[] }>;
  /** Which provider 'auto' currently resolves to on the AI server. */
  autoResolvesTo: 'openai' | 'ollama';
}

const SYSTEM_PROMPT = `You are a MongoDB schema designer. Given the user's description of the data they want to store, produce ONLY a valid JSON object — no markdown fences, no commentary — shaped exactly like this:

{
  "collection": "<plural, snake_case collection name>",
  "fields": [
    { "name": "<field>", "type": "String|Number|Boolean|Date|ObjectId|Array|Mixed", "required": false, "unique": false, "enum": ["a","b"], "description": "<short note>" }
  ],
  "jsonSchema": { "$jsonSchema": { "bsonType": "object", "required": ["..."], "properties": { "<field>": { "bsonType": "..." } } } }
}

Rules:
- Every listed field must appear in properties with a matching bsonType (string, int/double/long, bool, date, objectId, array, object).
- required lists only fields marked required: true. unique fields must be marked with a unique index note in their description.
- Give the collection a sensible plural snake_case name.`;

/** Normalized result returned to the admin UI. */
export interface GeneratedSchema {
  collection: string;
  fields: Array<{ name: string; type: string; required?: boolean; unique?: boolean; enum?: string[]; description?: string }>;
  jsonSchema: { $jsonSchema: { bsonType: string; required?: string[]; properties: Record<string, unknown> } };
  model: string;
}

/** Env var name for a provider's API key (e.g. "together" → "NEXUS_AI_TOGETHER_API_KEY"). */
function providerEnvKey(providerId: string): string {
  return `NEXUS_AI_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
}

/** Write a single key=value line into the .env file (creates or updates it). */
async function writeEnvKey(root: string, key: string, value: string): Promise<void> {
  const envPath = resolve(root, '.env');
  const content = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const lines = content.split(/\r?\n/);
  const regex = new RegExp(`^(\\s*export\\s+)?${key}\\s*=`);
  let found = false;
  const output = lines.map((line) => {
    if (regex.test(line)) { found = true; return `${key}=${value}`; }
    return line;
  });
  if (!found) {
    if (output.length > 0 && output[output.length - 1] === '') output[output.length - 1] = `${key}=${value}`;
    else output.push(`${key}=${value}`);
  }
  const tempPath = `${envPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${output.join('\n')}\n`, 'utf8');
  try { await rename(tempPath, envPath); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST' && (err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
    await unlink(envPath).catch(() => undefined);
    await rename(tempPath, envPath);
  }
}

/** Delete a key from the .env file. */
async function deleteEnvKey(root: string, key: string): Promise<void> {
  const envPath = resolve(root, '.env');
  if (!existsSync(envPath)) return;
  const content = await readFile(envPath, 'utf8');
  const regex = new RegExp(`^(\\s*export\\s+)?${key}\\s*=`);
  const output = content.split(/\r?\n/).filter((line) => !regex.test(line));
  if (output.length === content.split(/\r?\n/).length) return;
  const tempPath = `${envPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${output.join('\n')}\n`, 'utf8');
  try { await rename(tempPath, envPath); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST' && (err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
    await unlink(envPath).catch(() => undefined);
    await rename(tempPath, envPath);
  }
}

/** Persist the provider list (sans API keys) to nexus.runtime.json so the
 *  change survives restarts. The runtime file is a JSON object of DeepPartial
 *  config overrides; we merge `ai.providers` into it. */
async function persistRuntimeProviders(root: string, providers: AiProviderConfig[]): Promise<void> {
  const runtimePath = join(root, 'nexus.runtime.json');
  let overrides: Record<string, any> = {};
  if (existsSync(runtimePath)) {
    try { overrides = JSON.parse(await readFile(runtimePath, 'utf8')) as Record<string, any>; }
    catch { /* corrupt file — start fresh */ }
  }
  const ai = (overrides.ai ?? {}) as Record<string, any>;
  ai.providers = providers.map((p) => ({
    id: p.id, label: p.label, baseUrl: p.baseUrl,
    enabled: p.enabled,
    ...(p.defaultModel ? { defaultModel: p.defaultModel } : {}),
  }));
  overrides.ai = ai;
  const tempPath = `${runtimePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(overrides, null, 2) + '\n', 'utf8');
  try { await rename(tempPath, runtimePath); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST' && (err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
    await unlink(runtimePath).catch(() => undefined);
    await rename(tempPath, runtimePath);
  }
}

/** Persist the provider list (sans API keys) to the nexus_projects.settings.aiProviders
 *  field in MongoDB, so other admin views / projects can see the configured providers. */
async function persistDbProviders(projectName: string | undefined, providers: AiProviderConfig[]): Promise<void> {
  if (!projectName) throw new Error('project name is unavailable for database persistence');
  const coll = await getProjectInfoCollection();
  const result = await coll.updateOne(
    { name: projectName },
    { $set: { 'settings.aiProviders': providers.map((p) => ({
      id: p.id, label: p.label, baseUrl: p.baseUrl,
      enabled: p.enabled,
      ...(p.defaultModel ? { defaultModel: p.defaultModel } : {}),
    })) } },
    { upsert: false },
  );
  if (result.matchedCount === 0) throw new Error(`project "${projectName}" was not found in nexus_projects`);
}

export function registerSchemaRoutes(router: Router, aiConfig: SchemaAIConfig, guard: Middleware[]): void {
  const model = aiConfig.model ?? DEFAULT_SCHEMA_MODEL;

  // On boot, load any persisted API keys from .env into the in-memory providers.
  if (aiConfig.providers) {
    for (const p of aiConfig.providers) {
      const envKey = providerEnvKey(p.id);
      const simpleKey = `${p.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
      const envVal = process.env[envKey] ?? process.env[simpleKey];
      if (envVal) p.apiKey = envVal;
    }
  }

  /** Persist providers and report each durable store independently. */
  const persistAll = async (): Promise<{ runtime: boolean; database: boolean }> => {
    const providers = aiConfig.providers ?? [];
    let runtime = false;
    let database = false;
    try {
      if (aiConfig.root) {
        await persistRuntimeProviders(aiConfig.root, providers);
        runtime = true;
      }
    } catch { /* surfaced in the response */ }
    try {
      await persistDbProviders(aiConfig.projectName, providers);
      database = true;
    } catch { /* surfaced in the response */ }
    return { runtime, database };
  };

  router.get('/admin/ai/status', async (ctx) => {
    const ai = aiConfig.client ?? new AiClient({ serverUrl: aiConfig.serverUrl, timeoutMs: 10_000 });
    const probe = async <T>(fn: () => Promise<T>): Promise<AiProbeResult<T>> => {
      try {
        return { ok: true, detail: await fn() };
      } catch (e) {
        return { ok: false, error: (e as Error).message || 'unknown error' };
      }
    };

    const aiServer = await probe(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(`${aiConfig.serverUrl.replace(/\/+$/, '')}/health`, { signal: controller.signal });
        if (!res.ok) throw new Error(`AI server responded with HTTP ${res.status}`);
        return (await res.json()) as { status?: string; providers?: string[] };
      } finally {
        clearTimeout(timer);
      }
    });

    const listModels = async (provider: 'openai' | 'ollama') => {
      const res = await ai.listModels(provider);
      const models = (res.data ?? []).map((m) => String(m.id ?? m)).slice(0, 10);
      return { provider: res.provider, modelCount: (res.data ?? []).length, models };
    };
    const openai = await probe(() => listModels('openai'));
    const ollama = await probe(() => listModels('ollama'));

    const autoResolvesTo =
      aiServer.detail && Array.isArray(aiServer.detail.providers)
        ? (aiServer.detail.providers.includes('openai') ? 'openai' : 'ollama')
        : 'ollama';

    ctx.json({
      checkedAt: new Date().toISOString(),
      aiServer,
      openai,
      ollama,
      autoResolvesTo,
    } satisfies AiStatus);
  }, guard);

  router.post('/admin/schemas/generate', async (ctx) => {
    const body = (ctx.body ?? {}) as { prompt?: unknown; model?: unknown; provider?: unknown };
    const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : '';
    if (!prompt) {
      ctx.json({ error: 'prompt (string) is required — describe the data you want to store' }, 400);
      return;
    }
    const usedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : model;

    const ai = aiConfig.client ?? new AiClient({ serverUrl: aiConfig.serverUrl, timeoutMs: aiConfig.timeoutMs });
    let text: string;
    try {
      const reply = await ai.chat({
        model: usedModel,
        temperature: 0,
        provider: body.provider === 'auto' || body.provider === undefined ? undefined : (body.provider as 'openai' | 'ollama'),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      });
      text = reply.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      ctx.status(502);
      ctx.json({ error: `AI server error: ${(e as Error).message}` });
      return;
    }

    let parsed: GeneratedSchema;
    try {
      parsed = extractSchema(text);
    } catch (e) {
      ctx.json({ error: `AI response was not a usable schema: ${(e as Error).message}` }, 502);
      return;
    }
    ctx.json({ ...parsed, model: usedModel });
  }, guard);

  // ── AI provider management ───────────────────────────────────────────

  /** GET /admin/ai/providers — list all configured providers (API keys masked). */
  router.get('/admin/ai/providers', async (ctx) => {
    const providers = aiConfig.providers ?? [];
    ctx.json({
      providers: providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? '••••••••' : '',
        hasApiKey: !!p.apiKey,
      })),
    });
  }, guard);

  /** PUT /admin/ai/providers/:id — update a provider. API keys are persisted
   *  to .env as NEXUS_AI_<ID>_API_KEY so they survive restarts. */
  router.put('/admin/ai/providers/:id', async (ctx) => {
    const id = ctx.params.id;
    const body = (ctx.body ?? {}) as { apiKey?: string; enabled?: boolean; defaultModel?: string; label?: string; baseUrl?: string };
    const providers = aiConfig.providers ?? [];
    const provider = providers.find((p) => p.id === id);
    if (!provider) { ctx.json({ error: `provider "${id}" not found` }, 404); return; }
    if (typeof body.enabled === 'boolean') provider.enabled = body.enabled;
    if (typeof body.defaultModel === 'string' && body.defaultModel.trim()) provider.defaultModel = body.defaultModel.trim();
    if (typeof body.label === 'string' && body.label.trim()) provider.label = body.label.trim();
    if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) provider.baseUrl = body.baseUrl.trim();
    if (typeof body.apiKey === 'string' && body.apiKey && body.apiKey !== '••••••••') {
      provider.apiKey = body.apiKey;
      if (aiConfig.root) {
        try {
          await writeEnvKey(aiConfig.root, providerEnvKey(id), body.apiKey);
          process.env[providerEnvKey(id)] = body.apiKey;
        } catch { /* non-fatal — in-memory key still works */ }
      }
    }
    const persistence = await persistAll();
    ctx.json({ ok: true, persistence, provider: { ...provider, apiKey: provider.apiKey ? '••••••••' : '', hasApiKey: !!provider.apiKey } });
  }, guard);

  /** POST /admin/ai/providers — add a custom provider.
   *  API key (if provided) is persisted to .env as NEXUS_AI_<ID>_API_KEY. */
  router.post('/admin/ai/providers', async (ctx) => {
    const body = (ctx.body ?? {}) as { id?: string; label?: string; baseUrl?: string; apiKey?: string; defaultModel?: string; enabled?: boolean };
    const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    if (!id || !label || !baseUrl) { ctx.json({ error: 'id, label and baseUrl are required' }, 400); return; }
    const providers = aiConfig.providers ?? [];
    if (providers.find((p) => p.id === id)) { ctx.json({ error: `provider "${id}" already exists` }, 409); return; }
    const apiKey = typeof body.apiKey === 'string' && body.apiKey ? body.apiKey : undefined;
    const provider: AiProviderConfig = {
      id, label, baseUrl,
      enabled: body.enabled ?? true,
      apiKey,
      defaultModel: typeof body.defaultModel === 'string' && body.defaultModel.trim() ? body.defaultModel.trim() : undefined,
    };
    providers.push(provider);
    aiConfig.providers = providers;
    if (apiKey && aiConfig.root) {
      try {
        await writeEnvKey(aiConfig.root, providerEnvKey(id), apiKey);
        process.env[providerEnvKey(id)] = apiKey;
      } catch { /* non-fatal */ }
    }
    const persistence = await persistAll();
    ctx.json({ ok: true, persistence, provider: { ...provider, apiKey: provider.apiKey ? '••••••••' : '', hasApiKey: !!provider.apiKey } });
  }, guard);

  /** DELETE /admin/ai/providers/:id — remove a provider + its .env key. */
  router.delete('/admin/ai/providers/:id', async (ctx) => {
    const id = ctx.params.id;
    const providers = aiConfig.providers ?? [];
    const idx = providers.findIndex((p) => p.id === id);
    if (idx === -1) { ctx.json({ error: `provider "${id}" not found` }, 404); return; }
    providers.splice(idx, 1);
    aiConfig.providers = providers;
    if (aiConfig.root) {
      try { await deleteEnvKey(aiConfig.root, providerEnvKey(id)); } catch { /* non-fatal */ }
    }
    const persistence = await persistAll();
    ctx.json({ ok: true, persistence });
  }, guard);

  /** POST /admin/ai/providers/:id/test — probe a single provider's connectivity. */
  router.post('/admin/ai/providers/:id/test', async (ctx) => {
    const id = ctx.params.id;
    const providers = aiConfig.providers ?? [];
    const provider = providers.find((p) => p.id === id);
    if (!provider) { ctx.json({ error: `provider "${id}" not found` }, 404); return; }
    const ai = aiConfig.client ?? new AiClient({ serverUrl: aiConfig.serverUrl, timeoutMs: 8_000 });
    try {
      const res = await ai.listModels(id);
      const models = (res.data ?? []).map((m) => String(m.id ?? m)).slice(0, 20);
      ctx.json({
        ok: true,
        provider: id,
        modelCount: (res.data ?? []).length,
        models,
        checkedAt: new Date().toISOString(),
      });
    } catch (e) {
      ctx.json({
        ok: false,
        provider: id,
        error: (e as Error).message || 'unknown error',
        checkedAt: new Date().toISOString(),
      }, 200);
    }
  }, guard);
}

/** Parse the AI reply (tolerates markdown fences and stray prose around the JSON). */
function extractSchema(text: string): GeneratedSchema {
  const cleaned = stripFences(text).trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found in the response');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
    collection?: unknown;
    fields?: unknown;
    jsonSchema?: unknown;
  };

  if (typeof parsed.collection !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(parsed.collection)) {
    throw new Error(`invalid collection name from AI: ${String(parsed.collection)}`);
  }
  if (!Array.isArray(parsed.fields)) throw new Error('"fields" must be an array');
  const schema = parsed.jsonSchema as { $jsonSchema?: unknown } | undefined;
  const jsonSchema = schema?.$jsonSchema as Record<string, unknown> | undefined;
  if (!jsonSchema || jsonSchema.bsonType !== 'object' || typeof jsonSchema.properties !== 'object' || jsonSchema.properties === null) {
    throw new Error('"jsonSchema" must contain $jsonSchema with bsonType "object" and properties');
  }

  const fields = parsed.fields.map((f) => {
    const raw = (f ?? {}) as Record<string, unknown>;
    return {
      name: String(raw.name ?? ''),
      type: String(raw.type ?? 'Mixed'),
      required: !!raw.required,
      unique: !!raw.unique,
      enum: Array.isArray(raw.enum) ? (raw.enum as string[]).map(String) : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
    };
  });
  if (!fields.length || fields.some((f) => !f.name)) throw new Error('fields must have unique names');

  return {
    collection: parsed.collection,
    fields,
    jsonSchema: { $jsonSchema: jsonSchema as GeneratedSchema['jsonSchema']['$jsonSchema'] },
    model: '',
  };
}

function stripFences(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return m ? m[1]! : text;
}
