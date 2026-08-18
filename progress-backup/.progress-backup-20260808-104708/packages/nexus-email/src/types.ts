/** Email-domain types shared by providers, templates, and the service. */

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
  /** Path to a file on disk (alternative to inline `content`). */
  path?: string;
}

export interface EmailInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  /** HTML body. */
  html?: string;
  /** Plain-text body. */
  text?: string;
  /** Named template to render (used by EmailService, not providers directly). */
  template?: string;
  /** Variables for the template. */
  vars?: Record<string, unknown>;
  attachments?: EmailAttachment[];
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface EmailResult {
  /** Provider message id. */
  messageId?: string;
  /** Provider response envelope (nodemailer). */
  envelope?: unknown;
  /** Raw response for debugging. */
  raw?: unknown;
  /** The input that was sent (for queue/audit). */
  input: EmailInput;
}

export interface EmailProvider {
  readonly name: string;
  send(input: EmailInput): Promise<EmailResult>;
}

/** Generic send-queue backend (memory or Redis). */
export interface QueueBackend {
  push(job: EmailInput): Promise<void>;
  close(): Promise<void>;
}