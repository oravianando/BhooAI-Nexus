/**
 * SafeGoto — secure external link navigation for the admin panel.
 *
 * External links are intercepted and routed through a confirmation dialog.
 * On confirm, the URL is opened via `window.open` with `noopener,noreferrer`
 * to prevent tab-nabbing (the opened page can't access `window.opener`) and
 * referrer leakage (the opened page can't see the admin panel URL).
 *
 * Usage:
 *   // 1. Mount the dialog once at the app root:
 *   <SafeGotoDialog />
 *
 *   // 2a. Use the hook component:
 *   <SafeGotoLink href="https://openai.com">OpenAI</SafeGotoLink>
 *
 *   // 2b. Or trigger programmatically:
 *   safeGoto('https://openai.com');
 */

import { useCallback, useEffect, useState } from 'react';

export interface SafeGotoOptions {
  /** Label shown in the dialog (defaults to the hostname). */
  label?: string;
  /** Optional message override. */
  message?: string;
}

interface PendingNav {
  url: string;
  label: string;
  message?: string;
}

let mountedSetter: ((nav: PendingNav | null) => void) | null = null;

/**
 * Register a setter so `safeGoto()` can trigger the mounted dialog.
 * Called internally by `<SafeGotoDialog />` on mount.
 */
export function registerSafeGoto(setter: (nav: PendingNav | null) => void): void {
  mountedSetter = setter;
}

export function unregisterSafeGoto(): void {
  mountedSetter = null;
}

/**
 * Trigger the safe-goto confirmation dialog for an external URL.
 * No-op if the dialog isn't mounted.
 */
export function safeGoto(url: string, opts: SafeGotoOptions = {}): void {
  if (!mountedSetter) {
    // Fallback: open directly with safe params.
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const label = opts.label ?? hostnameOf(url);
  mountedSetter({ url, label, message: opts.message });
}

/** Open a URL safely — always noopener + noreferrer. */
export function openSafe(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Extract the hostname from a URL for display. */
function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/** Check if a URL is an external http(s) link (different origin from the current page). */
export function isExternalUrl(url: string): boolean {
  try {
    if (!/^https?:\/\//i.test(url)) return false;
    const u = new URL(url, window.location.href);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Intercept clicks on `<a>` elements that point to external URLs.
 * Returns a click handler that calls `safeGoto` for external links
 * and lets internal links through.
 *
 * Usage:
 *   <div onClick={interceptExternalLinks}>...content with <a> tags...</div>
 */
export function interceptExternalLinks(e: React.MouseEvent): void {
  const target = (e.target as HTMLElement)?.closest('a');
  if (!target) return;
  const href = target.getAttribute('href');
  if (!href) return;
  // Only intercept http(s) external links.
  if (!href.startsWith('http://') && !href.startsWith('https://')) return;
  if (!isExternalUrl(href)) return;
  e.preventDefault();
  safeGoto(href);
}

/**
 * The confirmation dialog component. Mount this once at the app root.
 * It listens for `safeGoto()` calls and shows a modal before opening the link.
 */
export function SafeGotoDialog() {
  const [pending, setPending] = useState<PendingNav | null>(null);

  useEffect(() => {
    registerSafeGoto(setPending);
    return () => unregisterSafeGoto();
  }, []);

  const cancel = useCallback(() => setPending(null), []);

  const proceed = useCallback(() => {
    if (pending) openSafe(pending.url);
    setPending(null);
  }, [pending]);

  if (!pending) return null;

  const url = pending.url;
  const hostname = hostnameOf(url);

  return (
    <div className="safe-goto-overlay" onClick={cancel}>
      <div className="safe-goto-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="safe-goto-icon-wrap">
          <span className="safe-goto-icon">🛡️</span>
        </div>
        <div className="safe-goto-body">
          <div className="safe-goto-title">Leaving BhooAI Nexus</div>
          <p className="safe-goto-msg">
            {pending.message ?? `You are about to visit an external website. We cannot guarantee the safety of content on third-party sites. Please verify the URL before proceeding.`}
          </p>
          <div className="safe-goto-url">
            <span className="safe-goto-shield">🔗</span>
            <code>{url}</code>
          </div>
          <div className="safe-goto-warning">
            <span>⚠️</span>
            <span>This link opens in a new tab with security protections enabled (noopener + noreferrer). Never enter your BhooAI credentials on external sites.</span>
          </div>
          <div className="safe-goto-actions">
            <button onClick={cancel} className="glass-chip-btn">Stay here</button>
            <button onClick={proceed} className="glass-btn-primary">Continue to {hostname} →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A safe external link component. Renders an `<a>` that triggers the
 * confirmation dialog instead of navigating directly.
 */
export function SafeGotoLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    safeGoto(href);
  };
  return (
    <a href={href} onClick={handleClick} className={className ?? 'safe-goto-link'} title={`Open ${hostnameOf(href)} in a new tab (safe)`}>
      {children}
    </a>
  );
}

export default SafeGotoDialog;