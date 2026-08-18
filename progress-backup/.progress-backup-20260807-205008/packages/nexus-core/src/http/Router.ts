import type { Handler, Middleware, Params, RequestContext } from './context.js';

interface RouteNode {
  static: Map<string, RouteNode>; // exact segment -> child
  param?: { name: string; node: RouteNode };
  wildcard?: { node: RouteNode };
  handlers: Map<string, Handler>; // method -> handler
  middleware: Middleware[];
}

function createNode(): RouteNode {
  return { static: new Map(), handlers: new Map(), middleware: [] };
}

interface MatchResult {
  handler: Handler;
  params: Params;
  middleware: Middleware[];
  pattern: string;
}

/**
 * Trie router supporting static segments, `:param` segments, and `*` wildcards.
 * Per-route middleware runs before the handler; router-level middleware (via
 * `use`) runs for all matched routes under its mount path.
 */
export class Router {
  private root = createNode();
  private globalMiddleware: Middleware[] = [];
  private routeCount = 0;

  /** Register router-level middleware. */
  use(mw: Middleware): this;
  use(path: string, mw: Middleware): this;
  use(pathOrMw: string | Middleware, maybeMw?: Middleware): this {
    if (typeof pathOrMw === 'function') {
      this.globalMiddleware.push(pathOrMw);
    } else if (maybeMw) {
      // path-scoped middleware: attach to a node matched by prefix
      const node = this.findOrCreateNode(pathOrMw);
      node.middleware.push(maybeMw);
    }
    return this;
  }

  get(path: string, handler: Handler, mw: Middleware[] = []): this { return this.add('GET', path, handler, mw); }
  post(path: string, handler: Handler, mw: Middleware[] = []): this { return this.add('POST', path, handler, mw); }
  put(path: string, handler: Handler, mw: Middleware[] = []): this { return this.add('PUT', path, handler, mw); }
  patch(path: string, handler: Handler, mw: Middleware[] = []): this { return this.add('PATCH', path, handler, mw); }
  delete(path: string, handler: Handler, mw: Middleware[] = []): this { return this.add('DELETE', path, handler, mw); }
  head(path: string, handler: Handler, mw: Middleware[] = []): this { return this.add('HEAD', path, handler, mw); }
  options(path: string, handler: Handler, mw: Middleware[] = []): this { return this.add('OPTIONS', path, handler, mw); }

  add(method: string, path: string, handler: Handler, mw: Middleware[] = []): this {
    const node = this.findOrCreateNode(path);
    node.handlers.set(method.toUpperCase(), handler);
    for (const m of mw) node.middleware.push(m);
    this.routeCount++;
    return this;
  }

  /** Resolve a request to a route match, or null if none. */
  match(method: string, path: string): MatchResult | null {
    const segments = splitPath(path);
    const params: Params = {};
    const collectedMw: Middleware[] = [...this.globalMiddleware];

    let node: RouteNode = this.root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      if (node.static.has(seg)) {
        node = node.static.get(seg)!;
      } else if (node.param) {
        params[node.param.name] = decodeURIComponent(seg);
        node = node.param.node;
      } else if (node.wildcard) {
        // Wildcard is terminal: consume the rest of the path.
        node = node.wildcard.node;
        if (node.middleware.length) collectedMw.push(...node.middleware);
        break;
      } else {
        return null;
      }
      if (node.middleware.length) collectedMw.push(...node.middleware);
    }

    const handler = node.handlers.get(method);
    if (!handler) {
      // Method not allowed on this path — surface 405 if any method matches.
      if (node.handlers.size > 0) {
        return { handler: methodNotAllowedHandler(node.handlers), params, middleware: collectedMw, pattern: path };
      }
      return null;
    }
    return { handler, params, middleware: collectedMw, pattern: joinPattern(path) };
  }

  get size(): number {
    return this.routeCount;
  }

  /** Enumerate registered (method, path) pairs — for OPTIONS/CORS introspection. */
  routes(): Array<{ method: string; path: string }> {
    const out: Array<{ method: string; path: string }> = [];
    const walk = (node: RouteNode, prefix: string) => {
      for (const [method] of node.handlers) out.push({ method, path: prefix || '/' });
      for (const [seg, child] of node.static) walk(child, `${prefix}/${seg}`);
      if (node.param) walk(node.param.node, `${prefix}/:${node.param.name}`);
      if (node.wildcard) walk(node.wildcard.node, `${prefix}/*`);
    };
    walk(this.root, '');
    return out;
  }

  private findOrCreateNode(path: string): RouteNode {
    const segments = splitPath(path);
    let node = this.root;
    for (const seg of segments) {
      if (seg === '*') {
        if (!node.wildcard) node.wildcard = { node: createNode() };
        node = node.wildcard.node;
      } else if (seg.startsWith(':')) {
        const name = seg.slice(1);
        if (!node.param) node.param = { name, node: createNode() };
        node.param.name = name;
        node = node.param.node;
      } else {
        if (!node.static.has(seg)) node.static.set(seg, createNode());
        node = node.static.get(seg)!;
      }
    }
    return node;
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function joinPattern(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function methodNotAllowedHandler(handlers: Map<string, Handler>): Handler {
  return (ctx) => {
    ctx.setHeader('allow', [...handlers.keys()].join(', '));
    ctx.status(405);
  };
}