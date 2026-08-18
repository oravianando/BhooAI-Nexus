import crypto from 'node:crypto';
import {
  SEQUENCE,
  SET,
  INTEGER,
  BIT_STRING,
  OID,
  OCTET_STRING,
  UTF8String,
  BOOLEAN,
  COMMON_NAME,
  ORG,
  COUNTRY,
  CHALLENGE_PASSWORD,
  EXTENSION_REQUEST,
  PrintableString,
  sha256WithRsaAlgId,
  ecdsaP256AlgId,
  oidFromString,
  toBuffer,
  type Byte,
} from './der.js';
import { pemEncode } from './x509.js';

export interface CsrExtension {
  type: string;
  value: Buffer;
  critical?: boolean;
}

export interface CsrOptions {
  keyPair: { publicKey: Buffer; privateKey: Buffer };
  commonName: string;
  organization?: string;
  country?: string;
  challengePassword?: string;
  extensions?: CsrExtension[];
}

export interface CsrResult {
  csr: Buffer;
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

/** Build the attributes [0] IMPLICIT SET OF Attribute for the CRI. */
function buildAttributes(
  challengePassword?: string,
  extensions?: CsrExtension[],
): Byte {
  const attrs: Byte[] = [];

  if (challengePassword !== undefined) {
    // challengePassword attribute: SEQUENCE { OID, SET OF DirectoryString }
    attrs.push(
      SEQUENCE(
        CHALLENGE_PASSWORD,
        SET(UTF8String(challengePassword)),
      ),
    );
  }

  if (extensions && extensions.length > 0) {
    const exts: Byte[] = extensions.map((ext) => {
      const extOid = OID(oidFromString(ext.type));
      const value = OCTET_STRING(Array.from(ext.value));
      if (ext.critical) {
        return SEQUENCE(extOid, BOOLEAN(true), value);
      }
      return SEQUENCE(extOid, value);
    });
    // extensionRequest attribute: SEQUENCE { OID(1.2.840.113549.1.9.14), SET OF Extensions }
    // Extensions ::= SEQUENCE OF Extension
    attrs.push(
      SEQUENCE(
        EXTENSION_REQUEST,
        SET(SEQUENCE(...exts)),
      ),
    );
  }

  // [0] IMPLICIT SET OF Attribute — context tag 0xa0 (constructed), content is
  // the concatenation of the Attribute SEQUENCEs (no extra SET wrapper, because
  // the [0] IMPLICIT replaces the SET tag).
  return tagConstructed(0xa0, ...attrs);
}

/** Construct a context-class constructed tag wrapping concatenated items. */
function tagConstructed(tagByte: number, ...items: Byte[]): Byte {
  const flat: number[] = [];
  for (const it of items) flat.push(...it);
  const len = encodeLenLocal(flat.length);
  return [tagByte, ...len, ...flat];
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

/**
 * Create a PKCS#10 Certificate Signing Request.
 *
 * Builds CertificationRequestInfo DER by hand, signs it with the private key
 * (SHA-256), and wraps it as SEQUENCE { CRI, signatureAlgorithm, signature }.
 * No node-forge — only der.ts + node:crypto signing.
 */
export function createCsr(opts: CsrOptions): CsrResult {
  const privateKey = crypto.createPrivateKey({
    key: opts.keyPair.privateKey,
    format: 'der',
    type: 'pkcs8',
  });
  const keyType = privateKey.asymmetricKeyType;
  const isEc = keyType === 'ec';
  const sigAlgId = isEc ? ecdsaP256AlgId() : sha256WithRsaAlgId();

  const subject = buildName(opts.commonName, opts.organization, opts.country);
  // publicKey buffer is already SPKI DER — embed verbatim.
  const spki = Array.from(opts.keyPair.publicKey);
  const attributes = buildAttributes(opts.challengePassword, opts.extensions);

  const cri = SEQUENCE(
    INTEGER(0), // version
    subject,
    spki,
    attributes,
  );

  const criBuf = toBuffer(cri);
  const signature = crypto.sign('sha256', criBuf, privateKey);

  const csr = SEQUENCE(
    cri,
    sigAlgId,
    BIT_STRING(Array.from(signature)),
  );

  const csrBuf = toBuffer(csr);
  const pem = pemEncode(csrBuf, 'CERTIFICATE REQUEST');
  return { csr: csrBuf, pem };
}