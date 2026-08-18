# BhooAI Nexus — Admin Progress (2026-08-12)

## AI / Chat Playground
- Replaced the scaffolded stub `apps/ai-server` with the framework's full implementation
  (settings, providers, routers — chat SSE, /models, embeddings, preflight, lint).
  - Template: `packages/nexus-cli/templates/apps/ai-server/**`
  - Live: `test-app/test-app/apps/ai-server/**`
  - requirements.txt → `fastapi>=0.115.0`, `uvicorn[standard]>=0.30.0`, `httpx>=0.27.0`
- Rewrote `apps/backend/src/modules/ai/aiProxy.ts` for per-provider routing:
  - `together` → Together SDK (lazy `import('together-ai')`, so projects without the package boot)
  - other configured OpenAI-compatible providers → direct fetch to `{baseUrl}/v1/models`
    + `/chat/completions` (Bearer key, SSE relay)
  - `openai`/`ollama`/unknown → Python AI server fallback
  - Synced to template + test-app.
- `packages/nexus-admin/src/api.ts`: `AiModelsResponse.error?`
- `App.tsx` `AiChatPlayground`: auto-selects first enabled provider + loads its models
  (via `loadModelsRef`/`checkAiRef`), surfaces model-load errors in `msg`.

## Payment providers (Test Console)
- Backend `adminRoutes.ts` `PUT /admin/payments/providers/:id`:
  - accepts credential fields (keyId/keySecret, clientId/clientSecret, merchantKey/salt,
    merchantEmail, programId/apiKey)
  - writes to `.env` as `NEXUS_PAYMENTS_<PROVIDER>_<FIELD>` + syncs `process.env`
  - persists `enabled`/`sandbox` to `nexus.runtime.json` + MongoDB `settings.payments`
  - returns `{ ok, persistence:{runtime,database}, savedFields, provider }`
  - **fix**: removed `config.payments = ...` reassignment (config is frozen) — mutate in place
  - **fix**: calls `deps.payments.refresh(...)` so providers activate without restart
- `GET /admin/payments/status`: returns per-provider `fields` `[{field,label,hasValue}]`
- `packages/nexus-payments/src/index.ts`:
  - added `refresh(config)` to `PaymentsService` (rebuilds provider map in place)
  - `active()` never instantiates a provider missing required keys (fixes boot crash)
- Frontend `App.tsx` + `api.ts`:
  - `savePaymentProviderKeys(id, keys)` API
  - `PaymentKeysDialog` (navy `provider-modal` style) + 🔑 keys button on each provider card
  - success → dismiss dialog + green alert box on Payments page; error → rose inside dialog
- All `adminRoutes.ts` changes synced to framework + `packages/nexus-cli/templates` + test-app.

## Admin UI / theming
- Dialogs/popups use the APPEARANCE-panel navy glass style (`provider-modal`).
- Buttons follow the Config JSON / workspace-action blue theme gradient:
  `linear-gradient(135deg, rgba(38,130,225,0.55), rgba(90,67,183,0.45))`
  - `glass-btn-primary`, `glass-chip-btn`, `glass-chip-btn-primary` (new), `workspace-action`
  - removed `inspector-primary` (replaced by `glass-chip-btn-primary`)
- Drop shadow unified everywhere: `0 1.2rem 2.8rem rgba(0,0,0,0.55)` (matches search results).
- `workspace-tabs` style used in Payments, AI Agents, Cluster mode toggle.
- Theme Centre theme cards use `theme-preview` (deleted `theme-card-swatch`); preview buttons use glass buttons.
- Cluster Link-node dialog matches AI Providers dialog style.
- Section-heading `hero-art` made unique per menu (added `grid`, `cards`, `bolt` variants in CSS):
  Processes=bars, Logs=wave, Cluster=stack, AI Agents=spark, AI Schema=bolt, Plugins=grid,
  Monitoring=coins, Payments=cards, Users=people, Databases=cubes, Theme Centre=palette.
- Removed "THIS PC" from the top breadcrumb (now `Project › <page>`).
- Removed the `×` from the top window tab.
- AI Providers search input: uses plain `glass-input` (dropped `ai-provider-search` id/name),
  flat ⌕ search icon instead of 🔍 emoji.
- `provider-filter-bar` now uses the theme navy glass (blue border, `rgba(7,30,58,0.6)`, blur).
- Top search bar: pointer cursor on hover (text cursor only while focused), hover highlight.
- Search bar matches keywords per menu (e.g. "roles", "mongo", "palette", "stripe", "ollama").
- CURRENT SURFACE inspector card shows a unique per-menu description.

## Payment provider fixes (this session)
- **400 "Unknown or disabled provider"**: added `refresh(config)` to `PaymentsService`
  (`packages/nexus-payments/src/index.ts`) that rebuilds the provider map in place; admin PUT
  calls it so toggles/keys activate without restart.
- **Boot crash "keyId/keySecret required"**: `active()` now never instantiates a provider missing
  its required keys (enabling without keys no longer crashes boot).
- `writeEnvKeys` syncs `process.env` so saved keys apply immediately.

## Verified
- `GET /ai/models?provider=deepseek` → its own models; `provider=ollama` → 16 local models.
- Payment keys PUT works; Razorpay becomes `live=true`, `POST /payments/order` returns a real order.
- 8 Python contract tests pass; admin frontend typecheck passes (`npx tsc --noEmit -p apps\admin\tsconfig.json`).

## Running stack
- test-app: backend :4000, admin :3001, frontend :3000, ai-server :8000, supervisor :7474.
- Test admin user in MongoDB: `testadmin@nexus.local` / `password123` (first registered → admin).

## Notes / gotchas
- `loadEnvFile` skips env vars already set — after editing `.env` directly, a full `npm run dev`
  restart is needed for new keys to load at boot (admin dialog writes avoid this by syncing
  process.env + refreshing in-memory config).
- Backend `npx tsc --noEmit` in `apps/backend` fails on pre-existing composite-reference config
  (TS6306) — backend runs via tsx.
- `nexus-payments` is consumed via `main: ./src/index.ts` (no template copy needed).

## PLAN (next): Functional right-side Tool Rail
- Goal: wire the 5 placeholder buttons in admin-tool-rail (App.tsx:544) into working tools with popover/panel behavior, navy-glass theme.
- State (in Dashboard): railOpen (notes|notify|activity|launcher|appearance|search|null), railRef + outside-click close; favorites:Tab[] in localStorage 'nexus-admin-favorites' (default overview/config/env/logs); activity:{at,label}[] in 'nexus-admin-activity' appended on tab change capped ~20; notes:string in 'nexus-admin-notes'.
- Buttons: ? search ? focus top search (searchInputRef+setSearchOpen(true)) + keyword hint; ? AI Notes ? textarea autosaved+clear; ? Screen recall ? recent activity + clear; ? Notifications ? getAllLogs({level:'error'}) on open + refresh + activity, wire topbar ?3 badge; + Add tool ? favorites/quick-launch toggle, pinned render as top-of-rail quick links; ? Appearance ? setAppearanceOpen(true).
- New RailPanel component (navy glass, admin-pop, right-anchored ~220-260px, shadow 0 1.2rem 2.8rem rgba(0,0,0,0.55)).
- CSS: .admin-tool-rail button.is-active, .rail-fav, .rail-panel (theme vars --admin-blue/--admin-violet); rail stays hidden on mobile.
- Files: packages/nexus-admin/src/App.tsx + index.css. No backend changes.
- Verify: npx tsc --noEmit -p apps\admin\tsconfig.json; HMR at :3001.
- Default: Notifications fetch error/warn logs on open + refresh (real supervisor data) + local activity.
- **DONE**: Functional right-side Tool Rail implemented:
  - state: railOpen, railRef + outside-click; favorites (localStorage 'nexus-admin-favorites', default overview/config/env/logs); activity (localStorage 'nexus-admin-activity', capped 20, appended via goTab); notes (localStorage 'nexus-admin-notes').
  - rail buttons: ? Smart search (focus top search + hint), ? AI Notes (autosaved textarea+clear), ? Screen recall (activity list+clear), ? Notifications (getAllLogs({level:'error'}) on open + refresh), ? Appearance (inline theme/ui-mode picker), + Add tool (favorites toggle list).
  - favorites render as quick-link icons atop the rail (click ? goTab).
  - new RailPanel component + CSS: .rail-panel (navy glass, admin-pop, fixed right, shadow 0 1.2rem 2.8rem rgba(0,0,0,0.55)), .rail-favs, .rail-appearance, .rail-list, .admin-tool-rail button.is-active. Rail + panel hidden on mobile via existing media queries (rail display:none; panel is fixed so only reachable when rail visible).
  - Files: packages/nexus-admin/src/App.tsx + index.css. No backend changes. Typecheck passes.

## Tool rail — favorites removed, rail simplified (2026-08-13)
- Removed the favorites/quick-launch section from the rail (`.rail-favs` block + CSS deleted).
  Pinning still works for the tab switcher (`App.tsx:812`).
- Rail now holds 4 tools: Smart search (⌕), AI Notes (▣), Screen recall (◫), Notifications (◍).
  Appearance (◒) remains in the top bar.
- Rail vertically centered (`top: 50%` + `translateY(-50%)`); `rail-panel` aligned via its own
  `translate` property so it never collides with the `admin-pop` transform.
- Tooltips (`data-tip`) shown above rail buttons.

## Provider cards + theme toggle system
- `.provider-card` restyled to the admin navy-glass surface (`rgba(8, 25, 48, 0.68)`),
  theme radius/glass, status-tinted border via `--card-accent`.
- Toggle styles integrated into the theme system:
  - `ToggleStyle = 'chip' | 'neon' | 'icon' | 'orb' | 'track'`; `CustomTheme.toggle` default `'chip'`
    in all presets; persisted with the custom theme in localStorage (`nexus-admin-custom-theme`).
  - Theme Centre → SURFACE TUNING has a "TOGGLE STYLE" picker (`.toggle-style-row`) with live previews.
  - Selection threaded `Dashboard → AiAgents → AiProviders → ProviderGroup → ProviderCard`
    via `tg-${toggle}`; applied with `.ai-toggle.tg-chip|tg-neon|tg-icon|tg-orb|tg-track` CSS
    + glow keyframes (`ai-glow-breathe`, `ai-glow-icon`, `ai-glow-dot`, `ai-orb-pulse`).
- `.provider-badge-*` variants now `@apply provider-badge` (`px-2.5 py-1`, gap, `leading-none`).
- AI provider toggles animate: `.provider-card.is-switch-out` (0.28s) → API call → vanish →
  `.provider-card.is-switch-in` (0.42s), via `switchAnim` state; `busy` set immediately to block
  double clicks.
- Payments → Test Console provider cards mirror the AI cards (`.provider-card` + `is-on`/`is-off`,
  `ai-toggle tg-${toggle}`, `provider-badge-*`, same fade animation).

## Admin alerts centralized (alertCenter.tsx)
- New `packages/nexus-admin/src/alertCenter.tsx`:
  - `AlertProvider` + `useAlerts()` → `{ alerts, push, clear, dismiss }`; persisted to
    localStorage `nexus-admin-alerts` (cap 50). Mounted around `Dashboard` in `App()`.
  - `useAdminAlert(source)` → `[msg, setMsg]`; auto-kinds messages
    (`cluster` → warn, error-heuristic → err, else ok), dedupes repeated values so the Cluster
    5s poll doesn't spam.
- Inline `role="alert"` banners removed from: Cluster, AiSettings, AiProviders, AiChatPlayground,
  Config, Environment, Users, Payments (incl. TestConsole `onNotice` feed), Databases, Schema.
  Kept inline: Login, Logs, Lint errors, PaymentKeysDialog, and the Cluster pairing modal banner.
- Notifications rail panel gains an ADMIN ALERTS section below the supervisor error-log list:
  divider, Clear button, per-row dismiss, severity dots, `source · time`, empty state.
- Top-bar ⌁ button (`App.tsx:553`) opens the notify panel, gets `.is-active` glow, and shows a
  live count badge = `alerts.length` (99+ cap).

## Init template
- The init template's admin app (`packages/nexus-cli/templates/apps/admin`) consumes
  `@bhooai/admin` (= `packages/nexus-admin`) through the framework workspace, so all the above
  ships to generated projects automatically. Tailwind content scan already includes
  `nexus-admin/src/**/*.{ts,tsx}` (covers `alertCenter.tsx`). No template copy to sync.

## Verified
- `npm run build --workspace @bhooai/admin-host` passes (tsc + vite) after the alert migration.

## Notification popup redesigned + anchored to top-bar (2026-08-13)
- The notification dialog (was: `rail-panel` beside the rail) is now a dedicated `NotifyPanel`
  anchored UNDER the top-bar ⌁ button (wrapped in `.admin-notify`, absolute below the button,
  caret pointing up, `z-index: 45`).
- Redesign:
  - Header with icon chip + "NOTIFICATIONS" overline + live count title, refresh (↻) and close (×).
  - Summary strip (errors / warnings / notices / log-line counts, severity-coloured).
  - ADMIN ALERTS section: rows with coloured left bar + dot, message, `source · time`, per-row
    dismiss, "Clear all"; SYSTEM ERRORS section: supervisor error-level log lines.
  - Scrollable `.notify-body`, empty states ("All clear" / "Loading notifications…"), keyframe
    `notify-pop`, custom scrollbar.
- Outside-click close now also keeps the panel open when clicking inside `notifyRef`.
- RailPanel's notify section collapsed to a pointer note (the rail ◍ button still toggles the
  same panel). Old `.rail-alerts*` / `.rail-list--logs` CSS removed.
- Files: `packages/nexus-admin/src/App.tsx` + `index.css`. No backend changes. Build passes.


