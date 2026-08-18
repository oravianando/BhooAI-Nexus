/** Types mirroring contracts/ai-openapi.yaml — the Node↔Python AI boundary. */

export type Provider = 'openai' | 'ollama' | 'auto';
export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: Role;
  content: string;
  name?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  provider?: Provider;
}

export interface Choice {
  index: number;
  message: Message;
  finish_reason: string | null;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletionResponse {
  id?: string;
  model: string;
  provider?: string;
  choices: Choice[];
  usage?: Usage;
}

export interface Delta {
  role?: Role;
  content?: string;
}

export interface ChunkChoice {
  index: number;
  delta: Delta;
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id?: string;
  model: string;
  provider?: string;
  choices: ChunkChoice[];
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  provider?: Provider;
}

export interface EmbeddingData {
  index: number;
  embedding: number[];
}

export interface EmbeddingResponse {
  model: string;
  provider?: string;
  data: EmbeddingData[];
  usage?: Usage;
}

export interface ModelInfo {
  id: string;
  owned_by?: string;
}

export interface ModelsResponse {
  provider?: string;
  data: ModelInfo[];
}

export interface AiClientOptions {
  /** AI server base URL, e.g. http://localhost:8000. */
  serverUrl: string;
  /** Request timeout in ms (default 60000). */
  timeoutMs?: number;
  /** Max retry attempts on network/5xx errors (default 2). */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default 500). */
  retryDelayMs?: number;
  /** Optional Bearer token sent to the AI server. */
  authToken?: string;
}

// ── Image generation (local Stable Diffusion HTTP server) ──────────────────
// OpenAI-compatible /images/generations surface, plus the agentic loop.

export interface ImageGenRequest {
  prompt: string;
  n?: number;
  size?: string;
  model?: string;
  negative_prompt?: string;
  steps?: number;
  sampler?: string;
  seed?: number;
}

export interface ImageGenData {
  b64_json?: string;
  url?: string;
}

export interface ImageGenMeta {
  prompt: string;
  negative_prompt: string;
  model: string;
  steps: number;
  width: number;
  height: number;
  sampler: string;
  seed: number | null;
  n: number;
  api: string;
}

export interface ImageGenResponse {
  created: number;
  data: ImageGenData[];
  meta?: ImageGenMeta;
}

export interface ImageGenModelsResponse {
  api: string;
  data: Array<{ id: string; title: string }>;
}

// ── Agentic image loop ─────────────────────────────────────────────────────

export interface AgentImageRequest {
  /** The user's rough idea, e.g. "a cyberpunk fox in neon rain". */
  idea: string;
  /** Max agent iterations (default from server config). */
  max_iterations?: number;
}

/** SSE event emitted by POST /agent/image. Discriminated by `type`. */
export type AgentImageEvent =
  | { type: 'thinking'; content: string; iteration: number }
  | { type: 'tool'; name: string; args: Record<string, unknown>; iteration: number }
  | { type: 'tool_error'; name: string; message: string; iteration: number }
  | { type: 'image'; b64: string; prompt: string; iteration: number }
  | { type: 'error'; message: string }
  | AgentImageDoneEvent;

export interface AgentImageDoneEvent {
  type: 'done';
  image_b64: string;
  prompt: string;
  negative_prompt: string;
  style?: string | null;
  aspect_ratio?: string | null;
  model: string;
  steps: number;
  sampler?: string | null;
  seed?: number | null;
  iterations: number;
  critique_log: Array<{ score?: number; feedback?: string; suggestions?: string[] }>;
}