/**
 * Minimal DER/ASN.1 encoder (hand-rolled, no external deps).
 *
 * Works in arrays of byte values (0-255) and flattens to a Buffer at the end.
 * This is sufficient to encode X.509 TBSCertificates and PKCS#10 CSRs.
 */

/** A working byte array. */
export type Byte = number[];

// --- Tag bytes for common ASN.1 types ---
const TAG_INTEGER = 0x02;
const TAG_BIT_STRING = 0x03;
const TAG_OCTET_STRING = 0x04;
const TAG_NULL = 0x05;
const TAG_BOOLEAN = 0x01;
const TAG_OID = 0x06;
const TAG_UTF8_STRING = 0x0c;
const TAG_SEQUENCE = 0x30;
const TAG_SET = 0x31;
const TAG_PRINTABLE_STRING = 0x13;
const TAG_IA5_STRING = 0x16;
const TAG_UTC_TIME = 0x17;
const TAG_GENERALIZED_TIME = 0x18;

/** DER length encoding: short form for <128, long form otherwise. */
export function encodeLen(n: number): number[] {
  if (n < 0) {
    throw new Error('DER length cannot be negative');
  }
  if (n < 0x80) {
    return [n];
  }
  // Long form: 0x80 | number of length bytes, then big-endian length bytes.
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = v >>> 8;
  }
  // Ensure we never produce a non-minimal long-form encoding (no leading 0).
  if (bytes.length === 0) bytes.push(0);
  if (bytes.length > 0x7f) {
    throw new Error('DER length too large');
  }
  return [0x80 | bytes.length, ...bytes];
}

/** Wrap content with a tag byte and DER length. */
export function tag(tagByte: number, content: number[]): number[] {
  return [tagByte, ...encodeLen(content.length), ...content];
}

/** INTEGER from a non-negative number or bigint (two's complement for negatives). */
export function INTEGER(n: number | bigint): number[] {
  if (typeof n === 'bigint') {
    return INTEGER_bigint(n);
  }
  if (!Number.isInteger(n)) {
    throw new Error('INTEGER requires an integer');
  }
  return INTEGER_bigint(BigInt(n));
}

function INTEGER_bigint(n: bigint): number[] {
  if (n === 0n) {
    return tag(TAG_INTEGER, [0x00]);
  }
  const bytes: number[] = [];
  const negative = n < 0n;
  if (negative) {
    // Two's complement of a negative bigint: we use a wide representation.
    // Find the smallest byte width that holds the magnitude, then invert.
    const magnitude = -n;
    let bits = 0n;
    let m = magnitude;
    while (m > 0n) {
      bits += 1n;
      m >>= 1n;
    }
    const width = Number((bits + 7n) / 8n) + 1; // extra byte to hold sign bit
    const mask = (1n << BigInt(width * 8)) - 1n;
    const twos = ((~magnitude) + 1n) & mask;
    let t = twos;
    for (let i = 0; i < width; i++) {
      bytes.unshift(Number(t & 0xffn));
      t >>= 8n;
    }
    // Trim leading 0xff only if next bit is set, etc. Keep minimal but signed.
    while (bytes.length > 1 && bytes[0] === 0xff && (bytes[1]! & 0x80) !== 0) {
      bytes.shift();
    }
    return tag(TAG_INTEGER, bytes);
  }
  // Positive: encode big-endian, prepend 0x00 if high bit set (so it stays positive).
  let v = n;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  if ((bytes[0]! & 0x80) !== 0) {
    bytes.unshift(0x00);
  }
  return tag(TAG_INTEGER, bytes);
}

/** BIT STRING with a leading unused-bits byte (default 0). */
export function BIT_STRING(content: number[], unusedBits = 0): number[] {
  return tag(TAG_BIT_STRING, [unusedBits, ...content]);
}

export function OCTET_STRING(content: number[]): number[] {
  return tag(TAG_OCTET_STRING, content);
}

export function NULL(): number[] {
  return tag(TAG_NULL, []);
}

/** BOOLEAN: 0x00 for false, 0xff for true. */
export function BOOLEAN(value: boolean): number[] {
  return tag(TAG_BOOLEAN, [value ? 0xff : 0x00]);
}

/** Parse a dotted OID string (e.g. "1.2.840.113549.1.1.11") into an arc array. */
export function oidFromString(s: string): number[] {
  return s.split('.').map((part) => {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Invalid OID arc: ${part}`);
    }
    return n;
  });
}

/** OID encoder: first two arcs packed as 40*a+b, rest base-128 with continuation. */
export function OID(arcs: number[]): number[] {
  if (arcs.length < 2) {
    throw new Error('OID needs at least 2 arcs');
  }
  const content: number[] = [];
  content.push(40 * arcs[0]! + arcs[1]!);
  for (let i = 2; i < arcs.length; i++) {
    const arc = arcs[i]!;
    if (arc < 0) throw new Error('OID arc cannot be negative');
    if (arc === 0) {
      content.push(0x00);
      continue;
    }
    const buf: number[] = [];
    let v = arc;
    while (v > 0) {
      buf.unshift(v & 0x7f);
      v = v >>> 7;
    }
    for (let j = 0; j < buf.length; j++) {
      if (j < buf.length - 1) {
        content.push(buf[j]! | 0x80);
      } else {
        content.push(buf[j]!);
      }
    }
  }
  return tag(TAG_OID, content);
}

export function SEQUENCE(...items: Byte[]): Byte {
  const flat: number[] = [];
  for (const it of items) flat.push(...it);
  return tag(TAG_SEQUENCE, flat);
}

export function SET(...items: Byte[]): Byte {
  const flat: number[] = [];
  for (const it of items) flat.push(...it);
  return tag(TAG_SET, flat);
}

function asciiBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    out.push(s.charCodeAt(i) & 0xff);
  }
  return out;
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** UTCTime: YYMMDDHHMMSSZ (used for years 1950-2049). */
export function UTCTime(date: Date): number[] {
  const yy = date.getUTCFullYear() % 100;
  const s =
    pad2(yy) +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z';
  return tag(TAG_UTC_TIME, asciiBytes(s));
}

/** GeneralizedTime: YYYYMMDDHHMMSSZ (used for years >= 2050). */
export function GeneralizedTime(date: Date): number[] {
  const s =
    String(date.getUTCFullYear()).padStart(4, '0') +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z';
  return tag(TAG_GENERALIZED_TIME, asciiBytes(s));
}

export function PrintableString(s: string): number[] {
  return tag(TAG_PRINTABLE_STRING, asciiBytes(s));
}

export function UTF8String(s: string): number[] {
  return tag(TAG_UTF8_STRING, Array.from(Buffer.from(s, 'utf8')));
}

export function IA5String(s: string): number[] {
  return tag(TAG_IA5_STRING, asciiBytes(s));
}

// --- Common OID constants (already tagged, ready to embed) ---
export const RSA_ENCRYPTION = OID([1, 2, 840, 113549, 1, 1, 1]);
export const SHA256_WITH_RSA = OID([1, 2, 840, 113549, 1, 1, 11]);
export const EC_PUBLIC_KEY = OID([1, 2, 840, 10045, 2, 1]);
export const ECDSA_P256 = OID([1, 2, 840, 10045, 4, 3, 2]);
export const PRIME256V1 = OID([1, 2, 840, 10045, 3, 1, 7]);
export const COMMON_NAME = OID([2, 5, 4, 3]);
export const ORG = OID([2, 5, 4, 10]);
export const COUNTRY = OID([2, 5, 4, 6]);
export const EXTENSION_REQUEST = OID([1, 2, 840, 113549, 1, 9, 14]);
export const CHALLENGE_PASSWORD = OID([1, 2, 840, 113549, 1, 9, 7]);

/** AlgorithmIdentifier SEQUENCE { OID, NULL } for RSA-SHA256. */
export function sha256WithRsaAlgId(): number[] {
  return SEQUENCE(SHA256_WITH_RSA, NULL());
}

/** AlgorithmIdentifier SEQUENCE { OID, curveName OID } for ECDSA P-256. */
export function ecdsaP256AlgId(): number[] {
  return SEQUENCE(ECDSA_P256);
}

/** Flatten a byte array into a Buffer. */
export function toBuffer(bytes: number[]): Buffer {
  return Buffer.from(bytes);
}

/** Debug helper: render a byte array as hex. */
export function hex(bytes: number[]): string {
  return bytes
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}