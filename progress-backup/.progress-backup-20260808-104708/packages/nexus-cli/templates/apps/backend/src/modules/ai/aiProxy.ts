import type { Router } from '@bhooai/nexus-core';
import { AiClient, type ChatCompletionRequest } from '@bhooai/nexus-ai-client';

/**
 * Mount OpenAI-compatible AI routes on the backend that proxy to the Python AI
 * server via @bhooai/nexus-ai-client. The browser never calls Python directly —
 * Node re-emits the SSE stream chunk-by-chunk so CSRF + auth still apply.
 *
 * Routes (CSRF-protected like all unsafe methods):
 *   POST /ai/chat/completions   (streaming or JSON)
 *   POST /ai/embeddings
 *   GET  /ai/models
 */
export function registerAiRoutes(router: Router, opts: { serverUrl: string; timeoutMs: number; authToken?: string }): AiClient {
  const client = new AiClient({ serverUrl: opts.serverUrl, timeoutMs: opts.timeoutMs, authToken: opts.authToken });

  router.post('/ai/chat/completions', async (ctx) => {
    const req = (ctx.body ?? {}) as ChatCompletionRequest;
    if (req.stream) {
      ctx.res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      try {
        for await (const chunk of client.chatStream(req)) {
          ctx.res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        ctx.res.write('data: [DONE]\n\n');
      } catch (err) {
        // Mid-stream error → emit an error event then close.
        ctx.res.write(`data: ${JSON.stringify({ error: { message: String((err as Error)?.message ?? err) } })}\n\n`);
      } finally {
        ctx.res.end();
      }
      return;
    }
    try {
      const result = await client.chat(req);
      ctx.json(result);
    } catch (err) {
      ctx.status((err as { status?: number })?.status ?? 502);
      ctx.json({ error: { message: String((err as Error)?.message ?? err) } });
    }
  });

  router.post('/ai/embeddings', async (ctx) => {
    const req = (ctx.body ?? {}) as { model: string; input: string | string[]; provider?: string };
    try {
      ctx.json(await client.embeddings(req));
    } catch (err) {
      ctx.status((err as { status?: number })?.status ?? 502);
      ctx.json({ error: { message: String((err as Error)?.message ?? err) } });
    }
  });

  router.get('/ai/models', async (ctx) => {
    const provider = typeof ctx.query['provider'] === 'string' ? (ctx.query['provider'] as string) : undefined;
    try {
      ctx.json(await client.listModels(provider));
    } catch (err) {
      ctx.status((err as { status?: number })?.status ?? 502);
      ctx.json({ error: { message: String((err as Error)?.message ?? err) } });
    }
  });

  return client;
}
