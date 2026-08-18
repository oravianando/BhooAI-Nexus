/// <reference path="./bcryptjs.d.ts" />

import bcrypt from 'bcryptjs';

/**
 * Password hashing using `bcryptjs` (pure-JavaScript, API-compatible with the
 * native `bcrypt` binding). The pure-JS implementation is chosen deliberately
 * so the framework builds on Windows without node-gyp / native toolchains;
 * the cost parameter below keeps it within practical latency budgets.
 */
const DEFAULT_ROUNDS = 12;

/** Hash a plaintext password with a salt cost of `rounds`. */
export async function hashPassword(plaintext: string, rounds = DEFAULT_ROUNDS): Promise<string> {
  if (!plaintext || typeof plaintext !== 'string') throw new Error('Password must be a non-empty string.');
  const salt = await bcrypt.genSalt(rounds);
  return bcrypt.hash(plaintext, salt);
}

/** Verify a plaintext password against a previously-hashed value. */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/** True if `hash` looks like a bcrypt hash (so we can detect legacy / plaintext). */
export function isBcryptHash(hash: string): boolean {
  return /^\$2[abxy]\$\d{2}\$/.test(hash);
}
