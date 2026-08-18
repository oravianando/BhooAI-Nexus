import type { Middleware, RequestContext } from '../../nexus-core/src/http/index.js';
import { AuthorizationError, AuthenticationError } from '../../nexus-core/src/index.js';

/**
 * Role-based access control. A `RoleRegistry` maps role names to the set of
 * permissions they grant; roles can inherit from other roles via the
 * `inherits` option. The `can(role, permission)` check resolves the full
 * transitive permission set.
 */
export interface RoleDefinition {
  permissions?: string[];
  /** Other roles whose permissions are inherited. */
  inherits?: string[];
}

export class RoleRegistry {
  private roles = new Map<string, RoleDefinition>();

  define(name: string, def: RoleDefinition): this {
    this.roles.set(name, def);
    return this;
  }

  defineAll(map: Record<string, RoleDefinition>): this {
    for (const [name, def] of Object.entries(map)) this.define(name, def);
    return this;
  }

  /** Resolve the full transitive permission set for a role. */
  permissionsFor(role: string, seen = new Set<string>()): Set<string> {
    if (seen.has(role)) return new Set();
    seen.add(role);
    const def = this.roles.get(role);
    if (!def) return new Set();
    const out = new Set(def.permissions ?? []);
    for (const parent of def.inherits ?? []) {
      for (const p of this.permissionsFor(parent, seen)) out.add(p);
    }
    return out;
  }

  can(role: string, permission: string): boolean {
    return this.permissionsFor(role).has(permission);
  }

  /** True if ANY of the user's roles grant the permission. */
  canAny(roles: string[], permission: string): boolean {
    return roles.some((r) => this.can(r, permission));
  }
}

/** The shape of an authenticated principal stored on `ctx.state.user`. */
export interface AuthUser {
  id: string;
  roles: string[];
  [key: string]: unknown;
}

/** Read the authenticated user from ctx.state, throwing 401 if absent. */
export function getUser(ctx: RequestContext): AuthUser {
  const user = ctx.state.user as AuthUser | undefined;
  if (!user) throw new AuthenticationError();
  return user;
}

/** Middleware that requires an authenticated user (sets nothing; pairs with `authToken`). */
export function requireAuth(): Middleware {
  return async (ctx, next) => {
    getUser(ctx);
    await next();
  };
}

/** Middleware that requires the user to hold one of the given roles. */
export function requireRole(...roles: string[]): Middleware {
  return async (ctx, next) => {
    const user = getUser(ctx);
    if (!roles.some((r) => user.roles.includes(r))) {
      throw new AuthorizationError(`Requires one of roles: ${roles.join(', ')}`);
    }
    await next();
  };
}

/** Middleware that requires a specific permission, checked against a registry. */
export function requirePermission(registry: RoleRegistry, permission: string): Middleware {
  return async (ctx, next) => {
    const user = getUser(ctx);
    if (!registry.canAny(user.roles, permission)) {
      throw new AuthorizationError(`Missing permission: ${permission}`);
    }
    await next();
  };
}
