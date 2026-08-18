import { useEffect, useRef, useState } from 'react';
import { RealtimeClient } from '../lib/realtime.js';

interface Line { id: string; from: string; text: string }

export function RealtimeRoom() {
  const [room, setRoom] = useState('lobby');
  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [err, setErr] = useState('');
  const rtRef = useRef<RealtimeClient | null>(null);
  const meRef = useRef<string>('?');

  const joinRoom = () => {
    setErr('');
    const rt = new RealtimeClient();
    rtRef.current = rt;
    rt.on('joined', (r, p) => { setJoined(true); setPeers(p); setLines((l) => [...l, { id: `${Date.now()}`, from: 'system', text: `Joined ${r} (${p.length} peers)` }]); });
    rt.on('peer-joined', (_r, peer) => setPeers((p) => p.includes(peer) ? p : [...p, peer]));
    rt.on('peer-left', (_r, peer) => setPeers((p) => p.filter((x) => x !== peer)));
    rt.on('broadcast', (_r, from, event, data) => {
      if (event === 'chat') setLines((l) => [...l, { id: `${Date.now()}-${Math.random()}`, from, text: String(data) }]);
    });
    rt.on('error', (message) => setErr(message));
    rt.connect();
    // The server doesn't echo our own id directly; derive a placeholder from time.
    meRef.current = `me-${Math.random().toString(36).slice(2, 6)}`;
    // join after open: RealtimeClient buffers? No — send on open.
    rt.on('open', () => rt.join(room));
  };

  const send = () => {
    if (!input.trim()) return;
    rtRef.current?.broadcast(room, 'chat', input.trim());
    setLines((l) => [...l, { id: `${Date.now()}`, from: 'me', text: input.trim() }]);
    setInput('');
  };

  const leave = () => { rtRef.current?.close(); rtRef.current = null; setJoined(false); setPeers([]); };

  useEffect(() => () => rtRef.current?.close(), []);

  return (
    <div className="space-y-4 max-w-2xl">
      <h2 className="text-xl font-bold">Realtime Room (WS)</h2>
      <p className="text-slate-500 text-sm">Joins a WebSocket room and exchanges chat broadcasts peer-to-peer through the backend relay. Auth uses the access token as a query param.</p>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <div className="flex gap-2 items-center">
        <label className="text-sm">Room
          <input className="ml-2 px-3 py-2 border rounded" value={room} onChange={(e) => setRoom(e.target.value)} disabled={joined} />
        </label>
        {!joined ? (
          <button onClick={joinRoom} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500">Join</button>
        ) : (
          <button onClick={leave} className="px-4 py-2 bg-slate-200 rounded">Leave</button>
        )}
        {joined && <span className="text-sm text-slate-500">{peers.length} peers</span>}
      </div>
      <div className="bg-white border rounded-lg p-4 h-72 overflow-auto">
        {lines.length === 0 && <p className="text-slate-400 text-sm">No messages yet.</p>}
        {lines.map((l) => (
          <div key={l.id} className="text-sm"><span className="font-mono text-slate-400">{l.from}:</span> {l.text}</div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className="flex-1 px-3 py-2 border rounded" placeholder="Broadcast a message…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} disabled={!joined} />
        <button onClick={send} disabled={!joined} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50">Send</button>
      </div>
    </div>
  );
}