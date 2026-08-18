import { Router } from '@bhooai/nexus-core/http';
import type { NexusConfig } from '@bhooai/nexus-core';
import { ConflictError, AuthenticationError, ValidationError } from '@bhooai/nexus-core';
import {
  AuthService,
  MemorySessionStore,
  authToken,
  requireAuth,
  setAuthCookies,
  clearAuthCookies,
  readCookieValue,
  hashPassword,
  verifyPassword,
  buildGoogleAuthUrl,
  buildFacebookAuthUrl,
  exchangeGoogleCode,
  exchangeFacebookCode,
  fetchGoogleProfile,
  fetchFacebookProfile,
  generateState,
  generatePkceVerifier,
  MemoryOAuthStateStore,
  type GoogleOAuthConfig,
  type FacebookOAuthConfig,
} from '@bhooai/nexus-auth';
import { initUserModel, getUserModel, findUserForLogin, upsertOAuthUser } from '../users/userModel.js';

const sessions = new MemorySessionStore();
const oauthState = new MemoryOAuthStateStore();

function origin(config: NexusConfig): string {
  const proto = config.server.https ? 'https' : 'http';
  return `${proto}://${config.server.host === '0.0.0.0' ? 'localhost' : config.server.host}:${config.server.port}`;
}

function jwtOptions(config: NexusConfig) {
  return {
    secret: config.auth.jwt.secret,
    algorithm: 'HS256' as const,
    issuer: config.auth.jwt.issuer,
    audience: config.auth.jwt.audience,
    accessTtl: config.auth.jwt.accessTtl,
    refreshTtl: config.auth.jwt.refreshTtl,
  };
}

function authService(config: NexusConfig): AuthService {
  return new AuthService(jwtOptions(config), sessions);
}

/** Register /auth/* routes onto the given router. Call after `connect()` + `initUserModel()`. */
export function registerAuthRoutes(router: Router, config: NexusConfig, onUserCreated?: () => void): void {
  initUserModel();
  const service = authService(config);

  // POST /auth/register
  router.post('/auth/register', async (ctx) => {
    const body = (ctx.body ?? {}) as { email?: string; password?: string; name?: string };
    if (!body.email || !body.password) throw new ValidationError('email and password are required');
    if (body.password.length < 8) throw new ValidationError('password must be at least 8 characters');

    const User = getUserModel();
    const existing = await User.findOne({ email: body.email.toLowerCase() }).lean();
    if (existing) throw new ConflictError('A user with that email already exists');

    const passwordHash = await hashPassword(body.password);
    // Bootstrap: the very first registered user becomes an admin.
    const userCount = await User.countDocuments();
    const roles = userCount === 0 ? ['admin'] : ['user'];
    const [user] = await User.create({ email: body.email, name: body.name, passwordHash, roles });
    // Notify subscribers (e.g. the GraphQL `userCount` subscription) if wired.
    onUserCreated?.();
    const pair = await service.login({ userId: String(user._id), roles: user.roles, meta: { ip: ctx.req.socket.remoteAddress } });
    setAuthCookies(ctx, pair, { accessTokenName: config.auth.cookieName, refreshTokenName: config.auth.refreshCookieName });
    ctx.json({ user: publicUser(user), accessToken: pair.accessToken, refreshToken: pair.refreshToken });
  });

  // POST /auth/login
  router.post('/auth/login', async (ctx) => {
    const body = (ctx.body ?? {}) as { email?: string; password?: string };
    if (!body.email || !body.password) throw new ValidationError('email and password are required');
    const user = await findUserForLogin(body.email);
    if (!user || !user.passwordHash) throw new AuthenticationError('Invalid email or password');
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) throw new AuthenticationError('Invalid email or password');
    const pair = await service.login({ userId: String(user._id), roles: user.roles });
    setAuthCookies(ctx, pair, { accessTokenName: config.auth.cookieName, refreshTokenName: config.auth.refreshCookieName });
    ctx.json({ user: publicUser(user), accessToken: pair.accessToken, refreshToken: pair.refreshToken });
  });

  // POST /auth/refresh
  router.post('/auth/refresh', async (ctx) => {
    const body = (ctx.body ?? {}) as { refreshToken?: string };
    const refreshToken = body.refreshToken ?? readCookieValue(ctx, config.auth.refreshCookieName);
    if (!refreshToken) throw new AuthenticationError('Missing refresh token');
    const pair = await service.refresh(refreshToken);
    setAuthCookies(ctx, pair, { accessTokenName: config.auth.cookieName, refreshTokenName: config.auth.refreshCookieName });
    ctx.json({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
  });

  // POST /auth/logout
  router.post('/auth/logout', async (ctx) => {
    // Optional auth: end the session if a token is present, but never 401 on logout.
    await authToken(service, { required: false, allowCookie: true, cookieName: config.auth.cookieName })(ctx, async () => {});
    const sid = (ctx.state.user as { sid?: string } | undefined)?.sid;
    if (sid) await service.logout(sid);
    clearAuthCookies(ctx, { accessTokenName: config.auth.cookieName, refreshTokenName: config.auth.refreshCookieName });
    ctx.json({ ok: true });
  });

  // GET /auth/me
  router.get('/auth/me', async (ctx) => {
    const User = getUserModel();
    const id = (ctx.state.user as { id: string }).id;
    const user = await User.findById(id).lean();
    ctx.json({ user: publicUser(user) });
  }, [authToken(service, { cookieName: config.auth.cookieName }), requireAuth()]);

  // ── OAuth: Google ──────────────────────────────────────────────────────────
  if (config.auth.google?.clientId) {
    const google: GoogleOAuthConfig = {
      clientId: config.auth.google.clientId,
      clientSecret: config.auth.google.clientSecret,
      redirectUri: `${origin(config)}${config.auth.google.callbackPath}`,
      scope: config.auth.google.scope.split(/\s+/).filter(Boolean),
    };
    router.get('/auth/google', async (ctx) => {
      const state = generateState();
      const verifier = generatePkceVerifier();
      await oauthState.set(state, { provider: 'google', verifier }, 5 * 60_000);
      ctx.redirect(buildGoogleAuthUrl(google, { state, verifier }));
    });
    router.get(config.auth.google.callbackPath, async (ctx) => {
      const code = ctx.query.code as string | undefined;
      const state = ctx.query.state as string | undefined;
      if (!code || !state) throw new AuthenticationError('Missing OAuth code/state');
      const data = await oauthState.consume(state);
      if (!data || data.provider !== 'google') throw new AuthenticationError('Invalid OAuth state');
      const tokens = await exchangeGoogleCode(code, google, data.verifier as string);
      const profile = await fetchGoogleProfile(tokens.accessToken);
      const user = await upsertOAuthUser({ provider: 'google', providerUserId: profile.providerUserId, email: profile.email, name: profile.name });
      const pair = await service.login({ userId: String(user._id), roles: user.roles });
      setAuthCookies(ctx, pair, { accessTokenName: config.auth.cookieName, refreshTokenName: config.auth.refreshCookieName });
      ctx.json({ user: publicUser(user), accessToken: pair.accessToken });
    });
  }

  // ── OAuth: Facebook ─────────────────────────────────────────────────────────
  if (config.auth.facebook?.clientId) {
    const facebook: FacebookOAuthConfig = {
      clientId: config.auth.facebook.clientId,
      clientSecret: config.auth.facebook.clientSecret,
      redirectUri: `${origin(config)}${config.auth.facebook.callbackPath}`,
      scope: config.auth.facebook.scope.split(/\s+/).filter(Boolean),
    };
    router.get('/auth/facebook', async (ctx) => {
      const state = generateState();
      await oauthState.set(state, { provider: 'facebook' }, 5 * 60_000);
      ctx.redirect(buildFacebookAuthUrl(facebook, state));
    });
    router.get(config.auth.facebook.callbackPath, async (ctx) => {
      const code = ctx.query.code as string | undefined;
      const state = ctx.query.state as string | undefined;
      if (!code || !state) throw new AuthenticationError('Missing OAuth code/state');
      const data = await oauthState.consume(state);
      if (!data || data.provider !== 'facebook') throw new AuthenticationError('Invalid OAuth state');
      const tokens = await exchangeFacebookCode(code, facebook);
      const profile = await fetchFacebookProfile(tokens.accessToken);
      const user = await upsertOAuthUser({ provider: 'facebook', providerUserId: profile.providerUserId, email: profile.email, name: profile.name });
      const pair = await service.login({ userId: String(user._id), roles: user.roles });
      setAuthCookies(ctx, pair, { accessTokenName: config.auth.cookieName, refreshTokenName: config.auth.refreshCookieName });
      ctx.json({ user: publicUser(user), accessToken: pair.accessToken });
    });
  }
}

function publicUser(user: unknown): Record<string, unknown> | null {
  if (!user) return null;
  // DocumentInstance → use toObject() (avoids spreading the Proxy and its circular _model).
  // Plain objects (raw lean docs / JWT claims) → spread directly.
  const obj =
    (user as { toObject?: () => Record<string, unknown> }).toObject?.() ??
    (user as Record<string, unknown>);
  const u = { ...obj };
  delete u.passwordHash;
  return u;
}