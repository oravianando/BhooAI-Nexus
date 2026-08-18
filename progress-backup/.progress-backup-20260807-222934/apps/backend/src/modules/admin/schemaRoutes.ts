/**
 * AI-enabled schema generation for MongoDB.
 *
 * `POST /admin/schemas/generate` sends the user's plain-English description to
 * the Python AI server and asks for a MongoDB `$jsonSchema` validator plus a
 * human-readable field list. The result is previewed in the admin app and then
 * applied via `POST /admin/databases/:db/collections` (which creates the
 * collection with the validator attached).
 */
import type { Router, Middleware } from '@bhooai/nexus-core';
import { AiClient } from '@bhooai/nexus-ai-client';

export interface SchemaAIConfig {
  serverUrl: string;
  timeoutMs: number;
  /** Model to use for generation (config: `ai.schemaModel`). */
  model?: string;
  /** Pre-built client (tests inject a stub). */
  client?: Pick<AiClient, 'chat' | 'listModels'>;
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

export function registerSchemaRoutes(router: Router, aiConfig: SchemaAIConfig, guard: Middleware[]): void {
  const model = aiConfig.model ?? DEFAULT_SCHEMA_MODEL;

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