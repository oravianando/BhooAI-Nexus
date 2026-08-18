// Shared nav tree for the BhooAI Nexus docs.
//
// Single source of truth for the sidebar navigation, imported by both
// `docs.js` (the standalone docs site) and the in-app `Docs.tsx` (the
// frontend docs view). Edit this file to add/relabel pages — both
// consumers pick up the change.

export const NAV = [
  {
    group: "Start",
    items: [
      { label: "Overview", file: "index.html", tag: "what it is" },
      { label: "Getting Started", file: "getting-started.html", tag: "how to run install" },
      { label: "Architecture", file: "architecture.html", tag: "how it's made" },
      { label: "Examples", file: "examples.html", tag: "recipes snippets code" },
      { label: "Troubleshooting", file: "troubleshooting.html", tag: "errors fix debug solve troubleshoot" },
    ],
  },
  {
    group: "Guides",
    items: [
      { label: "From Empty Project", file: "guides/guide-empty-project.html", tag: "init scaffold new project create wizard setup" },
      { label: "Login & Auth Flow", file: "guides/guide-auth.html", tag: "login register csrf jwt token oauth session" },
      { label: "WebSocket Chat", file: "guides/guide-websocket.html", tag: "websocket realtime rooms chat webrtc" },
      { label: "Send Email", file: "guides/guide-email.html", tag: "email smtp template send" },
      { label: "Payments Integration", file: "guides/guide-payments.html", tag: "payments razorpay paypal order checkout webhook" },
      { label: "AI Chat Streaming", file: "guides/guide-ai-chat.html", tag: "ai chat streaming sse ollama together provider" },
      { label: "Upload Files", file: "guides/guide-uploads.html", tag: "upload file multipart form data" },
      { label: "MongoDB CRUD", file: "guides/guide-mongodb.html", tag: "mongodb crud schema model query populate transaction" },
      { label: "GraphQL API", file: "guides/guide-graphql.html", tag: "graphql subgraph gateway subscription federation" },
      { label: "Cluster Setup", file: "guides/guide-cluster.html", tag: "cluster master slave node agent link load balancer" },
      { label: "Frontend Styling", file: "guides/guide-frontend-styling.html", tag: "frontend css tailwind postcss theme tokens styling" },
      { label: "Postman API Testing", file: "learn/14-postman-testing.html", tag: "postman testing api cluster link csrf" },
    ],
  },
  {
    group: "API Reference",
    items: [
      { label: "Core", file: "api/core.html", pkg: "nexus-core", tag: "http server router config" },
      { label: "Telemetry", file: "api/telemetry.html", pkg: "nexus-telemetry", tag: "logger metrics trace" },
      { label: "Auth", file: "api/auth.html", pkg: "nexus-auth", tag: "csrf cors jwt oauth session rbac" },
      { label: "Data (ODM)", file: "api/data.html", pkg: "nexus-data", tag: "odm mongodb schema model query" },
      { label: "GraphQL", file: "api/graphql.html", pkg: "nexus-graphql", tag: "federation gateway subgraph subscription" },
      { label: "Realtime", file: "api/realtime.html", pkg: "nexus-realtime", tag: "websocket rooms webrtc mediasoup" },
      { label: "Payments", file: "api/payments.html", pkg: "nexus-payments", tag: "razorpay paypal payu skrill payoneer" },
      { label: "Email", file: "api/email.html", pkg: "nexus-email", tag: "smtp nodemailer template queue" },
      { label: "Crypto", file: "api/crypto.html", pkg: "nexus-crypto", tag: "keypair x509 csr der cert" },
      { label: "Cache", file: "api/cache.html", pkg: "nexus-cache", tag: "redis rate limiter pubsub" },
      { label: "Ads", file: "api/ads.html", pkg: "nexus-ads", tag: "google ads gaql campaigns" },
      { label: "Plugins", file: "api/plugins.html", pkg: "nexus-plugins", tag: "manifest host sandbox worker hooks" },
      { label: "AI Client", file: "api/ai-client.html", pkg: "nexus-ai-client", tag: "sse streaming openai ollama together" },
      { label: "Cluster", file: "api/cluster.html", pkg: "nexus-cluster", tag: "mesh nodes registry load balancer autoscaler" },
      { label: "Admin Client", file: "api/admin.html", pkg: "admin", tag: "admin react client login config env users roles metrics preflight lint payments databases ai cluster supervisor" },
      { label: "Safe Goto", file: "api/safe-goto.html", pkg: "nexus-safe-goto", tag: "external link dialog safe goto noopener noreferrer" },
      { label: "PostCSS Preset", file: "api/postcss.html", pkg: "nexus-postcss", tag: "postcss tailwind css preset theme tokens createpreset" },
      { label: "CLI", file: "api/cli.html", pkg: "nexus-cli", tag: "init wizard dev doctor uninstall pysetup supervisor" },
      { label: "HTTP Endpoints", file: "api/http-endpoints.html", tag: "http rest api endpoints routes get post put delete" },
      { label: "WebSockets", file: "api/websockets.html", tag: "websocket ws realtime graphql subscription" },
      { label: "Supervisor API", file: "api/supervisor.html", tag: "supervisor control status logs start stop restart" },
      { label: "Node Agent API", file: "api/node-agent.html", tag: "node agent health info exec metrics cluster" },
    ],
  },
  {
    group: "Build Guide",
    items: [
      { label: "01 · Foundation", file: "learn/01-foundation.html", tag: "core http router config di errors" },
      { label: "02 · Security", file: "learn/02-security.html", tag: "auth csrf cors jwt oauth rbac telemetry" },
      { label: "03 · Data ODM", file: "learn/03-data.html", tag: "data mongodb schema model query populate" },
      { label: "04 · GraphQL", file: "learn/04-graphql.html", tag: "graphql federation gateway subgraph subscription" },
      { label: "05 · Realtime", file: "learn/05-realtime.html", tag: "realtime websocket rooms webrtc mediasoup" },
      { label: "06 · Payments Email Crypto", file: "learn/06-payments-email-crypto.html", tag: "payments razorpay paypal email smtp crypto cert" },
      { label: "07 · Cache Ads", file: "learn/07-cache-ads.html", tag: "cache redis ads gaql" },
      { label: "08 · AI Server", file: "learn/08-ai.html", tag: "ai python openai ollama embeddings sse" },
      { label: "09 · Plugins", file: "learn/09-plugins.html", tag: "plugins manifest host sandbox hooks" },
      { label: "10 · Cluster", file: "learn/10-cluster.html", tag: "cluster mesh nodes registry load balancer autoscaler" },
      { label: "11 · CLI", file: "learn/11-cli.html", tag: "cli init wizard dev doctor uninstall pysetup" },
      { label: "CLI Init Wizard", file: "learn/11-cli.html", tag: "init wizard setup scaffold project create prereq scan" },
      { label: "CLI Uninstall", file: "learn/11-cli.html", tag: "uninstall remove delete purge project database" },
      { label: "12 · Apps", file: "learn/12-apps.html", tag: "apps backend frontend admin docker" },
      { label: "13 · Tests", file: "learn/13-tests.html", tag: "tests vitest pytest playwright e2e" },
    ],
  },
  {
    group: "More",
    items: [
      { label: "Improvements", file: "improvements.html", tag: "roadmap suggestions seams" },
    ],
  },
];

export default NAV;