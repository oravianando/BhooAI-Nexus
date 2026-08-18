# @bhooai/app-frontend

React 18 + Vite 5 + TypeScript + Tailwind 3 user-facing frontend.

- `src/lib/auth.ts` — double-submit CSRF, in-memory access token (reduces XSS),
  refresh in HttpOnly cookie, shared `getCsrfToken`/`refreshCsrf`, OAuth launch.
- `src/lib/graphql.ts` — **non-Apollo** client: `gql<T>()` POSTs `/graphql`
  (transparent refresh + retry); `subscribe<T>()` over `/graphql/ws` implementing
  `graphql-transport-ws` by hand.
- `src/lib/realtime.ts` — `RealtimeClient` over `/ws` (typed events, auto-reconnect).
- `src/lib/ai.ts` — `chat()` + `chatStream()` SSE async generator.
- `src/lib/payments.ts` — checkout (createOrder/capture/status).
- `src/lib/stream.ts` — `StreamClient` over `mediasoup-client` (send/recv transports,
  produce/consume) driven by the realtime WS.
- `src/components/{AuthBar,Home,Chat,Checkout,LiveStream,RealtimeRoom}.tsx`.

Vite proxies `/auth`, `/csrf-token`, `/graphql` (ws), `/ai`, `/payments`, `/ws`
to the backend on `:4000`.

## Run / test

```bash
npm run dev        # vite on :5173
npx vitest run     # mocked client tests (FakeWebSocket + fetch stub)
npx tsc --noEmit   # typecheck
npx vite build     # build
```