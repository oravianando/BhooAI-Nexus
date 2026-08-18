import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export interface TokenPayload extends JWTPayload {
  /** Subject (user id). */
  sub: string;
  /** Roles attached to the subject. */
  roles?: string[];
  /** Token kind discriminator. */
  kind?: 'access' | 'refresh';
  /** For refresh tokens: the session id they belong to. */
  sid?: string;
}

export interface JwtOptions {
  /** Signing secret (string or raw bytes). Required. */
  secret: string | Uint8Array;
  /** Algorithm. Defaults to HS256. */
  algorithm?: 'HS256' | 'HS384' | 'HS512';
  /** Issuer. */
  issuer?: string;
  /** Audience. */
  audience?: string;
  /** Access-token TTL in seconds (default 15m). */
  accessTtl?: number;
  /** Refresh-token TTL in seconds (default 7d). */
  refreshTtl?: number;
}

const enc = (secret: string | Uint8Array): Uint8Array =>
  typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;

/** Sign an access token for a subject with roles (optionally bound to a session id). */
export async function signAccessToken(subject: string, roles: string[], opts: JwtOptions, sid?: string): Promise<string> {
  const ttl = opts.accessTtl ?? 60 * 15;
  const builder = new SignJWT({ kind: 'access', roles, sid })
    .setProtectedHeader({ alg: opts.algorithm ?? 'HS256' })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`);
  if (opts.issuer) builder.setIssuer(opts.issuer);
  if (opts.audience) builder.setAudience(opts.audience);
  return builder.sign(enc(opts.secret));
}

/** Sign a refresh token bound to a session id. */
export async function signRefreshToken(subject: string, sid: string, roles: string[], opts: JwtOptions): Promise<string> {
  const ttl = opts.refreshTtl ?? 60 * 60 * 24 * 7;
  const builder = new SignJWT({ kind: 'refresh', roles, sid })
    .setProtectedHeader({ alg: opts.algorithm ?? 'HS256' })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`);
  if (opts.issuer) builder.setIssuer(opts.issuer);
  if (opts.audience) builder.setAudience(opts.audience);
  return builder.sign(enc(opts.secret));
}

/** Verify a token and return its payload; throws on invalid/expired tokens. */
export async function verifyToken(token: string, opts: JwtOptions): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, enc(opts.secret), {
    issuer: opts.issuer,
    audience: opts.audience,
  });
  return payload as TokenPayload;
}