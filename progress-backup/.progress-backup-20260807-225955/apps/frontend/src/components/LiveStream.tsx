import { useEffect, useRef, useState } from 'react';
import { RealtimeClient } from '../lib/realtime.js';
import { StreamClient } from '../lib/stream.js';

interface Remote { consumerId: string; producerId: string; kind: string; stream: MediaStream }

export function LiveStream() {
  const [room, setRoom] = useState('demo');
  const [joined, setJoined] = useState(false);
  const [live, setLive] = useState(false);
  const [err, setErr] = useState('');
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const rtRef = useRef<RealtimeClient | null>(null);
  const streamRef = useRef<StreamClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const join = async () => {
    setErr('');
    const rt = new RealtimeClient();
    rtRef.current = rt;
    streamRef.current = new StreamClient(rt);

    rt.on('open', async () => {
      try {
        rt.join(room);
        await streamRef.current!.loadRouterCaps(room);
        setJoined(true);
      } catch (e: any) { setErr(String(e?.message ?? e)); }
    });

    // Producers announce themselves over the broadcast channel; consume on sight.
    rt.on('broadcast', (_room, _from, event, data) => {
      if (event !== 'producer') return;
      const d = data as { producerId: string; kind: string };
      streamRef.current!.consume(room, d.producerId, d.kind).then((r) => {
        const stream = new MediaStream([r.track]);
        setRemotes((prev) => [...prev, { consumerId: r.consumerId, producerId: r.producerId, kind: r.kind, stream }]);
        // Attach to a fresh <video> via effect on remotes state.
      }).catch((e) => setErr(String(e?.message ?? e)));
    });

    rt.on('error', (message) => setErr(message));
    rt.connect();
  };

  // Attach remote streams to video elements as they arrive.
  useEffect(() => {
    remotes.forEach((r, i) => {
      const el = document.getElementById(`remote-${i}`) as HTMLVideoElement | null;
      if (el && el.srcObject !== r.stream) el.srcObject = r.stream;
    });
  }, [remotes]);

  const goLive = async () => {
    if (!streamRef.current) return;
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      for (const track of stream.getTracks()) {
        const producerId = await streamRef.current.produce(room, track);
        // Announce to viewers in the room.
        rtRef.current!.broadcast(room, 'producer', { producerId, kind: track.kind });
      }
      setLive(true);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  const leave = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current?.close();
    rtRef.current?.close();
    rtRef.current = null; streamRef.current = null;
    setJoined(false); setLive(false); setRemotes([]);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Live Stream (WebRTC SFU via mediasoup-client)</h2>
      <p className="text-slate-500 text-sm">Joins a realtime room, loads the mediasoup router, and either publishes a local camera feed or consumes remote producers announced over the room broadcast channel. Requires a running backend with the mediasoup worker available.</p>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <div className="flex gap-2 items-center">
        <label className="text-sm">Room
          <input className="ml-2 px-3 py-2 border rounded" value={room} onChange={(e) => setRoom(e.target.value)} disabled={joined} />
        </label>
        {!joined ? (
          <button onClick={join} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500">Join room</button>
        ) : (
          <>
            {!live && <button onClick={goLive} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-500">Go live</button>}
            <button onClick={leave} className="px-4 py-2 bg-slate-200 rounded">Leave</button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-semibold mb-1">Local (you)</div>
          <video ref={localVideoRef} autoPlay muted playsInline className="w-full bg-black rounded-lg aspect-video" />
        </div>
        <div>
          <div className="text-sm font-semibold mb-1">Remote ({remotes.length})</div>
          {remotes.length === 0 ? (
            <div className="w-full bg-slate-100 rounded-lg aspect-video flex items-center justify-center text-slate-400 text-sm">No remote streams</div>
          ) : (
            remotes.map((r, i) => (
              <video key={r.consumerId} id={`remote-${i}`} autoPlay playsInline className="w-full bg-black rounded-lg aspect-video mb-2" />
            ))
          )}
        </div>
      </div>
    </div>
  );
}