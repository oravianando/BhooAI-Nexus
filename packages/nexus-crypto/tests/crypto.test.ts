import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  generateKeyPair,
  createSelfSignedCertificate,
  createCsr,
  createTlsConfig,
  encodeLen,
  OID,
  SEQUENCE,
  NULL,
  toBuffer,
} from '../src/index.js';

/** Node's X509Certificate has no `subjectCN` accessor; derive it from subject. */
function subjectCN(x509: crypto.X509Certificate): string | undefined {
  const subject = x509.subject;
  const match = subject.match(/(?:^|\n)CN=([^\n]+)/);
  return match ? match[1] : undefined;
}

// --- Tiny DER reader helpers for re-parsing our own CSR DER in the test ---
function readLen(buf: Buffer, offset: number): { len: number; next: number } {
  const first = buf[offset]!;
  if (first < 0x80) {
    return { len: first, next: offset + 1 };
  }
  const numBytes = first & 0x7f;
  let len = 0;
  let o = offset + 1;
  for (let i = 0; i < numBytes; i++) {
    len = (len << 8) | buf[o]!;
    o++;
  }
  return { len, next: o };
}

/** Read one TLV; returns { tag, content, rest } where content is the V bytes. */
function readTlv(buf: Buffer, offset: number): {
  tag: number;
  content: Buffer;
  rest: Buffer;
} {
  const tag = buf[offset]!;
  const { len, next } = readLen(buf, offset + 1);
  const content = buf.subarray(next, next + len);
  const rest = buf.subarray(next + len);
  return { tag, content, rest };
}

/** Split a constructed SEQUENCE's content into its child TLV byte slices. */
function splitChildren(content: Buffer): Buffer[] {
  const children: Buffer[] = [];
  let o = 0;
  while (o < content.length) {
    const { len, next } = readLen(content, o + 1);
    const fullLen = next + len - o;
    children.push(content.subarray(o, o + fullLen));
    o += fullLen;
  }
  return children;
}

describe('nexus-crypto', () => {
  it('generateKeyPair rsa produces valid PEM and DER buffers', () => {
    const kp = generateKeyPair('rsa');
    expect(kp.publicKey.length).toBeGreaterThan(0);
    expect(kp.privateKey.length).toBeGreaterThan(0);
    expect(kp.pem.public.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true);
    expect(kp.pem.private.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);
    // createPublicKey accepts the PEM.
    const pub = crypto.createPublicKey(kp.pem.public);
    expect(pub.asymmetricKeyType).toBe('rsa');
  });

  it('generateKeyPair ec (prime256v1) produces valid PEM and DER buffers', () => {
    const kp = generateKeyPair('ec');
    expect(kp.publicKey.length).toBeGreaterThan(0);
    expect(kp.privateKey.length).toBeGreaterThan(0);
    expect(kp.pem.public.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true);
    expect(kp.pem.private.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);
    const pub = crypto.createPublicKey(kp.pem.public);
    expect(pub.asymmetricKeyType).toBe('ec');
  });

  it('createSelfSignedCertificate rsa parses and self-verifies', () => {
    const kp = generateKeyPair('rsa');
    const { pem } = createSelfSignedCertificate({
      keyPair: kp,
      commonName: 'test.rsa.example',
      organization: 'BhooAI',
      country: 'IN',
    });
    expect(pem.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
    const x509 = new crypto.X509Certificate(pem);
    expect(subjectCN(x509)).toBe('test.rsa.example');
    expect(x509.validFrom).toBeDefined();
    expect(x509.validTo).toBeDefined();
    // Self-signed: verifies against its own public key.
    const pub = crypto.createPublicKey(kp.pem.public);
    expect(x509.verify(pub)).toBe(true);
  });

  it('createSelfSignedCertificate ec parses and self-verifies', () => {
    const kp = generateKeyPair('ec');
    const { pem } = createSelfSignedCertificate({
      keyPair: kp,
      commonName: 'test.ec.example',
    });
    expect(pem.startsWith('-----BEGIN CERTIFICATE-----')).toBe(true);
    const x509 = new crypto.X509Certificate(pem);
    expect(subjectCN(x509)).toBe('test.ec.example');
    const pub = crypto.createPublicKey(kp.pem.public);
    expect(x509.verify(pub)).toBe(true);
  });

  it('createCsr rsa produces a verifiable CSR', () => {
    const kp = generateKeyPair('rsa');
    const { csr, pem } = createCsr({
      keyPair: kp,
      commonName: 'csr.rsa.example',
    });
    expect(pem.startsWith('-----BEGIN CERTIFICATE REQUEST-----')).toBe(true);
    // Outer SEQUENCE: tag 0x30.
    const outer = readTlv(csr, 0);
    expect(outer.tag).toBe(0x30);
    // Children: CRI SEQUENCE, sigAlg SEQUENCE, signature BIT STRING.
    const kids = splitChildren(outer.content);
    expect(kids.length).toBe(3);
    expect(kids[0]![0]).toBe(0x30); // CRI
    expect(kids[1]![0]).toBe(0x30); // sigAlg
    expect(kids[2]![0]).toBe(0x03); // BIT STRING

    const criBytes = kids[0]!;
    const sigTlv = readTlv(kids[2]!, 0);
    // BIT STRING content: first byte is unused-bits count (0), rest is signature.
    const signature = sigTlv.content.subarray(1);

    const verify = crypto.createVerify('SHA256').update(criBytes);
    expect(verify.verify(kp.pem.public, signature)).toBe(true);
  });

  it('createCsr with challengePassword + extension still verifies', () => {
    const kp = generateKeyPair('rsa');
    const extValue = Buffer.from('hello-extension');
    const { csr, pem } = createCsr({
      keyPair: kp,
      commonName: 'csr.ext.example',
      challengePassword: 'secret-pass',
      extensions: [{ type: '1.2.3.4.5.6.7', value: extValue }],
    });
    expect(pem.startsWith('-----BEGIN CERTIFICATE REQUEST-----')).toBe(true);
    const outer = readTlv(csr, 0);
    const kids = splitChildren(outer.content);
    expect(kids.length).toBe(3);
    const verify = crypto
      .createVerify('SHA256')
      .update(kids[0]!)
      .verify(kp.pem.public, readTlv(kids[2]!, 0).content.subarray(1));
    expect(verify).toBe(true);
  });

  it('createCsr ec verifies with EC key', () => {
    const kp = generateKeyPair('ec');
    const { csr, pem } = createCsr({
      keyPair: kp,
      commonName: 'csr.ec.example',
    });
    expect(pem.startsWith('-----BEGIN CERTIFICATE REQUEST-----')).toBe(true);
    const outer = readTlv(csr, 0);
    const kids = splitChildren(outer.content);
    expect(kids.length).toBe(3);
    const verify = crypto
      .createVerify('SHA256')
      .update(kids[0]!)
      .verify(kp.pem.public, readTlv(kids[2]!, 0).content.subarray(1));
    expect(verify).toBe(true);
  });

  it('DER unit tests: encodeLen, OID, SEQUENCE(NULL())', () => {
    expect(encodeLen(0)).toEqual([0x00]);
    expect(encodeLen(127)).toEqual([0x7f]);
    expect(encodeLen(128)).toEqual([0x81, 0x80]);

    const oid = OID([1, 2, 840, 113549, 1, 1, 11]);
    // 0x06 (OID tag), length 0x09, then the standard sha256WithRSAEncryption arcs.
    expect(oid.slice(0, 2)).toEqual([0x06, 0x09]);
    expect(oid.slice(2)).toEqual([
      0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b,
    ]);

    const seq = SEQUENCE(NULL());
    expect(seq[0]).toBe(0x30);
    // SEQUENCE length 2 (NULL is 0x05 0x00).
    expect(seq[1]).toBe(0x02);
    expect(seq.slice(2)).toEqual([0x05, 0x00]);
    // Round-trip through a Buffer.
    expect(toBuffer(seq)).toEqual(Buffer.from([0x30, 0x02, 0x05, 0x00]));
  });

  it('createTlsConfig returns the cert/key object', () => {
    const cert = Buffer.from('cert');
    const key = Buffer.from('key');
    const cfg = createTlsConfig({ cert, key });
    expect(cfg.cert).toBe(cert);
    expect(cfg.key).toBe(key);
    expect('ca' in cfg).toBe(false);

    const ca = Buffer.from('ca');
    const cfg2 = createTlsConfig({ cert, key, ca });
    expect(cfg2.ca).toBe(ca);
  });
});