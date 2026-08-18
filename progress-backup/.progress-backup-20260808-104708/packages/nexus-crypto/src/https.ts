import https from 'node:https';

export interface HttpsAgentOptions {
  cert: Buffer;
  key: Buffer;
  ca?: Buffer;
  rejectUnauthorized?: boolean;
}

/** Create an https.Agent suitable for mutual TLS (client-side). */
export function createHttpsAgent(opts: HttpsAgentOptions): https.Agent {
  return new https.Agent({
    cert: opts.cert,
    key: opts.key,
    ca: opts.ca,
    rejectUnauthorized: opts.rejectUnauthorized ?? true,
  });
}

export interface TlsConfigOptions {
  cert: Buffer;
  key: Buffer;
  ca?: Buffer;
}

/** Return the { cert, key, ca } object for use with https.createServer. */
export function createTlsConfig(opts: TlsConfigOptions): {
  cert: Buffer;
  key: Buffer;
  ca?: Buffer;
} {
  if (opts.ca !== undefined) {
    return { cert: opts.cert, key: opts.key, ca: opts.ca };
  }
  return { cert: opts.cert, key: opts.key };
}