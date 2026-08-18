"""BhooAI Nexus AI server (FastAPI).

OpenAI-compatible gateway fronting OpenAI and Ollama. The Node backend proxies
requests here (and re-emits SSE); the browser never calls this server directly.

Run:  uvicorn main:app --reload --port 8000  (from apps/ai-server)
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from providers import available_providers
from routers import chat, embeddings, models

app = FastAPI(title="BhooAI Nexus AI", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "providers": available_providers()}


app.include_router(chat.router)
app.include_router(embeddings.router)
app.include_router(models.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=settings.server_port, reload=False)