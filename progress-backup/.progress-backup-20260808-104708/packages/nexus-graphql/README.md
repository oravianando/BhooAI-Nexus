# @bhooai/nexus-graphql

GraphQL on `graphql` (graphql-js) with a **custom federation/gateway layer built
from scratch** — no Apollo, no `@graphql-tools/federation`.

## Exports

- **subgraph** — `defineSubgraph` (SDL + resolvers, auto-wires `_service`/`_entities`),
  federation directives, `parseKeys`.
- **gateway** — `createGateway({ subgraph })` (single-subgraph, in-process) and
  `createFederatedGateway` (multi-subgraph). `graphqlHttpHandler({ gateway,
  introspection, context })` for HTTP `/graphql`.
- **subscriptions** — `PubSub` (async iterators), `SubscriptionServer` over
  WebSocket (`graphql-transport-ws`) with auth.
- **federation** — `composeSupergraph` (field ownership, `@key` collection,
  `@provides`/`@requires` records → supergraph SDL), the query planner (FetchNode
  DAG: root + entity fetches, `@requires` two-step), and `executor` (batched
  `_entities` by `__typename+keyFields`, `@provides` short-circuit, error remap).

## Subset supported (v1)

`@key` (single + composite), `@external`, `@requires`, `@provides`, `@extends`,
`_entities`, `_service { sdl }`. Skipped: `@shareable` arbitration, `@override`,
`@inaccessible` enforcement, subscription federation. See `docs/ARCHITECTURE.md`.

## Subscribe note

`gateway.subscribe({ document, contextValue })` needs a **parsed** `DocumentNode`
(`parse(query)`) and the param is `contextValue` (HTTP execute uses `context`).