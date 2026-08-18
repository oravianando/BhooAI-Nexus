# @bhooai/nexus-realtime

WebSocket server with rooms, a Redis pub/sub adapter for horizontal scale, WS
auth, WebRTC signaling over WS, and a mediasoup SFU adapter.

## Exports

- **RealtimeServer** — `new RealtimeServer({ httpServer, path, authService,
  csrfOptions? })`. Auth via access token on the WS upgrade; optional CSRF
  origin/double-submit check on the upgrade.
- **PubSubAdapter / RedisPubSubAdapter** — fan-out across instances.
- **MediasoupAdapter** — mediasoup SFU worker (native; RTP/SFU is **not** hand-rolled).

## Wire protocol

Client → server: `{type:'join'|'offer'|'answer'|'candidate'|'broadcast'|'media'|'ping'}`.
Server → client: `{type:'joined'|'peer-joined'|'peer-left'|'offer'|'answer'|'candidate'|
'broadcast'|'media'|'pong'|'error'}`.

Mediasoup media actions: `getRouterRtpCapabilities`, `createWebRtcTransport{direction}`,
`connectTransport{direction,dtlsParameters}`, `produce{kind,rtpParameters}→{id,kind}`,
`consume{producerId,rtpCapabilities}→{id,producerId,kind,rtpParameters}`,
`closeProducer`/`closeConsumer`. The frontend uses `mediasoup-client` (see
`apps/frontend/src/lib/stream.ts`).