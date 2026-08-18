import crypto from 'node:crypto';

export interface KeyPairResult {
  publicKey: Buffer;
  privateKey: Buffer;
  pem: { public: string; private: string };
}

export interface KeyPairOptions {
  modulusLength?: number;
  namedCurve?: string;
}

/**
 * Generate an RSA or EC keypair.
 *
 * Returns DER buffers (spki public, pkcs8 private) and PEM strings.
 * RSA defaults to 2048-bit; EC defaults to prime256v1 (P-256).
 */
export function generateKeyPair(
  type: 'rsa' | 'ec',
  opts: KeyPairOptions = {},
): KeyPairResult {
  let publicKey: crypto.KeyObject;
  let privateKey: crypto.KeyObject;
  if (type === 'rsa') {
    ({ publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: opts.modulusLength ?? 2048,
    }));
  } else if (type === 'ec') {
    ({ publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: opts.namedCurve ?? 'prime256v1',
    }));
  } else {
    throw new Error(`Unsupported key type: ${type}`);
  }

  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const privateKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;

  return {
    publicKey: publicKeyDer,
    privateKey: privateKeyDer,
    pem: {
      public: exportPublicKeyPem(publicKey),
      private: exportPrivateKeyPem(privateKey),
    },
  };
}

/** Export a KeyObject as a SPKI PEM string. */
export function exportPublicKeyPem(key: crypto.KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString('utf8');
}

/** Export a KeyObject as a PKCS#8 PEM string. */
export function exportPrivateKeyPem(key: crypto.KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'pem' }).toString('utf8');
}