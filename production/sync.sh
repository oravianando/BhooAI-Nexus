#!/usr/bin/env bash
# BhooAI Nexus - sync the framework source into production/.
# Idempotent: safe to re-run after framework changes.
# Usage:  ./sync.sh   (run from the repo root)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

copy_file() {
  local rel="$1"
  if [ ! -e "$ROOT/$rel" ]; then echo "  [warn] missing: $rel"; return; fi
  mkdir -p "$PROD/$(dirname "$rel")"
  cp -f "$ROOT/$rel" "$PROD/$rel"
  echo "  copied $rel"
}

copy_tree() {
  local rel="$1"
  if [ ! -e "$ROOT/$rel" ]; then echo "  [warn] missing: $rel"; return; fi
  mkdir -p "$PROD/$rel"
  cp -rf "$ROOT/$rel/." "$PROD/$rel/"
  echo "  copied $rel"
}

echo "Syncing BhooAI Nexus -> production/"

# Root workspace + configs
copy_file package.json
copy_file package-lock.json
copy_file tsconfig.json
copy_file tsconfig.base.json
copy_file nexus.config.ts

# CLI entry + serve-all runner
copy_file bin/nexus.js
cp -f "$ROOT/packages/nexus-cli/templates/bin/serve-all.mjs" "$PROD/bin/serve-all.mjs"
echo "  staged bin/serve-all.mjs"

# Framework packages
for pkg in "$ROOT"/packages/*/; do
  name="$(basename "$pkg")"
  base="packages/$name"
  copy_file "$base/package.json"
  for sub in src templates; do
    [ -d "$ROOT/$base/$sub" ] && copy_tree "$base/$sub"
  done
  [ -f "$ROOT/$base/tsconfig.json" ] && copy_file "$base/tsconfig.json"
done

# Apps - backend
copy_file apps/backend/package.json
copy_file apps/backend/tsconfig.json
copy_tree apps/backend/src

# Apps - frontend + admin
for app in frontend admin; do
  copy_file "apps/$app/package.json"
  copy_file "apps/$app/tsconfig.json"
  copy_file "apps/$app/vite.config.ts"
  copy_file "apps/$app/tailwind.config.js"
  copy_file "apps/$app/postcss.config.js"
  copy_file "apps/$app/index.html"
  copy_tree "apps/$app/src"
  [ -d "$ROOT/apps/$app/public" ] && copy_tree "apps/$app/public"
done

# Apps - python AI server
copy_file apps/ai-server/requirements.txt
copy_file apps/ai-server/settings.py
copy_file apps/ai-server/main.py
copy_tree apps/ai-server/providers
copy_tree apps/ai-server/routers

# Shared contract
copy_tree contracts

# Runtime dirs
for d in uploads plugins logs certs; do
  mkdir -p "$PROD/$d"
done

# Clean dev artifacts
find "$PROD" -type d \( -name dist -o -name node_modules -o -name .venv -o -name __pycache__ -o -name .pytest_cache \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$PROD" -name '*.tsbuildinfo' -delete 2>/dev/null || true
find "$PROD" -name '*.log' -delete 2>/dev/null || true

echo "Sync complete."
