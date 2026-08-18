import crypto from 'node:crypto';
import {
  SEQUENCE,
  INTEGER,
  BIT_STRING,
  UTCTime,
  GeneralizedTime,
  OID,
  COMMON_NAME,
  ORG,
  COUNTRY,
  PrintableString,
  NULL,
  sha256WithRsaAlgId,
  ecdsaP256AlgId,
  toBuffer,
  SET,
  type Byte,
} from './der.js';

export interface X509Options {
  keyPair: { publicKey: Buffer; privateKey: Buffer };
  commonName: string;
  organization?: string;
  country?: string;
  notBefore?: Date;
  notAfter?: Date;
  serial?: number;
}

export interface X509Result {
  cert: Buffer;
  pem: string;
}

/** Build a Name (RDNSequence) from subject components. */
function buildName(
  commonName: string,
  organization?: string,
  country?: string,
): Byte {
  const rdns: Byte[] = [];
  if (country) {
    rdns.push(SET(SEQUENCE(COUNTRY, PrintableString(country))));
  }
  if (organization) {
    rdns.push(SET(SEQUENCE(ORG, PrintableString(organization))));
  }
  rdns.push(SET(SEQUENCE(COMMON_NAME, PrintableString(commonName))));
  return SEQUENCE(...rdns);
}

/** Pick Time encoding: UTCTime for 1950-2049, GeneralizedTime otherwise. */
function timeEncode(date: Date): Byte {
  const year = date.getUTCFullYear();
  if (year >= 1950 && year <= 2049) {
    return UTCTime(date);
  }
  return GeneralizedTime(date);
}

/**
 * Create a self-signed X.509 v3 certificate.
 *
 * Builds TBSCertificate DER by hand, signs it with the private key (SHA-256),
 * and wraps it as SEQUENCE { tbs, signatureAlgorithm, signature }.
 * No extensions are added (a v3 cert with no extensions is still valid DER).
 */
export function createSelfSignedCertificate(opts: X509Options): X509Result {
  const privateKey = crypto.createPrivateKey({
    key: opts.keyPair.privateKey,
    format: 'der',
    type: 'pkcs8',
  });
  const keyType = privateKey.asymmetricKeyType;
  const isEc = keyType === 'ec';

  const sigAlgId = isEc ? ecdsaP256AlgId() : sha256WithRsaAlgId();
  const signAlg = isEc ? 'sha256' : 'sha256';

  const notBefore = opts.notBefore ?? new Date();
  const notAfter =
    opts.notAfter ?? new Date(notBefore.getTime() + 365 * 24 * 60 * 60 * 1000);
  const serial = opts.serial ?? 1;

  // version [0] EXPLICIT INTEGER(2) → v3
  const version = tagExplicit(0, INTEGER(2));

  const issuer = buildName(opts.commonName, opts.organization, opts.country);
  const subject = buildName(opts.commonName, opts.organization, opts.country);
  const validity = SEQUENCE(timeEncode(notBefore), timeEncode(notAfter));

  // The publicKey buffer is already a SPKI DER (from generateKeyPairSync with
  // type 'spki', format 'der') — embed it verbatim.
  const spki = Array.from(opts.keyPair.publicKey);

  const tbs = SEQUENCE(
    version,
    INTEGER(serial),
    sigAlgId,
    issuer,
    validity,
    subject,
    spki,
  );

  const tbsBuf = toBuffer(tbs);
  const signature = crypto.sign(signAlg, tbsBuf, privateKey);

  const cert = SEQUENCE(
    tbs,
    sigAlgId,
    BIT_STRING(Array.from(signature)),
  );

  const certBuf = toBuffer(cert);
  const pem = pemEncode(certBuf, 'CERTIFICATE');
  return { cert: certBuf, pem };
}

/** IMPLICIT/EXPLICIT context tag helper. EXPLICIT wraps content in another TLV. */
function tagExplicit(tagNumber: number, content: Byte): Byte {
  const tagByte = 0xa0 | (tagNumber & 0x1f);
  return tag(tagByte, content);
}

function tag(tagByte: number, content: Byte): Byte {
  // Local copy to avoid exporting a private helper; matches der.tag semantics.
  const len = encodeLenLocal(content.length);
  return [tagByte, ...len, ...content];
}

function encodeLenLocal(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = v >>> 8;
  }
  if (bytes.length === 0) bytes.push(0);
  return [0x80 | bytes.length, ...bytes];
}

/** Wrap a DER buffer as a PEM string. */
export function pemEncode(der: Buffer, label: string): string {
  const b64 = der.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

// Re-export for index convenience.
export { OID, NULL };