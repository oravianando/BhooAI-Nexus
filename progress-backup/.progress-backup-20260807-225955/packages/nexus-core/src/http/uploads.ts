import { mkdir, writeFile } from 'node:fs/promises';
import { extname, basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Router } from './Router.js';
import type { Middleware, RequestContext } from './context.js';
import type { UploadedFile } from './bodyParser.js';
import { ValidationError } from '../errors.js';

export interface UploadRouteOptions {
  /** Directory where uploaded files are persisted. */
  directory: string;
  /** POST endpoint that accepts multipart/form-data. */
  path?: string;
  /** Public URL prefix returned for saved files. */
  publicPath?: string;
  /** Maximum size of an individual file. */
  maxFileSize?: number;
  /** Maximum number of files accepted in one request. */
  maxFiles?: number;
  /** Empty means all MIME types are accepted. */
  allowedTypes?: string[];
  /** Optional route middleware, such as authentication. */
  middleware?: Middleware[];
}

export interface SavedUpload {
  field: string;
  originalName: string;
  filename: string;
  contentType: string;
  size: number;
  url: string;
}

/** Register a safe multipart upload endpoint backed by a local directory. */
export function registerUploadRoutes(router: Router, options: UploadRouteOptions): void {
  const path = options.path ?? '/uploads';
  const publicPath = (options.publicPath ?? path).replace(/\/$/, '');
  const maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 20;
  const allowedTypes = new Set(options.allowedTypes ?? []);
  const directory = resolve(options.directory);

  router.post(path, async (ctx) => {
    const files = (ctx.state.files as UploadedFile[] | undefined) ?? [];
    if (files.length === 0) throw new ValidationError('At least one file is required');
    if (files.length > maxFiles) throw new ValidationError(`A maximum of ${maxFiles} files may be uploaded`);

    for (const file of files) {
      if (file.data.length > maxFileSize) {
        throw new ValidationError(`File "${file.filename}" exceeds the ${maxFileSize}-byte limit`);
      }
      if (allowedTypes.size > 0 && !allowedTypes.has(file.contentType)) {
        throw new ValidationError(`File type "${file.contentType}" is not allowed`);
      }
    }

    await mkdir(directory, { recursive: true });
    const saved: SavedUpload[] = [];
    for (const file of files) {
      const extension = safeExtension(file.filename);
      const filename = `${randomUUID()}${extension}`;
      await writeFile(join(directory, filename), file.data, { flag: 'wx' });
      saved.push({
        field: file.field,
        originalName: basename(file.filename),
        filename,
        contentType: file.contentType,
        size: file.data.length,
        url: `${publicPath}/${filename}`,
      });
    }
    ctx.json({ files: saved }, 201);
  }, options.middleware ?? []);
}

function safeExtension(filename: string): string {
  const extension = extname(basename(filename)).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

/** Type guard useful to route handlers that consume parsed multipart state. */
export function uploadedFiles(ctx: RequestContext): UploadedFile[] {
  return (ctx.state.files as UploadedFile[] | undefined) ?? [];
}
