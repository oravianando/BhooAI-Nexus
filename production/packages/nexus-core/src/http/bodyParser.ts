import type { Middleware } from './context.js';
import { NexusError } from '../errors.js';

/** Read the full request body into a Buffer, capped at `limit` bytes. */
export function readBody(req: import('node:http').IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        reject(new NexusError('Request body too large', { code: 'BODY_TOO_LARGE', statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Body parser middleware: parses JSON, urlencoded, and multipart/form-data
 * (urlencoded + multipart use Node's querystring / a simple parser). For
 * multipart file uploads, populates `ctx.state.files` with { field, filename,
 * contentType, data } entries.
 */
export function bodyParser(limit = 1024 * 1024): Middleware {
  return async (ctx, next) => {
    const type = (ctx.headers['content-type'] ?? '').toString().split(';')[0]?.trim() ?? '';
    if (ctx.method === 'GET' || ctx.method === 'HEAD' || !type) {
      await next();
      return;
    }
    const buf = await readBody(ctx.req, limit);
    // Preserve the raw body for webhook signature verification (the parsed form
    // loses exact byte order/encoding that the gateway's signature was computed over).
    ctx.state.__rawBody = buf;
    try {
      if (type === 'application/json') {
        ctx.body = buf.length ? JSON.parse(buf.toString('utf8')) : undefined;
      } else if (type === 'application/x-www-form-urlencoded') {
        ctx.body = parseUrlEncoded(buf.toString('utf8'));
      } else if (type === 'text/plain') {
        ctx.body = buf.toString('utf8');
      } else if (type === 'multipart/form-data') {
        const { fields, files } = parseMultipart(buf, getBoundary(ctx.headers['content-type']?.toString() ?? ''));
        ctx.body = fields;
        ctx.state.files = files;
      } else {
        ctx.body = buf;
      }
    } catch {
      throw new NexusError('Invalid request body', { code: 'INVALID_BODY', statusCode: 400 });
    }
    await next();
  };
}

function getBoundary(contentType: string): string | undefined {
  const match = /boundary=("?)([^";]+)\1/.exec(contentType);
  return match?.[2];
}

export function parseUrlEncoded(input: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const pair of input.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq)).replace(/\+/g, ' ');
    const val = decodeURIComponent(eq === -1 ? '' : pair.slice(eq + 1)).replace(/\+/g, ' ');
    const existing = out[key];
    if (existing === undefined) out[key] = val;
    else if (Array.isArray(existing)) existing.push(val);
    else out[key] = [existing, val];
  }
  return out;
}

export interface UploadedFile {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

/** Minimal multipart/form-data parser sufficient for file uploads. */
export function parseMultipart(buf: Buffer, boundary?: string): {
  fields: Record<string, string>;
  files: UploadedFile[];
} {
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  if (!boundary) return { fields, files };
  const delim = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(buf, delim).slice(1); // drop preamble
  for (const part of parts) {
    if (part.length === 0 || part.toString('utf8').trim() === '--') continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.subarray(0, headerEnd).toString('utf8');
    const bodyBuf = part.subarray(headerEnd + 4, part.length - 2); // strip trailing \r\n
    const disposition = /Content-Disposition: form-data;[^\r\n]*/i.exec(headerStr)?.[0] ?? '';
    const name = /name="([^"]+)"/.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/.exec(disposition)?.[1];
    const contentType = /Content-Type: ([^\r\n]+)/i.exec(headerStr)?.[1]?.trim() ?? 'text/plain';
    if (!name) continue;
    if (filename !== undefined) {
      files.push({ field: name, filename, contentType, data: bodyBuf });
    } else {
      fields[name] = bodyBuf.toString('utf8');
    }
  }
  return { fields, files };
}

function splitBuffer(buf: Buffer, delim: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let start = 0;
  let idx = buf.indexOf(delim, start);
  while (idx !== -1) {
    out.push(buf.subarray(start, idx));
    start = idx + delim.length;
    idx = buf.indexOf(delim, start);
  }
  out.push(buf.subarray(start));
  return out;
}
