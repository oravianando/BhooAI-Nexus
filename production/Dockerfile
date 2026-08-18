# BhooAI Nexus image - backend + built frontend + built admin in one container.
#
# Build (from production/):
#   docker build -t bhooai-nexus .
# Run (pass project secrets; real env vars always win over .env):
#   docker run --rm -p 4000:4000 -p 3000:3000 -p 3001:3001 --env-file .env bhooai-nexus
#
# Access:
#   frontend  http://localhost:3000   (SPA; /health /graphql /auth /ai /ws proxied to the backend)
#   admin     http://localhost:3001   (SPA; /admin /auth proxied to the backend)
#   backend   http://localhost:4000   (API + /health)
#
# The Python AI server, MongoDB, and Redis remain separate services and must
# already be reachable (see docker-compose.yml / nexus.config.*).

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base

WORKDIR /app

# npm workspaces: install deps for packages/*, apps/backend, admin, apps/frontend.
# The dev deps (vite, typescript, tsx) are needed both to build the SPAs and at runtime.
COPY package.json package-lock.json* ./
COPY packages packages
COPY apps apps
RUN npm install --no-audit --no-fund

# Build the frontend + admin SPA bundles (static dist/ folders).
RUN npm --prefix apps/frontend run build \
 && npm --prefix apps/admin run build

# Full source tree (config, bin, uploads dir, tsconfig).
COPY . .

# The uploads dir is written at runtime (uploads / certs).
RUN mkdir -p uploads && chown -R node:node /app

# Default ports are informational; the real values come from nexus.config.* /
# NEXUS_* env overrides at runtime.
EXPOSE 3000 3001 4000 7575

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${NEXUS_SERVER_PORT:-4000}/health >/dev/null || exit 1

USER node

# Runs the stack: backend role service via `nexus node serve --role=backend`,
# plus frontend (:3000) and admin (:3001) previews.
CMD ["node", "bin/serve-all.mjs"]
