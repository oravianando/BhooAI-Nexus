/** Framework-wide error base class with a stable `code` for programmatic handling. */
export class NexusError extends Error {
  code: string;
  statusCode: number;
  details?: unknown;
  constructor(message: string, options: { code?: string; statusCode?: number; details?: unknown } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code ?? 'NEXUS_ERROR';
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}

export class ConfigError extends NexusError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'CONFIG_ERROR', statusCode: 500, details });
  }
}

export class ValidationError extends NexusError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400, details });
  }
}

export class AuthenticationError extends NexusError {
  constructor(message = 'Authentication required') {
    super(message, { code: 'AUTHENTICATION_ERROR', statusCode: 401 });
  }
}

export class AuthorizationError extends NexusError {
  constructor(message = 'Insufficient permissions') {
    super(message, { code: 'AUTHORIZATION_ERROR', statusCode: 403 });
  }
}

export class NotFoundError extends NexusError {
  constructor(message = 'Not found') {
    super(message, { code: 'NOT_FOUND', statusCode: 404 });
  }
}

export class ConflictError extends NexusError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'CONFLICT', statusCode: 409, details });
  }
}

export class PaymentError extends NexusError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'PAYMENT_ERROR', statusCode: 402, details });
  }
}

/** Normalize an unknown thrown value into a NexusError. */
export function toNexusError(err: unknown): NexusError {
  if (err instanceof NexusError) return err;
  if (err instanceof Error) return new NexusError(err.message, { code: 'NEXUS_ERROR' });
  return new NexusError(String(err));
}