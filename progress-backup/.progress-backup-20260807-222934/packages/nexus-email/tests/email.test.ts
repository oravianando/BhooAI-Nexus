import { describe, it, expect } from 'vitest';
import nodemailer from 'nodemailer';
import {
  TemplateEngine,
  SmtpProvider,
  LogProvider,
  MemoryQueue,
  EmailService,
  createEmail,
  renderTemplate,
  type EmailInput,
} from '../src/index.js';

/** A capturing log provider for assertions. */
function capturingLog(): { provider: LogProvider; lines: string[] } {
  const lines: string[] = [];
  return { provider: new LogProvider((l) => lines.push(l)), lines };
}

describe('TemplateEngine', () => {
  it('interpolates {{var}} and nested paths', () => {
    const e = new TemplateEngine();
    expect(e.renderString('Hi {{user.name}}, {{x}}!', { user: { name: 'Al' }, x: 1 })).toBe('Hi Al, 1!');
  });
  it('renders #if / #else', () => {
    const e = new TemplateEngine();
    expect(e.renderString('{{#if ok}}yes{{else}}no{{/if}}', { ok: true })).toBe('yes');
    expect(e.renderString('{{#if ok}}yes{{else}}no{{/if}}', { ok: false })).toBe('no');
  });
  it('renders #each with {{this}}', () => {
    const e = new TemplateEngine();
    expect(e.renderString('{{#each items}}[{{this}}]{{/each}}', { items: ['a', 'b', 'c'] })).toBe('[a][b][c]');
  });
  it('registered templates render with vars', () => {
    const e = new TemplateEngine();
    e.register('welcome', 'Hello {{name}}!');
    expect(e.render('welcome', { name: 'Bob' })).toBe('Hello Bob!');
  });
  it('throws on unknown template', () => {
    expect(() => new TemplateEngine().render('nope', {})).toThrow(/unknown template/);
  });
});

describe('LogProvider', () => {
  it('logs the email and returns a messageId', async () => {
    const { provider, lines } = capturingLog();
    const res = await provider.send({ to: 'a@x.com', subject: 'Hi', text: 'body' });
    expect(res.messageId).toMatch(/^log-/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('a@x.com');
    expect(lines[0]).toContain('Hi');
  });
});

describe('SmtpProvider', () => {
  it('sends via a jsonTransport (no network) and returns a messageId', async () => {
    const provider = new SmtpProvider({ host: 'localhost', port: 25, secure: false, user: 'u', pass: 'p' }, { jsonTransport: true } as any);
    const res = await provider.send({ to: 'a@x.com', subject: 'Hi', html: '<b>hi</b>' });
    expect(res.messageId).toBeDefined();
    expect(res.raw).toBeDefined();
  });

  it('nodemailer jsonTransport round-trip via createTransport directly', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const info = await transport.sendMail({ to: 'a@x.com', subject: 'x', html: '<b>x</b>' });
    expect(info.messageId).toBeDefined();
  });
});

describe('renderTemplate', () => {
  it('renders html + subject from a named template', () => {
    const e = new TemplateEngine();
    e.register('receipt', 'Hi {{name}}, your order {{order}} is confirmed');
    const input: EmailInput = { to: 'a@x.com', subject: 'Order {{order}}', template: 'receipt', vars: { name: 'Al', order: '42' } };
    const out = renderTemplate(input, e);
    expect(out.html).toBe('Hi Al, your order 42 is confirmed');
    expect(out.subject).toBe('Order 42');
  });
});

describe('EmailService (queue + retry)', () => {
  it('send() renders template and delegates to provider', async () => {
    const e = new TemplateEngine();
    e.register('welcome', 'Hello {{name}}');
    const { provider, lines } = capturingLog();
    const svc = new EmailService({ provider, templates: e });
    await svc.send({ to: 'a@x.com', subject: 's', template: 'welcome', vars: { name: 'Zed' } });
    expect(lines[0]).toContain('Hello Zed');
  });

  it('queue + worker delivers once, with retries on failure', async () => {
    let calls = 0;
    const provider = { name: 'flaky', async send() { calls++; if (calls < 2) throw new Error('boom'); return { input: {} as EmailInput }; } };
    const queue = new MemoryQueue(20);
    const svc = new EmailService({ provider: provider as any, queue, maxAttempts: 3 });
    svc.startWorker();
    await svc.queue({ to: 'a@x.com', subject: 's', text: 't' });
    await new Promise<void>((r) => setTimeout(r, 400)); // let the worker drain + retry
    expect(calls).toBe(2); // failed once, succeeded on retry
    await svc.close();
  });

  it('gives up after maxAttempts', async () => {
    let calls = 0;
    const provider = { name: 'dead', async send() { calls++; throw new Error('always'); } };
    const queue = new MemoryQueue(20);
    const svc = new EmailService({ provider: provider as any, queue, maxAttempts: 2 });
    svc.startWorker();
    await svc.queue({ to: 'a@x.com', subject: 's', text: 't' });
    await new Promise<void>((r) => setTimeout(r, 800));
    expect(calls).toBe(2);
    await svc.close();
  });
});

describe('createEmail factory', () => {
  it('uses LogProvider when provider === "log"', () => {
    const svc = createEmail({ provider: 'log', from: 'x@x.com' });
    expect(svc.provider.name).toBe('log');
  });
  it('uses SmtpProvider when provider === "smtp"', () => {
    const svc = createEmail({ provider: 'smtp', smtp: { host: 'h', port: 587, secure: false, user: 'u', pass: 'p' }, from: 'x@x.com' });
    expect(svc.provider.name).toBe('smtp');
  });
});