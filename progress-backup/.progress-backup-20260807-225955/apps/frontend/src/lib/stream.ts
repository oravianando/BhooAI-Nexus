// WebRTC live-stream helper using mediasoup-client over the Nexus realtime
// 'media' channel.
//
// Flow (viewer): join room → getRouterRtpCapabilities → create recv transport →
//   connectTransport → consume(producerId).
// Flow (publisher): join room → getRouterRtpCapabilities → create send transport →
//   connectTransport → produce(track) → broadcast the new producerId so viewers
//   can consume it.
//
// The backend MediasoupAdapter does not maintain a producer-discovery list, so
// producers announce themselves over the room broadcast channel
// ({ event: 'producer', producerId, kind }) and viewers consume on sight.

import { Device } from 'mediasoup-client';
import type { RealtimeClient } from './realtime.js';

export interface RemoteTrack { consumerId: string; producerId: string; kind: string; track: MediaStreamTrack; }

export class StreamClient {
  private device: Device | null = null;
  private sendTransport: any = null;
  private recvTransport: any = null;

  constructor(private rt: RealtimeClient) {}

  /** Request-response helper over the 'media' channel. */
  private async request(action: string, payload: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const off = this.rt.on('media', (a: string, p: any) => {
        if (a !== action) return;
        off();
        if (p?.error) reject(new Error(p.error));
        else resolve(p);
      });
      // The server echoes the action back; if it never responds, the off()
      // listener stays registered but resolve/reject already ran on first match.
      this.rt.media(action, payload);
      // Safety timeout so a missing SFU doesn't hang the UI forever.
      setTimeout(() => { off(); reject(new Error(`media ${action} timed out (SFU unavailable?)`)); }, 8000);
    });
  }

  async loadRouterCaps(room: string): Promise<any> {
    const res = await this.request('getRouterRtpCapabilities', { room });
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: res.rtpCapabilities });
    return this.device.rtpCapabilities;
  }

  async createSendTransport(room: string): Promise<void> {
    const res = await this.request('createWebRtcTransport', { room, direction: 'send' });
    this.sendTransport = this.device!.createSendTransport({
      id: res.id, iceParameters: res.iceParameters, iceCandidates: res.iceCandidates,
      dtlsParameters: res.dtlsParameters,
    });
    this.sendTransport.on('connect', (params: any, callback: () => void, errback: (e: Error) => void) => {
      this.request('connectTransport', { room, direction: 'send', dtlsParameters: params.dtlsParameters })
        .then(() => callback()).catch(errback);
    });
    this.sendTransport.on('produce', (params: any, callback: (id: string) => void, errback: (e: Error) => void) => {
      this.request('produce', { room, kind: params.kind, rtpParameters: params.rtpParameters })
        .then((r) => callback(r.id)).catch(errback);
    });
  }

  async createRecvTransport(room: string): Promise<void> {
    const res = await this.request('createWebRtcTransport', { room, direction: 'recv' });
    this.recvTransport = this.device!.createRecvTransport({
      id: res.id, iceParameters: res.iceParameters, iceCandidates: res.iceCandidates,
      dtlsParameters: res.dtlsParameters,
    });
    this.recvTransport.on('connect', (params: any, callback: () => void, errback: (e: Error) => void) => {
      this.request('connectTransport', { room, direction: 'recv', dtlsParameters: params.dtlsParameters })
        .then(() => callback()).catch(errback);
    });
  }

  /** Publish a local track. Returns the producer id; caller should broadcast it. */
  async produce(room: string, track: MediaStreamTrack): Promise<string> {
    if (!this.sendTransport) await this.createSendTransport(room);
    const producer = await this.sendTransport.produce({ track });
    return producer.id;
  }

  /** Consume a remote producer and return the decoded track. */
  async consume(room: string, producerId: string, kind: string): Promise<RemoteTrack> {
    if (!this.recvTransport) await this.createRecvTransport(room);
    const res = await this.request('consume', {
      room, producerId, rtpCapabilities: this.device!.rtpCapabilities,
    });
    const consumer = await this.recvTransport.consume({
      id: res.id, producerId: res.producerId, kind: res.kind, rtpParameters: res.rtpParameters,
    });
    return { consumerId: consumer.id, producerId: res.producerId, kind: res.kind, track: consumer.track };
  }

  closeProducer(room: string, producerId: string): void { this.rt.media('closeProducer', { room, producerId }); }
  closeConsumer(room: string, consumerId: string): void { this.rt.media('closeConsumer', { room, consumerId }); }

  close(): void {
    try { this.sendTransport?.close(); } catch { /* ignore */ }
    try { this.recvTransport?.close(); } catch { /* ignore */ }
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
  }
}