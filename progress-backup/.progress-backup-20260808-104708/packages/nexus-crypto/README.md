# @bhooai/nexus-crypto

RSA/ECDSA keypairs, self-signed X.509 certs, CSRs, and HTTPS/mTLS helpers.

## Exports

- **keypair** — `generateKeyPair(type, { modulusLength, namedCurve })` →
  `{ publicKey, privateKey, pem }`.
- **x509** — `createSelfSignedCertificate({ keyPair, commonName, organization, country })`.
- **csr** — `createCsr({ keyPair, commonName, organization, country })` via a
  **hand-rolled DER/ASN.1 encoder** (`der.ts`). `node:crypto` can't create CSRs, so
  this is built from scratch (no `node-forge`).
- **der** — the minimal ASN.1/DER encoder underpinning the CSR.
- **https** — helpers for HTTPS servers and mTLS.

## Usage

```ts
import { generateKeyPair, createSelfSignedCertificate, createCsr } from '@bhooai/nexus-crypto';
const kp = generateKeyPair('rsa', { modulusLength: 2048 });
const cert = createSelfSignedCertificate({ keyPair: kp, commonName: 'localhost' });
const csr = createCsr({ keyPair: kp, commonName: 'localhost' });
```

The backend exposes this at `POST /certs/self-signed` (with optional `csr: true`).