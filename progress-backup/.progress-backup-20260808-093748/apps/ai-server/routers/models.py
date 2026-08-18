"""Models router — lists available upstream models."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.params import Query

from providers import get_provider

router = APIRouter()


@router.get("/models")
async def list_models(provider: str | None = Query(default=None)):
    try:
        p = get_provider(provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return await p.list_models()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"upstream error: {e}")