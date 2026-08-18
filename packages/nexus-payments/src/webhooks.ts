import type { RequestContext, Handler } from '@bhooai/nexus-core/http';
import type { PaymentProvider, WebhookEvent } from './types.js';

/**
 * Webhook router: mounts on a route like `/payments/webhook/:provider` and
 * dispatches the raw body to the named provider's `verifyWebhook`. Verified
 * events are handed to `onEvent` (the app's business logic); unverified events
 * are rejected with 401. The handler always responds 200 to the gateway once the
 * event is accepted (so it isn't retried), or 401 on bad signatures.
 */
export class WebhookRouter {
  private readonly providers: Map<string, PaymentProvider>;
  private readonly onEvent: (event: WebhookEvent) => Promise<void> | void;

  constructor(providers: Map<string, PaymentProvider>, onEvent: (event: WebhookEvent) => Promise<void> | void) {
    this.providers = providers;
    this.onEvent = onEvent;
  }

  /** nexus-core Handler for `POST /payments/webhook/:provider`. */
  handler: Handler = async (ctx) => {
    const providerName = ctx.params.provider;
    const provider = providerName ? this.providers.get(providerName) : undefined;
    if (!provider) {
      ctx.json({ error: `unknown provider: ${providerName}` }, 404);
      return;
    }
    // The body parser may have parsed JSON/form; webhooks need the RAW body for
    // signature verification. The bodyParser stores the original string under
    // state.__rawBody when available; fall back to re-serializing the parsed body.
    const rawBody = (ctx.state.__rawBody as string | Buffer | undefined) ?? serializeBody(ctx.body);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(ctx.headers)) {
      if (typeof v === 'string') headers[k] = v;
      else if (Array.isArray(v) && v.length) headers[k] = v[0]!;
    }
    const event = await provider.verifyWebhook({ rawBody, headers, params: ctx.params });
    if (!event.verified) {
      ctx.json({ error: 'signature verification failed' }, 401);
      return;
    }
    try {
      await this.onEvent(event);
    } catch (err) {
      // Log but still ACK so the gateway doesn't retry; the app should persist + retry internally.
      ctx.json({ ok: false, error: (err as Error).message }, 200);
      return;
    }
    ctx.json({ ok: true }, 200);
  };
}

function serializeBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString();
  if (body == null) return '';
  try { return JSON.stringify(body); } catch { return String(body); }
}
