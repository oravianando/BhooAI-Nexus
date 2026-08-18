import type { NexusConfig } from './types.js';

/**
 * Code-level defaults — the lowest-precedence layer of the config stack.
 * Every field is present so a config that supplies nothing still boots.
 */
export const defaults: NexusConfig = {
  env: 'development',
  server: {
    port: 4000,
    host: '0.0.0.0',
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
    uri: 'mongodb://localhost:27017/nexus',
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
    introspection: true,
  },
  ws: {
    path: '/ws',
    heartbeatMs: 30_000,
    requireCsrf: true,
  },
  auth: {
    jwt: {
      secret: 'change-me-please',
      accessTtl: 60 * 15, // 15 min
      refreshTtl: 60 * 60 * 24 * 30, // 30 days
      issuer: 'bhooai-nexus',
      audience: 'bhooai-nexus-client',
    },
    cookieName: 'nexus_sid',
    refreshCookieName: 'nexus_rid',
    requireEmailVerification: false,
    google: { clientId: '', clientSecret: '', callbackPath: '/auth/google/callback', scope: 'openid email profile' },
    facebook: { clientId: '', clientSecret: '', callbackPath: '/auth/facebook/callback', scope: 'email' },
  },
  payments: {
    webhookPath: '/payments/webhook/:provider',
    currency: 'USD',
  },
  email: {
    provider: 'log',
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
    enabled: false,
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
    schemaModel: 'gpt-4o-mini',
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
    enabled: true,
  },
  admin: {
    port: 5174,
    host: 'localhost',
    enabled: true,
  },
};
