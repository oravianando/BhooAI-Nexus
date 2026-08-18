"""Test fixtures: a mocked upstream (httpx MockTransport) + patched get_provider
so the routers hit canned responses instead of real OpenAI/Ollama."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import pytest

# Make the app dir importable (so `import main`, `from config import ...` work).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _mock_handler(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if "/chat/completions" in url:
        body = json.loads(request.content.decode())
        if body.get("stream"):
            chunks = [
                {"id": "c1", "model": body["model"], "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Hello"}}]},
                {"id": "c1", "model": body["model"], "choices": [{"index": 0, "delta": {"content": " world"}, "finish_reason": None}]},
            ]
            sse = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
            return httpx.Response(200, content=sse.encode(), headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={
            "id": "c1", "model": body["model"],
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hi there"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6},
        })
    if "/embeddings" in url:
        body = json.loads(request.content.decode())
        inp = body["input"]
        n = len(inp) if isinstance(inp, list) else 1
        return httpx.Response(200, json={
            "model": body["model"],
            "data": [{"index": i, "embedding": [0.1, 0.2, 0.3]} for i in range(n)],
            "usage": {"prompt_tokens": n, "total_tokens": n},
        })
    if url.endswith("/models") or "/models" in url:
        return httpx.Response(200, json={"data": [{"id": "gpt-test", "owned_by": "test"}]})
    return httpx.Response(404, json={"error": {"message": "not found", "code": "404"}})


@pytest.fixture
def mock_transport():
    return httpx.MockTransport(_mock_handler)


@pytest.fixture
def client(mock_transport):
    from fastapi.testclient import TestClient
    import main
    from providers.base import OpenAIProvider

    provider = OpenAIProvider("http://upstream.test/v1", "test-key", 30, transport=mock_transport)

    # Patch the get_provider used by each router to return our mocked provider,
    # while still validating the requested provider (so bogus → 400).
    from config import resolve_provider

    def fake_get_provider(requested):
        resolve_provider(requested)  # raises ValueError on unknown
        return provider

    main.chat.get_provider = fake_get_provider
    main.embeddings.get_provider = fake_get_provider
    main.models.get_provider = fake_get_provider

    with TestClient(main.app) as c:
        yield c