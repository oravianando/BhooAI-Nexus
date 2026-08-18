import type { Router, NexusConfig } from '@bhooai/nexus-core';
import type { PaymentsService } from '@bhooai/nexus-payments';
import { authToken, type AuthService } from '@bhooai/nexus-auth';
import { upsertOrder } from './paymentStore.js';

/**
 * Phase 11 — browser-facing checkout routes. The browser creates an order and
 * (for hosted-checkout providers) is redirected to `paymentUrl`; for direct
 * providers the client confirms capture via a second call. Webhooks remain the
 * source of truth (mounted separately in main.ts).
 *
 * Routes:
 *   POST /payments/order          — create an order with a named provider
 *   POST /payments/order/:id/capture — capture an authorized order
 *   GET  /payments/order/:id         — get order status (provider in query)
 */
export function registerPaymentRoutes(
  router: Router,
  config: NexusConfig,
  payments: PaymentsService,
  authService: AuthService,
): void {
  const guard = [authToken(authService, { cookieName: config.auth.cookieName, allowCookie: true })];

  router.post(
    '/payments/order',
    async (ctx) => {
      const body = ctx.body as { provider?: string; amount?: number; currency?: string; reference?: string; description?: string; returnUrl?: string; cancelUrl?: string } | undefined;
      const providerName = (body?.provider ?? '').toLowerCase();
      const provider = payments.providers.get(providerName);
      if (!provider) {
        ctx.json({ error: `Unknown or disabled provider: ${providerName}. Enabled: ${[...payments.providers.keys()].join(', ') || 'none'}` }, 400);
        return;
      }
      if (typeof body?.amount !== 'number' || body.amount <= 0) {
        ctx.json({ error: 'amount (major units, > 0) is required' }, 400);
        return;
      }
      const origin = `http${config.server.https ? 's' : ''}://${ctx.headers.host}`;
      let order;
      try {
        order = await provider.createOrder({
          amount: body.amount,
          currency: body.currency ?? 'USD',
          reference: body.reference ?? `nx_${Date.now()}`,
          description: body.description,
          returnUrl: body.returnUrl ?? `${origin}/checkout/return`,
          cancelUrl: body.cancelUrl ?? `${origin}/checkout/cancel`,
        });
      } catch (e) {
        ctx.json({ error: `${providerName} order failed: ${(e as Error).message}` }, 502);
        return;
      }
      await upsertOrder(order, providerName, {
        customer: (body as Record<string, unknown>).customer as Record<string, unknown> | undefined,
        description: body.description,
      });
      ctx.json({ provider: providerName, order });
    },
    guard,
  );

  router.post(
    '/payments/order/:id/capture',
    async (ctx) => {
      const providerName = ((ctx.body as { provider?: string } | undefined)?.provider ?? '').toLowerCase();
      const provider = payments.providers.get(providerName);
      if (!provider) { ctx.json({ error: 'Unknown or disabled provider' }, 400); return; }
      let order;
      try {
        order = await provider.capture({ orderId: ctx.params.id, amount: (ctx.body as { amount?: number } | undefined)?.amount } as any);
      } catch (e) {
        ctx.json({ error: `${providerName} capture failed: ${(e as Error).message}` }, 502);
        return;
      }
      await upsertOrder(order, providerName);
      ctx.json({ provider: providerName, order });
    },
    guard,
  );

  router.get(
    '/payments/order/:id',
    async (ctx) => {
      const providerName = (ctx.query.provider ?? '').toString().toLowerCase();
      const provider = payments.providers.get(providerName);
      if (!provider) { ctx.json({ error: 'Unknown or disabled provider (pass ?provider=)' }, 400); return; }
      let order;
      try {
        order = await provider.getOrderStatus(ctx.params.id);
      } catch (e) {
        ctx.json({ error: `${providerName} status failed: ${(e as Error).message}` }, 502);
        return;
      }
      await upsertOrder(order, providerName);
      ctx.json({ provider: providerName, order });
    },
    guard,
  );
}
