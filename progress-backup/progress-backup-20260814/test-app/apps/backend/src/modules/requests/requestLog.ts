import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { WriteStream } from 'node:fs';

/**
 * Datewise, append-only HTTP request log.
 *
 * Each request is written as a single JSON line to a date-stamped file
 * (`requests-YYYY-MM-DD.log`) inside the project's logging dir, so a day's
 * traffic is easy to inspect and long ranges can be aggregated on the fly.
 *
 * Written by the backend request middleware (main.ts) and read by the admin
 * endpoints under /admin/requests (adminRoutes.ts).
 */

export interface RequestLogEntry {
  time: number;
  method: string;
  path: string;
  url?: string;
  status: number;
  durationMs: number;
  ip?: string;
  referer?: string;
  userAgent?: string;
  origin?: string;
  requestId?: string;
  route?: string;
}

export type RequestSeriesRange = 'today' | '5d' | 'week' | 'month' | 'year';

export interface RequestSeries {
  range: RequestSeriesRange;
  bucketMs: number;
  start: number;
  end: number;
  total: number;
  points: Array<{ t: number; count: number }>;
}

let stream: WriteStream | null = null;
let streamDate = '';
let streamDir = '';

function dateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fileNameFor(date: string): string {
  return `requests-${date}.log`;
}

function ensureStream(dir: string, date: string): WriteStream {
  if (stream && streamDate === date && streamDir === dir) return stream;
  if (stream) {
    stream.end();
    stream = null;
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  stream = createWriteStream(join(dir, fileNameFor(date)), { flags: 'a' });
  stream.on('error', () => {
    stream = null;
  });
  streamDate = date;
  streamDir = dir;
  return stream;
}

/** Append one JSON line for a completed request. Safe to call from the hot path. */
export function appendRequestLog(dir: string, entry: RequestLogEntry): void {
  try {
    ensureStream(dir, dateKey()).write(JSON.stringify(entry) + '\n');
  } catch {
    // never let logging break the request path
  }
}

/** Close the active stream (used on shutdown). */
export function closeRequestLog(): void {
  if (stream) {
    stream.end();
    stream = null;
  }
}

function listLogFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^requests-\d{4}-\d{2}-\d{2}\.log$/.test(f))
    .sort();
}

function fileDate(file: string): number {
  const match = /^requests-(\d{4}-\d{2}-\d{2})\.log$/.exec(file);
  if (!match) return 0;
  return Date.parse(match[1]);
}

function readEntries(dir: string, from: number): RequestLogEntry[] {
  const out: RequestLogEntry[] = [];
  for (const file of listLogFiles(dir)) {
    if (fileDate(file) < from) continue;
    let text: string;
    try {
      text = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as RequestLogEntry;
        if (typeof e.time === 'number' && e.time >= from) out.push(e);
      } catch {
        // skip malformed lines
      }
    }
  }
  return out;
}

const RANGE_PARAMS: Record<RequestSeriesRange, { bucketMs: number; back: number }> = {
  today: { bucketMs: 5 * 60_000, back: 24 * 60 * 60_000 },
  '5d': { bucketMs: 60 * 60_000, back: 5 * 24 * 60 * 60_000 },
  week: { bucketMs: 6 * 60 * 60_000, back: 7 * 24 * 60 * 60_000 },
  month: { bucketMs: 24 * 60 * 60_000, back: 31 * 24 * 60 * 60_000 },
  year: { bucketMs: 7 * 24 * 60 * 60_000, back: 365 * 24 * 60 * 60_000 },
};

/** Aggregate request logs into coarse buckets for the requested range. */
export function readRequestSeries(dir: string, range: RequestSeriesRange): RequestSeries {
  const { bucketMs, back } = RANGE_PARAMS[range];
  const end = Date.now();
  const start = end - back;
  const entries = readEntries(dir, start);
  const buckets = new Map<number, number>();
  let total = 0;
  for (const e of entries) {
    const idx = Math.floor((e.time - start) / bucketMs);
    buckets.set(idx, (buckets.get(idx) ?? 0) + 1);
    total += 1;
  }
  const points = [...buckets.entries()]
    .map(([idx, count]) => ({ t: start + idx * bucketMs, count }))
    .sort((a, b) => a.t - b.t);
  return { range, bucketMs, start, end, total, points };
}

/** Tail the newest request entries, reading back across days to satisfy the limit. */
export function tailRequestLogs(dir: string, limit: number): RequestLogEntry[] {
  const out: RequestLogEntry[] = [];
  const files = listLogFiles(dir).reverse();
  for (const file of files) {
    if (out.length >= limit) break;
    try {
      const text = readFileSync(join(dir, file), 'utf8');
      const lines = text.split('\n').filter((l) => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          out.push(JSON.parse(lines[i]) as RequestLogEntry);
        } catch {
          // skip
        }
        if (out.length >= limit) break;
      }
    } catch {
      continue;
    }
  }
  return out;
}
