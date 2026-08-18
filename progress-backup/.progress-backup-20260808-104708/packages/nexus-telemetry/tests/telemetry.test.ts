import { describe, it, expect, beforeEach } from 'vitest';
import { Logger, createLogger, MetricsRegistry, withTrace, currentTrace } from '../src/index.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';

describe('Logger', () => {
  it('respects level filtering (silent below threshold)', () => {
    const sink: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => { sink.push(String(chunk)); return true; };
    try {
      const log = createLogger({ level: 'warn', console: true });
      log.info('should-not-appear');
      log.warn('should-appear');
    } finally {
      process.stdout.write = orig;
    }
    expect(sink.join('')).not.toContain('should-not-appear');
    expect(sink.join('')).toContain('should-appear');
  });

  it('redacts configured fields', () => {
    const sink: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => { sink.push(String(chunk)); return true; };
    try {
      const log = createLogger({ level: 'debug', console: true, redact: ['password'], format: 'json' });
      log.info('login', { password: 'secret', user: 'alice' });
    } finally {
      process.stdout.write = orig;
    }
    const line = sink.join('');
    expect(line).toContain('[REDACTED]');
    expect(line).not.toContain('secret');
    expect(line).toContain('alice');
  });

  it('writes to a rotating file transport', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-log-'));
    try {
      const log = new Logger({ level: 'info', console: false, file: { dir, maxFileSize: 1_000_000, maxFiles: 3 } });
      log.info('file-message', { n: 1 });
      await log.close();
      // give the OS a tick to flush the final write
      await new Promise((r) => setTimeout(r, 50));
      const content = readFileSync(join(dir, 'nexus.log'), 'utf8');
      expect(content).toContain('file-message');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('MetricsRegistry', () => {
  let m: MetricsRegistry;
  beforeEach(() => { m = new MetricsRegistry(); });

  it('increments counters with labels', () => {
    m.inc('http_requests', 1, { route: '/health', method: 'GET' });
    m.inc('http_requests', 1, { route: '/health', method: 'GET' });
    const json = m.toJSON()['http_requests'] as { values: Record<string, number> };
    expect(json.values['{method="GET",route="/health"}']).toBe(2);
  });

  it('observes histograms into buckets', () => {
    m.observe('latency', 0.02, { route: '/x' });
    m.observe('latency', 0.5, { route: '/x' });
    const prom = m.toPrometheus();
    expect(prom).toContain('latency_bucket');
    expect(prom).toContain('latency_sum');
    expect(prom).toContain('latency_count');
  });
});

describe('trace', () => {
  it('propagates context through async locals', () => {
    withTrace(() => {
      expect(currentTrace()?.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    });
    expect(currentTrace()).toBeUndefined();
  });
});