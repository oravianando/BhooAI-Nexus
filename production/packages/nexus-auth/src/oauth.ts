import { createHash, randomBytes } from 'node:crypto';

/** Normalized profile returned by every provider. */
export interface OAuthProfile {
  provider: 'google' | 'facebook';
  /** Stable per-provider user id (the provider's own subject id). */
  providerUserId: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  avatarUrl?: string;
  raw: Record<string, unknown>;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Redirect URI registered in the Google console. */
  redirectUri: string;
  /** OAuth scopes (default: openid email profile). */
  scope?: string[];
}

export interface FacebookOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope?: string[];
  /** Graph API version. */
  apiVersion?: string;
}

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_PROFILE = 'https://openidconnect.googleapis.com/v1/userinfo';

// ── PKCE / state helpers ─────────────────────────────────────────────────────

/** Random URL-safe string for the OAuth `state` param (CSRF for the redirect). */
export function generateState(): string {
  return randomBytes(24).toString('base64url');
}

/** Generate a PKCE code_verifier (43-128 chars, unreserved chars). */
export function generatePkceVerifier(): string {
  return randomBytes(48).toString('base64url');
}

/** S256 code_challenge for a verifier. */
export function computePkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Short-lived store mapping `state` → flow context (verifier, redirect target).
 * The default in-memory impl is fine for a single process; a Redis-backed impl
 * is wired in Phase 7 for multi-instance deployments.
 */
export interface OAuthStateStore {
  set(state: string, data: Record<string, unknown>, ttlMs: number): Promise<void>;
  consume(state: string): Promise<Record<string, unknown> | null>;
}

export class MemoryOAuthStateStore implements OAuthStateStore {
  private map = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
  async set(state: string, data: Record<string, unknown>, ttlMs: number): Promise<void> {
    this.map.set(state, { data, expiresAt: Date.now() + ttlMs });
  }
  async consume(state: string): Promise<Record<string, unknown> | null> {
    const entry = this.map.get(state);
    if (!entry) return null;
    this.map.delete(state);
    if (entry.expiresAt < Date.now()) return null;
    return entry.data;
  }
}

// ── Google ───────────────────────────────────────────────────────────────────

export function buildGoogleAuthUrl(
  config: GoogleOAuthConfig,
  opts: { state: string; verifier: string },
): string {
  const scope = (config.scope ?? ['openid', 'email', 'profile']).join(' ');
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope,
    state: opts.state,
    code_challenge: computePkceChallenge(opts.verifier),
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${GOOGLE_AUTH}?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string,
  config: GoogleOAuthConfig,
  verifier: string,
): Promise<{ accessToken: string; refreshToken?: string; idToken?: string; expiresAt: number }> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as Record<string, unknown>;
  const expiresIn = Number(json.expires_in ?? 3600);
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    idToken: json.id_token ? String(json.id_token) : undefined,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch(GOOGLE_PROFILE, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google profile fetch failed: ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;
  return {
    provider: 'google',
    providerUserId: String(raw.sub),
    email: raw.email ? String(raw.email) : undefined,
    emailVerified: raw.email_verified === true || raw.email_verified === 'true',
    name: raw.name ? String(raw.name) : undefined,
    givenName: raw.given_name ? String(raw.given_name) : undefined,
    familyName: raw.family_name ? String(raw.family_name) : undefined,
    avatarUrl: raw.picture ? String(raw.picture) : undefined,
    raw,
  };
}

// ── Facebook ─────────────────────────────────────────────────────────────────

export function buildFacebookAuthUrl(config: FacebookOAuthConfig, state: string): string {
  const version = config.apiVersion ?? 'v19.0';
  const scope = (config.scope ?? ['email']).join(',');
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope,
    state,
  });
  return `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`;
}

export async function exchangeFacebookCode(
  code: string,
  config: FacebookOAuthConfig,
): Promise<{ accessToken: string; expiresAt: number }> {
  const version = config.apiVersion ?? 'v19.0';
  const params = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
  const res = await fetch(`https://graph.facebook.com/${version}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Facebook token exchange failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as Record<string, unknown>;
  const expiresIn = Number(json.expires_in ?? 3600);
  return { accessToken: String(json.access_token), expiresAt: Date.now() + expiresIn * 1000 };
}

export async function fetchFacebookProfile(accessToken: string, apiVersion = 'v19.0'): Promise<OAuthProfile> {
  const fields = 'id,name,email,first_name,last_name,picture';
  const res = await fetch(`https://graph.facebook.com/${apiVersion}/me?fields=${fields}&access_token=${accessToken}`);
  if (!res.ok) throw new Error(`Facebook profile fetch failed: ${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;
  return {
    provider: 'facebook',
    providerUserId: String(raw.id),
    email: raw.email ? String(raw.email) : undefined,
    emailVerified: !!raw.email, // Facebook marks email-verified accounts; treat presence as verified.
    name: raw.name ? String(raw.name) : undefined,
    givenName: raw.first_name ? String(raw.first_name) : undefined,
    familyName: raw.last_name ? String(raw.last_name) : undefined,
    avatarUrl:
      raw.picture && typeof raw.picture === 'object'
         ? String((raw.picture as { data?: { url?: string } }).data?.url ?? '')
        : undefined,
    raw,
  };
}
