# Plan: `libraries/` — Python library callable from Node.js

## Goal
Create a `libraries/` folder that turns the current Node↔Python bridge into
clean, reusable libraries:

- **Python library** (`libraries/python/`) — an installable Python package that
  implements the FastAPI app (providers, routers, settings) as a library.
- **Node bridge** (`libraries/node/nexus-bridge/`) — a typed Node package that
  sends requests to the Python library over HTTP and returns typed responses,
  so developers call Python from Node without touching raw fetch/SSE.

The existing `apps/ai-server` (Python) and `packages/nexus-ai-client` (Node)
become thin wrappers over these libraries. No behavior change.

## Current architecture (source of truth)
- `apps/ai-server/` — FastAPI app: `main.py` mounts `routers/{chat,embeddings,models,lint,preflight}`; `providers/` (OpenAI + Ollama) ; `settings.py`; contract tests in `apps/ai-server/tests/`.
- `packages/nexus-ai-client/` — Node client: `client.ts` (fetch + SSE + retries), `types.ts`, `sse.ts`, `errors.ts`. Calls `/chat/completions`, `/embeddings`, `/models`.
- Node backend (`apps/backend/src/modules/ai/aiProxy.ts`) proxies `/ai/*` to the AI server; admin lint/preflight proxy to Python `/lint/*` and `/preflight`.
- Contract: `contracts/ai-openapi.yaml`.

## Target layout

```
libraries/
├── PLAN.md                     (this file)
├── python/
│   ├── pyproject.toml          # name = "bhooai-nexus", installable, deps: fastapi/uvicorn/httpx
│   ├── README.md
│   └── bhooai_nexus/
│       ├── __init__.py         # exports create_app, __version__
│       ├── server.py           # create_app() — FastAPI factory (CORS + health + routers)
│       ├── settings.py         # moved from apps/ai-server
│       ├── providers/
│       │   ├── __init__.py
│       │   └── base.py         # moved from apps/ai-server
│       ├── routers/
│       │   ├── __init__.py
│       │   ├── chat.py         # moved
│       │   ├── embeddings.py   # moved
│       │   ├── models.py       # moved
│       │   ├── lint.py         # moved
│       │   └── preflight.py    # moved
│       └── tests/
│           ├── conftest.py     # moved from apps/ai-server
│           └── test_contract.py
└── node/
    └── nexus-bridge/
        ├── package.json        # name @bhooai/nexus-bridge
        ├── tsconfig.json
        ├── src/
        │   ├── index.ts        # exports PythonBridge, types
        │   ├── bridge.ts       # generic call(): POST/GET to Python, SSE for stream
        │   ├── sse.ts          # reuse/extend AI-client SSE parser
        │   └── types.ts        # chat/embeddings/models/lint/preflight request+response types
        └── tests/
            └── bridge.test.ts  # mocked fetch
```

## Step 1 — Python library (`libraries/python/`)
1. Copy `providers/`, `routers/`, `settings.py` from `apps/ai-server` into
   `bhooai_nexus/` as a proper package (fix imports to `from bhooai_nexus.providers import ...`).
2. Add `server.py` with `create_app()` — moves the `main.py` body (CORS,
   `/health` with providers, `include_router` x5) into the library.
3. Add `pyproject.toml` (`pip install -e ./libraries/python`):
   - name `bhooai-nexus`, version 0.1.0, requires `fastapi>=0.115`, `uvicorn[standard]>=0.30`, `httpx>=0.27`.
   - Optional dev extras: `pytest`, `pytest-asyncio`.
4. Move `apps/ai-server/tests/` into the package as `bhooai_nexus/tests/`.
5. Rewrite `apps/ai-server/main.py` to a thin entrypoint:
   ```python
   from bhooai_nexus import create_app
   app = create_app()
   if __name__ == "__main__":
       import uvicorn; uvicorn.run(app, host="0.0.0.0", port=...)
   ```
6. `apps/ai-server/requirements.txt` → installs the package:
   `-e ../../libraries/python` plus the runtime deps.
7. `pytest.ini` updated so `pytest` runs `bhooai_nexus/tests` from the library.

## Step 2 — Node bridge (`libraries/node/nexus-bridge/`)
1. `package.json`:
   - name `@bhooai/nexus-bridge`, private, `type: module`, `main: ./src/index.ts`.
   - deps: none (uses global fetch); devDeps: typescript, vitest, @types/node.
2. `src/types.ts` — re-export chat/embeddings/models types AND add `lint`/`preflight` types (the pieces the AI client lacks).
3. `src/sse.ts` — copy the SSE parser pattern from `nexus-ai-client`.
4. `src/bridge.ts` — `class PythonBridge`:
   - `constructor({ baseUrl, timeoutMs, maxRetries, authToken })`
   - `chat(req)` → `POST /chat/completions`
   - `chatStream(req)` → async generator over SSE chunks
   - `embeddings(req)` → `POST /embeddings`
   - `models(provider?)` → `GET /models`
   - `lintEnv(envText)` → `POST /lint/env`
   - `lintConfig(content)` → `POST /lint/config`
   - `preflight(targets)` → `POST /preflight`
   - retries/timeouts mirror `nexus-ai-client/client.ts`.
5. `src/index.ts` — exports `PythonBridge`, all types, error class.
6. Add to npm workspaces in root `package.json` (`"libraries/node/*"`).
7. Tests: `tests/bridge.test.ts` with mocked `fetch` (all methods + stream).

## Step 3 — Wire existing code to the libraries
1. `packages/nexus-ai-client` — either keep as-is (thin, same contract) OR make it
   re-export `@bhooai/nexus-bridge`. Keep `nexus-ai-client` for backwards compat;
   note in its README that `nexus-bridge` supersedes it.
2. `apps/backend/src/modules/ai/aiProxy.ts` — switch import to `@bhooai/nexus-bridge`
   (same call surface, so this is a 1-line import change).
3. Admin lint/preflight proxies already POST to Python `/lint/*` and `/preflight` —
   they can keep using raw fetch, or adopt the bridge for typed calls (optional).
4. `apps/ai-server/main.py` — thin entrypoint (Step 1.5).
5. Update `tsconfig.json` include to cover `libraries/node/**/*`.

## Step 4 — Docs + verification
1. `libraries/README.md` — how to use the Python lib and the Node bridge, with examples.
2. Update `apps/ai-server/README.md` and `docs/ARCHITECTURE.md` to mention `libraries/`.
3. Update `PROGRESS.md` with a new milestone entry.
4. Add the Step 5 roadmap (features/platform/architecture) to `docs/IMPROVEMENTS.md`
   and extend `contracts/ai-openapi.yaml` as endpoints land.
5. Verify:
   - `pip install -e ./libraries/python` + `pytest` (Python contract tests pass).
   - `npx vitest run libraries/node/nexus-bridge` (Node bridge tests pass).
   - `npm run doctor` passes.
   - `nexus dev` boots all four terminals; `POST /ai/chat/completions` still works.
   - `npm run build` for frontend unaffected; backend typecheck passes.
   - New roadmap endpoints (once implemented) pass contract tests in Python + bridge tests in Node.

## Step 5 — Applications & roadmap

### Feature ideas (product layer, ordered by value)
1. **Embeddings + smart search** — embed posts/users via `/embeddings`, store
   vectors, semantic search replacing substring filtering (`SearchResults`).
2. **Auto-tagging & summaries** — Python tags posts (PRODUCT / BUILD IN PUBLIC…)
   + one-line summary on publish.
3. **Content moderation hook** — `/moderate` scores posts/comments pre-publish;
   auto-flag or quarantine.
4. **Recommendation feed** — embed liked posts, rank candidates by cosine
   similarity → "For you" feed.
5. **AI profile helpers** — bio + handle suggestions on signup.
6. **Translations** — on-demand EN/ES/FR/JA translation for post text (UI already
   has the 4 languages).
7. **Link enrichment** — og: metadata + NER people/places for `link-preview`.
8. **Analytics / bot detection** — usage aggregation + burst-posting anomaly
   flags for the admin pane.

### Platform capabilities
9. **Code interpreter sandbox** — Node sends `post.code` to Python for safe
   subprocess execution; returns stdout/errors.
10. **Scheduled Python jobs** — `CronScheduler` triggers digests/cleanup/recs
    over HTTP.
11. **Vision pipeline** — thumbnails, OCR, alt-text on uploads via `/uploads`.
12. **Import/export + PDF** — batch CSV/JSON imports, receipts, DB exports for
    admins.
13. **Vector store service** — Python owns embedding storage (Redis via
    `nexus-cache` or Mongo), exposes `/search`, `/recs`.
14. **Webhook processor** — normalize/validate heavy payment webhooks in Python;
    Node persists result.
15. **CLI/data scripts** — one-off migrations & seeding using the same
    `pysetup`/`python main.py` pattern.

### Architecture patterns
16. **Asymmetric trust** — Python on private network, Node-only caller,
    `authToken` lock.
17. **Queue-based offload** — long Python tasks via Redis (`nexus-cache` PubSub)
    jobs; Node polls results.
18. **Per-tenant provider routing** — premium → OpenAI, free → local Ollama
    (already in contract).
19. **Streaming pipelines** — SSE Python→Node→browser; also progress events on
    long jobs.
20. **Plugin extension** — expose Python endpoints as admin "AI skills" via the
    plugin system.

### Recommended sequencing (after `libraries/` restructure)
1. Smart search (embeddings) — highest visible value, uses existing `/embeddings`.
2. Auto-tagging/summaries — makes the feed AI-native.
3. Moderation hook — safety + production-ready.
4. Queue-based job offload — scalability foundation for the rest.

### New contract additions required
- `/moderate`, `/summarize`, `/translate`, `/search`, `/recs`, `/code/run`
  endpoints to be added to `contracts/ai-openapi.yaml` as features land.

## Out of scope (for now)
- Refactoring the 16 existing `packages/nexus-*` into `libraries/node/` (only the
  new bridge lives there; existing packages stay put to avoid breaking imports).
- Behavior changes to providers/routers.
