import { randomBytes } from 'node:crypto';
import { signAccessToken, verifyToken, type JwtOptions, type TokenPayload } from './jwt.js';
import type { SessionStore, Session } from './session.js';
import { AuthenticationError } from '../../nexus-core/src/index.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  /** Refresh-token expiry (ms epoch). */
  refreshExpiresAt: number;
}

export interface LoginInput {
  userId: string;
  roles: string[];
  meta?: Record<string, unknown>;
}

/**
 * High-level auth orchestrator. The app verifies credentials (via
 * `verifyPassword` + its user store) and calls `login()` to mint a session and
 * token pair. Refresh tokens are rotated on every refresh and bound to a
 * session family, so reuse of a previously-rotated token revokes the whole
 * family (refresh-token theft detection).
 */
export class AuthService {
  constructor(
    private jwt: JwtOptions,
    private sessions: SessionStore,
  ) {}

  /** Create a session and return an access + refresh token pair. */
  async login(input: LoginInput): Promise<TokenPair> {
    const session = await this.sessions.create(input.userId, input.roles, input.meta);
    return this.mintPair(session);
  }

  /**
   * Verify a refresh token, rotate it (new jti), and return a fresh pair.
   * If the presented refresh token's jti no longer matches the session's
   * current jti, the token has been reused after rotation → revoke the family.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: TokenPayload;
    try {
      payload = await verifyToken(refreshToken, this.jwt);
    } catch {
      throw new AuthenticationError('Invalid refresh token');
    }
    if (payload.kind !== 'refresh' || !payload.sid) {
      throw new AuthenticationError('Not a refresh token');
    }
    const session = await this.sessions.get(payload.sid);
    if (!session) throw new AuthenticationError('Session expired');

    // Reuse detection: the jti on the session must match the presented token.
    if (session.currentJti && payload.jti && session.currentJti !== payload.jti) {
      await this.sessions.destroyFamily(session.familyId);
      throw new AuthenticationError('Refresh token reuse detected; session revoked');
    }

    return this.mintPair(session);
  }

  /** End a single session (logout). */
  async logout(sessionId: string): Promise<void> {
    await this.sessions.destroy(sessionId);
  }

  /** End every session for a user (logout everywhere). */
  async logoutAll(userId: string): Promise<void> {
    await this.sessions.destroyAllForUser(userId);
  }

  /** Verify an access token and return its payload (for the auth middleware). */
  async verifyAccessToken(accessToken: string): Promise<TokenPayload> {
    try {
      const payload = await verifyToken(accessToken, this.jwt);
      if (payload.kind && payload.kind !== 'access') {
        throw new AuthenticationError('Not an access token');
      }
      return payload;
    } catch (e) {
      if (e instanceof AuthenticationError) throw e;
      throw new AuthenticationError('Invalid access token');
    }
  }

  private async mintPair(session: Session): Promise<TokenPair> {
    const jti = randomBytes(12).toString('base64url');
    // Record the issued refresh jti on the session for reuse detection.
    await this.sessions.update(session.id, { currentJti: jti });
    const access = await signAccessToken(session.userId, session.roles, this.jwt, session.id);
    const refresh = await this.signRefreshWithJti(session, jti);
    const refreshExpiresAt = Date.now() + (this.jwt.refreshTtl ?? 60 * 60 * 24 * 7) * 1000;
    return { accessToken: access, refreshToken: refresh, sessionId: session.id, refreshExpiresAt };
  }

  private async signRefreshWithJti(session: Session, jti: string): Promise<string> {
    // Re-use the jose SignJWT path by importing here to inject jti.
    const { SignJWT } = await import('jose');
    const ttl = this.jwt.refreshTtl ?? 60 * 60 * 24 * 7;
    const secret =
      typeof this.jwt.secret === 'string' ? new TextEncoder().encode(this.jwt.secret) : this.jwt.secret;
    const builder = new SignJWT({ kind: 'refresh', roles: session.roles, sid: session.id })
      .setProtectedHeader({ alg: this.jwt.algorithm ?? 'HS256' })
      .setSubject(session.userId)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`);
    if (this.jwt.issuer) builder.setIssuer(this.jwt.issuer);
    if (this.jwt.audience) builder.setAudience(this.jwt.audience);
    return builder.sign(secret);
  }
}
