# @bhooai/nexus-auth

One cohesive security + identity unit: CORS, CSRF, security headers, rate
limiting, password hashing, JWT auth, sessions, RBAC, and Google + Facebook OAuth2.

## Exports

- **CORS** — `cors({ origin, credentials })` with preflight short-circuit and `Vary: Origin`.
- **CSRF** — `csrf({ trustedOrigins })` double-submit token (HttpOnly `nexus_csrf`
  cookie + `x-csrf-token` header); `issueCsrfToken(ctx, { trustedOrigins })`. Safe
  methods issue a fresh token; unsafe methods run `checkOrigin` + double-submit.
  Applies to **all** unsafe methods (incl. `POST /graphql` and `/payments`) and to
  the **WS upgrade**.
- **headers** — `securityHeaders()` (helmet-equivalent).
- **rateLimit** — `rateLimit({ windowMs, max })` (in-memory; Redis backend in `nexus-cache`).
- **jwt / session / password** — `AuthService`, `MemorySessionStore`,
  `hashPassword`/`verifyPassword`, access + refresh token rotation.
- **rbac** — role checks.
- **oauth** — `buildGoogleAuthUrl` (with PKCE), `exchangeGoogleCode`,
  `fetchGoogleProfile`, and the Facebook equivalents.
- **middleware** — `authToken(service, { cookieName, allowCookie, required })`,
  `requireAuth()`, `setAuthCookies`, `clearAuthCookies`.

> `authToken`'s first argument is the `AuthService` instance; options are the 2nd.

## CSRF note

With a non-empty `trustedOrigins`, every unsafe request **must** carry an `Origin`
header that exactly matches a trusted origin (including the port) **and** a
matching `x-csrf-token`. API clients that don't send `Origin` (e.g. Playwright's
`APIRequestContext`) must add it explicitly — see the e2e/integration tests.