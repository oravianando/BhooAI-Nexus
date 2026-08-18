import { z } from 'zod';

/**
 * Zod validation schema for the merged `NexusConfig`. Validates types and the
 * most error-prone fields (ports, URLs, TTLs). Provider sub-configs use a
 * permissive record so custom keys flow through.
 */
const providerConfig = z
  .object({ enabled: z.boolean().default(false), sandbox: z.boolean().default(true) })
  .passthrough();

export const nexusConfigSchema = z.object({
  env: z.enum(['development', 'production', 'test']).default('development'),
  server: z.object({
    port: z.number().int().min(1).max(65535),
    host: z.string().min(1),
    https: z.boolean(),
    certFile: z.string().optional(),
    keyFile: z.string().optional(),
    trustProxy: z.union([z.boolean(), z.number().int().nonnegative()]),
    bodyLimit: z.number().int().positive(),
  }),
  uploads: z.object({
    dir: z.string().min(1),
    path: z.string().startsWith('/'),
    maxFileSize: z.number().int().positive(),
    maxFiles: z.number().int().positive(),
    allowedTypes: z.array(z.string()),
  }),
  db: z.object({
    uri: z.string().min(1),
    name: z.string().optional(),
    maxPoolSize: z.number().int().positive(),
    autoIndex: z.boolean(),
  }),
  redis: z.object({ url: z.string().min(1), keyPrefix: z.string() }),
  graphql: z.object({
    path: z.string().min(1),
    federation: z.enum(['in-process', 'distributed']),
    subscriptions: z.boolean(),
    introspection: z.boolean(),
  }),
  ws: z.object({
    path: z.string().min(1),
    heartbeatMs: z.number().int().positive(),
    requireCsrf: z.boolean(),
  }),
  auth: z.object({
    jwt: z.object({
      secret: z.string().min(8, 'jwt.secret must be at least 8 characters'),
      accessTtl: z.number().int().positive(),
      refreshTtl: z.number().int().positive(),
      issuer: z.string(),
      audience: z.string(),
    }),
    cookieName: z.string(),
    refreshCookieName: z.string(),
    google: z
      .object({
        clientId: z.string(),
        clientSecret: z.string(),
        callbackPath: z.string(),
        scope: z.string(),
      })
      .optional(),
    facebook: z
      .object({
        clientId: z.string(),
        clientSecret: z.string(),
        callbackPath: z.string(),
        scope: z.string(),
      })
      .optional(),
    requireEmailVerification: z.boolean(),
  }),
  payments: z.object({
    razorpay: providerConfig.optional(),
    paypal: providerConfig.optional(),
    payu: providerConfig.optional(),
    skrill: providerConfig.optional(),
    payoneer: providerConfig.optional(),
    webhookPath: z.string(),
    currency: z.string().length(3),
  }),
  email: z.object({
    provider: z.enum(['smtp', 'log']),
    smtp: z
      .object({
        host: z.string(),
        port: z.number().int().min(1).max(65535),
        secure: z.boolean(),
        user: z.string(),
        pass: z.string(),
      })
      .optional(),
    from: z.string(),
  }),
  certs: z.object({
    dir: z.string(),
    keyType: z.enum(['rsa', 'ec']),
    rsaModulus: z.number().int().positive(),
    ecCurve: z.enum(['prime256v1', 'secp384r1', 'secp521r1']),
    validityDays: z.number().int().positive(),
  }),
  ads: z.object({
    enabled: z.boolean(),
    developerToken: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    refreshToken: z.string(),
    customerId: z.string(),
  }),
  webrtc: z.object({
    rtcMinPort: z.number().int().min(1).max(65535),
    rtcMaxPort: z.number().int().min(1).max(65535),
    announceIp: z.string(),
  }),
  ai: z.object({
    serverUrl: z.string().url(),
    timeoutMs: z.number().int().positive(),
    defaultProvider: z.enum(['openai', 'ollama', 'auto']),
    schemaModel: z.string().min(1).optional(),
  }),
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    format: z.enum(['json', 'pretty']),
    console: z.boolean(),
    dir: z.string(),
    maxFileSize: z.number().int().positive(),
    maxFiles: z.number().int().positive(),
  }),
  plugins: z.object({
    dir: z.string(),
    entries: z.array(
      z.object({ path: z.string(), enabled: z.boolean(), config: z.record(z.unknown()).optional() }),
    ),
  }),
  frontend: z.object({
    port: z.number().int().min(1).max(65535),
    host: z.string().min(1),
    enabled: z.boolean(),
  }),
  admin: z.object({
    port: z.number().int().min(1).max(65535),
    host: z.string().min(1),
    enabled: z.boolean(),
  }),
});

export type ValidatedNexusConfig = z.infer<typeof nexusConfigSchema>;
