"""Env + config linter router.

Node sends the raw `.env` / `.env.example` text (and the raw `nexus.runtime.json`
text) and Python computes a structured report. Python never echoes secret
*values* — only keys + issues. This keeps the lint logic in Python while Node
owns auth + file access.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

ALLOWED_LOG_LEVELS = {"silent", "fatal", "error", "warn", "info", "debug", "trace"}


class LintEnvRequest(BaseModel):
    envText: str = ""
    exampleText: str = ""


class LintConfigRequest(BaseModel):
    content: str = ""


# ---- env parsing helpers ----

def _parse_env(text: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Parse dotenv-ish text. Returns (exports, malformed_lines)."""
    exports: list[dict[str, Any]] = []
    malformed: list[str] = []
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            malformed.append(f"line {lineno}: no '=' found")
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        exports.append({"key": key, "value": value})
    return exports, malformed


_PLACEHOLDER_PATTERNS = [
    r"^(change|changeme|change-me|your|example|exampl|replace|dummy|sample)",
    r"^xxxx+$",
    r"^xxxx+",
]


def _is_placeholder(value: str) -> bool:
    if len(value.strip()) < 4:
        return True
    lowered = value.strip().lower()
    return any(re.search(p, lowered) for p in _PLACEHOLDER_PATTERNS)


# ---- env checks ----

def _check_env(exports: list[dict[str, Any]], malformed: list[str], example: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for e in exports:
        k = e["key"]
        count = seen.get(k, 0) + 1
        seen[k] = count
        if count > 1:
            checks.append({"key": k, "severity": "error", "kind": "duplicate", "message": "duplicate key"})
        if e["value"] == "":
            checks.append({"key": k, "severity": "warning", "kind": "empty", "message": "has an empty value"})
        elif _is_placeholder(e["value"]):
            checks.append({"key": k, "severity": "warning", "kind": "placeholder", "message": "value still looks like a placeholder"})
    for line in malformed:
        checks.append({"key": "(syntax)", "severity": "error", "kind": "malformed", "message": line})
    if example:
        ex = {f["key"] for f in example}
        env = {f["key"] for f in exports}
        for f in example:
            if f["key"] not in env:
                checks.append({"key": f["key"], "severity": "warning", "kind": "missing", "message": "declared in .env.example but missing here"})
        for e in exports:
            if e["key"] not in ex:
                checks.append({"key": e["key"], "severity": "info", "kind": "ghost", "message": "present here but not declared in .env.example"})
    return checks


# ---- config checks ----

def _config_checks(data: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    port = _get(data, "server.port")
    if port is not None and not (isinstance(port, (int, float)) and 1 <= int(port) <= 65535):
        checks.append({"key": "server.port", "severity": "error", "kind": "type", "message": "must be an integer port 1–65535"})
    body = _get(data, "server.bodyLimit")
    if body is not None and not isinstance(body, (int, float)):
        checks.append({"key": "server.bodyLimit", "severity": "warning", "kind": "type", "message": "must be a number (bytes)"})
    lvl = _get(data, "logging.level")
    if lvl is not None and lvl not in ALLOWED_LOG_LEVELS:
        checks.append({"key": "logging.level", "severity": "warning", "kind": "value", "message": f"unexpected level '{lvl}' (expected one of {sorted(ALLOWED_LOG_LEVELS)})"})
    uri = _get(data, "db.uri")
    if uri is not None and not (isinstance(uri, str) and uri.startswith(("mongodb://", "mongodb+srv://"))):
        checks.append({"key": "db.uri", "severity": "error", "kind": "url", "message": "must be a mongodb:// or mongodb+srv:// URL"})
    auto = _get(data, "db.autoIndex")
    if auto is not None and not isinstance(auto, bool):
        checks.append({"key": "db.autoIndex", "severity": "warning", "kind": "type", "message": "must be a boolean"})
    jwt = _get(data, "auth.jwt.secret")
    if jwt is not None and (isinstance(jwt, str) and (not jwt or jwt in ("change-me", "change-me-please") or len(jwt) < 16)):
        checks.append({"key": "auth.jwt.secret", "severity": "error", "kind": "weak", "message": "JWT secret is missing or still the default — set a strong random value"})
    intro = _get(data, "graphql.introspection")
    if intro is not None and not isinstance(intro, bool):
        checks.append({"key": "graphql.introspection", "severity": "warning", "kind": "type", "message": "must be a boolean"})
    return checks


def _get(doc: dict[str, Any], path: str) -> Any:
    node: Any = doc
    for part in path.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return None
    return node


# ---- report ----

def _report(checks: list[dict[str, Any]]) -> dict[str, Any]:
    summary = {"error": 0, "warning": 0, "info": 0, "ok": 0}
    for c in checks:
        sev = c["severity"] if c["severity"] in summary else "info"
        summary[sev] += 1
    if not checks:
        summary["ok"] = 1
    order = {"error": 0, "warning": 1, "info": 2, "ok": 9}
    checks.sort(key=lambda c: (order.get(c["severity"], 9), c["key"]))
    return {"ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "summary": summary, "checks": checks}


# ---- routes ----

@router.post("/lint/env")
async def lint_env(req: LintEnvRequest):
    exports, malformed = _parse_env(req.envText)
    example = None
    if req.exampleText:
        example, ex_malformed = _parse_env(req.exampleText)
        malformed = malformed + ex_malformed
    checks = _check_env(exports, malformed, example)
    return _report(checks)


@router.post("/lint/config")
async def lint_config(req: LintConfigRequest):
    try:
        doc = json.loads(req.content)
    except json.JSONDecodeError as e:
        return {
            "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "summary": {"error": 1, "warning": 0, "info": 0, "ok": 0},
            "checks": [
                {"key": "(syntax)", "severity": "error", "kind": "malformed",
                 "message": f"not valid JSON: {e} at line {e.lineno} col {e.colno}"}
            ],
        }
    if not isinstance(doc, dict):
        return {
            "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "summary": {"error": 1, "warning": 0, "info": 0, "ok": 0},
            "checks": [{"key": "(root)", "severity": "error", "kind": "type", "message": "config root must be a JSON object"}],
        }
    return _report(_config_checks(doc))