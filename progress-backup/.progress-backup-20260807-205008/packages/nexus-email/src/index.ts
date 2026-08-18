export * from './types.js';
export * from './TemplateEngine.js';
export * from './providers.js';
export * from './queue.js';
export * from './EmailService.js';

import { SmtpProvider, LogProvider } from './providers.js';
import { TemplateEngine } from './TemplateEngine.js';
import { EmailService, type EmailServiceOptions } from './EmailService.js';
import type { EmailProvider, QueueBackend } from './types.js';

export interface EmailConfigLike {
  provider: 'smtp' | 'log';
  smtp?: { host: string; port: number; secure: boolean; user: string; pass: string };
  from: string;
}

export interface CreateEmailOptions {
  /** Inject a custom provider (tests). */
  provider?: EmailProvider;
  /** Inject a queue backend (default: none → send is synchronous only). */
  queue?: QueueBackend;
  templates?: TemplateEngine;
  maxAttempts?: number;
}

/**
 * Build an EmailService from the `email` config section. `provider: 'log'`
 * never sends (dev/test); `provider: 'smtp'` uses nodemailer with the smtp config.
 */
export function createEmail(config: EmailConfigLike, opts: CreateEmailOptions = {}): EmailService {
  const provider: EmailProvider = opts.provider
    ?? (config.provider === 'smtp' && config.smtp
      ? new SmtpProvider(config.smtp)
      : new LogProvider());
  return new EmailService({ provider, templates: opts.templates, queue: opts.queue, maxAttempts: opts.maxAttempts });
}