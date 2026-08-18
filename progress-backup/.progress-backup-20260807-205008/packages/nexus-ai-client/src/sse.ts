/**
 * Minimal SSE parser for the streaming chat endpoint. Reads a web
 * ReadableStream<Uint8Array>, buffers bytes, splits events on blank lines, and
 * yields the parsed `data:` JSON payload of each event. Stops at `[DONE]`.
 */
export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<any, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line (\n\n). Process complete ones.
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const payload = extractData(rawEvent);
        if (payload === undefined) continue;
        if (payload === '[DONE]') return;
        try {
          yield JSON.parse(payload);
        } catch {
          /* skip malformed */
        }
      }
    }
    // Flush any trailing event without a blank-line terminator.
    if (buffer.trim()) {
      const payload = extractData(buffer);
      if (payload && payload !== '[DONE]') {
        try { yield JSON.parse(payload); } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractData(event: string): string | undefined {
  // An event may have multiple lines; collect `data:` fields (concatenated).
  const parts: string[] = [];
  for (const line of event.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      parts.push(trimmed.slice(5).trimStart());
    }
  }
  if (parts.length === 0) return undefined;
  return parts.join('\n');
}