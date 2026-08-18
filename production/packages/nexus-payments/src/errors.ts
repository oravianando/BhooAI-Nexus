/** Payment-domain error. `code` is machine-readable; `provider` names the gateway. */
export class PaymentError extends Error {
  readonly code: string;
  readonly provider: string;
  readonly status?: number;
  readonly raw?: unknown;
  constructor(message: string, opts: { code: string; provider: string; status?: number; raw?: unknown }) {
    super(message);
    this.name = 'PaymentError';
    this.code = opts.code;
    this.provider = opts.provider;
    this.status = opts.status;
    this.raw = opts.raw;
  }
}