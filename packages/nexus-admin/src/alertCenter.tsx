import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type AlertKind = 'ok' | 'err' | 'warn';

export interface AdminAlert {
  id: string;
  kind: AlertKind;
  message: string;
  source: string;
  at: string;
}

interface AlertContextValue {
  alerts: AdminAlert[];
  toasts: AdminAlert[];
  push: (kind: AlertKind, message: string, source: string) => void;
  clear: () => void;
  dismiss: (id: string) => void;
  dismissToast: (id: string) => void;
}

export const TOAST_TTL = 4500;

const ALERTS_KEY = 'nexus-admin-alerts';
const MAX_ALERTS = 50;

const AlertContext = createContext<AlertContextValue | null>(null);

function loadAlerts(): AdminAlert[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ALERTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AdminAlert[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a) => a && typeof a.message === 'string' && typeof a.source === 'string')
      .slice(0, MAX_ALERTS);
  } catch { /* ignore corrupt value */ }
  return [];
}

export function AlertProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<AdminAlert[]>(() => loadAlerts());
  const [toasts, setToasts] = useState<AdminAlert[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    try { window.localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts)); } catch { /* storage unavailable */ }
  }, [alerts]);

  const push = useCallback((kind: AlertKind, message: string, source: string) => {
    const text = String(message ?? '').trim();
    if (!text) return;
    idRef.current += 1;
    const alert: AdminAlert = {
      id: `${Date.now()}-${idRef.current}`,
      kind,
      message: text,
      source: source || 'admin',
      at: new Date().toLocaleString(),
    };
    setAlerts((prev) => [alert, ...prev].slice(0, MAX_ALERTS));
    setToasts((prev) => [...prev.slice(-3), alert]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== alert.id));
    }, TOAST_TTL);
  }, []);

  const clear = useCallback(() => setAlerts([]), []);

  const dismiss = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <AlertContext.Provider value={{ alerts, toasts, push, clear, dismiss, dismissToast }}>
      {children}
    </AlertContext.Provider>
  );
}

export function useAlerts(): AlertContextValue {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlerts must be used within <AlertProvider>');
  return ctx;
}

/** Pages that default their action messages to "warn" unless they look like errors. */
const WARN_SOURCES = new Set(['cluster']);

function kindFor(source: string, value: string): AlertKind {
  if (WARN_SOURCES.has(source)) return 'warn';
  return /fail|error|could not|no .* (found|available)|unavailable|invalid|missing|rejected|failed|did not|unreachable/i.test(value) ? 'err' : 'ok';
}

export function useAdminAlert(source: string): [
  string | null,
  (value: string | { kind: AlertKind; text: string } | null) => void,
] {
  const { push } = useAlerts();
  const [msg, setMsg] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);

  const set = useCallback((value: string | { kind: AlertKind; text: string } | null) => {
    if (!value) { currentRef.current = null; setMsg(null); return; }
    if (typeof value === 'object') {
      const text = String(value.text ?? '').trim();
      if (!text) return;
      if (text === currentRef.current) { setMsg(text); return; }
      currentRef.current = text;
      setMsg(text);
      push(value.kind, text, source);
      return;
    }
    const text = String(value).trim();
    const current = currentRef.current;
    currentRef.current = text || null;
    setMsg(text || null);
    if (text && text !== current) push(kindFor(source, text), text, source);
  }, [push, source]);

  return [msg, set];
}

const TOAST_ICONS: Record<AlertKind, string> = { ok: '✓', err: '✕', warn: '!' };

/** Floating alert popups, top-right, themed via the surrounding admin shell. */
export function ToastStack() {
  const { toasts, dismissToast } = useAlerts();
  if (!toasts.length) return null;
  return (
    <div className="admin-toasts" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`admin-toast is-${t.kind}`} role="status">
          <span className="admin-toast-icon">{TOAST_ICONS[t.kind]}</span>
          <span className="admin-toast-body">
            <b>{t.message}</b>
            <small>{t.source} · {t.at}</small>
          </span>
          <button type="button" className="admin-toast-x" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
