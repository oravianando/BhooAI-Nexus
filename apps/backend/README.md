# @bhooai/app-backend

The reference Nexus backend app — the canonical example of wiring the
`@bhooai/nexus-*` packages together.

Boots the custom HTTP server with the security stack (security headers → CORS →
body parsing → CSRF → rate limiting), connects MongoDB, registers the User model +
`/auth/*` routes, mounts GraphQL (`/graphql` + `/graphql/ws`), realtime (`/ws`),
AI proxy (`/ai/*`), payments (`/payments/*` + webhook), cert generation
(`/certs/self-signed`), admin routes, and the plugin loader.

See `src/main.ts` for the full bootstrap. Tests (`tests/*.integration.test.ts`)
run against real MongoDB + a live server with CSRF enforced (they set
`trustedOrigins` and send `Origin` explicitly).

## Run

```bash
npx tsx src/main.ts   # from this dir; paths resolve to the package root
# or: npm run dev     # from the package root
```
Set `NEXUS_DB_URI` (MongoDB) and `NEXUS_AUTH_JWT_SECRET` in the project-root `.env`.
