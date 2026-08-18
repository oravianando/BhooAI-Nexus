"""Contract tests — verify the AI server implements contracts/ai-openapi.yaml.
No real network: the upstream is a mocked httpx transport (see conftest.py)."""
from __future__ import annotations

import json


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "ollama" in body["providers"]


def test_chat_completion_non_stream(client):
    r = client.post("/chat/completions", json={
        "model": "gpt-test", "messages": [{"role": "user", "content": "hi"}],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "openai"
    assert body["choices"][0]["message"]["content"] == "Hi there"
    assert body["choices"][0]["finish_reason"] == "stop"
    assert body["usage"]["total_tokens"] == 6


def test_chat_completion_stream(client):
    with client.stream("POST", "/chat/completions", json={
        "model": "gpt-test", "messages": [{"role": "user", "content": "hi"}], "stream": True,
    }) as r:
        assert r.status_code == 200
        assert "text/event-stream" in r.headers["content-type"]
        chunks = []
        for line in r.iter_lines():
            if line.startswith("data:"):
                raw = line[5:].strip()
                if raw == "[DONE]":
                    break
                chunks.append(json.loads(raw))
    # The stream injected `provider` into every chunk and ended with [DONE].
    assert len(chunks) == 2
    assert all(c["provider"] == "openai" for c in chunks)
    assert chunks[0]["choices"][0]["delta"]["content"] == "Hello"
    assert chunks[1]["choices"][0]["delta"]["content"] == " world"


def test_embeddings_single(client):
    r = client.post("/embeddings", json={"model": "text-embed-test", "input": "hello"})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "openai"
    assert len(body["data"]) == 1
    assert body["data"][0]["embedding"] == [0.1, 0.2, 0.3]


def test_embeddings_batch(client):
    r = client.post("/embeddings", json={"model": "text-embed-test", "input": ["a", "b", "c"]})
    assert r.status_code == 200
    assert len(r.json()["data"]) == 3


def test_models(client):
    r = client.get("/models")
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "openai"
    assert body["data"][0]["id"] == "gpt-test"


def test_unknown_provider_400(client):
    r = client.post("/chat/completions", json={
        "model": "x", "messages": [{"role": "user", "content": "hi"}], "provider": "bogus",
    })
    assert r.status_code == 400


def test_provider_field_stripped_before_upstream(client, mock_transport):
    # The mock handler reads request.content; ensure 'provider' is NOT forwarded.
    seen = {}

    def handler(request):
        body = json.loads(request.content.decode())
        seen["forwarded"] = body
        return _orig_handler(request)

    import conftest
    _orig_handler = conftest._mock_handler
    # Swap the handler on the existing transport by creating a fresh one is hard;
    # instead assert via a separate transport.
    import httpx
    captured = {}

    def capturing(request):
        captured["body"] = json.loads(request.content.decode())
        return _orig_handler(request)

    from providers.base import OpenAIProvider
    prov = OpenAIProvider("http://upstream.test/v1", "k", 30, transport=httpx.MockTransport(capturing))
    import main
    main.chat.get_provider = lambda _req=None: prov
    r = client.post("/chat/completions", json={
        "model": "gpt-test", "messages": [{"role": "user", "content": "hi"}], "provider": "openai",
    })
    assert r.status_code == 200
    assert "provider" not in captured["body"]