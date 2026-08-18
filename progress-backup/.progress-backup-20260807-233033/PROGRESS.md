# Progress snapshot — 2026-08-07 23:30

Checkpoint for the preflight/lint resilience improvements. Source of truth: framework at
`C:\server\BhooAI\BhooAI-Nexus\BhooAI-Nexus\bhooai-nexus\`; files synced into projects under
`C:\server\BhooAI\BhooAI-Nexus\{MyFirstProject,sample-project,social-network}\`.

## Files in this snapshot (changed this session)
- `apps/ai-server/routers/preflight.py` — NEW failure classification + fast connect timeouts
- `apps/backend/src/modules/admin/preflightProxy.ts` — engine_offline synthetic report + `engineOk`
- `apps/backend/src/modules/admin/lintProxy.ts` — same engine_offline synthetic + `engineOk`
- `admin/src/api.ts` — `PreflightCheck`/`LintCheck` gained `port?` + `errorCategory?`; reports `engineOk?`
- `admin/src/App.tsx` — `friendlyPreflightError`/`CATEGORY_LABEL`/`preflightAddress` helpers; preflight rows
  now show target address + friendly categorized errors; all-failed guidance banner; LintChecks engine guidance
- `admin/src/index.css` — `.preflight-address`, `.preflight-guidance`, `.text-action` in guidance

## Why (user report: "fail — All connection attempts failed")
httpx's raw connect error text was surfaced verbatim, there was no distinction between the Python
diagnostics engine being down vs a dependency being down, and no guidance. Port 8080/5174/Mongo were
often not running when checks were run, so every probe failed with that opaque string.

## Delivered improvements
- **A — Python** (`preflight.py`): checks now classify failures → `errorCategory` in
  {refused, timeout, dns, ssl, http, other} with a short human message (e.g. "connection refused on
  host:port — is the service running?"), never the raw transport string. HTTP uses a fast connect
  timeout (`httpx.Timeout(connect=1.0, ...)`) so dead hosts fail in ~1s. No new deps.
- **B-slice — Node proxies**: when the Python engine is unreachable, both proxies return
  `{ engineOk: false, ... }` with a single clear `engine_offline` check:
  "Python diagnostics engine offline — start it with `python main.py` or `nexus dev`".
  (Chosen slice: messaging only — NOT the full Node local-probe fallback, which remains out of scope.)
- **C — Admin UI**: each preflight row shows the target address (host/port or url) and a friendly,
  categorized error (with title tooltip for full text). An amber guidance banner appears when
  everything failed or the engine is offline. Lint panel shows the same engine-offline banner.

## Verification
- `python -m py_compile` on preflight.py (framework + 3 projects) — OK.
- FastAPI `TestClient` smoke: dead http + dead tcp → `errorCategory=timeout`, human message; bad DNS →
  `dns`; live health → ok. Confirmed no "All connection attempts" string leaks. (This machine's port-1
  probes surface as `timeout`; refused path is handled for real ECONNREFUSED cases.)
- Backend `tsc --noEmit` filtered to touched proxies — clean (pre-existing TS6306 elsewhere).
- Framework admin `npm run build` OK (assets index-p1EEpSYD.css, index-DWCFGO1y.js); all 3 project admins rebuild OK.

## Notes
- En-dash/em-dash renders as mojibake (`�`) only in the console capture; the files contain correct Unicode.
- Earlier checkpoints: `...-20260807-225955` (Incr 2 linter), `...-222934` (Incr 1 + rename + pysetup),
  `...-205008` (Theme Centre v2).
- Roadmap position: Incr 1 Preflight ✅, Incr 2 linter ✅, resilience pass ✅; next: Incr 3 enhanced
  AI schema generation.