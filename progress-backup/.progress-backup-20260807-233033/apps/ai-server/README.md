# BhooAI Nexus — Python AI server

FastAPI server exposing an OpenAI-compatible API backed by OpenAI **and** a local
Ollama instance. The Node backend proxies/re-emits its SSE; the browser never
calls it directly.

## Endpoints

- `POST /chat/completions` — OpenAI-compatible, with SSE streaming (`stream: true`)
- `POST /embeddings` — OpenAI-compatible embeddings
- `GET /models` — list models (OpenAI + Ollama)
- `GET /health`

## Run

```bash
pip install -r requirements.txt
python main.py          # uvicorn on :8000, --reload
```

## Tests

```bash
pip install -r requirements.txt pytest pytest-asyncio httpx
pytest                 # contract tests via FastAPI TestClient
```

The Node↔Python contract is defined in the repo's `contracts/`.