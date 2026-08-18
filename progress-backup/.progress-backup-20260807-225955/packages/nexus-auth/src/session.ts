import { randomBytes } from 'node:crypto';

export interface Session {
  id: string;
  /** User id this session belongs to. */
  userId: string;
  /** Roles snapshot at session creation (for quick auth without a DB hit). */
  roles: string[];
  /** Refresh-token family id — used to detect reuse after rotation. */
  familyId: string;
  /** The current refresh token's jti (so a reused/old refresh token is detectable). */
  currentJti?: string;
  /** Creation timestamp (ms). */
  createdAt: number;
  /** Last-seen timestamp (ms). */
  updatedAt: number;
  /** Optional metadata (ip, userAgent). */
  meta?: Record<string, unknown>;
}

/**
 * Session store abstraction. The default `MemorySessionStore` is used in tests
 * and single-process deployments; a Redis-backed implementation is wired in
 * Phase 7 (`nexus-cache`) for horizontal scaling. Refresh-token rotation uses
 * the `familyId` so that a stolen, already-rotated refresh token revokes the
 * entire family on reuse detection.
 */
export interface SessionStore {
  create(userId: string, roles: string[], meta?: Record<string, unknown>): Promise<Session>;
  get(id: string): Promise<Session | null>;
  update(id: string, patch: Partial<Session>): Promise<void>;
  destroy(id: string): Promise<void>;
  /** Destroy every session in a refresh family (reuse detection / logout-all). */
  destroyFamily(familyId: string): Promise<void>;
  /** Destroy all sessions for a user (logout everywhere). */
  destroyAllForUser(userId: string): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();
  private byFamily = new Map<string, Set<string>>();
  private byUser = new Map<string, Set<string>>();

  async create(userId: string, roles: string[], meta?: Record<string, unknown>): Promise<Session> {
    const id = randomBytes(18).toString('base64url');
    const familyId = randomBytes(18).toString('base64url');
    const now = Date.now();
    const session: Session = { id, userId, roles, familyId, createdAt: now, updatedAt: now, meta };
    this.sessions.set(id, session);
    this.byFamily.set(familyId, new Set([id]));
    let userSet = this.byUser.get(userId);
    if (!userSet) {
      userSet = new Set<string>();
      this.byUser.set(userId, userSet);
    }
    userSet.add(id);
    return session;
  }

  async get(id: string): Promise<Session | null> {
    return this.sessions.get(id) ?? null;
  }

  async update(id: string, patch: Partial<Session>): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    Object.assign(s, patch, { updatedAt: Date.now() });
  }

  async destroy(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.byFamily.get(s.familyId)?.delete(id);
    this.byUser.get(s.userId)?.delete(id);
  }

  async destroyFamily(familyId: string): Promise<void> {
    const ids = this.byFamily.get(familyId);
    if (!ids) return;
    for (const id of ids) this.destroy(id);
    this.byFamily.delete(familyId);
  }

  async destroyAllForUser(userId: string): Promise<void> {
    const ids = this.byUser.get(userId);
    if (!ids) return;
    for (const id of ids) this.destroy(id);
    this.byUser.delete(userId);
  }
}