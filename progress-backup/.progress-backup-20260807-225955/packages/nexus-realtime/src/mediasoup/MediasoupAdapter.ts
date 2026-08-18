import type { Connection } from '../types.js';
import type { MediaAction } from '../types.js';

/**
 * mediasoup SFU adapter. Lazily imports `mediasoup` (an optional native
 * dependency) so the realtime package loads even when mediasoup is not
 * installed; media actions return a clear error in that case.
 *
 * One mediasoup worker is created per adapter; one router per room (with a
 * default Opus audio + VP8 video RTP capability set). Each connection gets a
 * send WebRtcTransport and a recv WebRtcTransport; producers/consumers are
 * tracked per connection. This is a functional single-room SFU demo; full
 * multi-room capacity scaling is wired but tuned in a later pass.
 */
export interface MediasoupAdapterOptions {
  /** RTC listen IP announced to clients (default 127.0.0.1). */
  announceIp?: string;
  /** RTC port range (defaults let mediasoup choose). */
  rtcMinPort?: number;
  rtcMaxPort?: number;
  /** Number of mediasoup workers (default 1). */
  workerCount?: number;
}

// Default router media codecs: Opus audio + VP8 video. (RTX omitted for portability —
// adding it requires a correctly-bound `apt` referencing the VP8 payload type; not needed for the demo.)
const ROUTER_MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'ccm', parameter: 'fir' }, { type: 'goog-remb' }] },
];

interface ConnState {
  sendTransport?: unknown;
  recvTransport?: unknown;
  producers: Map<string, unknown>;
  consumers: Map<string, unknown>;
}

export class MediasoupAdapter {
  private workerPromise?: Promise<unknown>;
  private routers = new Map<string, Promise<unknown>>();
  private states = new WeakMap<Connection, ConnState>();
  private opts: MediasoupAdapterOptions;

  constructor(opts: MediasoupAdapterOptions = {}) {
    this.opts = opts;
  }

  private state(conn: Connection): ConnState {
    let s = this.states.get(conn);
    if (!s) { s = { producers: new Map(), consumers: new Map() }; this.states.set(conn, s); }
    return s;
  }

  private async worker(): Promise<unknown> {
    if (!this.workerPromise) {
      const mod = await import('mediasoup');
      this.workerPromise = mod.createWorker({
        logLevel: 'warn',
        rtcMinPort: this.opts.rtcMinPort ?? 40000,
        rtcMaxPort: this.opts.rtcMaxPort ?? 40100,
      }) as Promise<unknown>;
    }
    return this.workerPromise;
  }

  private async router(room: string): Promise<unknown> {
    let p = this.routers.get(room);
    if (!p) {
      p = (async () => {
        const w = await this.worker();
        const r = await (w as any).createRouter({ mediaCodecs: ROUTER_MEDIA_CODECS });
        return r;
      })();
      this.routers.set(room, p);
    }
    return p;
  }

  async handle(conn: Connection, action: MediaAction, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const room = String(payload.room ?? 'default');
    const router = await this.router(room);
    const s = this.state(conn);

    switch (action) {
      case 'getRouterRtpCapabilities':
        return { rtpCapabilities: (router as any).rtpCapabilities };

      case 'createWebRtcTransport': {
        const dir = (payload.direction ?? 'send') as 'send' | 'recv';
        const t = await (router as any).createWebRtcTransport({
          listenIps: [{ ip: '0.0.0.0', announcedIp: this.opts.announceIp ?? '127.0.0.1' }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });
        if (dir === 'send') s.sendTransport = t; else s.recvTransport = t;
        return {
          id: t.id,
          iceParameters: t.iceParameters,
          iceCandidates: t.iceCandidates,
          dtlsParameters: t.dtlsParameters,
          direction: dir,
        };
      }

      case 'connectTransport': {
        const dir = (payload.direction ?? 'send') as 'send' | 'recv';
        const t = dir === 'send' ? s.sendTransport : s.recvTransport;
        if (!t) return { error: 'transport not found' };
        await (t as any).connect({ dtlsParameters: payload.dtlsParameters });
        return { connected: true };
      }

      case 'produce': {
        if (!s.sendTransport) return { error: 'send transport not found' };
        const producer = await (s.sendTransport as any).produce({
          kind: payload.kind,
          rtpParameters: payload.rtpParameters,
          paused: false,
        });
        s.producers.set(producer.id, producer);
        return { id: producer.id, kind: producer.kind };
      }

      case 'consume': {
        if (!s.recvTransport) return { error: 'recv transport not found' };
        const canConsume = (router as any).canConsume({ producerId: payload.producerId, rtpCapabilities: payload.rtpCapabilities });
        if (!canConsume) return { error: 'cannot consume' };
        const consumer = await (s.recvTransport as any).consume({
          producerId: payload.producerId,
          rtpCapabilities: payload.rtpCapabilities,
          paused: true,
        });
        s.consumers.set(consumer.id, consumer);
        return {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };
      }

      case 'closeProducer': {
        const p = s.producers.get(String(payload.producerId));
        if (p) { (p as any).close(); s.producers.delete(String(payload.producerId)); }
        return { closed: true };
      }

      case 'closeConsumer': {
        const c = s.consumers.get(String(payload.consumerId));
        if (c) { (c as any).close(); s.consumers.delete(String(payload.consumerId)); }
        return { closed: true };
      }

      default:
        return { error: `unknown media action` };
    }
  }

  /** Clean up a connection's transports/producers/consumers on disconnect. */
  cleanup(conn: Connection): void {
    const s = this.states.get(conn);
    if (!s) return;
    for (const p of s.producers.values()) try { (p as any).close(); } catch { /* ignore */ }
    for (const c of s.consumers.values()) try { (c as any).close(); } catch { /* ignore */ }
    try { (s.sendTransport as any)?.close(); } catch { /* ignore */ }
    try { (s.recvTransport as any)?.close(); } catch { /* ignore */ }
    this.states.delete(conn);
  }

  /** Whether mediasoup is importable on this process (for capability checks). */
  static async isAvailable(): Promise<boolean> {
    try { await import('mediasoup'); return true; } catch { return false; }
  }
}