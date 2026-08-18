# Plan: `nexus init` — all-in-one setup wizard

## Goal
Turn `nexus init` into a single interactive command that, when it finishes, leaves a
fully bootable stack: Node backend, frontend, admin, Python AI server, Mongo + Redis
wired, JWT secret, AI provider keys, and the cluster token. After running it once,
`npm run dev` starts everything.

## Current state (source of truth)

`nexus init` (`packages/nexus-cli/src/commands/init.ts`) today:
1. Scaffolds templates (`listFiles(TEMPLATES)` -> write each)
2. `wireFrameworkDependency()` — workspace paths + `file:` dep + Vite/Tailwind patching
3. `allocateProjectPorts()` — auto-pick free ports for server/frontend/admin/ai/lb/agent
4. `ensureJwtSecret()` — generate `NEXUS_AUTH_JWT_SECRET`, add empty AI/payment env keys
5. `chooseKind()` — interactive root/node prompt (the only wizard step today)
6. `applyClusterConfig()` — write cluster section into `nexus.config.ts`
7. `installDependencies()` — `npm install`
8. `printSetup()` — onboarding text

Gaps that prevent "everything at once":
- Python deps never installed (separate `nexus pysetup` command, forgotten by users)
- No Mongo/Redis reachability check before scaffolding -> silent failures at `npm run dev`
- No way to customize DB URI / Redis URL / AI provider keys during init (empty placeholders only)
- No final verification that the scaffolded project actually loads
- `.env` doesn't get `MONGODB_URI`/`REDIS_URL` (Python AI server can't connect)

`pysetup.ts` is non-interactive (one-shot pip install). `doctor.ts` has reusable check
logic (`tcpReachable`, `versionOf`, `parseHostPort`) but it's a monolithic `doctor()`
function, not exported helpers.

## Wizard flow (interactive when stdin is a TTY; flag-driven otherwise)

```
nexus init [target] [--as=root|node] [--no-interactive] [--no-venv] [--no-install] [--skip-mongo-check]
```

| # | Step | Interactive prompt | Non-interactive fallback |
|---|------|--------------------|--------------------------|
| 0 | Banner — "BhooAI Nexus — project setup wizard" + what it'll do | shown | shown |
| 1 | Prerequisite scan — detect node, npm, python, git, Mongo TCP, Redis TCP. Blocks on missing node/python (critical); warns on missing Mongo/Redis (asks to continue) | shown, "Continue anyway?" if Mongo/Redis down | `--skip-mongo-check` skips; missing node/python -> exit 1 |
| 2 | Project name -> `package.json` name + Mongo db name | prompt, default = dir basename | `--name <x>` or dir basename |
| 3 | Server kind root/node (existing `chooseKind`) | prompt | `--as=root\|node` |
| 4 | Cluster role + port (if node) | prompt role, default `backend` | `--role` `--port` |
| 5 | Ports — auto-allocate (existing) OR custom | "Auto-allocate free ports? Y/n" | auto (existing) |
| 6 | Mongo URI — confirm or edit, DB name from step 2 | prompt, default `mongodb://localhost:27017/<name>` | `--mongo-uri` |
| 7 | Redis URL — confirm or edit | prompt, default `redis://localhost:6379` | `--redis-url` |
| 8 | AI providers — multi-select (openai/ollama/anthropic/google/groq/...), then enter API key for each selected (written to `.env`). Ollama/lmstudio need no key. | multi-select + per-key prompt | `--ai-providers openai,ollama` (keys via env or `--ai-key <id>=<val>`) |
| 9 | Python venv — "Create a virtualenv for the AI server? Y/n" | prompt | `--no-venv` skips; `--venv` forces |
| 10 | Review summary — table of all chosen values; "Proceed? Y/n" | shown | proceeds |
| 11 | Scaffold templates (existing) | — | — |
| 12 | Wire framework (existing) | — | — |
| 13 | Allocate ports (existing) | — | — |
| 14 | Write config — patch `nexus.config.ts` with chosen Mongo URI / Redis URL / AI serverUrl + `applyClusterConfig` (existing) | — | — |
| 15 | Generate `.env` — JWT secret (existing) + `MONGODB_URI` + `REDIS_URL` + AI provider keys from step 8 + cluster token + payment placeholders (existing) | — | — |
| 16 | npm install (existing) | — | — |
| 17 | Python setup — invoke `pysetup(['--venv'\|--no-venv])` -> creates `apps/ai-server/.venv` + `pip install -r requirements.txt` | — | — |
| 18 | Verify — run an in-process mini-doctor on the new project: load `nexus.config.ts`, TCP-check Mongo/Redis, check backend/frontend/admin/ai ports free, sign+verify a JWT. Print pass/fail table. | — | — |
| 19 | Next steps — print URLs (backend `:port/health`, frontend, admin, ai `127.0.0.1:port`), pairing token, and `npm run dev` | shown | shown |

## Files to change (8)

### Framework — CLI

1. **`packages/nexus-cli/src/wizard.ts`** (NEW) — shared wizard primitives used by `init`
   and `pysetup`:
   - `isInteractive()` — `process.stdin.isTTY && !process.env.CI`
   - `prompt(q, default?)`, `confirm(q, default?)`, `select(q, options)`, `multiSelect(q, options)`
   - `banner(title, lines)`, `summaryTable(rows)`, `statusIcon(ok)`
   - Built on `node:readline/promises` (already used by `chooseKind`)
   - No new deps

2. **`packages/nexus-cli/src/commands/init.ts`** (rewrite) — orchestrate the 20-step flow
   above. Keep existing helpers (`wireFrameworkDependency`, `allocateProjectPorts`,
   `ensureJwtSecret`, `applyClusterConfig`, `installDependencies`, `printSetup`); insert
   prerequisite scan, prompts (steps 2/6/7/8/9), review, pysetup call, verify. Extract
   `ensureJwtSecret`'s env-key writing into a reusable `writeEnv(target, entries)` so the
   new `.env` step is one call. Add flags: `--name`, `--mongo-uri`, `--redis-url`,
   `--ai-providers`, `--ai-key`, `--venv`/`--no-venv`, `--no-interactive`,
   `--skip-mongo-check`.

3. **`packages/nexus-cli/src/commands/pysetup.ts`** (extend) — accept an `--interactive`
   flag that, when set and TTY, prompts for venv y/n + python path before installing.
   Expose `pysetup(args)` so `init` can call it programmatically (already exported). No
   behavior change for direct `nexus pysetup` invocation unless `--interactive` passed.

4. **`packages/nexus-cli/src/commands/doctor.ts`** (refactor) — extract the reusable
   prerequisite scan into exported helpers in `util.ts` so `init` step 1 reuses them:
   `scanRuntimes()` (node/npm/python/git versions), `scanServices(cfg)` (Mongo/Redis/AI
   TCP + port-free checks). `doctor()` becomes a thin renderer over these. No output change.

5. **`packages/nexus-cli/src/util.ts`** — add `scanRuntimes()`, `scanServices(cfg)`,
   `tcpReachable` (exists), `versionOf` (exists). Move the runtime + service check logic
   out of `doctor.ts` so both `doctor` and `init` share one implementation.

6. **`packages/nexus-cli/src/index.ts`** — update `init` help line to list new flags; no
   dispatch change (init already wired at `index.ts:20`).

### Framework — templates

7. **`packages/nexus-cli/templates/package.json`** — add `"pysetup": "nexus pysetup"`
   script so users can re-run it easily. (Optional; the wizard runs it automatically.)

8. **`packages/nexus-cli/templates/nexus.config.ts`** — no structural change, but the
   wizard patches it at step 14 with the chosen Mongo URI / Redis URL / AI serverUrl.
   (Patch logic lives in `init.ts`, not the template.)

## Security / correctness invariants

- **Python AI server binds `127.0.0.1`** — wizard writes `AI_HOST=127.0.0.1` into `.env`
  and the template `settings.py` reads it (pairs with the `/py-server` plan; if that plan
  hasn't run yet, the wizard still sets the env so a future `settings.py` picks it up).
- **`.env` is the single secrets sink** — JWT secret, Mongo URI, Redis URL, AI keys,
  cluster token all land there. `nexus.config.ts` stays clean (no secrets), matching the
  existing precedence comment.
- **No external exposure of Python** — only Node binds `0.0.0.0`; AI server stays
  loopback. Wizard's verify step asserts `ai.serverUrl` host is `127.0.0.1` or `localhost`.
- **Idempotent** — re-running `nexus init .` in an existing project updates config +
  `.env` without clobbering secrets (existing `ensureJwtSecret` pattern preserved).

## Verification (after execution)

1. `nexus init test-app` (interactive) -> walk through prompts -> all 20 steps complete.
2. `cd test-app && npm run doctor` -> all green.
3. `cd test-app && npm run dev` -> backend, frontend, admin, AI server all start;
   `http://localhost:<port>/health` returns ok.
4. `nexus init test-app --no-interactive --name ci-app --mongo-uri mongodb://localhost:27017/ci-app --ai-providers ollama --venv`
   -> fully non-interactive, exit 0.
5. Re-run `nexus init .` inside `test-app` -> secrets preserved, config updated.
6. Existing `cli.test.ts` (`run('init', [dir, '--skip-install'])`) still exits 0 and
   scaffolds the four-terminal tree (non-interactive mode, no pysetup).

## Decisions (confirmed)

- Wizard interactivity auto-detected via TTY + `!CI`; `--no-interactive` forces flags-only.
- Mongo/Redis down at init -> warn + "Continue anyway?" (default yes). Hard requirement
  only for node/python.
- AI provider keys typed inline during the wizard (hidden echo). Left blank = fill later.
- Python venv default **yes** (deps don't pollute global site-packages).
- `--skip-install` skips BOTH npm install and pysetup (so tests/CI don't hang on pip).
- Plan saved here at `packages/nexus-cli/PLAN.md` (matches repo `PLAN.md` convention).