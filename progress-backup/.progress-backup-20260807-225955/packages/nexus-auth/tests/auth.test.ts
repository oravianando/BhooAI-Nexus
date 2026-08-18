import { describe, it, expect, afterEach } from 'vitest';
import { Router, NexusServer, bodyParser } from '@bhooai/nexus-core/http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  verifyToken,
  MemorySessionStore,
  AuthService,
  RoleRegistry,
  requireAuth,
  requireRole,
  requirePermission,
  authToken,
  setAuthCookies,
  buildGoogleAuthUrl,
  buildFacebookAuthUrl,
  computePkceChallenge,
  generatePkceVerifier,
  MemoryOAuthStateStore,
  type GoogleOAuthConfig,
  type FacebookOAuthConfig,
} from '../src/index.js';

const JWT = { secret: 'test-secret-key-very-long-for-hs256-testing', issuer: 'nexus-test', accessTtl: 60, refreshTtl: 3600 };

function call(port: number, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path: opts.path ?? '/', method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe('auth: passwords', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).not.toBe('hunter2');
    expect(await verifyPassword('hunter2', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

describe('auth: jwt', () => {
  it('signs and verifies an access token with roles', async () => {
    const token = await signAccessToken('user-1', ['admin'], JWT);
    const payload = await verifyToken(token, JWT);
    expect(payload.sub).toBe('user-1');
    expect(payload.roles).toEqual(['admin']);
    expect(payload.kind).toBe('access');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken('user-1', [], JWT);
    await expect(verifyToken(token, { ...JWT, secret: 'other-secret-also-long-enough-for-hs' })).rejects.toThrow();
  });
});

describe('auth: session store', () => {
  it('creates, retrieves, and destroys sessions', async () => {
    const store = new MemorySessionStore();
    const s = await store.create('u1', ['user']);
    expect(await store.get(s.id)).not.toBeNull();
    await store.destroy(s.id);
    expect(await store.get(s.id)).toBeNull();
  });

  it('destroyAllForUser removes every session for that user', async () => {
    const store = new MemorySessionStore();
    const a = await store.create('u1', ['user']);
    const b = await store.create('u1', ['user']);
    await store.destroyAllForUser('u1');
    expect(await store.get(a.id)).toBeNull();
    expect(await store.get(b.id)).toBeNull();
  });
});

describe('auth: AuthService login / refresh / reuse detection', () => {
  it('issues a token pair on login and refreshes with rotation', async () => {
    const service = new AuthService(JWT, new MemorySessionStore());
    const pair = await service.login({ userId: 'u1', roles: ['user'] });
    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.sessionId).toBeTruthy();

    const refreshed = await service.refresh(pair.refreshToken);
    expect(refreshed.refreshToken).not.toBe(pair.refreshToken); // rotated

    // The old refresh token is now invalid (jti mismatch → reuse → family revoked)
    await expect(service.refresh(pair.refreshToken)).rejects.toThrow(/reuse|expired|Session/);
  });

  it('verifyAccessToken accepts the access token', async () => {
    const service = new AuthService(JWT, new MemorySessionStore());
    const pair = await service.login({ userId: 'u1', roles: ['user'] });
    const payload = await service.verifyAccessToken(pair.accessToken);
    expect(payload.sub).toBe('u1');
  });

  it('logout ends the session so refresh fails', async () => {
    const service = new AuthService(JWT, new MemorySessionStore());
    const pair = await service.login({ userId: 'u1', roles: ['user'] });
    await service.logout(pair.sessionId);
    await expect(service.refresh(pair.refreshToken)).rejects.toThrow();
  });
});

describe('auth: RBAC', () => {
  it('resolves inherited permissions and powers requirePermission middleware', async () => {
    const registry = new RoleRegistry().defineAll({
      viewer: { permissions: ['read:posts'] },
      editor: { permissions: ['write:posts'], inherits: ['viewer'] },
      admin: { permissions: ['delete:posts'], inherits: ['editor'] },
    });
    expect(registry.can('editor', 'read:posts')).toBe(true);
    expect(registry.can('editor', 'delete:posts')).toBe(false);
    expect(registry.can('admin', 'delete:posts')).toBe(true);
    expect(registry.canAny(['editor'], 'write:posts')).toBe(true);
  });
});

describe('auth: authToken + requireRole middleware (live server)', () => {
  let server: NexusServer;
  let port: number;
  let service: AuthService;
  afterEach(async () => server && (await server.close()));

  async function boot(roles: string[]) {
    service = new AuthService(JWT, new MemorySessionStore());
    const registry = new RoleRegistry().define('admin', { permissions: ['billing:read'] });
    const router = new Router();
    router.get('/me', (ctx) => ctx.json({ id: (ctx.state.user as { id: string }).id }), [authToken(service), requireAuth()]);
    router.get('/admin', (ctx) => ctx.json({ ok: true }), [authToken(service), requireRole('admin')]);
    router.get('/perm', (ctx) => ctx.json({ ok: true }), [authToken(service), requirePermission(registry, 'billing:read')]);
    server = new NexusServer({ router, middleware: [bodyParser()] });
    await server.listen(0, '127.0.0.1');
    port = (server.address as AddressInfo).port;
    return service.login({ userId: 'u1', roles });
  }

  it('sets ctx.state.user from a bearer token and allows requireAuth', async () => {
    const pair = await boot(['user']);
    const res = await call(port, { path: '/me', headers: { authorization: `Bearer ${pair.accessToken}` } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).id).toBe('u1');
  });

  it('rejects requests with no token (401)', async () => {
    await boot(['user']);
    const res = await call(port, { path: '/me' });
    expect(res.status).toBe(401);
  });

  it('requireRole allows admins and forbids plain users (403)', async () => {
    const adminPair = await boot(['admin']);
    const ok = await call(port, { path: '/admin', headers: { authorization: `Bearer ${adminPair.accessToken}` } });
    expect(ok.status).toBe(200);

    const userPair = await service.login({ userId: 'u2', roles: ['user'] });
    const forbidden = await call(port, { path: '/admin', headers: { authorization: `Bearer ${userPair.accessToken}` } });
    expect(forbidden.status).toBe(403);
  });

  it('requirePermission checks the registry', async () => {
    const adminPair = await boot(['admin']);
    const ok = await call(port, { path: '/perm', headers: { authorization: `Bearer ${adminPair.accessToken}` } });
    expect(ok.status).toBe(200);
  });
});

describe('auth: OAuth helpers (no network)', () => {
  let server: NexusServer;
  let port: number;
  afterEach(async () => server && (await server.close()));

  const google: GoogleOAuthConfig = { clientId: 'g-id', clientSecret: 'g-secret', redirectUri: 'https://app.test/cb' };
  const facebook: FacebookOAuthConfig = { clientId: 'fb-id', clientSecret: 'fb-secret', redirectUri: 'https://app.test/cb' };

  it('builds a Google auth URL with PKCE challenge and state', () => {
    const verifier = generatePkceVerifier();
    const url = buildGoogleAuthUrl(google, { state: 'st', verifier });
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('state=st');
    expect(url).toContain(`code_challenge=${computePkceChallenge(verifier)}`);
  });

  it('builds a Facebook auth URL with state and scope', () => {
    const url = buildFacebookAuthUrl(facebook, 'st');
    expect(url).toContain('facebook.com/v19.0/dialog/oauth');
    expect(url).toContain('state=st');
    expect(url).toContain('client_id=fb-id');
  });

  it('state store consumes a value exactly once and rejects expired/unknown', async () => {
    const store = new MemoryOAuthStateStore();
    await store.set('s1', { verifier: 'v' }, 1000);
    expect((await store.consume('s1'))?.verifier).toBe('v');
    expect(await store.consume('s1')).toBeNull(); // single-use
    expect(await store.consume('unknown')).toBeNull();
  });

  it('setAuthCookies writes two httpOnly cookies', async () => {
    const service = new AuthService(JWT, new MemorySessionStore());
    const pair = await service.login({ userId: 'u1', roles: ['user'] });
    const router = new Router();
    router.get('/c', (ctx) => setAuthCookies(ctx, pair));
    server = new NexusServer({ router });
    await server.listen(0, '127.0.0.1');
    port = (server.address as AddressInfo).port;
    const res = await call(port, { path: '/c' });
    const setCookie = res.headers['set-cookie'] as string[] | undefined;
    expect(setCookie).toBeDefined();
    expect(setCookie!.some((c) => c.startsWith('nexus_at='))).toBe(true);
    expect(setCookie!.some((c) => c.startsWith('nexus_rt='))).toBe(true);
    expect(setCookie!.every((c) => c.includes('HttpOnly'))).toBe(true);
    await server.close();
    server = undefined as unknown as NexusServer;
  });
});