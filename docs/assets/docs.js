// Shared sidebar nav for the BhooAI Nexus docs. Renders the nav tree from a
// single source, highlights the active page, and filters by the search box.
//
// NOTE: This NAV array is mirrored in assets/nav.js (the ES-module version
// imported by the in-app frontend Docs view). Keep both in sync — nav.js is
// the canonical source; if you add/relabel a page, update both files.
const NAV = [
  {
    group: "Start",
    items: [
      { label: "Overview", file: "index.html", tag: "what it is" },
      { label: "Getting Started", file: "getting-started.html", tag: "how to run install" },
      { label: "Architecture", file: "architecture.html", tag: "how it's made" },
      { label: "Examples", file: "examples.html", tag: "recipes snippets code" },
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

const SCRIPT_URL =
  document.currentScript?.src || new URL("assets/docs.js", location.href).href;
const DOCS_BASE = new URL("../", SCRIPT_URL);

function routeFromPath(pathname = location.pathname) {
  const route = pathname.startsWith(DOCS_BASE.pathname)
    ? pathname.slice(DOCS_BASE.pathname.length)
    : "index.html";
  return route || "index.html";
}

function currentRoute() {
  return location.hash
    ? decodeURIComponent(location.hash.slice(1)) || "index.html"
    : routeFromPath();
}

const IS_EMBEDDED = new URL(location.href).searchParams.get("embed") === "1";
const IS_SHELL = !IS_EMBEDDED && routeFromPath() === "index.html";
let docFrame;

function routeLabel(route) {
  for (const group of NAV) {
    const item = group.items.find((entry) => entry.file === route);
    if (item) return item.label;
  }
  return "Documentation";
}

function renderSidebar() {
  const sb = document.getElementById("sidebar");
  if (!sb) return;
  const html = [];
  const inSubdir = /\/api\/|\/learn\//.test(location.pathname);
  const logoUrl = inSubdir
    ? "../assets/bhooai-nexus-logo.svg"
    : "assets/bhooai-nexus-logo.svg";
  html.push(
    `<div class="brand"><img src="${logoUrl}" alt="BhooAI Nexus" /></div>`,
  );
  html.push(
    '<div class="sidebar-meta"><span class="pulse"></span>LOCAL KNOWLEDGE BASE<span class="version">v0.1</span></div>',
  );
  html.push(
    '<input class="search" type="search" placeholder="Filter docs... (press /)" id="nav-search">',
  );
  for (const g of NAV) {
    html.push(`<div class="group-label">${g.group}</div>`);
    for (const it of g.items) {
      const active = it.file === currentRoute() ? " active" : "";
      const pkg = it.pkg ? ` <span class="pkg">@bhooai/${it.pkg}</span>` : "";
      html.push(
        `<a class="nav${active}" href="#${it.file}" data-route="${it.file}" data-tag="${(it.label + " " + (it.tag || "")).toLowerCase()}">${it.label}${pkg}</a>`,
      );
    }
  }
  sb.innerHTML = html.join("");

  const search = document.getElementById("nav-search");
  search.addEventListener("input", () => {
    const q = search.value.toLowerCase().trim();
    sb.querySelectorAll("a.nav").forEach((a) => {
      const match = !q || a.dataset.tag.includes(q);
      a.classList.toggle("hidden", !match);
    });
    sb.querySelectorAll(".group-label").forEach((label) => {
      const anyVisible = label.nextElementSibling;
      let next = label.nextElementSibling;
      let visible = false;
      while (next && !next.classList.contains("group-label")) {
        if (
          next.classList.contains("nav") &&
          !next.classList.contains("hidden")
        )
          visible = true;
        next = next.nextElementSibling;
      }
      label.classList.toggle("hidden", q && !visible);
    });
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = sb.querySelector("a.nav:not(.hidden)");
      if (first) location.href = first.getAttribute("href");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== search) {
      e.preventDefault();
      search.focus();
    }
    if (e.key === "Escape") search.blur();
  });
}

function updateActiveNav(route) {
  document.querySelectorAll("#sidebar a.nav").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
}

function ensureFrame() {
  if (!IS_SHELL) return;
  const content = document.querySelector("main#content");
  if (!content) return;
  docFrame = document.createElement("iframe");
  docFrame.className = "docs-frame";
  docFrame.title = "BhooAI Nexus documentation content";
  docFrame.loading = "eager";
  content.replaceChildren(docFrame);
}

function frameUrl(route) {
  const url = new URL(route || "index.html", DOCS_BASE);
  url.search = "?embed=1";
  url.hash = "";
  return url.href;
}

async function loadRoute(route, replace = false) {
  const safeRoute = route || "index.html";
  const url = new URL(safeRoute, DOCS_BASE);
  if (IS_SHELL) {
    if (!docFrame) ensureFrame();
    docFrame.src = frameUrl(safeRoute);
    document.title = `BhooAI Nexus Docs - ${routeLabel(safeRoute)}`;
    updateActiveNav(safeRoute);
    if (replace)
      history.replaceState(
        { route: safeRoute },
        "",
        `#${encodeURIComponent(safeRoute)}`,
      );
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById("sidebar")?.classList.remove("open");
    return;
  }
  try {
    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const nextContent = parsed.querySelector("main#content");
    const content = document.querySelector("main#content");
    if (!nextContent || !content)
      throw new Error("Documentation page has no #content main");
    content.replaceChildren(
      ...Array.from(nextContent.childNodes).map((node) => node.cloneNode(true)),
    );
    if (parsed.title) document.title = parsed.title;
    updateActiveNav(safeRoute);
    if (replace)
      history.replaceState(
        { route: safeRoute },
        "",
        `#${encodeURIComponent(safeRoute)}`,
      );
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById("sidebar")?.classList.remove("open");
    if (window.NexusPlayground) window.NexusPlayground.initAll(content);
  } catch (error) {
    // Keep every page directly addressable when opened without a web server.
    console.warn(
      "SPA route loading failed; using the static page instead.",
      error,
    );
    location.href = url.href;
  }
}

function setupSpaRouting() {
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      anchor.target === "_blank"
    )
      return;
    const url = new URL(href, new URL(currentRoute(), DOCS_BASE));
    if (url.origin !== location.origin || !url.pathname.endsWith(".html"))
      return;
    event.preventDefault();
    const route = url.pathname.startsWith(DOCS_BASE.pathname)
      ? url.pathname.slice(DOCS_BASE.pathname.length)
      : "index.html";
    history.pushState({ route }, "", `#${encodeURIComponent(route)}`);
    loadRoute(route);
  });
  window.addEventListener("hashchange", () => loadRoute(currentRoute()));
  window.addEventListener("popstate", () => loadRoute(currentRoute()));
  if (location.hash) loadRoute(currentRoute(), true);
}

function setupEmbeddedRouting() {
  document.body.classList.add("embedded");
  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      anchor.target === "_blank"
    )
      return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !url.pathname.endsWith(".html"))
      return;
    event.preventDefault();
    const route = url.pathname.startsWith(DOCS_BASE.pathname)
      ? url.pathname.slice(DOCS_BASE.pathname.length)
      : "index.html";
    window.parent.postMessage({ type: "nexus-docs-route", route }, "*");
  });
}

function setupFrameMessages() {
  if (!IS_SHELL) return;
  window.addEventListener("message", (event) => {
    if (event.source !== docFrame?.contentWindow) return;
    if (event.data?.type !== "nexus-docs-route") return;
    const route = String(event.data.route || "index.html");
    history.pushState({ route }, "", `#${encodeURIComponent(route)}`);
    loadRoute(route);
  });
}

function renderMenuButton() {
  const btn = document.createElement("button");
  btn.className = "menu-btn";
  btn.textContent = "MENU";
  btn.addEventListener("click", () =>
    document.getElementById("sidebar").classList.toggle("open"),
  );
  document.body.appendChild(btn);
}

/** Spawn ~16 glowing particles inside the hero section (homepage only).
 *  Each particle gets random position, size, color, duration, and drift
 *  via CSS custom properties. Pure decoration — no interaction, no layout. */
function initHeroParticles() {
  var container = document.querySelector('.hero .hero-particles');
  if (!container) return;
  var colors = ['rgba(34,211,238,', 'rgba(168,85,247,', 'rgba(99,102,241,', 'rgba(217,70,239,', 'rgba(255,255,255,'];
  var frag = document.createDocumentFragment();
  for (var i = 0; i < 16; i++) {
    var span = document.createElement('span');
    span.className = 'hero-particle';
    span.style.setProperty('--x', (Math.random() * 180 - 90) + 'px');
    span.style.setProperty('--y', (Math.random() * 120 - 60) + 'px');
    span.style.setProperty('--dur', (10 + Math.random() * 12) + 's');
    span.style.setProperty('--delay', '-' + (Math.random() * 14).toFixed(2) + 's');
    span.style.left = (Math.random() * 100) + '%';
    span.style.top = (Math.random() * 100) + '%';
    span.style.width = span.style.height = (3 + Math.random() * 5) + 'px';
    span.style.background = colors[Math.floor(Math.random() * colors.length)] + (0.35 + Math.random() * 0.4).toFixed(2) + ')';
    frag.appendChild(span);
  }
  container.appendChild(frag);
}

document.addEventListener("DOMContentLoaded", () => {
  initHeroParticles();
  if (IS_EMBEDDED) {
    setupEmbeddedRouting();
    if (window.NexusPlayground) window.NexusPlayground.initAll();
    return;
  }
  if (IS_SHELL) document.body.classList.add("shell");
  renderSidebar();
  renderMenuButton();
  if (IS_SHELL) ensureFrame();
  setupSpaRouting();
  setupFrameMessages();
  if (IS_SHELL) loadRoute(currentRoute(), true);
  else if (window.NexusPlayground) window.NexusPlayground.initAll();
});
