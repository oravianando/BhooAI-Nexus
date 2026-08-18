// AI chat client for the frontend.
//
// POST /ai/chat/completions with stream:true and parse the SSE response by
// hand (the backend re-emits OpenAI-compatible chunks). Mirrors the Node
// @bhooai/nexus-ai-client SSE parser, but for the browser fetch ReadableStream.

import { getAccessToken, getCsrfToken, refreshCsrf } from './auth.js';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }
export interface ChatChunk { choices: { delta: { content?: string; role?: string } }[]; [k: string]: any; }

export async function chat(messages: ChatMessage[], opts: { model?: string; provider?: string } = {}): Promise<string> {
  await refreshCsrf();
  const r = await fetch('/ai/chat/completions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken(), ...authz() },
    body: JSON.stringify({ messages, stream: false, ...opts }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message ?? 'chat failed');
  return data.choices?.[0]?.message?.content ?? '';
}

/** Stream a chat completion. Yields each delta content chunk as it arrives. */
export async function* chatStream(messages: ChatMessage[], opts: { model?: string; provider?: string } = {}): AsyncGenerator<string> {
  await refreshCsrf();
  const r = await fetch('/ai/chat/completions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken(), ...authz() },
    body: JSON.stringify({ messages, stream: true, ...opts }),
  });
  if (!r.ok || !r.body) throw new Error('chat stream failed');

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLines = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
      if (!dataLines.length) continue;
      const payload = dataLines.join('\n');
      if (payload === '[DONE]') return;
      try {
        const chunk = JSON.parse(payload) as ChatChunk;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip malformed */ }
    }
  }
}

function authz(): Record<string, string> {
  const t = getAccessToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}