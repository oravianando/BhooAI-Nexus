/**
 * BhooAI Nexus — root configuration types.
 *
 * The single config file (`nexus.config.ts`) is typed by `NexusConfig`.
 * Precedence (low → high): code defaults < nexus.config.ts < nexus.runtime.json
 * < environment variables < CLI flags.
 */

export type Env = 'development' | 'production' | 'test';

export interface ServerConfig {
  port: number;
  host: string;
  /** When true, serve over HTTPS using the certs from `certs`. */
  https: boolean;
  /** Path to a generated TLS cert/key pair (relative to project root). */
  certFile?: string;
  keyFile?: string;
  /** Trust proxy headers (X-Forwarded-*) — set to the number of hops or true. */
  trustProxy: boolean | number;
  /** Maximum request body size in bytes. */
  bodyLimit: number;
}

export interface UploadsConfig {
  /** Directory for persisted files, relative to the project root. */
  dir: string;
  /** Public URL path for upload and download requests. */
  path: string;
  /** Maximum size of one uploaded file in bytes. */
  maxFileSize: number;
  /** Maximum number of files accepted in one request. */
  maxFiles: number;
  /** Empty means all MIME types are accepted. */
  allowedTypes: string[];
}

export interface DbConfig {
  uri: string;
  /** Database name override; otherwise taken from the URI. */
  name?: string;
  /** Connection pool size. */
  maxPoolSize: number;
  /** Auto-create indexes declared in schemas on boot. */
  autoIndex: boolean;
}

export interface RedisConfig {
  url: string;
  /** Key prefix for namespacing. */
  keyPrefix: string;
}

export interface JwtConfig {
  secret: string;
  /** Access token TTL in seconds. */
  accessTtl: number;
  /** Refresh token TTL in seconds. */
  refreshTtl: number;
  issuer: string;
  audience: string;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  /** OAuth redirect path relative to the server root, e.g. "/auth/google/callback". */
  callbackPath: string;
  /** Space-separated OAuth scopes. */
  scope: string;
}

export interface AuthConfig {
  jwt: JwtConfig;
  /** Cookie name for the session/access token. */
  cookieName: string;
  /** Cookie name for the refresh token. */
  refreshCookieName: string;
  google?: OAuthProviderConfig;
  facebook?: OAuthProviderConfig;
  /** Require email verification before login. */
  requireEmailVerification: boolean;
}

export interface PaymentsProviderConfig {
  enabled: boolean;
  /** Sandbox/test mode. */
  sandbox: boolean;
  [key: string]: unknown;
}

export interface PaymentsConfig {
  razorpay?: PaymentsProviderConfig;
  paypal?: PaymentsProviderConfig;
  payu?: PaymentsProviderConfig;
  skrill?: PaymentsProviderConfig;
  payoneer?: PaymentsProviderConfig;
  /** Path on which payment webhooks are mounted, e.g. "/payments/webhook/:provider". */
  webhookPath: string;
  /** Default currency (ISO 4217). */
  currency: string;
}

export interface EmailConfig {
  provider: 'smtp' | 'log';
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  from: string;
}

export interface CertsConfig {
  /** Directory (relative to project root) where generated certs/keys are written. */
  dir: string;
  /** Default key type for new keypairs. */
  keyType: 'rsa' | 'ec';
  /** RSA key size in bits. */
  rsaModulus: number;
  /** EC curve name. */
  ecCurve: 'prime256v1' | 'secp384r1' | 'secp521r1';
  /** Self-signed cert validity in days. */
  validityDays: number;
}

export interface AdsConfig {
  enabled: boolean;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
}

export interface WebRtcConfig {
  /** mediasoup worker RTC listen IPs. */
  rtcMinPort: number;
  rtcMaxPort: number;
  /** IP announced to clients (must be reachable from the browser). */
  announceIp: string;
}

export interface GraphqlConfig {
  /** Path on which GraphQL is mounted. */
  path: string;
  /** Federation mode: "in-process" (monolith) or "distributed" (HTTP subgraphs). */
  federation: 'in-process' | 'distributed';
  /** Enable GraphQL over WebSocket (subscriptions). */
  subscriptions: boolean;
  /** Introspection enabled (disable in production). */
  introspection: boolean;
}

export interface WsConfig {
  /** Path on which the WebSocket server listens. */
  path: string;
  /** Heartbeat ping interval in ms. */
  heartbeatMs: number;
  /** Require CSRF token + origin check on the WS upgrade. */
  requireCsrf: boolean;
}

export interface AiConfig {
  /** Python AI server base URL. */
  serverUrl: string;
  /** Request timeout in ms. */
  timeoutMs: number;
  /** Default provider: "openai" | "ollama" | "auto". */
  defaultProvider: 'openai' | 'ollama' | 'auto';
  /** Model used by the admin AI schema generator (e.g. "gpt-4o-mini"). */
  schemaModel: string;
}

export interface LoggingConfig {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** "json" (machine) or "pretty" (colored, dev). */
  format: 'json' | 'pretty';
  /** Write logs to stdout in addition to file. */
  console: boolean;
  /** Directory for rotating log files. */
  dir: string;
  /** Max log file size in bytes before rotation. */
  maxFileSize: number;
  /** Number of rotated files to keep. */
  maxFiles: number;
}

export interface PluginEntry {
  /** Package or path to the plugin. */
  path: string;
  enabled: boolean;
  /** Plugin-specific config. */
  config?: Record<string, unknown>;
}

export interface PluginsConfig {
  /** Directory holding local plugins. */
  dir: string;
  entries: PluginEntry[];
}

export interface FrontendConfig {
  /** Vite dev server port. */
  port: number;
  /** Vite dev server bind host. "localhost" = loopback only, "0.0.0.0" = LAN. */
  host: string;
  /** Launch the frontend dev server under `nexus dev`. */
  enabled: boolean;
}

export interface AdminConfig {
  /** Vite dev server port for the admin app. */
  port: number;
  /** Vite dev server bind host. */
  host: string;
  /** Launch the admin dev server under `nexus dev`. */
  enabled: boolean;
}

export interface NexusConfig {
  env: Env;
  server: ServerConfig;
  uploads: UploadsConfig;
  db: DbConfig;
  redis: RedisConfig;
  graphql: GraphqlConfig;
  ws: WsConfig;
  auth: AuthConfig;
  payments: PaymentsConfig;
  email: EmailConfig;
  certs: CertsConfig;
  ads: AdsConfig;
  webrtc: WebRtcConfig;
  ai: AiConfig;
  logging: LoggingConfig;
  plugins: PluginsConfig;
  frontend: FrontendConfig;
  admin: AdminConfig;
}

/** Deep partial used for user config files and runtime overrides. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type UserNexusConfig = DeepPartial<NexusConfig>;
