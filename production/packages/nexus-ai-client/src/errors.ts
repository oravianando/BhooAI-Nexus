/** AI client errors. */

export class AiError extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = opts.status;
    this.code = opts.code;
  }
}

/** True for transient errors worth retrying: network failures + 5xx + 429. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof AiError) {
    if (err.status === undefined) return true; // network-level failure
    return err.status >= 500 || err.status === 429;
  }
  return true;
}