import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceContext {
  requestId: string;
  traceId: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

/** Start a trace context for the lifetime of `fn`, propagating request/trace ids. */
export function withTrace<R>(fn: () => R, existing?: Partial<TraceContext>): R {
  const ctx: TraceContext = {
    requestId: existing?.requestId ?? randomUUID(),
    traceId: existing?.traceId ?? randomUUID(),
  };
  return traceStorage.run(ctx, fn);
}

/** Current trace context, if any. */
export function currentTrace(): TraceContext | undefined {
  return traceStorage.getStore();
}

/** Generate a standalone id (for headers). */
export function newRequestId(): string {
  return randomUUID();
}