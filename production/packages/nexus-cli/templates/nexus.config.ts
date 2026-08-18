import type { NexusConfig } from '@bhooai/nexus-core';

/**
 * THE single, human-edited config file for every server host/port.
 *
 * Precedence (low → high): code defaults < this file < nexus.runtime.json
 * (admin, gitignored) < NEXUS_* env vars < CLI flags. Admin writes only
 * `nexus.runtime.json`, so this file stays clean.
 *
 * The backend, MongoDB, Redis, the AI server, the frontend and admin Vite
 * dev servers, and the node mesh all read their host/port from here. The
 * Vite dev servers (apps/admin/vite.config.ts, apps/frontend/vite.config.ts)
 * open the SAME file, so change host/port in ONE place.
 */
const config: Partial<NexusConfig> = {
  env: 'development',
  
  // The HTTP API server the browser/cluster proxy to.
  server: { port: 4000, host: '0.0.0.0', https: false, trustProxy: false, bodyLimit: 12 * 1024 * 1024 },
  // Vite dev server for the frontend — hosts guests visit.
  frontend: { port: 3000, host: 'localhost', enabled: true },
  // Python AI server (first /ai/* proxy hops to this).
  ai: { serverUrl: 'http://localhost:8000', timeoutMs: 60_000, defaultProvider: 'auto', schemaModel: 'llama3:latest' },
  // Vite dev server for the admin app.
  admin: { port: 3001, host: 'localhost', enabled: true },
  // Node mesh: set kind via —as=root|node at init (this file stays minimal).
  cluster: { enabled: false, failOpenSingleNode: true, lbHost: '0.0.0.0', lbPort: 8080, nodeAgentHost: '0.0.0.0', nodeAgentPort: 7575, registryFile: 'cluster.runtime.json', token: '' },
  
  // File uploads.
  uploads: { dir: 'uploads', path: '/uploads', maxFileSize: 10 * 1024 * 1024, maxFiles: 20, allowedTypes: [] },
  // MongoDB host/port/database.
  db: { uri: 'mongodb://localhost:27017/acme-app', maxPoolSize: 10, autoIndex: true },
  // Redis host/port.
  redis: { url: 'redis://localhost:6379', keyPrefix: 'acme:' },
  // GraphQL API server (first /graphql proxy hops to this).
  graphql: { path: '/graphql', federation: 'in-process', subscriptions: true, introspection: true },
  //Web Socket server for the browser/cluster proxy to.
  ws: { path: '/ws', heartbeatMs: 30_000, requireCsrf: true },

  auth: {
    // JWT secret comes ONLY from NEXUS_AUTH_JWT_SECRET in .env — never here.
    jwt: { accessTtl: 60 * 15, refreshTtl: 60 * 60 * 24 * 30 },
    cookieName: 'nexus_sid',
    refreshCookieName: 'nexus_rid',
    requireEmailVerification: false,
  },

  payments: { webhookPath: '/payments/webhook/:provider', currency: 'INR',
    razorpay: { enabled: false, sandbox: true },
    paypal: { enabled: false, sandbox: true },
    payu: { enabled: false, sandbox: true },
    skrill: { enabled: false, sandbox: true },
    payoneer: { enabled: false, sandbox: true },
   },
  email: { provider: 'log', from: 'no-reply@acme.local' },
  // Certificates for HTTPS, WebRTC, etc.
  certs: { dir: 'certs', keyType: 'rsa', rsaModulus: 2048, ecCurve: 'prime256v1', validityDays: 365 },
  // Google Ads API (first /ads proxy hops to this).
  ads: { enabled: false, developerToken: '', clientId: '', clientSecret: '', refreshToken: '', customerId: '' },
  // WebRTC server (first /webrtc proxy hops to this).
  webrtc: { rtcMinPort: 40000, rtcMaxPort: 40100, announceIp: '127.0.0.1' },


  // Logging and plugins.
  logging: { level: 'info', format: 'pretty', console: true, dir: 'logs', maxFileSize: 10 * 1024 * 1024, maxFiles: 7 },
  plugins: { dir: 'plugins', entries: [] },
};

export default config;