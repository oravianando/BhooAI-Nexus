"""Generated Nexus Python AI server (OpenAI + Ollama).

A minimal FastAPI app exposing an OpenAI-compatible /chat/completions (SSE)
backed by OpenAI or a local Ollama instance. The framework's own
apps/ai-server has the full implementation (embeddings, /models, retries).
"""
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI(title="Nexus AI Server")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "nexus-ai-server"}


@app.post("/chat/completions")
def chat_completions(payload: dict) -> dict:
    # Placeholder: echo the last message. Replace with an OpenAI/Ollama call.
    messages = payload.get("messages", [])
    last = messages[-1]["content"] if messages else ""
    return {
        "id": "chatcmpl-nexus",
        "object": "chat.completion",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": last}, "finish_reason": "stop"}],
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)