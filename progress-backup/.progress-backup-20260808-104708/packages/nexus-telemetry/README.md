# @bhooai/nexus-telemetry

Structured logging, metrics, and trace/request-ID propagation.

## Exports

- **Logger** — JSON or pretty output, child loggers, levels, redaction of
  sensitive fields (`password`, `secret`, `authorization`), console + rotating
  file transports.
- **MetricsRegistry** — counters and histograms; `counter(name, help)` registers
  a counter, `inc(name, value, labels)` increments it, `toJSON()` snapshots.
- **trace** — request/trace-ID helpers for propagation across Node → WS → Python.

## Usage

```ts
import { Logger, MetricsRegistry } from '@bhooai/nexus-telemetry';

const log = new Logger({ level: 'info', format: 'pretty', console: true, redact: ['password'] });
log.info('listening', { port: 4000 });

const metrics = new MetricsRegistry();
metrics.counter('http_requests_total', 'Total HTTP requests');
metrics.inc('http_requests_total', 1, { method: 'GET' });
```

> `counter()` returns the registered counter state; it does **not** chain `.inc()`.
> Increment via the registry's `inc(name, …)`.