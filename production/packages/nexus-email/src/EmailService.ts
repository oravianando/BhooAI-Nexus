import type { EmailProvider, EmailInput, EmailResult, QueueBackend } from './types.js';
import { renderTemplate } from './providers.js';
import { TemplateEngine } from './TemplateEngine.js';

export interface EmailServiceOptions {
  provider: EmailProvider;
  templates?: TemplateEngine;
  /** Optional queue; when set, `queue()` enqueues and a worker drains it. */
  queue?: QueueBackend;
  /** Max send attempts per queued job (exponential backoff). */
  maxAttempts?: number;
}

/**
 * EmailService ties a provider + template engine + optional queue together.
 * `send()` renders (if a template is named) and sends immediately.
 * `queue()` enqueues for background delivery; `startWorker()` drains the queue
 * with retries (exponential backoff) until success or max attempts exhausted.
 */
export class EmailService {
  readonly provider: EmailProvider;
  private readonly templates?: TemplateEngine;
  private readonly queueBackend?: QueueBackend;
  private readonly maxAttempts: number;
  private running = false;

  constructor(opts: EmailServiceOptions) {
    this.provider = opts.provider;
    this.templates = opts.templates;
    this.queueBackend = opts.queue;
    this.maxAttempts = opts.maxAttempts ?? 3;
  }

  async send(input: EmailInput): Promise<EmailResult> {
    const rendered = this.templates ? renderTemplate(input, this.templates) : input;
    return this.provider.send(rendered);
  }

  async queue(input: EmailInput): Promise<void> {
    if (!this.queueBackend) throw new Error('[nexus-email] no queue configured');
    const rendered = this.templates ? renderTemplate(input, this.templates) : input;
    await this.queueBackend.push(rendered);
  }

  /** Start the background worker (idempotent). */
  startWorker(): void {
    if (!this.queueBackend || this.running) return;
    this.running = true;
    (this.queueBackend as any).subscribe?.((job: EmailInput) => this.processWithRetry(job));
  }

  /** Process a queued job with exponential backoff up to maxAttempts. */
  private async processWithRetry(job: EmailInput): Promise<void> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt < this.maxAttempts) {
      try {
        await this.provider.send(job);
        return;
      } catch (err) {
        lastErr = err;
        attempt++;
        if (attempt >= this.maxAttempts) break;
        const backoff = 250 * 2 ** (attempt - 1);
        await new Promise<void>((r) => setTimeout(r, backoff));
      }
    }
    // Give up; in production this should go to a dead-letter store.
    console.error(`[nexus-email] delivery failed after ${this.maxAttempts} attempts:`, (lastErr as Error)?.message);
  }

  async close(): Promise<void> {
    this.running = false;
    await this.queueBackend?.close();
  }
}