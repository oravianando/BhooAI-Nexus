import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { Middleware } from './context.js';
import { NotFoundError } from '../errors.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
};

/** Serve static files from `root`. Safe against path traversal. */
export function serveStatic(root: string, options: { index?: string; prefix?: string } = {}): Middleware {
  const index = options.index ?? 'index.html';
  const prefix = normalizePrefix(options.prefix);
  return async (ctx, next) => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      await next();
      return;
    }
    if (prefix && ctx.path !== prefix && !ctx.path.startsWith(`${prefix}/`)) {
      await next();
      return;
    }
    const requestPath = prefix ? ctx.path.slice(prefix.length) || '/' : ctx.path;
    const safe = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(root, safe);
    if (isOutside(root, filePath)) {
      throw new NotFoundError();
    }
    if (!existsSync(filePath)) {
      await next();
      return;
    }
    const initialStat = statSync(filePath);
    if (initialStat.isDirectory()) {
      filePath = join(filePath, index);
      if (!existsSync(filePath)) {
        await next();
        return;
      }
    }
    const stat = statSync(filePath);
    const ext = extname(filePath).toLowerCase();
    ctx.setHeader('content-type', MIME[ext] ?? 'application/octet-stream');
    ctx.setHeader('content-length', String(stat.size));
    ctx.setHeader('etag', `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`);
    if (ctx.method === 'HEAD') {
      ctx.status(200);
      return;
    }
    await new Promise<void>((resolveStream, rejectStream) => {
      const stream = createReadStream(filePath);
      stream.on('error', rejectStream);
      stream.on('end', resolveStream);
      stream.pipe(ctx.res);
    });
  };
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix || prefix === '/') return '';
  return `/${prefix.replace(/^\/+|\/+$/g, '')}`;
}

function isOutside(root: string, target: string): boolean {
  const rel = normalize(target).split(sep);
  const base = normalize(root).split(sep);
  return !normalize(target).startsWith(normalize(root) + sep) && normalize(target) !== normalize(root);
}
