import type { Middleware, RequestContext } from '../../nexus-core/src/http/index.js';
import { AuthenticationError } from '../../nexus-core/src/index.js';
import type { AuthService } from './auth.js';
import type { TokenPair } from './auth.js';

export interface AuthCookieOptions {
  /** Cookie names. */
  accessTokenName?: string;
  refreshTokenName?: string;
  /** Cookie attributes. */
  path?: string;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  domain?: string;
}

const DEFAULT_COOKIE: Required<AuthCookieOptions> = {
  accessTokenName: 'nexus_at',
  refreshTokenName: 'nexus_rt',
  path: '/',
  secure: false,
  sameSite: 'lax',
  domain: '',
};

/** Read a cookie value from the request's cookie header. */
export function readCookieValue(ctx: RequestContext, name: string): string | undefined {
  const header = (ctx.headers['cookie'] as string) ?? '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Set access + refresh tokens as httpOnly cookies (for cookie-based sessions). */
export function setAuthCookies(ctx: RequestContext, pair: TokenPair, opts: AuthCookieOptions = {}): void {
  const o = { ...DEFAULT_COOKIE, ...opts };
  const base = [`Path=${o.path}`, `SameSite=${o.sameSite}`, o.secure ? 'Secure' : '', o.domain ? `Domain=${o.domain}` : '', 'HttpOnly'].filter(Boolean).join('; ');
  ctx.setHeader('set-cookie', [`${o.accessTokenName}=${pair.accessToken}; ${base}`, `${o.refreshTokenName}=${pair.refreshToken}; ${base}; Max-Age=${Math.floor((pair.refreshExpiresAt - Date.now()) / 1000)}`]);
}

/** Clear the auth cookies (logout). */
export function clearAuthCookies(ctx: RequestContext, opts: AuthCookieOptions = {}): void {
  const o = { ...DEFAULT_COOKIE, ...opts };
  const expired = `Path=${o.path}; Max-Age=0`;
  ctx.setHeader('set-cookie', [`${o.accessTokenName}=; ${expired}`, `${o.refreshTokenName}=; ${expired}`]);
}

export interface AuthTokenOptions {
  /** Cookie name for the access token (cookie-mode). Defaults to `nexus_at`. */
  cookieName?: string;
  /** If false, only the Authorization header is accepted (no cookie). */
  allowCookie?: boolean;
  /** If true, missing/invalid tokens throw 401; if false, the middleware is optional (no user set). */
  required?: boolean;
}

/**
 * Authenticate the request by verifying a bearer access token from the
 * `Authorization` header or (optionally) an httpOnly cookie. On success,
 * `ctx.state.user = { id, roles }` is set for downstream `requireAuth` /
 * `requireRole` / `requirePermission` middleware.
 */
export function authToken(service: AuthService, options: AuthTokenOptions = {}): Middleware {
  const cookieName = options.cookieName ?? 'nexus_at';
  const allowCookie = options.allowCookie ?? true;
  const required = options.required ?? true;

  return async (ctx, next) => {
    const header = (ctx.headers['authorization'] as string) ?? '';
    let token: string | undefined;
    if (header.toLowerCase().startsWith('bearer ')) {
      token = header.slice(7).trim();
    } else if (allowCookie) {
      token = readCookieValue(ctx, cookieName);
    }

    if (!token) {
      if (required) throw new AuthenticationError();
      await next();
      return;
    }

    try {
      const payload = await service.verifyAccessToken(token);
      ctx.state.user = { id: payload.sub, roles: payload.roles ?? [], ...(payload as Record<string, unknown>) };
    } catch (e) {
      if (required) throw e instanceof AuthenticationError ? e : new AuthenticationError('Invalid token');
      // optional mode: leave ctx.state.user unset
    }
    await next();
  };
}
