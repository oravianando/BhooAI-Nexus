# @bhooai/nexus-payments

Unified `PaymentProvider` interface across five gateways with per-provider
webhook signature verification.

## Providers

| provider | status | notes |
| --- | --- | --- |
| Razorpay | **full** | REST orders + signature verify |
| PayPal | **full** | Orders v2 |
| PayU | happy-path | hash-based |
| Skrill | happy-path | Quick Checkout |
| Payoneer | happy-path | hosted flow |

Razorpay + PayPal are fully implemented and tested. PayU/Skrill/Payoneer have
happy-path + sandbox tests (documented seams — their Node SDKs are weak, so some
flows use raw HTTP). See `docs/IMPROVEMENTS.md`.

## Exports

- `createPayments(config)` → `PaymentsService` with `createOrder/capture/refund/
  getOrderStatus/verifyWebhook` and a `webhookRouter(handler)`.
- Per-provider classes, `http` + `signature` helpers, typed errors.

The browser-facing routes live in `apps/backend` (`registerPaymentRoutes`);
webhooks mount separately at `config.payments.webhookPath`.