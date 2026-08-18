import type { NexusConfig } from '@bhooai/nexus-core';

/**
 * BhooAI Nexus — framework reference config.
 *
 * Every section is listed below with its default value, so this file doubles as
 * the canonical map of every knob you can turn. Precedence (low → high):
 *   code defaults < this file < nexus.runtime.json < NEXUS_* env vars < CLI flags.
 *
 * Secrets/keys belong in .env (e.g. NEXUS_AUTH_JWT_SECRET, NEXUS_DB_URI,
 * NEXUS_PAYMENTS_RAZORPAY_KEY_ID). No secret is stored in this file. A value
 * left empty here is inherited from
 * the code defaults instead. Features that need credentials (OAuth, ads,
 * payment providers, SMTP) stay off until you add keys — with one exception:
 * a payment provider also activates automatically as soon as its keys carry
 * real values.
 */
const config: Partial<NexusConfig> = {
  env: 'development',

  server: {
    port: 4000,
    host: '127.0.0.1',
    https: false,
    trustProxy: false,
     bodyLimit: 12 * 1024 * 1024, // 12 MiB, allowing a 10 MiB upload plus multipart overhead
   },

  uploads: {
    dir: 'uploads',
    path: '/uploads',
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 20,
    allowedTypes: [],
  },

  db: {
    uri: 'mongodb://localhost:27017/nexus', // override with NEXUS_DB_URI in .env
    maxPoolSize: 10,
    autoIndex: true,
  },

  redis: {
    url: 'redis://localhost:6379',
    keyPrefix: 'nexus:',
  },

  graphql: {
    path: '/graphql',
    federation: 'in-process',
    subscriptions: true,
    introspection: true, // false in production
  },

  ws: {
    path: '/ws',
    heartbeatMs: 30_000,
    requireCsrf: true,
  },

  auth: {
    jwt: {
      // secret comes ONLY from NEXUS_AUTH_JWT_SECRET in .env — never store it here
      accessTtl: 60 * 15, // 15 min
      refreshTtl: 60 * 60 * 24 * 30, // 30 days
      issuer: 'bhooai-nexus',
      audience: 'bhooai-nexus-client',
    },
    cookieName: 'nexus_sid',
    refreshCookieName: 'nexus_rid',
    requireEmailVerification: false,
    // OAuth is off until client id/secret are set (.env or here).
    google: { clientId: '', clientSecret: '', callbackPath: '/auth/google/callback', scope: 'openid email profile' },
    facebook: { clientId: '', clientSecret: '', callbackPath: '/auth/facebook/callback', scope: 'email' },
  },

  payments: {
    webhookPath: '/payments/webhook/:provider',
    currency: 'INR', // default for orders created without an explicit currency
    // A provider is on when `enabled: true` AND its keys are set, or
    // automatically once its keys carry real values. Enabled-with-no-keys is
    // invalid. Keys NEVER go in this file — they live in .env as
    // NEXUS_PAYMENTS_<NAME>_KEY_ID / _KEY_SECRET (or _MERCHANT_KEY/_SALT, …).
    razorpay: { enabled: false, sandbox: true },
    paypal: { enabled: false, sandbox: true },
    payu: { enabled: false, sandbox: true },
    skrill: { enabled: false, sandbox: true },
    payoneer: { enabled: false, sandbox: true },
  },

  email: {
    provider: 'log', // 'log' in dev, switch to 'smtp' once creds are in .env
    from: 'no-reply@nexus.local',
  },

  certs: {
    dir: 'certs',
    keyType: 'rsa',
    rsaModulus: 2048,
    ecCurve: 'prime256v1',
    validityDays: 365,
  },

  ads: {
    enabled: false, // turns on once tokens are provided
    developerToken: '',
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    customerId: '',
  },

  webrtc: {
    rtcMinPort: 40000,
    rtcMaxPort: 40100,
    announceIp: '127.0.0.1',
  },

  ai: {
    serverUrl: 'http://localhost:8000',
    timeoutMs: 60_000,
    defaultProvider: 'auto',
    schemaModel: 'llama3:latest',
  },

  logging: {
    level: 'info',
    format: 'pretty',
    console: true,
    dir: 'logs',
    maxFileSize: 10 * 1024 * 1024, // 10 MiB
    maxFiles: 7,
  },

  plugins: {
    dir: 'plugins',
    entries: [],
  },

  frontend: {
    port: 3000,
    host: 'localhost',
    enabled: true, // launches vite under `nexus dev`
  },

  admin: {
    port: 3001,
    host: 'localhost',
    enabled: true, // launches the admin panel under `nexus dev`
  },

  cluster: {
    enabled: false,
    failOpenSingleNode: true,
    lbHost: '127.0.0.1',
    lbPort: 8080,
    nodeAgentHost: '127.0.0.1',
    nodeAgentPort: 7575,
    registryFile: 'cluster.runtime.json',
    token: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
    autoscale: { enabled: true, mode: 'auto', minNodes: 1, maxNodes: 4, cooldownMs: 60_000, cpuHigh: 80, rpsPerNodeHigh: 15, rpsPerNodeLow: 5 },
  },
};

export default config;
