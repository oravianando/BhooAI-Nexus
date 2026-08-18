import type { Middleware } from '../../nexus-core/src/http/index.js';

export interface SecurityHeadersOptions {
  /** HSTS max age in seconds (0 to disable). */
  hstsMaxAge?: number;
  /** Include subdomains in HSTS. */
  hstsIncludeSubdomains?: boolean;
  /** Enable HSTS preload. */
  hstsPreload?: boolean;
  /** Content-Security-Policy directive string. */
  csp?: string;
  /** Referrer-Policy. */
  referrerPolicy?: string;
  /** X-Content-Type-Options. */
  noSniff?: boolean;
  /** X-Frame-Options (DENY/SAMEORIGIN) — superseded by CSP frame-ancestors when present. */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** Cross-Origin-Opener-Policy. */
  coop?: string;
  /** Cross-Origin-Resource-Policy. */
  corp?: string;
}

/** Helmet-equivalent security headers, applied to every response. */
export function securityHeaders(options: SecurityHeadersOptions = {}): Middleware {
  const opts = {
    hstsMaxAge: options.hstsMaxAge ?? 15552000, // 180 days
    hstsIncludeSubdomains: options.hstsIncludeSubdomains ?? true,
    hstsPreload: options.hstsPreload ?? false,
    csp: options.csp ?? "default-src 'self'",
    referrerPolicy: options.referrerPolicy ?? 'no-referrer',
    noSniff: options.noSniff ?? true,
    frameOptions: options.frameOptions ?? 'SAMEORIGIN',
    coop: options.coop ?? 'same-origin',
    corp: options.corp ?? 'same-origin',
  };

  return async (ctx, next) => {
    // Apply headers early; they persist through the response.
    if (opts.hstsMaxAge > 0) {
      let hsts = `max-age=${opts.hstsMaxAge}`;
      if (opts.hstsIncludeSubdomains) hsts += '; includeSubDomains';
      if (opts.hstsPreload) hsts += '; preload';
      ctx.setHeader('strict-transport-security', hsts);
    }
    if (opts.csp) ctx.setHeader('content-security-policy', opts.csp);
    if (opts.referrerPolicy) ctx.setHeader('referrer-policy', opts.referrerPolicy);
    if (opts.noSniff) ctx.setHeader('x-content-type-options', 'nosniff');
    if (opts.frameOptions) ctx.setHeader('x-frame-options', opts.frameOptions);
    if (opts.coop) ctx.setHeader('cross-origin-opener-policy', opts.coop);
    if (opts.corp) ctx.setHeader('cross-origin-resource-policy', opts.corp);
    ctx.setHeader('x-xss-protection', '0'); // disabled in favor of CSP
    await next();
  };
}
