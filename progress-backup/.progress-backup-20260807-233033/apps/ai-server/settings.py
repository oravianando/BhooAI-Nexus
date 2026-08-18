"""Configuration for the AI server (env-driven)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(key: str, default: str) -> str:
    return os.environ.get(key, default)


@dataclass
class Settings:
    # OpenAI-compatible upstreams. Both OpenAI and Ollama speak the same shape;
    # only the base URL + auth header differ.
    openai_base_url: str = field(default_factory=lambda: _env("AI_OPENAI_BASE_URL", "https://api.openai.com/v1"))
    # Fall back to the generic OPENAI_API_KEY / OLLAMA_HOST names so the root
    # .env.example keys work with the AI server as well as the AI_* names.
    openai_api_key: str = field(
        default_factory=lambda: _env("AI_OPENAI_API_KEY", _env("OPENAI_API_KEY", ""))
    )
    ollama_base_url: str = field(
        default_factory=lambda: _env(
            "AI_OLLAMA_BASE_URL",
            (_env("OLLAMA_HOST", "http://localhost:11434") + "/v1"),
        )
    )
    ollama_api_key: str = field(default_factory=lambda: _env("AI_OLLAMA_API_KEY", ""))

    default_provider: str = field(default_factory=lambda: _env("AI_DEFAULT_PROVIDER", "auto"))
    request_timeout_s: float = field(default_factory=lambda: float(_env("AI_TIMEOUT_S", "120")))
    server_port: int = field(default_factory=lambda: int(_env("AI_PORT", "8000")))

    # CORS: the Node backend proxies, but allow dev tools + the admin to call directly.
    cors_origins: list[str] = field(default_factory=lambda: _env("AI_CORS_ORIGINS", "*").split(","))


settings = Settings()


def resolve_provider(requested: str | None) -> str:
    """Resolve 'auto' to a concrete provider. auto → openai if a key is set, else ollama."""
    provider = (requested or settings.default_provider or "auto").lower()
    if provider == "auto":
        provider = "openai" if settings.openai_api_key else "ollama"
    if provider not in ("openai", "ollama"):
        raise ValueError(f"unknown provider: {provider}")
    return provider