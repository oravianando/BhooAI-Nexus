import { useRef, useState } from 'react';
import { chatStream, type ChatMessage } from '../lib/ai.js';

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState('');
  const abortRef = useRef(false);

  const send = async () => {
    if (!input.trim() || streaming) return;
    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: '' }]);
    setInput('');
    setErr('');
    setStreaming(true);
    abortRef.current = false;
    try {
      const history = [...messages, userMsg];
      for await (const delta of chatStream(history, { provider: 'auto' })) {
        if (abortRef.current) break;
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + delta };
          return next;
        });
      }
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    setStreaming(false);
  };

  const stop = () => { abortRef.current = true; setStreaming(false); };

  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="text-xl font-bold">AI Chat (streaming via Python AI server)</h2>
      <p className="text-slate-500 text-sm">The browser POSTs <code>/ai/chat/completions</code> with <code>stream:true</code>; the Node backend proxies to the Python AI server and re-emits the SSE chunks. Provider <code>auto</code> picks OpenAI if a key is set, else Ollama.</p>
      <div className="bg-white border rounded-lg p-4 h-96 overflow-auto space-y-3">
        {messages.length === 0 && <p className="text-slate-400 text-sm">Say hello to start a streamed conversation.</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <span className={`inline-block max-w-[80%] px-3 py-2 rounded-lg ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>{m.content || '…'}</span>
          </div>
        ))}
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <div className="flex gap-2">
        <input className="flex-1 px-3 py-2 border rounded" placeholder="Message…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} disabled={streaming} />
        {streaming ? (
          <button onClick={stop} className="px-4 py-2 bg-slate-200 rounded">Stop</button>
        ) : (
          <button onClick={send} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500">Send</button>
        )}
      </div>
    </div>
  );
}