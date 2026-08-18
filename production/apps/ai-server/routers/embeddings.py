"""Embeddings router — OpenAI-compatible."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from providers import get_provider

router = APIRouter()


class EmbeddingRequest(BaseModel):
    model: str
    input: str | list[str]
    provider: str | None = None


@router.post("/embeddings")
async def create_embeddings(req: EmbeddingRequest):
    body = req.model_dump(exclude_none=True)
    try:
        provider = get_provider(body.get("provider"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return await provider.embed(body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"upstream error: {e}")