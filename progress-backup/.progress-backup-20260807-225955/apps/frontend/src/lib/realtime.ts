// Realtime client for the BhooAI Nexus frontend.
//
// Connects to the backend WS endpoint (/ws) with the access token as a query
// param, then speaks the Nexus realtime protocol:
//   client → server: { type:'join', room } | { type:'offer'|'answer', to, sdp }
//                    | { type:'candidate', to, candidate } | { type:'broadcast', room, event, data }
//                    | { type:'media', action, payload } | { type:'ping' }
//   server → client: { type:'joined', room, peers } | { type:'peer-joined'|'peer-left', room, peer }
//                    | { type:'offer'|'answer', from, sdp } | { type:'candidate', from, candidate }
//                    | { type:'broadcast', room, from, event, data } | { type:'media', action, payload }
//                    | { type:'pong' } | { type:'error', message, code? }
//
// Exposes typed event subscriptions. Used by the RealtimeRoom and LiveStream
// components (the LiveStream component layers mediasoup-client on top of the
// 'media' action channel).

import { getAccessToken } from './auth.js';

export interface RealtimeEvents {
  joined: (room: string, peers: string[]) => void;
  'peer-joined': (room: string, peer: string) => void;
  'peer-left': (room: string, peer: string) => void;
  offer: (from: string, sdp: unknown) => void;
  answer: (from: string, sdp: unknown) => void;
  candidate: (from: string, candidate: unknown) => void;
  broadcast: (room: string, from: string, event: string, data: unknown) => void;
  media: (action: string, payload: any) => void;
  error: (message: string, code?: string) => void;
  open: () => void;
  close: () => void;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers: { [K in keyof RealtimeEvents]?: RealtimeEvents[K][] } = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  on<K extends keyof RealtimeEvents>(event: K, fn: RealtimeEvents[K]): () => void {
    (this.handlers[event] ??= [] as any).push(fn as any);
    return () => { this.handlers[event] = this.handlers[event]?.filter((f) => f !== fn) as any; };
  }

  private emit<K extends keyof RealtimeEvents>(event: K, ...args: Parameters<RealtimeEvents[K]>): void {
    this.handlers[event]?.forEach((fn) => (fn as any)(...args));
  }

  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getAccessToken();
    const url = `${proto}//${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => this.emit('open');
    ws.onclose = () => { this.ws = null; this.emit('close'); this.scheduleReconnect(); };
    ws.onerror = () => { /* surfaced via onclose */ };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      switch (msg.type) {
        case 'joined': this.emit('joined', msg.room, msg.peers ?? []); break;
        case 'peer-joined': this.emit('peer-joined', msg.room, msg.peer); break;
        case 'peer-left': this.emit('peer-left', msg.room, msg.peer); break;
        case 'offer': this.emit('offer', msg.from, msg.sdp); break;
        case 'answer': this.emit('answer', msg.from, msg.sdp); break;
        case 'candidate': this.emit('candidate', msg.from, msg.candidate); break;
        case 'broadcast': this.emit('broadcast', msg.room, msg.from, msg.event, msg.data); break;
        case 'media': this.emit('media', msg.action, msg.payload); break;
        case 'error': this.emit('error', msg.message, msg.code); break;
        case 'pong': break;
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 2000);
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  join(room: string): void { this.send({ type: 'join', room }); }
  leave(room: string): void { this.send({ type: 'leave', room }); }
  ping(): void { this.send({ type: 'ping' }); }
  broadcast(room: string, event: string, data: unknown): void { this.send({ type: 'broadcast', room, event, data }); }
  sendOffer(to: string, sdp: unknown): void { this.send({ type: 'offer', to, sdp }); }
  sendAnswer(to: string, sdp: unknown): void { this.send({ type: 'answer', to, sdp }); }
  sendCandidate(to: string, candidate: unknown): void { this.send({ type: 'candidate', to, candidate }); }
  media(action: string, payload: unknown): void { this.send({ type: 'media', action, payload }); }

  close(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
  }
}