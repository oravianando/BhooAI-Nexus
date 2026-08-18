"""Chat completions router — OpenAI-compatible, supports SSE streaming."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from providers import get_provider

router = APIRouter()


class Message(BaseModel):
    role: str
    content: str
    name: str | None = None


class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[Message]
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = None
    provider: str | None = None


@router.post("/chat/completions")
async def chat_completions(req: ChatCompletionRequest):
    body = req.model_dump(exclude_none=True)
    try:
        provider = get_provider(body.get("provider"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if body.get("stream"):
        async def gen():
            async for chunk in provider.chat_stream(body):
                yield chunk
        return StreamingResponse(gen(), media_type="text/event-stream")

    try:
        return await provider.chat(body)
    except HTTPException:
        raise
    except Exception as e:  # upstream error
        raise HTTPException(status_code=502, detail=f"upstream error: {e}")