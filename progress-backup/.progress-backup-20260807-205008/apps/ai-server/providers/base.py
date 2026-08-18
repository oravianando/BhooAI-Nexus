"""Provider abstraction. Both OpenAI and Ollama expose OpenAI-compatible
endpoints, so a single OpenAICompatibleProvider parameterised by base URL +
auth handles both. Streaming uses SSE (upstream → parsed → re-emitted with the
provider field injected)."""
from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from config import Settings, settings, resolve_provider


class Provider:
    name = "base"

    def __init__(self, base_url: str, api_key: str, timeout: float, transport: Any | None = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.transport = transport

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _clean(self, body: dict[str, Any]) -> dict[str, Any]:
        # Strip our routing field before forwarding upstream.
        return {k: v for k, v in body.items() if k != "provider"}

    async def chat(self, body: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", json=self._clean(body), headers=self._headers())
            resp.raise_for_status()
            data = resp.json()
            data["provider"] = self.name
            return data

    async def chat_stream(self, body: dict[str, Any]) -> AsyncIterator[str]:
        """Yield SSE-formatted `data: ...` lines (already ending in \\n\\n)."""
        payload = self._clean(body)
        payload["stream"] = True
        async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
            async with client.stream("POST", f"{self.base_url}/chat/completions", json=payload, headers=self._headers()) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        yield "data: [DONE]\n\n"
                        return
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    chunk["provider"] = self.name
                    yield f"data: {json.dumps(chunk)}\n\n"
        # If the upstream didn't send [DONE], close the stream cleanly.
        yield "data: [DONE]\n\n"

    async def embed(self, body: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
            resp = await client.post(f"{self.base_url}/embeddings", json=self._clean(body), headers=self._headers())
            resp.raise_for_status()
            data = resp.json()
            data["provider"] = self.name
            return data

    async def list_models(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout, transport=self.transport) as client:
            resp = await client.get(f"{self.base_url}/models", headers=self._headers())
            resp.raise_for_status()
            data = resp.json()
            data["provider"] = self.name
            return data


class OpenAIProvider(Provider):
    name = "openai"

    @classmethod
    def from_settings(cls, s: Settings) -> "OpenAIProvider":
        return cls(s.openai_base_url, s.openai_api_key, s.request_timeout_s)


class OllamaProvider(Provider):
    name = "ollama"

    @classmethod
    def from_settings(cls, s: Settings) -> "OllamaProvider":
        return cls(s.ollama_base_url, s.ollama_api_key, s.request_timeout_s)


def get_provider(requested: str | None) -> Provider:
    """Resolve and instantiate the provider for a request."""
    name = resolve_provider(requested)
    if name == "openai":
        return OpenAIProvider.from_settings(settings)
    return OllamaProvider.from_settings(settings)


def available_providers() -> list[str]:
    avail = []
    if settings.openai_api_key:
        avail.append("openai")
    avail.append("ollama")
    return avail