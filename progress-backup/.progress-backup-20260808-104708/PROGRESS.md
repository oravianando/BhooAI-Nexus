# Progress snapshot — 2026-08-08 10:47

Checkpoint for the preflight architecture redesign (Node-native probing). Source of
truth: framework at `C:\server\BhooAI\BhooAI-Nexus\BhooAI-Nexus\bhooai-nexus\`; files
synced into projects under `C:\server\BhooAI\BhooAI-Nexus\{MyFirstProject,sample-project,social-network}\`.

## Files in this snapshot (changed this session)
- `apps/backend/src/modules/admin/preflightProxy.ts` — **rewritten**: Node performs all
  connectivity/latency probes itself (fetch + net), no Python round-trip
- `admin/src/App.tsx` — `friendlyPreflightError` dedupes the label case-insensitively
  ("Timed out — Timed Out …" collapse), plus the earlier search UI

## Why (user report: "preflight, fail — Timed out — Timed out — the service may be filtering traffic")
The Backend + GraphQL probes were built from `config.server.host`, which is the **bind**
address `0.0.0.0`. Connecting *to* `0.0.0.0` is invalid on this platform (`WinError 10049`),
which Python's `_classify_error` mapped to the `timeout` category → the misleading
"timed out — the service may be filtering traffic". Live probes confirmed backend (:4000),
AI server (:8000), Mongo (:27017) and Redis (:6379) were all actually listening — only the
two `0.0.0.0`-based targets failed. UI compounded this by prefixing the category label again.

## Delivered (Option B — preflight runs entirely in Node)
- **`preflightProxy.ts` rewritten**: same `POST /admin/preflight` + `PreflightReport` /
  `PreflightCheck` shape, but:
  - `normalizeProbeHost()` maps `0.0.0.0`, `::`, `[::]`, `localhost`, `localhost.localdomain`
    → `127.0.0.1`, and strips bracket IPv6 `[…]`.
  - HTTP probes via `fetch(..., signal: AbortSignal.timeout(...))` (abort → `timeout`),
    `ok = status < 400`, `http` category carries `HTTP <status>`.
  - TCP probes via `net.createConnection` with a timeout; transient errors classified to
    `refused` / `dns` / `timeout` / `other` (ECONNREFUSED / ENOTFOUND / ETIMEDOUT /
    UND_ERR_CONNECT_TIMEOUT / ABORT_ERR), with `sanitize()` masking noisy strings
    (`WinError`, "address not valid/already in use" → "unreachable from this host").
  - GraphQL now probes with `GET …/graphql?query=<encodeURIComponent('{ __typename }')>`:
    a bare GET returns 400 (no query) and POST is CSRF/trusted-origin blocked.
  - Run all checks concurrently (`Promise.all`), 800ms slow threshold → `warnings`,
    ordering failed → slow → ok like the Python report; `engineOk: true`.
  - **No Python dependency**: the synthetic `engine_offline` report is gone from this path;
    the Python `/preflight` endpoint in `apps/ai-server/routers/preflight.py` remains
    untouched for any external tooling.
- **`App.tsx`**: `friendlyPreflightError()` now compares `startsWith` case-insensitively so
  the label isn't doubled.

## Verification
- `tsc --noEmit` on preflightProxy.ts (and all 3 project copies, identical SHA256) — clean;
  full backend build only shows the pre-existing TS6306 project-reference errors.
- Standalone handler smoke (tsx, real config `loadConfigAuto`):
  `passed=5 warnings=0 failed=0 duration=21ms` — Backend API, AI server, GraphQL, MongoDB,
  Redis all `ok`, addresses shown as `127.0.0.1:port` (no `0.0.0.0`/`localhost` leaked).
- Live HTTP: register/login flow (trusted-origin + CSRF) reaches `/admin/preflight`
  (403 above was just "requires admin role"; behaviour verified via the 5/5 smoke).
- Framework + all 3 project admins rebuilt OK (App.tsx sync; identical asset hashes).

## Notes
- Running backend auto-reloaded via `tsx watch` (PID changed on save); Redis `/ai-server`
  etc. still on their configured ports.
- Earlier checkpoints: `...-20260808-094050` (header search), `-093748` (UI polish),
  `...-20260807-233033` (resilience pass), `-225955` (Incr 2 linter), `-222934`,
  `-205008`.
- Roadmap position: Incr 1 ✅, Incr 2 ✅, resilience ✅, UI polish ✅, search ✅, preflight
  redesign ✅; next: Incr 3 enhanced AI schema generation.