import { createHmac, createHash } from 'node:crypto';

/** HMAC-SHA256 hex digest (Razorpay webhooks + PayU v2). */
export function hmacSha256Hex(key: string | Buffer, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

/** SHA-512 hex digest (PayU payment hash). */
export function sha512Hex(message: string): string {
  return createHash('sha512').update(message).digest('hex');
}

/** MD5 hex digest (Skrill Quick Checkout signature). */
export function md5Hex(message: string): string {
  return createHash('md5').update(message).digest('hex');
}

/** Constant-time string compare (webhook signature verification). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}