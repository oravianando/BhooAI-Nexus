// Plugin worker bootstrap (plain ESM — Node runs this directly in a worker_thread,
// no TS loader needed). Loads the plugin entry and exposes a PluginContext whose
// registrars RPC back to the host (capability-gated there). Runs lifecycle hooks
// and route/schedule/event handlers in response to host messages. A crash here
// is isolated from the host process.
import { workerData, parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const { entryPath, manifest, config } = workerData;
const caps = new Set(manifest.capabilities);

// Pending RPC requests awaiting host replies.
const rpcPending = new Map();
let rpcSeq = 0;

function callHost(method, args) {
  const id = ++rpcSeq;
  return new Promise((resolve, reject) => {
    rpcPending.set(id, { resolve, reject });
    parentPort.postMessage({ kind: 'rpc', id, method, args });
  });
}

function requireCap(cap) {
  if (!caps.has(cap)) throw new Error(`plugin ${manifest.name} lacks capability: ${cap}`);
}

// Stored handlers the host invokes via messages.
const routes = new Map(); // routeId -> handler
const schedules = new Map(); // name -> fn
const eventHandlers = new Map(); // topic -> handler

function buildContext() {
  const logger = {
    info: (m, meta) => parentPort.postMessage({ kind: 'log', level: 'info', msg: m, meta }),
    warn: (m, meta) => parentPort.postMessage({ kind: 'log', level: 'warn', msg: m, meta }),
    error: (m, meta) => parentPort.postMessage({ kind: 'log', level: 'error', msg: m, meta }),
  };
  const ctx = {
    pluginName: manifest.name,
    capabilities: manifest.capabilities,
    config,
    logger,
    http: {
      addRoute(method, path, handler) {
        requireCap('http');
        const routeId = `${method}:${path}:${Math.random().toString(36).slice(2, 8)}`;
        routes.set(routeId, handler);
        callHost('http.addRoute', { method, path, routeId });
      },
      addMiddleware(mw, phase) {
        requireCap('http');
        // Middleware can't be serialized; sandboxed middleware is a v1 no-op stub
        // (documented). The host logs that middleware was requested but not applied.
        callHost('http.addMiddleware', { phase });
      },
    },
    graphql: {
      addSubgraph() {
        throw new Error('sandboxed plugins cannot add GraphQL subgraphs in v1 (resolvers are not serializable; use trusted mode)');
      },
    },
    data: {
      registerModel(name, schema) { requireCap('data'); return callHost('data.registerModel', { name, schema }); },
      getModel(name) { requireCap('data'); return callHost('data.getModel', { name }); },
    },
    realtime: {
      join(room, connId) { requireCap('realtime'); callHost('realtime.join', { room, connId }); },
      broadcast(room, msg) { requireCap('realtime'); callHost('realtime.broadcast', { room, msg }); },
    },
    scheduler: {
      schedule(name, cron, fn) { requireCap('scheduler'); schedules.set(name, fn); callHost('scheduler.schedule', { name, cron }); },
      cancel(name) { requireCap('scheduler'); schedules.delete(name); callHost('scheduler.cancel', { name }); },
    },
    events: {
      publish(topic, payload) { requireCap('events'); callHost('events.publish', { topic, payload }); },
      subscribe(topic, handler) {
        requireCap('events');
        eventHandlers.set(topic, handler);
        callHost('events.subscribe', { topic });
        return () => { eventHandlers.delete(topic); callHost('events.unsubscribe', { topic }); };
      },
    },
    admin: {
      registerAdminPage(page) { requireCap('admin'); callHost('admin.registerAdminPage', { page }); },
      registerSlot(slot) { requireCap('admin'); callHost('admin.registerSlot', { slot }); },
    },
    services: {
      register(name, svc) { requireCap('events'); callHost('services.register', { name, svc }); },
      get(name) { requireCap('events'); return callHost('services.get', { name }); },
    },
  };
  if (caps.has('fs')) {
    ctx.fs = {
      readFile(path) { return callHost('fs.readFile', { path }); },
      writeFile(path, data) { return callHost('fs.writeFile', { path, data }); },
    };
  }
  if (caps.has('net')) {
    ctx.net = {
      fetch(url, init) { return callHost('net.fetch', { url, init }); },
    };
  }
  return ctx;
}

// Build a serializable request context for an invoked route handler.
function buildRequestContext(request) {
  let sent = false;
  const response = { status: 200, body: undefined, headers: {} };
  const api = {
    method: request.method,
    path: request.path,
    headers: request.headers,
    body: request.body,
    params: request.params,
    query: request.query,
    json(data, status) { response.body = data; response.status = status ?? 200; sent = true; },
    text(data, status) { response.body = data; response.status = status ?? 200; sent = true; },
    html(data, status) { response.body = data; response.status = status ?? 200; sent = true; },
    status(status) { response.status = status; sent = true; },
    setHeader(name, value) { response.headers[name] = value; },
  };
  return { api, response, isSent: () => sent };
}

let ctx;
let pluginModule;

async function loadPlugin() {
  const mod = await import(pathToFileURL(entryPath).href);
  pluginModule = mod.default ?? mod;
}

async function runHook(hook, hookConfig) {
  const fn = pluginModule?.[hook];
  if (hook === 'onConfigChange') {
    if (pluginModule?.onConfigChange) await pluginModule.onConfigChange(ctx, hookConfig);
    return;
  }
  if (fn) await fn(ctx);
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.kind === 'rpcResult') {
      const p = rpcPending.get(msg.id);
      if (!p) return;
      rpcPending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error));
      return;
    }
    if (msg.kind === 'lifecycle') {
      if (msg.config !== undefined) ctx.config = msg.config;
      try {
        // Map hook names to module methods.
        const hookMap = { install: 'install', init: 'init', start: 'start', stop: 'stop', 'config:change': 'onConfigChange' };
        const fnName = hookMap[msg.hook];
        const fn = pluginModule?.[fnName];
        if (fn) await fn(ctx, msg.config);
        parentPort.postMessage({ kind: 'lifecycleDone', hook: msg.hook, ok: true });
      } catch (err) {
        parentPort.postMessage({ kind: 'lifecycleDone', hook: msg.hook, ok: false, error: String(err?.message ?? err) });
      }
      return;
    }
    if (msg.kind === 'invokeRoute') {
      const handler = routes.get(msg.routeId);
      const { api, response, isSent } = buildRequestContext(msg.request);
      try {
        if (handler) await handler(api);
        if (!isSent()) { response.body = response.body ?? ''; response.status = response.status ?? 200; }
        parentPort.postMessage({ kind: 'routeResponse', routeId: msg.routeId, status: response.status, body: response.body, headers: response.headers });
      } catch (err) {
        parentPort.postMessage({ kind: 'routeResponse', routeId: msg.routeId, status: 500, body: { error: String(err?.message ?? err) }, headers: {} });
      }
      return;
    }
    if (msg.kind === 'runSchedule') {
      const fn = schedules.get(msg.name);
      if (fn) await fn();
      return;
    }
    if (msg.kind === 'event') {
      const h = eventHandlers.get(msg.topic);
      if (h) h(msg.payload);
      return;
    }
  } catch (err) {
    // Never let a message-handler throw crash the worker silently.
    parentPort.postMessage({ kind: 'log', level: 'error', msg: 'handler error', meta: { error: String(err?.message ?? err) } });
  }
});

// Heartbeat — tell the host we're alive on an interval.
const heartbeatMs = (workerData.limits && workerData.limits.heartbeatMs) || 1000;
const heartbeat = setInterval(() => parentPort.postMessage({ kind: 'heartbeat' }), heartbeatMs);

async function start() {
  ctx = buildContext();
  await loadPlugin();
  parentPort.postMessage({ kind: 'ready' });
  // The host drives all lifecycle hooks (install → init → start) via messages.
}
start().catch((err) => {
  parentPort.postMessage({ kind: 'log', level: 'error', msg: 'plugin failed to start', meta: { error: String(err?.message ?? err) } });
  parentPort.postMessage({ kind: 'fatal', error: String(err?.message ?? err) });
});

export {}; // keep this an ES module