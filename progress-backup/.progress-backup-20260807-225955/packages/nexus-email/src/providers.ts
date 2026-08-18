import nodemailer, { type Transport } from 'nodemailer';
import type { EmailProvider, EmailInput, EmailResult } from './types.js';
import { TemplateEngine } from './TemplateEngine.js';

/** SMTP provider backed by nodemailer. The transport is injectable for tests. */
export class SmtpProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly transport: { sendMail: (opts: any) => Promise<unknown> };

  constructor(
    opts: {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
    },
    /** Inject a custom nodemailer Transport (tests use `jsonTransport`). */
    customTransport?: Transport,
  ) {
    this.transport = customTransport
      ? nodemailer.createTransport(customTransport as any)
      : nodemailer.createTransport({ host: opts.host, port: opts.port, secure: opts.secure, auth: { user: opts.user, pass: opts.pass } });
  }

  async send(input: EmailInput): Promise<EmailResult> {
    const res = (await this.transport.sendMail({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
      replyTo: input.replyTo,
      headers: input.headers,
    })) as { messageId?: string; envelope?: unknown };
    return { messageId: res.messageId, envelope: res.envelope, raw: res, input };
  }
}

/**
 * Log provider: writes the email to the logger instead of sending it. Used when
 * `config.email.provider === 'log'` (dev/test) so the app runs without SMTP.
 */
export class LogProvider implements EmailProvider {
  readonly name = 'log';
  private readonly log: (line: string) => void;
  constructor(log?: (line: string) => void) {
    this.log = log ?? ((line) => console.log(`[nexus-email] ${line}`));
  }
  async send(input: EmailInput): Promise<EmailResult> {
    this.log(JSON.stringify({ name: input.to, subject: input.subject, text: input.text ?? input.html }));
    return { messageId: `log-${Date.now()}`, input };
  }
}

/** Render an EmailInput's template (if any) against the provided engine. */
export function renderTemplate(input: EmailInput, engine: TemplateEngine): EmailInput {
  if (!input.template) return input;
  const html = engine.render(input.template, input.vars ?? {});
  return { ...input, html: input.html ?? html, subject: /\{\{/.test(input.subject) ? engine.renderString(input.subject, input.vars ?? {}) : input.subject };
}