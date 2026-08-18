"""Preflight diagnostics router — connectivity + latency checks.

The Node backend composes the targets it wants checked (backend health, AI
server health, Mongo/Redis TCP reachability, service ports) and posts them here.
Python performs the checks concurrently and returns a normalized report. Only
stdlib (`socket`) + httpx are used, so this router adds no new dependencies.

Failed checks carry an `errorCategory` (refused/timeout/dns/ssl/http/other) plus
a short human-readable `error` message so the admin console never has to surface
raw transport exceptions like httpx's "All connection attempts failed...".
"""
from __future__ import annotations

import asyncio
import socket
import ssl
import time
from typing import Any, Literal
from urllib.parse import urlparse

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


def _classify_error(e: Exception, host: str = "", port: int | None = None) -> tuple[str, str]:
    """Map an exception to a (category, friendly message) pair.

    httpx wraps low-level socket errors, so when the top-level exception is the
    generic "All connection attempts failed..." the underlying cause is unwrapped.
    """
    endpoint = f"{host}:{port}" if host else "target"

    if isinstance(e, (httpx.ConnectTimeout, httpx.ConnectError, asyncio.TimeoutError, socket.timeout)):
        try:
            cause = e.__cause__
        except AttributeError:
            cause = None
        if isinstance(cause, socket.gaierror):
            return "dns", f"host not found: {host or 'unknown'}"
        if isinstance(cause, (ConnectionRefusedError, OSError)) and getattr(cause, "errno", None) == getattr(socket, "ECONNREFUSED", 111):
            return "refused", f"connection refused on {endpoint} — is the service running?"
        return "timeout", "timed out — the service may be filtering traffic or is down"

    if isinstance(e, socket.gaierror):
        return "dns", f"host not found: {host or 'unknown'}"
    if isinstance(e, (ConnectionRefusedError, OSError)) and getattr(e, "errno", None) == getattr(socket, "ECONNREFUSED", 111):
        return "refused", f"connection refused on {endpoint} — is the service running?"
    if isinstance(e, ssl.SSLError):
        return "ssl", "TLS handshake failed"
    return "other", str(e) or type(e).__name__


async def _check_http(target: Target, timeout: float) -> dict[str, Any]:
    url = target.url or ""
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=1.0, read=timeout, write=timeout, pool=timeout), follow_redirects=True) as client:
            resp = await client.get(url)
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        ok = resp.status_code < 400
        category: str | None = None
        error: str | None = None
        if not ok:
            category = "http"
            error = f"HTTP {resp.status_code}"
        return {
            "name": target.name,
            "kind": "http",
            "url": url,
            "ok": ok,
            "status": resp.status_code,
            "latencyMs": latency_ms,
            "errorCategory": category,
            "error": error,
        }
    except Exception as e:  # noqa: BLE001 - classify connectivity errors
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        category, message = _classify_error(e, urlparse(url).hostname or "", urlparse(url).port)
        return {
            "name": target.name,
            "kind": "http",
            "url": url,
            "ok": False,
            "status": None,
            "latencyMs": latency_ms,
            "errorCategory": category,
            "error": message,
        }


async def _check_tcp(target: Target, timeout: float) -> dict[str, Any]:
    host = target.host or ""
    port = target.port or 0
    start = time.perf_counter()
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, limit=256),
            timeout,
        )
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
        return {
            "name": target.name,
            "kind": "tcp",
            "host": host,
            "port": port,
            "ok": True,
            "latencyMs": latency_ms,
            "errorCategory": None,
            "error": None,
        }
    except Exception as e:  # noqa: BLE001 - classify connectivity errors
        latency_ms = round((time.perf_counter() - start) * 1000, 1)
        category, message = _classify_error(e, host, port)
        return {
            "name": target.name,
            "kind": "tcp",
            "host": host,
            "port": port,
            "ok": False,
            "latencyMs": latency_ms,
            "errorCategory": category,
            "error": message,
        }


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