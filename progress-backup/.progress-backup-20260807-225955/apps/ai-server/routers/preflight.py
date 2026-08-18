"""Preflight diagnostics router — connectivity + latency checks.

The Node backend composes the targets it wants checked (backend health, AI
server health, Mongo/Redis TCP reachability, service ports) and posts them here.
Python performs the checks concurrently and returns a normalized report. Only
stdlib (`socket`) + httpx are used, so this router adds no new dependencies.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class Target(BaseModel):
    name: str
    kind: Literal["http", "tcp"] = "tcp"
    url: str | None = None
    host: str | None = None
    port: int | None = None
    timeout: float | None = None


class PreflightRequest(BaseModel):
    targets: list[Target] = []
    timeout: float = 2.0


async def _check_http(target: Target, timeout: float) -> dict[str, Any]:
    url = target.url or ""
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(url)
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        return {
            "name": target.name,
            "kind": "http",
            "url": url,
            "ok": resp.status_code < 400,
            "status": resp.status_code,
            "latencyMs": latency_ms,
            "error": None if resp.status_code < 400 else f"HTTP {resp.status_code}",
        }
    except Exception as e:  # noqa: BLE001 - surface any connectivity error
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        return {"name": target.name, "kind": "http", "url": url, "ok": False, "status": None, "latencyMs": latency_ms, "error": str(e)}


async def _check_tcp(target: Target, timeout: float) -> dict[str, Any]:
    host = target.host or ""
    port = target.port or 0
    start = time.perf_counter()
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout,
        )
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
        return {"name": target.name, "kind": "tcp", "host": host, "port": port, "ok": True, "latencyMs": latency_ms, "error": None}
    except Exception as e:  # noqa: BLE001
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        return {"name": target.name, "kind": "tcp", "host": host, "port": port, "ok": False, "latencyMs": latency_ms, "error": str(e)}


@router.post("/preflight")
async def preflight(req: PreflightRequest):
    if not req.targets:
        raise HTTPException(status_code=400, detail="at least one target is required")
    started = time.perf_counter()
    results = await asyncio.gather(*(_check_http(t, t.timeout or req.timeout) if t.kind == "http" else _check_tcp(t, t.timeout or req.timeout) for t in req.targets))
    duration_ms = round((time.perf_counter() - started) * 1000, 1)

    failed = [c for c in results if not c["ok"]]
    passed = [c for c in results if c["ok"]]
    # failed then warnings (slow) then the rest, preserving stable order within groups.
    slow = [c for c in passed if isinstance(c.get("latencyMs"), (int, float)) and c["latencyMs"] > 800]
    ok = [c for c in passed if c not in slow]

    return {
        "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "durationMs": duration_ms,
        "passed": len(passed),
        "warnings": len(slow),
        "failed": len(failed),
        "checks": failed + slow + ok,
    }