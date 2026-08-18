import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EOL } from 'node:os';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface LogRecord {
  level: LogLevel;
  time: number;
  msg: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: 'json' | 'pretty';
  console?: boolean;
  /** File transport settings. */
  file?: { dir: string; maxFileSize: number; maxFiles: number };
  /** Field names to redact (replaced with [REDACTED]). */
  redact?: string[];
  /** Default bindings applied to every record. */
  bindings?: Record<string, unknown>;
}

const COLORS: Record<LogLevel, string> = {
  trace: '\x1b[90m',
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[35m',
};
const RESET = '\x1b[0m';

/** Inbuilt structured logger with JSON/pretty formatting, redaction, and rotating file transport. */
export class Logger {
  private opts: Required<Pick<LoggerOptions, 'level' | 'format' | 'console' | 'redact'>> & {
    file?: NonNullable<LoggerOptions['file']>;
    bindings: Record<string, unknown>;
  };
  private stream: NodeJS.WritableStream | null = null;
  private currentSize = 0;

  constructor(opts: LoggerOptions = {}) {
    this.opts = {
      level: opts.level ?? 'info',
      format: opts.format ?? 'pretty',
      console: opts.console ?? true,
      redact: opts.redact ?? [],
      file: opts.file,
      bindings: opts.bindings ?? {},
    };
    if (this.opts.file) this.openStream(this.opts.file);
  }

  private openStream(file: NonNullable<LoggerOptions['file']>): void {
    if (!existsSync(file.dir)) mkdirSync(file.dir, { recursive: true });
    const target = join(file.dir, 'nexus.log');
    try {
      this.currentSize = existsSync(target) ? statSync(target).size : 0;
    } catch {
      this.currentSize = 0;
    }
    this.stream = createWriteStream(target, { flags: 'a' });
    this.stream.on('error', () => {
      this.stream = null;
    });
  }

  child(bindings: Record<string, unknown>): Logger {
    return new Logger({
      level: this.opts.level,
      format: this.opts.format,
      console: this.opts.console,
      file: this.opts.file,
      redact: this.opts.redact,
      bindings: { ...this.opts.bindings, ...bindings },
    });
  }

  setLevel(level: LogLevel): void {
    this.opts.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.opts.level];
  }

  log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    const record: LogRecord = {
      level,
      time: Date.now(),
      msg,
      ...this.opts.bindings,
      ...(data ?? {}),
    };
    const safe = this.redactFields(record);
    const line = this.opts.format === 'json' ? JSON.stringify(safe) : this.pretty(safe);
    this.write(line + EOL, level);
  }

  private redactFields(record: LogRecord): LogRecord {
    if (this.opts.redact.length === 0) return record;
    const out: LogRecord = { ...record };
    for (const key of this.opts.redact) {
      if (key in out) out[key] = '[REDACTED]';
    }
    return out;
  }

  private pretty(rec: LogRecord): string {
    const time = new Date(rec.time).toISOString();
    const levelTag = `${COLORS[rec.level]}${rec.level.toUpperCase().padEnd(5)}${RESET}`;
    const base = Object.fromEntries(
      Object.entries(rec).filter(([k]) => k !== 'level' && k !== 'time' && k !== 'msg'),
    );
    const payload = Object.keys(base).length ? ` ${JSON.stringify(base)}` : '';
    return `${time} ${levelTag} ${rec.msg}${payload}`;
  }

  private write(line: string, level: LogLevel): void {
    if (this.opts.console) {
      if (level === 'error' || level === 'fatal') process.stderr.write(line);
      else process.stdout.write(line);
    }
    if (this.stream && this.opts.file) {
      this.currentSize += Buffer.byteLength(line);
      this.stream.write(line);
      if (this.currentSize >= this.opts.file.maxFileSize) this.rotate();
    }
  }

  private rotate(): void {
    const file = this.opts.file!;
    const target = join(file.dir, 'nexus.log');
    if (!existsSync(target)) return;
    this.stream?.end();
    for (let i = file.maxFiles - 1; i > 0; i--) {
      const from = join(file.dir, `nexus.${i - 1}.log`);
      const to = join(file.dir, `nexus.${i}.log`);
      if (existsSync(from)) renameSync(from, to);
    }
    renameSync(target, join(file.dir, 'nexus.0.log'));
    this.currentSize = 0;
    this.stream = createWriteStream(target, { flags: 'a' });
  }

  // Convenience level methods
  trace(msg: string, data?: Record<string, unknown>): void { this.log('trace', msg, data); }
  debug(msg: string, data?: Record<string, unknown>): void { this.log('debug', msg, data); }
  info(msg: string, data?: Record<string, unknown>): void { this.log('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>): void { this.log('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>): void { this.log('error', msg, data); }
  fatal(msg: string, data?: Record<string, unknown>): void { this.log('fatal', msg, data); }

  /** Flush file transport. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.stream) this.stream.end(() => resolve());
      else resolve();
    });
  }
}

/** A no-op file-less logger for tests / library contexts. */
export function createLogger(opts?: LoggerOptions): Logger {
  return new Logger({ console: false, ...opts });
}