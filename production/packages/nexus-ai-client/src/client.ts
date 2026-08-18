import type {
  AiClientOptions,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelsResponse,
  ImageGenRequest,
  ImageGenResponse,
  ImageGenModelsResponse,
  AgentImageRequest,
  AgentImageEvent,
} from './types.js';
import { AiError, isRetryable } from './errors.js';
import { parseSseStream } from './sse.js';

/**
 * Node client for the BhooAI Nexus AI server (Python FastAPI). OpenAI-compatible.
 * Supports non-streaming + streaming chat completions, embeddings, and model
 * listing, with timeout (AbortController) and exponential-backoff retries on
 * transient failures (network errors, 5xx, 429).
 */
export class AiClient {
  private readonly serverUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly authToken?: string;

  constructor(opts: AiClientOptions) {
    this.serverUrl = opts.serverUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? 500;
    this.authToken = opts.authToken;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', ...extra };
    if (this.authToken) h.authorization = `Bearer ${this.authToken}`;
    return h;
  }

  private async request<T>(path: string, init: RequestInit, { stream = false } = {}): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.serverUrl}${path}`, {
          ...init,
          signal: controller.signal,
          headers: this.headers(init.headers as Record<string, string> | undefined),
        });
        clearTimeout(timer);
        if (!res.ok) {
          let message = `AI server ${res.status}`;
          let code: string | undefined;
          try {
            const body = await res.json() as { error?: { message?: string; code?: string } };
            message = body?.error?.message ?? message;
            code = body?.error?.code;
          } catch { /* non-JSON error body */ }
          const err = new AiError(message, { status: res.status, code });
          if (isRetryable(err) && attempt < this.maxRetries) {
            lastErr = err;
            await this.backoff(attempt);
            continue;
          }
          throw err;
        }
        return (stream ? res : await res.json() as T) as T;
      } catch (e) {
        clearTimeout(timer);
        // Abort → timeout; network errors are retryable.
        const isAbort = e instanceof Error && e.name === 'AbortError';
        const err = e instanceof AiError ? e : new AiError(isAbort ? 'AI request timed out' : String((e as Error)?.message ?? e));
        if (isRetryable(err) && attempt < this.maxRetries) {
          lastErr = err;
          await this.backoff(attempt);
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new AiError('AI request failed');
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = this.retryDelayMs * Math.pow(2, attempt);
    // Tiny jitter without Math.random (deterministic): fold attempt into the delay.
    await new Promise((r) => setTimeout(r, delay + attempt));
  }

  /** Non-streaming chat completion. */
  async chat(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const body = { ...req, stream: false };
    return this.request<ChatCompletionResponse>('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** Streaming chat completion — yields chunks until the stream ends. */
  async *chatStream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const body = { ...req, stream: true };
    const res = await this.request<Response>('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { accept: 'text/event-stream' },
    }, { stream: true });
    if (!res.body) throw new AiError('streaming response has no body');
    for await (const chunk of parseSseStream(res.body as unknown as ReadableStream<Uint8Array>)) {
      yield chunk as ChatCompletionChunk;
    }
  }

  /** Create embeddings for one or more inputs. */
  async embeddings(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.request<EmbeddingResponse>('/embeddings', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  /** List available models (optionally for a specific provider). */
  async listModels(provider?: string): Promise<ModelsResponse> {
    const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return this.request<ModelsResponse>(`/models${qs}`, { method: 'GET' });
  }

  /** Generate images via the local Stable Diffusion HTTP server. */
  async images(req: ImageGenRequest): Promise<ImageGenResponse> {
    return this.request<ImageGenResponse>('/images/generations', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  /** List available image-generation models (SD checkpoints). */
  async listImageModels(): Promise<ImageGenModelsResponse> {
    return this.request<ImageGenModelsResponse>('/images/models', { method: 'GET' });
  }

  /** Agentic image loop — streams reasoning/tool/image/done events.
   *  Drives the Ollama LLM (reasoning) + local SD server (pixels). */
  async *agentImageStream(req: AgentImageRequest): AsyncGenerator<AgentImageEvent, void, unknown> {
    const res = await this.request<Response>('/agent/image', {
      method: 'POST',
      body: JSON.stringify(req),
      headers: { accept: 'text/event-stream' },
    }, { stream: true });
    if (!res.body) throw new AiError('agent stream response has no body');
    for await (const chunk of parseSseStream(res.body as unknown as ReadableStream<Uint8Array>)) {
      yield chunk as AgentImageEvent;
    }
  }
}