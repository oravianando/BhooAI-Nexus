import type { Router } from '@bhooai/nexus-core';
import { AiClient, type ChatCompletionRequest } from '@bhooai/nexus-ai-client';

/**
 * Mount OpenAI-compatible AI routes on the backend.
 *
 * The browser never calls external AI APIs directly — Node proxies:
 *
 *   - provider "together" → Together AI SDK (direct, API key from config)
 *   - provider "openai"/"ollama" → Python AI server via @bhooai/nexus-ai-client
 *   - any other configured OpenAI-compatible provider → direct fetch to its
 *     baseUrl with the configured API key (so e.g. Groq/DeepSeek/Mistral list
 *     their own models instead of falling back to the AI server's providers)
 *
 * Node re-emits the SSE stream chunk-by-chunk so CSRF + auth still apply.
 *
 * Routes (CSRF-protected like all unsafe methods):
 *   POST /ai/chat/completions   (streaming or JSON)
 *   POST /ai/embeddings
 *   GET  /ai/models
 */
export interface AiProxyProvider {
  id: string;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
}

export function registerAiRoutes(router: Router, opts: {
  serverUrl: string;
  timeoutMs: number;
  authToken?: string;
  /** Live AI providers array from config (shared reference — updated in-place
   *  by the admin provider management endpoints, so API key changes are visible
   *  here without restarting). */
  providers?: Array<AiProxyProvider>;
}): AiClient {
  const client = new AiClient({ serverUrl: opts.serverUrl, timeoutMs: opts.timeoutMs, authToken: opts.authToken });

  // Find a configured, enabled provider (case-insensitive on the id).
  const findProvider = (id?: string): AiProxyProvider | undefined => {
    if (!id) return undefined;
    return opts.providers?.find((p) => p.id.toLowerCase() === id.toLowerCase() && p.enabled);
  };

  // Resolve the Together AI key from the live providers array (not a snapshot).
  const resolveTogetherKey = (): string | undefined => {
    if (opts.providers?.find((p) => p.id === 'together' && p.enabled)?.apiKey) {
      return opts.providers.find((p) => p.id === 'together' && p.enabled)?.apiKey;
    }
    return process.env.TOGETHER_API_KEY;
  };

  // Together SDK is optional — lazy-load it so scaffolded projects without
  // together-ai installed still boot (they'd need the key to use it anyway).
  let togetherCtor: any = null;
  const loadTogether = async (): Promise<any> => {
    if (!togetherCtor) {
      const mod = await import('together-ai');
      togetherCtor = mod.default ?? mod;
    }
    return togetherCtor;
  };

  // Normalise a provider baseUrl to its OpenAI-compatible root (append /v1
  // unless it already ends in a version segment like /v1).
  const openAiBase = (baseUrl: string): string => {
    const u = baseUrl.replace(/\/+$/, '');
    return /\/v\d+(\/)?$/.test(u) ? u : `${u}/v1`;
  };

  const providerAuth = (p: AiProxyProvider) => (p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {});

  /** Proxy a streaming chat request to an OpenAI-compatible provider, re-emitting SSE. */
  const relayProviderStream = async (ctx: any, p: AiProxyProvider, req: ChatCompletionRequest): Promise<boolean> => {
    ctx.res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    try {
      const upstream = await fetch(`${openAiBase(p.baseUrl ?? '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...providerAuth(p) },
        body: JSON.stringify({ model: req.model, messages: req.messages, stream: true }),
      });
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text();
        throw new Error(`provider responded with HTTP ${upstream.status} ${text.slice(0, 300)}`);
      }
      const reader = upstream.body.getReader();
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
          if (trimmed.startsWith('data: ')) ctx.res.write(`${trimmed}\n\n`);
        }
      }
      ctx.res.write('data: [DONE]\n\n');
    } catch (err) {
      ctx.res.write(`data: ${JSON.stringify({ error: { message: String((err as Error)?.message ?? err) } })}\n\n`);
    } finally {
      if (!ctx.res.writableEnded) ctx.res.end();
    }
    return true;
  };

  // ── Chat completions: configured provider direct, Together SDK, or Python ──
  router.post('/ai/chat/completions', async (ctx) => {
    const req = (ctx.body ?? {}) as ChatCompletionRequest & { provider?: string };
    const isTogether = (req as any).provider === 'together';

    // ── Together AI direct SDK path ──
    if (isTogether) {
      const apiKey = resolveTogetherKey();
      if (!apiKey) {
        ctx.json({ error: { message: 'Together AI API key not configured. Set it in AI Providers or TOGETHER_API_KEY env var.' } }, 401);
        return;
      }
      try {
        const Together = await loadTogether();
        const together = new Together({ apiKey });
        if (req.stream) {
          ctx.res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          try {
            const stream = await together.chat.completions.create({
              model: req.model,
              messages: req.messages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
              stream: true,
              ...(req.temperature != null ? { temperature: req.temperature } : {}),
              ...(req.max_tokens != null ? { max_tokens: req.max_tokens } : {}),
            } as any);
            for await (const chunk of stream as any) ctx.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            ctx.res.write('data: [DONE]\n\n');
          } catch (err: any) {
            ctx.res.write(`data: ${JSON.stringify({ error: { message: err?.message ?? String(err) } })}\n\n`);
          } finally {
            if (!ctx.res.writableEnded) ctx.res.end();
          }
          return;
        }
        const result: any = await together.chat.completions.create({
          model: req.model,
          messages: req.messages.map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
          ...(req.temperature != null ? { temperature: req.temperature } : {}),
          ...(req.max_tokens != null ? { max_tokens: req.max_tokens } : {}),
        } as any);
        if (result?.error) { ctx.json({ error: { message: String(result.error.message ?? result.error) } }, result.error.status ?? 502); return; }
        ctx.json(result);
      } catch (err: any) {
        const status = err?.status ?? 502;
        const message = String(err?.message ?? err?.error?.message ?? JSON.stringify(err));
        const body = JSON.stringify({ error: { message, status } });
        if (!ctx.res.headersSent) { ctx.res.statusCode = status; ctx.res.setHeader('content-type', 'application/json; charset=utf-8'); }
        if (!ctx.res.writableEnded) ctx.res.end(body);
      }
      return;
    }

    // ── Other configured OpenAI-compatible providers (direct) ──
    const cfgProvider = findProvider(req.provider);
    if (cfgProvider && cfgProvider.baseUrl) {
      if (req.stream) {
        await relayProviderStream(ctx, cfgProvider, req);
        return;
      }
      try {
        const upstream = await fetch(`${openAiBase(cfgProvider.baseUrl)}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...providerAuth(cfgProvider) },
          body: JSON.stringify({ model: req.model, messages: req.messages }),
        });
        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          ctx.json({ error: { message: data?.error?.message ?? `provider responded with HTTP ${upstream.status}` } }, upstream.status === 401 ? 401 : 502);
          return;
        }
        ctx.json(data);
      } catch (err) {
        ctx.json({ error: { message: String((err as Error)?.message ?? err) } }, 502);
      }
      return;
    }

    // ── Default: proxy to the Python AI server ──
    if (req.stream) {
      ctx.res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      try {
        for await (const chunk of client.chatStream(req)) ctx.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        ctx.res.write('data: [DONE]\n\n');
      } catch (err) {
        ctx.res.write(`data: ${JSON.stringify({ error: { message: String((err as Error)?.message ?? err) } })}\n\n`);
      } finally {
        if (!ctx.res.writableEnded) ctx.res.end();
      }
      return;
    }
    try {
      ctx.json(await client.chat(req));
    } catch (err) {
      ctx.json({ error: { message: String((err as Error)?.message ?? err) } }, (err as { status?: number })?.status ?? 502);
    }
  });

  // ── Models: configured provider direct, Together SDK, or Python ──────────
  router.get('/ai/models', async (ctx) => {
    const provider = typeof ctx.query['provider'] === 'string' ? (ctx.query['provider'] as string) : undefined;

    // Other configured OpenAI-compatible providers → list their own /models.
    const cfgProvider = findProvider(provider);
    if (cfgProvider && cfgProvider.baseUrl) {
      try {
        const upstream = await fetch(`${openAiBase(cfgProvider.baseUrl)}/models`, { headers: providerAuth(cfgProvider) });
        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          ctx.json({ provider: cfgProvider.id, data: [], error: data?.error?.message ?? `provider responded with HTTP ${upstream.status}` });
          return;
        }
        const models = Array.isArray(data?.data)
          ? (data.data as any[]).map((m: any) => ({ id: String(m.id ?? m), owned_by: m.owned_by ?? cfgProvider.id }))
          : [];
        ctx.json({ provider: cfgProvider.id, data: models });
      } catch (err) {
        ctx.json({ provider: cfgProvider.id, data: [], error: String((err as Error)?.message ?? err) });
      }
      return;
    }

    if (provider === 'together') {
      const apiKey = resolveTogetherKey();
      if (!apiKey) {
        ctx.json({ provider: 'together', data: [] });
        return;
      }
      try {
        const Together = await loadTogether();
        const together = new Together({ apiKey });
        const models = await together.models.list();
        ctx.json({ provider: 'together', data: (models as any[])?.map((m: any) => ({ id: m.id, owned_by: m.owned_by ?? 'together' })) ?? [] });
      } catch (err) {
        ctx.json({ provider: 'together', data: [], error: String((err as Error)?.message ?? err) });
      }
      return;
    }

    try {
      ctx.json(await client.listModels(provider));
    } catch (err) {
      ctx.json({ error: { message: String((err as Error)?.message ?? err) } }, (err as { status?: number })?.status ?? 502);
    }
  });

  router.post('/ai/embeddings', async (ctx) => {
    const req = (ctx.body ?? {}) as { model: string; input: string | string[]; provider?: string };
    try {
      ctx.json(await client.embeddings(req));
    } catch (err) {
      ctx.json({ error: { message: String((err as Error)?.message ?? err) } }, (err as { status?: number })?.status ?? 502);
    }
  });

  return client;
}