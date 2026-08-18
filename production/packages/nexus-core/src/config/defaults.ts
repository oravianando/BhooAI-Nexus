import type { NexusConfig } from './types.js';

/**
 * Code-level defaults — the lowest-precedence layer of the config stack.
 * Every field is present so a config that supplies nothing still boots.
 */
export const defaults: NexusConfig = {
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
    currency: 'INR',
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
    providers: [
      { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434', enabled: true, defaultModel: 'llama3:latest' },
      { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', enabled: false, defaultModel: 'gpt-4o-mini' },
      { id: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', enabled: false, defaultModel: 'claude-sonnet-4-20250514' },
      { id: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1', enabled: false, defaultModel: 'gemini-2.0-flash' },
      { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', enabled: false, defaultModel: 'llama-3.3-70b-versatile' },
      { id: 'mistral', label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', enabled: false, defaultModel: 'mistral-large-latest' },
      { id: 'cohere', label: 'Cohere', baseUrl: 'https://api.cohere.ai/v1', enabled: false, defaultModel: 'command-r-plus' },
      { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', enabled: false, defaultModel: 'meta-llama/Llama-3-70b-chat-hf' },
      { id: 'fireworks', label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', enabled: false, defaultModel: 'accounts/fireworks/models/llama-v3-70b-instruct' },
      { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', enabled: false, defaultModel: 'deepseek-chat' },
      { id: 'perplexity', label: 'Perplexity', baseUrl: 'https://api.perplexity.ai', enabled: false, defaultModel: 'llama-3.1-sonar-large-128k-online' },
      { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', enabled: false, defaultModel: 'grok-2-latest' },
      { id: 'replicate', label: 'Replicate', baseUrl: 'https://api.replicate.com/v1', enabled: false, defaultModel: 'meta/llama-3-70b-instruct' },
      { id: 'huggingface', label: 'Hugging Face', baseUrl: 'https://api-inference.huggingface.co/models', enabled: false, defaultModel: 'meta-llama/Llama-3-70b-chat-hf' },
      { id: 'nvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', enabled: false, defaultModel: 'meta/llama-3.1-70b-instruct' },
      { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', enabled: false, defaultModel: 'openai/gpt-4o-mini' },
      { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', enabled: false, defaultModel: 'local-model' },
      { id: 'alephalpha', label: 'Aleph Alpha', baseUrl: 'https://api.aleph-alpha.com/v1', enabled: false, defaultModel: 'luminous-supreme-control' },
      { id: 'stability', label: 'Stability AI', baseUrl: 'https://api.stability.ai/v1', enabled: false, defaultModel: 'stable-diffusion-xl' },
      { id: 'azure', label: 'Azure OpenAI', baseUrl: 'https://your-resource.openai.azure.com', enabled: false, defaultModel: 'gpt-4o-mini' },
    ],
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
    port: 3001,
    host: 'localhost',
    enabled: true,
  },
  cluster: {
    enabled: false,
    failOpenSingleNode: true,
    lbHost: '127.0.0.1',
    lbPort: 8080,
    nodeAgentHost: '127.0.0.1',
    nodeAgentPort: 7575,
    registryFile: 'cluster.runtime.json',
    token: '',
    autoscale: {
      enabled: true,
      mode: 'auto',
      minNodes: 1,
      maxNodes: 4,
      cooldownMs: 60_000,
      cpuHigh: 80,
      rpsPerNodeHigh: 15,
      rpsPerNodeLow: 5,
    },
  },
};
