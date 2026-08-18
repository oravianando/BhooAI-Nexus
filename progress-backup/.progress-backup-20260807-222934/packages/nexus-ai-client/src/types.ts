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