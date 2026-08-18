# @bhooai/nexus-ai-client

Node client for the Python AI server: streaming (SSE), retries, and timeouts.
The browser never calls Python directly — the Node backend proxies/re-emits SSE.

## Exports

- **AiClient** — `chat`, `chatStream` (async generator over an SSE stream),
  `embeddings`, `models`. Retries with backoff, configurable timeout.
- **parseSseStream** — the SSE parser (buffer → split on `\n\n` → collect `data:`
  lines → JSON.parse → stop at `[DONE]`).
- types + errors.

## Usage

```ts
import { AiClient } from '@bhooai/nexus-ai-client';
const ai = new AiClient({ serverUrl: 'http://localhost:8000', timeoutMs: 60_000 });
for await (const chunk of ai.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
  process.stdout.write(chunk.delta ?? '');
}
```

The Node→Python contract is defined in `contracts/` (single source of truth).