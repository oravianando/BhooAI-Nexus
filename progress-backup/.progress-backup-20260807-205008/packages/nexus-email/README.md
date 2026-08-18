# @bhooai/nexus-email

Email providers, a template engine, and a Redis-backed queue.

## Exports

- `createEmail(config, { templates })` → `EmailService` with `send`.
- **providers** — SMTP via `nodemailer`; a log provider for dev. Pluggable
  `EmailProvider` interface.
- **TemplateEngine** — `register(name, template)` + render with `{{var}}` interpolation.
- **queue** — Redis-backed send queue (uses `nexus-cache` when available).

## Usage

```ts
import { createEmail, TemplateEngine } from '@bhooai/nexus-email';
const templates = new TemplateEngine();
templates.register('welcome', '<h1>Welcome, {{name}}!</h1>');
const email = createEmail(config.email, { templates });
await email.send({ to: 'a@b.com', template: 'welcome', vars: { name: 'Ravi' } });
```