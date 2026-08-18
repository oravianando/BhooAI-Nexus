import { randomBytes } from 'node:crypto';
import type { Middleware, RequestContext } from '../../nexus-core/src/http/index.js';
import { AuthenticationError } from '../../nexus-core/src/index.js';

export interface CsrfOptions {
  /** Cookie name holding the double-submit token. */
  cookieName?: string;
  /** Header / body field name carrying the token on unsafe requests. */
  tokenName?: string;
  /** Trusted origin hosts (for the origin/referer check). If omitted, origin check is skipped. */
  trustedOrigins?: string[];
  /** Methods exempt from CSRF (safe methods). */
  safeMethods?: string[];
  /** Cookie attributes. */
  cookie?: { path?: string; secure?: boolean; sameSite?: 'strict' | 'lax' | 'none'; domain?: string };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/**
 * Inbuilt CSRF protection using the double-submit cookie pattern plus an
 * origin/referer check on unsafe requests. Safe methods are exempt.
 *
 * On a safe request, a token cookie is set (rotated each request) and exposed
 * via `ctx.state.csrfToken` so handlers can return it to clients. On unsafe
 * requests, the header token must equal the cookie token.
 */
export function csrf(options: CsrfOptions = {}): Middleware {
  const cookieName = options.cookieName ?? 'nexus_csrf';
  const tokenName = options.tokenName ?? 'x-csrf-token';
  const trusted = options.trustedOrigins ?? [];
  const safeMethods = new Set(options.safeMethods ?? [...SAFE]);
  const cookieOpts = options.cookie ?? { path: '/', sameSite: 'lax', secure: false };

  return async (ctx, next) => {
    if (safeMethods.has(ctx.method)) {
      // Reuse an existing cookie token so concurrent safe requests (e.g. the
      // 5-second cluster overview poll) don't rotate the token out from under
      // a pending unsafe request — that race produced "Unauthorized" on POSTs.
      const existing = readCookie(ctx, cookieName);
      if (existing) {
        ctx.state.csrfToken = existing;
      } else {
        ctx.state.csrfToken = issueToken(ctx, cookieName, cookieOpts);
      }
      await next();
      return;
    }

    // Unsafe method: validate origin/referer first.
    checkOrigin(ctx, trusted);

    // Then double-submit: header token must match cookie token.
    const cookieToken = readCookie(ctx, cookieName);
    const sentToken =
      (ctx.headers[tokenName] as string) ??
      (ctx.body && typeof ctx.body === 'object' ? (ctx.body as Record<string, unknown>)[tokenName] as string : undefined);

    if (!cookieToken || !sentToken || !timingSafeEqual(cookieToken, sentToken)) {
      throw new AuthenticationError('Invalid CSRF token');
    }
    await next();
  };
}

/** Helper for handlers/endpoints to mint a token (e.g. a /csrf-token route). */
export function issueCsrfToken(ctx: RequestContext, options: CsrfOptions = {}): string {
  return issueToken(ctx, options.cookieName ?? 'nexus_csrf', options.cookie ?? { path: '/', sameSite: 'lax', secure: false });
}

/** CSRF + origin check for the WebSocket upgrade request (no CORS preflight). */
export function checkWsUpgrade(headers: Record<string, string | string[] | undefined>, options: CsrfOptions = {}): void {
  const trusted = options.trustedOrigins ?? [];
  if (trusted.length) {
    const origin = (headers['origin'] as string) ?? '';
    if (!origin || !isTrustedOrigin(origin, trusted)) {
      throw new AuthenticationError('Untrusted WebSocket origin');
    }
  }
  const cookieToken = readCookieFromHeader((headers['cookie'] as string) ?? '', options.cookieName ?? 'nexus_csrf');
  const queryToken = (headers['sec-websocket-protocol'] as string)?.split(',').map((s) => s.trim())[0];
  if (!cookieToken || !queryToken || !timingSafeEqual(cookieToken, queryToken)) {
    throw new AuthenticationError('Invalid WebSocket CSRF token');
  }
}

function issueToken(
  ctx: RequestContext,
  cookieName: string,
  opts: NonNullable<CsrfOptions['cookie']>,
): string {
  const token = randomBytes(24).toString('base64url');
  const parts = [
    `${cookieName}=${token}`,
    `Path=${opts.path ?? '/'}`,
    `SameSite=${opts.sameSite ?? 'lax'}`,
    opts.secure ? 'Secure' : '',
    opts.domain ? `Domain=${opts.domain}` : '',
    'HttpOnly',
  ].filter(Boolean);
  ctx.setHeader('set-cookie', parts.join('; '));
  return token;
}

function readCookie(ctx: RequestContext, name: string): string | undefined {
  return readCookieFromHeader((ctx.headers['cookie'] as string) ?? '', name);
}

function readCookieFromHeader(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    const k = part.slice(0, eq).trim();
    if (k === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function checkOrigin(ctx: RequestContext, trusted: string[]): void {
  if (trusted.length === 0) return;
  const origin = (ctx.headers['origin'] as string) ?? (ctx.headers['referer'] as string) ?? '';
  if (!origin || !isTrustedOrigin(origin, trusted)) {
    throw new AuthenticationError('Untrusted request origin');
  }
}

function isTrustedOrigin(origin: string, trusted: string[]): boolean {
  let hostname: string;
  let host: string;
  try {
    const u = new URL(origin);
    hostname = u.hostname;
    host = u.host;
  } catch {
    return false;
  }
  // Loopback origins (localhost/127.0.0.1) are safe from cross-site forgery
  // regardless of port — Docker / port-forwarding commonly remaps host ports
  // (e.g. container :3001 published on the host as :3011), so a strict
  // host:port match would wrongly reject the admin/frontend dev servers.
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return trusted.some((t) => {
      try {
        const tu = new URL(t);
        return tu.hostname === 'localhost' || tu.hostname === '127.0.0.1' || tu.hostname === '::1';
      } catch {
        return false;
      }
    });
  }
  return trusted.some((t) => t === host || t === origin || origin.startsWith(t));
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return ab.equals(bb);
}
