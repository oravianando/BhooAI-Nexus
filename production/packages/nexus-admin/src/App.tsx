import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from './assets/bhooai-nexus-logo.svg';
import { SafeGotoDialog, SafeGotoLink } from '@bhooai/nexus-safe-goto';
import { AlertProvider, useAlerts, useAdminAlert, ToastStack } from './alertCenter.js';
import {
  login, registerAndLogin, setAccessToken, getAccessToken, refresh,
  getAdminConfig, putAdminConfig, putAdminConfigFile, getAdminEnv, putAdminEnv, getPlugins, getUsers, getRoles, putUserRoles, getMetrics, updateProfile, changePassword, updateProject,
  getServices, controlService, getServiceLogs,
  runPreflight,
  runLintEnv, runLintConfig,
  getPaymentOrders, getPaymentTransactions, getPaymentStatus, createPaymentOrder, updatePaymentProvider, savePaymentProviderKeys,
  getDatabases, createDatabase, deleteDatabase,
  createCollection, modifyCollection, dropCollection, getCollectionDocs,
  generateSchema, getAiStatus, getAiModels, aiChat, aiChatStream, getAiProviders, updateAiProvider, addAiProvider, deleteAiProvider, testAiProvider,
  getClusterOverview, clusterLink, clusterUnlink, clusterExec, clusterScale, clusterPoll, getClusterSetup, saveClusterSetup, clusterStart, clusterStop, generateClusterToken, getClusterNodeStatus, clusterNodeStart, clusterNodeStop,
  getAllLogs, clearLogs, type LogEntry,
  getRequestLogs, getRequestSeries, type RequestLogEntry, type RequestSeries, type RequestSeriesRange,
  type ServiceState, type AdminConfig, type AdminEnv, type EnvEntry, type DatabaseInfo, type GeneratedSchema, type PaymentProviderStatus, type PaymentProviderField, type AiStatus, type AiModelInfo, type AiChatMessage, type AiProviderView, type AiProviderPersistence, type AiProviderTestResult, type UserRecord, type RoleDefinition, type PreflightReport, type PreflightCheck, type LintReport, type ClusterNodeView, type ClusterOverview, type ClusterSetup, type ClusterNodeAgentStatus,
} from './api.js';


type Tab = 'overview' | 'processes' | 'logs' | 'config' | 'env' | 'plugins' | 'users' | 'monitoring' | 'payments' | 'databases' | 'schema' | 'ai' | 'cluster' | 'theme';
type AdminTheme = 'aurora' | 'midnight' | 'violet';
type UiMode = 'workspace' | 'compact' | 'focus';
type ToggleStyle = 'chip' | 'neon' | 'icon' | 'orb' | 'track';

const TOGGLE_STYLES: Array<{ id: ToggleStyle; label: string; hint: string }> = [
  { id: 'chip', label: 'Chip ON/OFF', hint: 'Default · glass chip' },
  { id: 'neon', label: 'Neon glass', hint: 'Blue→violet border' },
  { id: 'icon', label: 'Icon knob', hint: '⏻ → ⚡ glow' },
  { id: 'orb', label: 'Orb dot', hint: 'Pulse halo' },
  { id: 'track', label: 'Gradient-track', hint: 'Sliding trail' },
];

interface CustomTheme { active: boolean; blue: string; violet: string; pink: string; bg: string; ink: string; muted: string; mesh: number; glass: number; radius: number; toggle: ToggleStyle; }

const CUSTOM_THEME_KEY = 'nexus-admin-custom-theme';
const THEME_PRESETS: Record<AdminTheme, Omit<CustomTheme, 'active'>> = {
  aurora: { blue: '#54b7ff', violet: '#9f7bff', pink: '#f36eb8', bg: '#0b0d1a', ink: '#eef6ff', muted: '#98aec9', mesh: 0.32, glass: 0.35, radius: 13, toggle: 'chip' },
  midnight: { blue: '#78bfff', violet: '#7da5d3', pink: '#b8c7db', bg: '#02050b', ink: '#eaf3ff', muted: '#8fa6c2', mesh: 0.2, glass: 0.25, radius: 11, toggle: 'chip' },
  violet: { blue: '#b4a1ff', violet: '#d78bff', pink: '#ff8ed1', bg: '#0b071b', ink: '#f3eaff', muted: '#a592c9', mesh: 0.4, glass: 0.3, radius: 15, toggle: 'chip' },
};

function loadCustomTheme(): CustomTheme {
  const fallback: CustomTheme = { ...THEME_PRESETS.aurora, active: false };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(CUSTOM_THEME_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CustomTheme>;
      if (parsed && typeof parsed === 'object') {
        return { ...THEME_PRESETS.aurora, ...parsed, active: Boolean(parsed.active) };
      }
    }
  } catch { /* ignore corrupt value */ }
  return fallback;
}

interface ParticleConfig { amount: number; speed: number; colors: string[]; }
const PARTICLES_KEY = 'nexus-admin-particles';
const DEFAULT_PARTICLE_COLORS = ['#59d7ff', '#c68dff', '#ff8fd4', '#5ef0b3', '#d3a0ff', '#5fb6ff'];
const DEFAULT_PARTICLES: ParticleConfig = { amount: 14, speed: 1, colors: [...DEFAULT_PARTICLE_COLORS] };
const SWATCH_CPLAETTE = ['#59d7ff', '#c68dff', '#ff8fd4', '#5ef0b3', '#ffd479', '#f0995a', '#7fe3c8', '#f2a7ff'];

function loadParticles(): ParticleConfig {
  const fallback: ParticleConfig = { amount: 14, speed: 1, colors: [...DEFAULT_PARTICLE_COLORS] };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(PARTICLES_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ParticleConfig>;
      if (p && typeof p === 'object') {
        const amount = Math.max(0, Math.min(48, Math.round(Number(p.amount) || 14)));
        const speed = Math.min(3, Math.max(0.2, Number(p.speed) || 1));
        const colors = Array.isArray(p.colors) ? p.colors.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) : [];
        return { amount, speed, colors: colors.length ? colors : [...DEFAULT_PARTICLE_COLORS] };
      }
    }
  } catch { /* ignore corrupt value */ }
  return fallback;
}

function buildParticleLayout(amount: number) {
  const list: { left: number; size: number; duration: number; delay: number; dx: number; dx2: number; opacity: string }[] = [];
  for (let i = 0; i < amount; i++) {
    list.push({
      left: 1 + Math.random() * 98,
      size: 3 + Math.random() * 7,
      duration: 18 + Math.random() * 18,
      delay: Math.random() * 32,
      dx: (Math.random() - 0.5) * 70,
      dx2: (Math.random() - 0.5) * 70,
      opacity: (0.45 + Math.random() * 0.4).toFixed(2),
    });
  }
  return list;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function randomAccentPalette() {
  const base = Math.round(Math.random() * 360);
  return {
    blue: hslToHex((base + 150) % 360, 72, 64),
    violet: hslToHex((base + 60) % 360, 62, 68),
    pink: hslToHex((base + 25) % 360, 80, 72),
  };
}
function randomParticleColors(): string[] {
  const base = Math.round(Math.random() * 360);
  const count = 4 + Math.round(Math.random() * 3);
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    colors.push(hslToHex((base + i * 55) % 360, 74 + Math.round(Math.random() * 12), 60 + Math.round(Math.random() * 16)));
  }
  return colors;
}

function storedPreference<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const value = typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  return value && allowed.includes(value as T) ? value as T : fallback;
}

function formatProjectName(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return name;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface AdminUser { email?: string; name?: string; roles?: string[]; }

const USER_KEY = 'nexus-admin-user';
function readUser(): AdminUser | null {
  if (typeof window === 'undefined') return null;
  try { const raw = window.localStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) as AdminUser : null; } catch { return null; }
}

export function App() {
  const [boot, setBoot] = useState<'loading' | 'ready'>('loading');
  const [authed, setAuthed] = useState(() => !!getAccessToken());
  const [user, setUser] = useState<AdminUser | null>(readUser);

  // Restore the session from the HttpOnly refresh cookie on boot, so a page
  // reload stays logged in instead of bouncing back to the login screen.
  useEffect(() => {
    if (getAccessToken()) {
      setBoot('ready');
      return;
    }
    void refresh().then((ok) => {
      if (ok) {
        setAuthed(true);
        // Reuse any stored user; refresh() only restores the token + identity.
        setUser(readUser());
      }
      setBoot('ready');
    });
  }, []);

  if (boot === 'loading') {
    return <div className="admin-boot bg-mesh"><span className="admin-overline">Loading…</span></div>;
  }
  if (!authed) return <Login onAuthed={(u) => { setUser(u); window.localStorage.setItem(USER_KEY, JSON.stringify(u)); setAuthed(true); }} />;
  const onUserChange = (u: AdminUser) => { setUser(u); try { window.localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch { /* ignore */ } };
  return <AlertProvider><Dashboard user={user} onUserChange={onUserChange} onLogout={() => { setAccessToken(''); setUser(null); window.localStorage.removeItem(USER_KEY); setAuthed(false); }} /></AlertProvider>;
}

function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <div className="section-heading-title">
        <span className="section-heading-mark" />
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function PageHero({ kicker, title, desc, glyph, art }: { kicker: string; title: React.ReactNode; desc: string; glyph: string; art?: string }) {
  return (
    <div className="config-intro">
      <div><span className="admin-overline">{kicker}</span><h1>{title}</h1><p>{desc}</p></div>
      {art ? (
        <div className={`hero-art hero-art--${art}`}><strong>{glyph}</strong><span className="ha-a" /><span className="ha-b" /><span className="ha-c" /></div>
      ) : (
        <div className="hero-orbit-art"><span /><i /><b /><strong>{glyph}</strong></div>
      )}
    </div>
  );
}

function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!props.open) return null;
  return (
    <div className="confirm-overlay" onClick={props.onCancel}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-dialog-head">
          <span className="confirm-dialog-mark">{props.danger ? '!' : '◈'}</span>
          <strong>{props.title}</strong>
          <button className="confirm-dialog-close" onClick={props.onCancel} aria-label="Cancel">×</button>
        </div>
        <p className="confirm-dialog-message">{props.message}</p>
        <div className="confirm-dialog-actions">
          <button className="glass-chip-btn" onClick={props.onCancel}>Cancel</button>
          <button
            className={`glass-chip-btn-danger confirm-dialog-primary${props.danger ? ' danger' : ''}`}
            onClick={props.onConfirm}
            disabled={props.busy}
            autoFocus
          >
            {props.busy ? 'Working…' : (props.confirmLabel ?? 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Login({ onAuthed }: { onAuthed: (user: AdminUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [theme] = useState<AdminTheme>(() => storedPreference('nexus-admin-theme', 'aurora', ['aurora', 'midnight', 'violet']));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr('');
    setBusy(true);
    try {
      const data = mode === 'login'
        ? await login(email, password)
        : await registerAndLogin(email, password, name || email.split('@')[0]);
      onAuthed({ email: data?.user?.email ?? email, name: data?.user?.name ?? email.split('@')[0] });
    } catch (e: any) {
      const message = e?.message as string | undefined;
      setErr(
        message
          || (mode === 'login'
            ? 'Sign in failed. Please check your email and password.'
            : 'Registration failed. Please try again.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`admin-login bg-mesh theme-${theme} flex min-h-screen items-center justify-center p-4`}>
      <form onSubmit={submit} className="admin-login-card glass-card w-96 space-y-4 p-8">
        <div className="space-y-1">
           <img src={logoUrl} alt="BhooAI Nexus Admin" className="mb-4 h-auto w-64 max-w-full" />
          <h1 className="brand-text text-2xl font-bold">Admin control panel</h1>
          <p className="text-sm text-slate-400">
            {mode === 'login' ? 'Sign in to manage the project.' : 'The first registered user becomes admin.'}
          </p>
        </div>
        {mode === 'register' && (
          <input className="glass-input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        <input className="glass-input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <input className="glass-input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        {err && (
          <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
            {err}
          </div>
        )}
        <button className="glass-btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Register & sign in'}
        </button>
        <button type="button" className="w-full cursor-pointer text-sm text-slate-400 transition-colors hover:text-slate-200" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Need an account? Register' : 'Already have one? Sign in'}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ user, onUserChange, onLogout }: { user: AdminUser | null; onUserChange: (u: AdminUser) => void; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [railOpen, setRailOpen] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const railPanelRef = useRef<HTMLDivElement | null>(null);
  const notifyRef = useRef<HTMLDivElement | null>(null);
  const FAVORITES_KEY = 'nexus-admin-favorites';
  const ACTIVITY_KEY = 'nexus-admin-activity';
  const NOTES_KEY = 'nexus-admin-notes';
  const [favorites, setFavorites] = useState<Tab[]>(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITES_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as Tab[];
        if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) return arr;
      }
    } catch { /* ignore */ }
    return ['overview', 'config', 'env', 'logs'];
  });
  const [notes, setNotes] = useState<string>(() => {
    try { return window.localStorage.getItem(NOTES_KEY) ?? ''; } catch { return ''; }
  });
  const [activity, setActivity] = useState<{ at: string; label: string }[]>(() => {
    try {
      const raw = window.localStorage.getItem(ACTIVITY_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as { at: string; label: string }[];
        if (Array.isArray(arr)) return arr.slice(0, 20);
      }
    } catch { /* ignore */ }
    return [];
  });
  const saveNotes = (v: string) => { setNotes(v); try { window.localStorage.setItem(NOTES_KEY, v); } catch { /* ignore */ } };
  const toggleFavorite = (id: Tab) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const goTab = (id: Tab) => {
    setTab(id);
    setMobileNav(false);
    setSearch('');
    setSearchOpen(false);
    setRailOpen(null);
    const label = nav.find((n) => n.id === id)?.label ?? id;
    setActivity((prev) => {
      const next = [{ at: new Date().toLocaleTimeString(), label }, ...prev].slice(0, 20);
      try { window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const [theme, setTheme] = useState<AdminTheme>(() => storedPreference('nexus-admin-theme', 'aurora', ['aurora', 'midnight', 'violet']));
  const [uiMode, setUiMode] = useState<UiMode>(() => storedPreference('nexus-admin-ui', 'workspace', ['workspace', 'compact', 'focus']));
  const [customTheme, setCustomTheme] = useState<CustomTheme>(() => loadCustomTheme());
  const updateCustomTheme = (partial: Partial<CustomTheme>) => {
    setCustomTheme((prev) => {
      const next = { ...prev, ...partial };
      try { window.localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };
  const [particles, setParticles] = useState<ParticleConfig>(() => loadParticles());
  const updateParticles = (partial: Partial<ParticleConfig>) => {
    setParticles((prev) => {
      const next = { ...prev, ...partial };
      try { window.localStorage.setItem(PARTICLES_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  };
  const particleLayout = useMemo(() => buildParticleLayout(particles.amount), [particles.amount]);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { alerts } = useAlerts();
  const accountRef = useRef<HTMLDivElement | null>(null);
  const appearanceRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!accountOpen && !appearanceOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (accountOpen && accountRef.current && !accountRef.current.contains(target)) setAccountOpen(false);
      if (appearanceOpen && appearanceRef.current && !appearanceRef.current.contains(target)) setAppearanceOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [accountOpen, appearanceOpen]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (railOpen && !(railRef.current?.contains(e.target as Node) || railPanelRef.current?.contains(e.target as Node) || notifyRef.current?.contains(e.target as Node))) setRailOpen(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [railOpen]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchOpen && searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [searchOpen]);
  useEffect(() => {
    if (!mobileNav) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el && sidebarRef.current && !sidebarRef.current.contains(el) && !el.closest('.admin-mobile-menu')) setMobileNav(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [mobileNav]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [projectName, setProjectName] = useState('');
  const [projectDb, setProjectDb] = useState('');
  const [projectVersion, setProjectVersion] = useState('');
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const load = async () => {
      if (cancelled) return;
      try {
        const c = await getAdminConfig();
        const name = c.project?.name ?? '';
        if (name) { setProjectName(name); setProjectDb(c.project?.dbName ?? ''); setProjectVersion(c.project?.version ?? ''); return; }
      } catch { /* retry below */ }
      if (!cancelled && tries < 15) { tries += 1; window.setTimeout(load, 1500); }
    };
    void load();
    return () => { cancelled = true; };
  }, []);
  const [shellWidth] = useState(() => Math.round((typeof window === 'undefined' ? 0 : window.screen.width) * 0.8));
  const displayName = user?.name || user?.email?.split('@')[0] || 'Admin';
  const initials = displayName.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
  const nav: { id: Tab; label: string; icon: string; keywords?: string[]; desc?: string }[] = [
    { id: 'overview', label: 'Overview', icon: '⌂', keywords: ['home', 'dashboard', 'project', 'summary'], desc: 'Project overview, services pulse and quick links.' },
    { id: 'processes', label: 'Processes', icon: '◈', keywords: ['services', 'supervisor', 'dev', 'run', 'terminal', 'server'], desc: 'Live service states with start/stop/restart control.' },
    { id: 'logs', label: 'Logs', icon: '▤', keywords: ['console', 'error', 'output', 'stdout', 'stderr', 'supervisor'], desc: 'Aggregated service output, filterable and searchable.' },
    { id: 'config', label: 'Config JSON', icon: '{}', keywords: ['configuration', 'runtime', 'settings', 'json', 'source file', 'nexus.config'], desc: 'Runtime overrides are stored in nexus.runtime.json.' },
    { id: 'env', label: 'Environment', icon: '⌁', keywords: ['dotenv', 'variables', 'secrets', 'keys', '.env'], desc: 'Masked environment values are ready to edit.' },
    { id: 'plugins', label: 'Plugins', icon: '◇', keywords: ['extensions', 'modules', 'addons', 'gallery'], desc: 'Registered plugin pages, slots and surfaces.' },
    { id: 'users', label: 'Users', icon: '◎', keywords: ['roles', 'permissions', 'accounts', 'team', 'access', 'rbac'], desc: 'Accounts, roles and permission grants.' },
    { id: 'monitoring', label: 'Monitoring', icon: '⌁', keywords: ['metrics', 'telemetry', 'health', 'uptime', 'traffic', 'stats'], desc: 'Live backend metrics and request traffic.' },
    { id: 'payments', label: 'Payments', icon: '$', keywords: ['orders', 'transactions', 'money', 'ledger', 'checkout', 'razorpay', 'paypal', 'stripe'], desc: 'Orders, transactions and provider status.' },
    { id: 'databases', label: 'Databases', icon: '▦', keywords: ['mongo', 'mongodb', 'collections', 'data', 'tables', 'docs'], desc: 'Databases, collections and their documents.' },
    { id: 'schema', label: 'AI Schema', icon: '✦', keywords: ['generate', 'ai', 'model', 'json schema', 'validator'], desc: 'Generate MongoDB schemas from plain English.' },
    { id: 'ai', label: 'AI Agents', icon: '◎', keywords: ['providers', 'chat', 'playground', 'ollama', 'openai', 'models', 'settings'], desc: 'AI settings, providers and chat playground.' },
    { id: 'cluster', label: 'Cluster', icon: '⬡', keywords: ['nodes', 'mesh', 'load balancer', 'scale', 'master', 'slave', 'link'], desc: 'Link and supervise servers as cluster nodes.' },
    { id: 'theme', label: 'Theme Centre', icon: '◒', keywords: ['appearance', 'colors', 'palette', 'ui', 'customize', 'surface'], desc: 'Curated themes, palettes and surface tuning.' },
  ];
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return nav.filter((n) => {
      if (n.label.toLowerCase().includes(q)) return true;
      return (n.keywords ?? []).some((k) => k.toLowerCase().includes(q));
    });
  }, [search, nav]);
  const title = nav.find((item) => item.id === tab)?.label ?? 'Overview';
  const displayProject = projectName ? formatProjectName(projectName) : '';
  const shellStyle: React.CSSProperties = {
    ['--admin-shell-width' as string]: `${shellWidth}px`,
    ['--admin-mesh' as string]: String(customTheme.mesh),
    ['--admin-glass' as string]: String(customTheme.glass),
    ['--admin-radius' as string]: `${customTheme.radius}px`,
    ['--admin-mesh-opacity' as string]: String(0.2 + customTheme.mesh * 0.8),
  };
  if (customTheme.active) {
    Object.assign(shellStyle, {
      ['--admin-blue' as string]: customTheme.blue,
      ['--admin-violet' as string]: customTheme.violet,
      ['--admin-pink' as string]: customTheme.pink,
      ['--admin-bg' as string]: customTheme.bg,
      ['--admin-ink' as string]: customTheme.ink,
      ['--admin-muted' as string]: customTheme.muted,
      background: `radial-gradient(60rem 60rem at 85% -10%, color-mix(in srgb, ${customTheme.violet} ${Math.round(28 + customTheme.mesh * 34)}%, transparent), transparent 70%), radial-gradient(50rem 50rem at -10% 110%, color-mix(in srgb, ${customTheme.blue} ${Math.round(24 + customTheme.mesh * 30)}%, transparent), transparent 70%), radial-gradient(45rem 45rem at 50% 50%, color-mix(in srgb, ${customTheme.pink} ${Math.round(14 + customTheme.mesh * 22)}%, transparent), transparent 70%), ${customTheme.bg}`,
    });
  }
  const particleColors = particles.colors.length ? particles.colors : DEFAULT_PARTICLE_COLORS;
  return (
    <div className={`admin-shell bg-mesh theme-${theme} ui-${uiMode}`} style={shellStyle}>
      <div className="admin-particles" aria-hidden="true">
        {particleLayout.map((p, i) => {
          const color = particleColors[i % particleColors.length];
          return (
            <i key={i} style={{
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: `radial-gradient(circle, ${color}, transparent 72%)`,
              animation: `admin-float ${(p.duration / particles.speed).toFixed(2)}s linear infinite`,
              animationDelay: `-${p.delay.toFixed(2)}s`,
              ['--dx' as string]: `${p.dx}px`,
              ['--dx2' as string]: `${p.dx2}px`,
              ['--o' as string]: p.opacity,
            }} />
          );
        })}
      </div>
      <aside ref={sidebarRef} className={`admin-sidebar ${mobileNav ? 'is-open' : ''}`}>
        <div className="admin-brand">
          <img src={logoUrl} alt="BhooAI Nexus" />
          <div>
            <strong>NEXUS</strong>
            <span>Admin workspace</span>
          </div>
          <button className="admin-close-mobile" onClick={() => setMobileNav(false)} aria-label="Close navigation">×</button>
        </div>
        <div className="admin-project-card">
          <span className="admin-overline">ACTIVE PROJECT</span>
          <strong>{displayProject || 'Loading…'}</strong>
          {projectDb && <em className="admin-project-db">db · {projectDb}</em>}
          <span><i className="status-dot good" /> Development</span>
        </div>
        <div className="admin-nav-label">Workspace</div>
        <nav className="admin-nav">
          {nav.slice(0, 5).map((n) => (
            <button key={n.id} onClick={() => { setTab(n.id); setMobileNav(false); }} className={tab === n.id ? 'is-active' : ''}>
              <span className="admin-nav-icon">{n.icon}</span>{n.label}
              {n.id === 'env' && <b>NEW</b>}
            </button>
          ))}
        </nav>
        <div className="admin-nav-label">Operations</div>
        <nav className="admin-nav">
          {nav.slice(5).map((n) => (
            <button key={n.id} onClick={() => { setTab(n.id); setMobileNav(false); }} className={tab === n.id ? 'is-active' : ''}>
              <span className="admin-nav-icon">{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="admin-main-shell">
        <header className={`admin-topbar${mobileSearch ? ' is-mobile-search' : ''}`}>
          <button className="admin-mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation">☰</button>
          <div className="admin-window-tab"><span className="window-tab-mark">◈</span><strong>{title}</strong></div>
          <div className="admin-search" ref={searchRef}>
            <span>⌕</span>
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchResults.length) {
                  e.preventDefault();
                  setTab(searchResults[0].id);
                  setSearch('');
                  setSearchOpen(false);
                  setMobileSearch(false);
                } else if (e.key === 'Escape') {
                  setSearch('');
                  setSearchOpen(false);
                  setMobileSearch(false);
                  searchInputRef.current?.blur();
                }
              }}
              placeholder="Search workspace"
            />
            <kbd>⌘ K</kbd>
            {searchOpen && search.length > 0 && (
              <div className="admin-search-results">
                {searchResults.length === 0 ? (
                  <div className="admin-search-empty">No matches for “{search}”</div>
                ) : (
                  searchResults.map((n) => (
                    <button key={n.id} className={tab === n.id ? 'is-active' : ''} onMouseDown={(e) => { e.preventDefault(); setTab(n.id); setSearch(''); setSearchOpen(false); setMobileSearch(false); }}>
                      <span className="admin-search-result-icon">{n.icon}</span>{n.label}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="admin-top-actions">
            <span className="top-live"><i className="status-dot good" /> All systems nominal</span>
            <button className="admin-mobile-search" aria-label="Search" aria-expanded={mobileSearch} onClick={() => {
              const next = !mobileSearch;
              setMobileSearch(next);
              if (next) {
                setAppearanceOpen(false);
                setAccountOpen(false);
                window.setTimeout(() => { searchInputRef.current?.focus(); setSearchOpen(true); }, 60);
              } else {
                setSearch('');
                setSearchOpen(false);
              }
            }}>{mobileSearch ? '×' : '⌕'}</button>
            <div ref={appearanceRef} className="admin-account">
              <button className="admin-icon-button" onClick={() => { setAppearanceOpen(!appearanceOpen); setAccountOpen(false); }} aria-label="Open appearance settings" aria-expanded={appearanceOpen}>◒</button>
              {appearanceOpen && <AppearancePanel theme={theme} uiMode={uiMode} onThemeChange={(value) => { setTheme(value); window.localStorage.setItem('nexus-admin-theme', value); }} onUiModeChange={(value) => { setUiMode(value); window.localStorage.setItem('nexus-admin-ui', value); }} />}
            </div>
            <div className="admin-notify" ref={notifyRef}>
              <button className={`admin-icon-button${railOpen === 'notify' ? ' is-active' : ''}`} aria-label="Notifications" aria-expanded={railOpen === 'notify'} onClick={() => setRailOpen(railOpen === 'notify' ? null : 'notify')}>⌁{alerts.length > 0 && <b>{alerts.length > 99 ? '99+' : alerts.length}</b>}</button>
              {railOpen === 'notify' && <NotifyPanel onClose={() => setRailOpen(null)} />}
            </div>
            <div className="admin-account" ref={accountRef}>
              <button className="admin-user-avatar" aria-label="Account" aria-expanded={accountOpen} onClick={() => { setAccountOpen(!accountOpen); setAppearanceOpen(false); }}>{initials}</button>
              {accountOpen && (
                <div className="account-panel">
                  <div className="account-head">
                    <span className="account-avatar">{initials}</span>
                    <span className="account-meta">
                      <strong>{displayName}</strong>
                      <small>{user?.email ?? 'admin@bhooai.local'}</small>
                    </span>
                  </div>
                  <div className="account-divider" />
                  <button className="account-item" onClick={() => { setSettingsOpen(true); setAccountOpen(false); }}>
                    <span className="account-item-icon">⚙</span><span><b>Settings</b><small>Profile, security, project & package</small></span>
                  </button>
                  <button className="account-item account-danger" onClick={onLogout}>
                    <span className="account-item-icon">↪</span><span><b>Sign out</b><small>End this session</small></span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="admin-breadcrumb"><strong>{displayProject || 'Project'}</strong><b>›</b><span>{title}</span><button>⋯</button></div>
        <div className="admin-content-layout">
          <main className="admin-content">
            {tab === 'overview' && <Overview onNavigate={setTab} />}
            {tab === 'processes' && <Processes />}
            {tab === 'logs' && <Logs onNavigate={setTab} />}
            {tab === 'config' && <Config onNavigate={setTab} />}
            {tab === 'env' && <Environment onNavigate={setTab} />}
            {tab === 'plugins' && <Plugins />}
            {tab === 'users' && <Users currentUserEmail={user?.email} />}
            {tab === 'monitoring' && <Monitoring />}
            {tab === 'payments' && <Payments toggle={customTheme.toggle} />}
            {tab === 'databases' && <Databases />}
            {tab === 'schema' && <Schema />}
            {tab === 'ai' && <AiAgents toggle={customTheme.toggle} />}
            {tab === 'cluster' && <Cluster />}
            {tab === 'theme' && <ThemeCentre theme={theme} onThemeChange={(value) => { setTheme(value); window.localStorage.setItem('nexus-admin-theme', value); }} uiMode={uiMode} onUiModeChange={(value) => { setUiMode(value); window.localStorage.setItem('nexus-admin-ui', value); }} custom={customTheme} onCustom={updateCustomTheme} particles={particles} onParticles={updateParticles} />}
          </main>
          <aside className="admin-inspector">
            <div className="inspector-heading"><span>WORKSPACE INSPECTOR</span><button aria-label="Close inspector">×</button></div>
            <div className="inspector-preview"><div className="preview-orbit"><span /><i /><b /></div><strong>Project Nexus</strong><span>Full-stack application</span></div>
            <div className="inspector-tabs"><b>Summary</b><span>Activity</span></div>
            <div className="inspector-card"><span className="admin-overline">CURRENT SURFACE</span><strong>{title}</strong><p>{nav.find((item) => item.id === tab)?.desc ?? 'Manage the running Nexus project from this workspace.'}</p></div>
            <div className="inspector-card inspector-list"><span className="admin-overline">QUICK LINKS</span><button onClick={() => setTab('config')}>Configuration <b>→</b></button><button onClick={() => setTab('env')}>Environment <b>→</b></button><button onClick={() => setTab('logs')}>Logs <b>→</b></button></div>
            <button className="glass-chip-btn-primary w-full justify-between" onClick={() => setTab('overview')}>⌁ Open project overview <span>→</span></button>
            <div className="admin-side-widget">
              <div className="admin-widget-heading"><span>RUNTIME LOAD</span><b>LIVE</b></div>
              <div className="load-line"><span>CPU</span><i><b style={{ width: '32%' }} /></i><strong>32%</strong></div>
              <div className="load-line"><span>MEM</span><i><b style={{ width: '61%' }} /></i><strong>61%</strong></div>
              <div className="load-line"><span>DB</span><i><b className="violet" style={{ width: '44%' }} /></i><strong>44%</strong></div>
            </div>
          </aside>
        </div>
        <div className="admin-tool-rail" ref={railRef}>
          <button data-tip="Smart search" className={railOpen === 'search' ? 'is-active' : ''} onClick={() => { setRailOpen(railOpen === 'search' ? null : 'search'); if (railOpen !== 'search') { searchInputRef.current?.focus(); setSearchOpen(true); } }}>⌕</button>
          <button data-tip="AI Notes" className={railOpen === 'notes' ? 'is-active' : ''} onClick={() => setRailOpen(railOpen === 'notes' ? null : 'notes')}>▣</button>
          <button data-tip="Screen recall" className={railOpen === 'activity' ? 'is-active' : ''} onClick={() => setRailOpen(railOpen === 'activity' ? null : 'activity')}>◫</button>
        </div>
        {railOpen && railOpen !== 'notify' && (
          <div ref={railPanelRef}>
            <RailPanel
              open={railOpen}
              onClose={() => setRailOpen(null)}
              nav={nav}
              tab={tab}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              onGo={goTab}
              notes={notes}
              onNotes={saveNotes}
              activity={activity}
              onClearActivity={() => { setActivity([]); try { window.localStorage.removeItem(ACTIVITY_KEY); } catch { /* ignore */ } }}
              onSearch={() => { setRailOpen(null); searchInputRef.current?.focus(); setSearchOpen(true); }}
              theme={theme}
              onThemeChange={(value) => { setTheme(value); window.localStorage.setItem('nexus-admin-theme', value); }}
              uiMode={uiMode}
              onUiModeChange={(value) => { setUiMode(value); window.localStorage.setItem('nexus-admin-ui', value); }}
            />
          </div>
        )}
        <footer className="admin-dock"><span><b className="dock-logo">◈</b> BhooAI Nexus</span><span>Connected to <strong>localhost:4000</strong></span><span className="dock-right"><i className="status-dot good" /> Secure admin session · {title}</span></footer>
      </div>
      <SafeGotoDialog />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user}
        onUserChange={onUserChange}
        projectName={projectName}
        projectDb={projectDb}
        projectVersion={projectVersion}
        onProjectChange={(name, version) => {
          if (name) setProjectName(name);
          if (version) setProjectVersion(version);
        }}
      />
      <ToastStack />
    </div>
  );
}

function formatUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function SettingsDialog({ open, onClose, user, onUserChange, projectName, projectDb, projectVersion, onProjectChange }: {
  open: boolean;
  onClose: () => void;
  user: AdminUser | null;
  onUserChange: (u: AdminUser) => void;
  projectName: string;
  projectDb: string;
  projectVersion: string;
  onProjectChange: (name?: string, version?: string) => void;
}) {
  const isAdmin = Array.isArray(user?.roles) && (user!.roles as string[]).includes('admin');
  const [nameDraft, setNameDraft] = useState(user?.name ?? '');
  const [profileMsg, setProfileMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pkgName, setPkgName] = useState(projectName);
  const [pkgVersion, setPkgVersion] = useState(projectVersion);
  const [pkgMsg, setPkgMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [about, setAbout] = useState<{ path?: string; version?: string | null; node?: string; uptime?: number; pid?: number } | null>(null);
  const { push } = useAlerts();

  useEffect(() => {
    if (!open) return;
    setNameDraft(user?.name ?? '');
    setCurPw(''); setNewPw(''); setConfirmPw('');
    setProfileMsg(null); setPwMsg(null); setPkgMsg(null);
    setPkgName(projectName); setPkgVersion(projectVersion);
    setAbout(null);
    let cancelled = false;
    void Promise.all([getAdminConfig().catch(() => null), getMetrics().catch(() => null)]).then(([c, m]) => {
      if (cancelled) return;
      const proj = c?.project as AdminConfig['project'] | undefined;
      setPkgName(proj?.name ?? projectName);
      setPkgVersion(proj?.version ?? m?.version ?? projectVersion);
      setAbout({
        path: proj?.path,
        version: m?.version ?? proj?.version ?? null,
        node: m?.node ?? null,
        uptime: m?.uptime,
        pid: m?.pid,
      });
    });
    return () => { cancelled = true; };
  }, [open, user, projectName, projectVersion]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const saveProfile = async () => {
    const name = nameDraft.trim();
    if (!name) { setProfileMsg({ text: 'Name is required.', kind: 'err' }); return; }
    const prevName = user?.name ?? '';
    if (name === prevName) { setProfileMsg({ text: 'Display name is unchanged.', kind: 'ok' }); return; }
    setProfileBusy(true); setProfileMsg(null);
    try {
      const res = await updateProfile(name);
      onUserChange((res.user ?? { ...(user ?? {}), name }) as AdminUser);
      setProfileMsg({ text: `Display name changed to "${name}".`, kind: 'ok' });
      push('ok', `Display name changed to "${name}".`, 'settings');
    } catch (e) {
      setProfileMsg({ text: e instanceof Error ? e.message : 'Failed to save profile.', kind: 'err' });
    } finally {
      setProfileBusy(false);
    }
  };

  const savePassword = async () => {
    if (newPw.length < 8) { setPwMsg({ text: 'New password must be at least 8 characters.', kind: 'err' }); return; }
    if (newPw !== confirmPw) { setPwMsg({ text: 'Passwords do not match.', kind: 'err' }); return; }
    setPwBusy(true); setPwMsg(null);
    try {
      await changePassword(curPw, newPw);
      setCurPw(''); setNewPw(''); setConfirmPw('');
      setPwMsg({ text: 'Password updated.', kind: 'ok' });
    } catch (e) {
      setPwMsg({ text: e instanceof Error ? e.message : 'Failed to change password.', kind: 'err' });
    } finally {
      setPwBusy(false);
    }
  };

  const savePackage = async () => {
    const patch: { name?: string; version?: string } = {};
    const name = pkgName.trim();
    if (name && name !== projectName) patch.name = name;
    const version = pkgVersion.trim();
    if (version && version !== (about?.version ?? projectVersion)) patch.version = version;
    if (!patch.name && !patch.version) { setPkgMsg({ text: 'Nothing to update.', kind: 'err' }); return; }
    setPkgBusy(true); setPkgMsg(null);
    try {
      const res = await updateProject(patch);
      const proj = res.project as { name?: string; version?: string } | undefined;
      if (proj?.name) onProjectChange(proj.name);
      if (proj?.version) onProjectChange(undefined, proj.version);
      if (proj?.version) setAbout((prev) => ({ ...(prev ?? {}), version: proj!.version ?? prev?.version }));
      setPkgName(proj?.name ?? projectName);
      setPkgVersion(proj?.version ?? about?.version ?? projectVersion);
      setPkgMsg({ text: 'package.json updated. Restart the backend to pick up changes.', kind: 'ok' });
    } catch (e) {
      setPkgMsg({ text: e instanceof Error ? e.message : 'Failed to update package.', kind: 'err' });
    } finally {
      setPkgBusy(false);
    }
  };

  const statusLine = (msg: { text: string; kind: 'ok' | 'err' } | null) =>
    msg ? <div role="status" className={`settings-status ${msg.kind}`}>{msg.text}</div> : null;

  return (
    <div className="provider-modal-backdrop" onClick={onClose}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <div>
            <span className="admin-overline">ACCOUNT & WORKSPACE</span>
            <h3 id="settings-title">Settings</h3>
          </div>
          <button type="button" onClick={onClose} className="glass-chip-btn" aria-label="Close settings">✕</button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h4>Profile</h4>
            <p className="settings-desc">Your display name across the admin workspace.</p>
            <div className="settings-row">
              <label className="settings-field">
                <span className="admin-overline">DISPLAY NAME</span>
                <input className="glass-input" type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              </label>
              <label className="settings-field">
                <span className="admin-overline">EMAIL</span>
                <input className="glass-input" type="text" readOnly value={user?.email ?? ''} aria-readonly="true" />
              </label>
            </div>
            {statusLine(profileMsg)}
            <div className="settings-actions">
              <button type="button" onClick={saveProfile} disabled={profileBusy} className="glass-chip-btn-primary">{profileBusy ? 'Saving…' : 'Save profile'}</button>
            </div>
          </section>

          <section className="settings-section">
            <h4>Security</h4>
            <p className="settings-desc">Change the password for this account.</p>
            <div className="settings-row">
              <label className="settings-field">
                <span className="admin-overline">CURRENT PASSWORD</span>
                <input className="glass-input" type="password" autoComplete="current-password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
              </label>
            </div>
            <div className="settings-row">
              <label className="settings-field">
                <span className="admin-overline">NEW PASSWORD</span>
                <input className="glass-input" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              </label>
              <label className="settings-field">
                <span className="admin-overline">CONFIRM PASSWORD</span>
                <input className="glass-input" type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
              </label>
            </div>
            {statusLine(pwMsg)}
            <div className="settings-actions">
              <button type="button" onClick={savePassword} disabled={pwBusy} className="glass-chip-btn-primary">{pwBusy ? 'Updating…' : 'Change password'}</button>
            </div>
          </section>

          <section className="settings-section">
            <h4>About</h4>
            <div className="settings-facts">
              <div><span>Package</span><b>{projectName || '—'}</b></div>
              <div><span>Version</span><b>{about?.version ?? (projectVersion || '—')}</b></div>
              <div><span>Database</span><b>{projectDb || '—'}</b></div>
              <div><span>Path</span><b>{about?.path ?? '—'}</b></div>
              <div><span>Node.js</span><b>{about?.node ?? '—'}</b></div>
              <div><span>Uptime</span><b>{formatUptime(about?.uptime)}</b></div>
              <div><span>PID</span><b>{about?.pid ?? '—'}</b></div>
            </div>
            {isAdmin && (
              <div className="settings-package">
                <div className="settings-row">
                  <label className="settings-field">
                    <span className="admin-overline">PACKAGE NAME</span>
                    <input className="glass-input" type="text" value={pkgName} onChange={(e) => setPkgName(e.target.value)} />
                  </label>
                  <label className="settings-field">
                    <span className="admin-overline">VERSION</span>
                    <input className="glass-input" type="text" value={pkgVersion} onChange={(e) => setPkgVersion(e.target.value)} placeholder="1.0.0" />
                  </label>
                </div>
                {statusLine(pkgMsg)}
                <div className="settings-actions">
                  <button type="button" onClick={savePackage} disabled={pkgBusy} className="glass-chip-btn-primary">{pkgBusy ? 'Updating…' : 'Update package'}</button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function AppearancePanel({
  theme,
  uiMode,
  onThemeChange,
  onUiModeChange,
}: {
  theme: AdminTheme;
  uiMode: UiMode;
  onThemeChange: (theme: AdminTheme) => void;
  onUiModeChange: (mode: UiMode) => void;
}) {
  return (
    <div className="appearance-panel">
      <div className="appearance-heading"><span className="admin-overline">APPEARANCE</span><span>LOCAL</span></div>
      <strong>Choose your surface</strong>
      <div className="appearance-options">
        {([['aurora', 'Aurora', 'Electric blue'], ['midnight', 'Midnight', 'Deep navy'], ['violet', 'Violet', 'Indigo glow']] as const).map(([id, label, detail]) => (
          <button key={id} onClick={() => onThemeChange(id)} className={theme === id ? 'is-selected' : ''}>
            <span className={`theme-preview ${id}`} />
            <span><b>{label}</b><small>{detail}</small></span>
            {theme === id && <i>✓</i>}
          </button>
        ))}
      </div>
      <div className="appearance-divider" />
      <span className="admin-overline">INTERFACE MODE</span>
      <div className="ui-mode-options">
        {([['workspace', 'Workspace', 'Inspector + tools'], ['compact', 'Compact', 'More content'], ['focus', 'Focus', 'Canvas first']] as const).map(([id, label, detail]) => (
          <button key={id} onClick={() => onUiModeChange(id)} className={uiMode === id ? 'is-selected' : ''}><span>{label}</span><small>{detail}</small></button>
        ))}
      </div>
    </div>
  );
}

function RailPanel({
  open,
  onClose,
  nav,
  tab,
  favorites,
  onToggleFavorite,
  onGo,
  notes,
  onNotes,
  activity,
  onClearActivity,
  onSearch,
  theme,
  onThemeChange,
  uiMode,
  onUiModeChange,
}: {
  open: string;
  onClose: () => void;
  nav: { id: Tab; label: string; icon: string; keywords?: string[]; desc?: string }[];
  tab: Tab;
  favorites: Tab[];
  onToggleFavorite: (id: Tab) => void;
  onGo: (id: Tab) => void;
  notes: string;
  onNotes: (v: string) => void;
  activity: { at: string; label: string }[];
  onClearActivity: () => void;
  onSearch: () => void;
  theme: AdminTheme;
  onThemeChange: (theme: AdminTheme) => void;
  uiMode: UiMode;
  onUiModeChange: (mode: UiMode) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open || open === 'notify') return null;

  return (
    <div className="rail-panel" role="dialog" aria-modal="false">
      {open === 'search' && (
        <>
          <div className="rail-panel-head"><span className="admin-overline">SMART SEARCH</span></div>
          <p className="rail-panel-text">Press <kbd>⌘ K</kbd> (or <kbd>Ctrl K</kbd>) to jump to any surface from the top search bar — or click below to focus it now.</p>
          <button type="button" className="glass-chip-btn-primary w-full justify-center" onClick={onSearch}>⌕ Focus search</button>
          <div className="rail-divider" />
          <span className="rail-panel-hint">Try: roles, mongo, palette, stripe, ollama, payments…</span>
        </>
      )}

      {open === 'notes' && (
        <>
          <div className="rail-panel-head"><span className="admin-overline">AI NOTES</span><button type="button" className="rail-x" onClick={onClose} aria-label="Close">×</button></div>
          <p className="rail-panel-text">Jot quick notes — saved locally in your browser.</p>
          <textarea className="rail-notes" value={notes} onChange={(e) => onNotes(e.target.value)} placeholder="Type a note…" spellCheck={false} />
          <div className="rail-row">
            <button type="button" className="glass-chip-btn" onClick={() => onNotes('')}>Clear</button>
            <span className="rail-panel-hint">{notes.length} chars</span>
          </div>
        </>
      )}

      {open === 'activity' && (
        <>
          <div className="rail-panel-head"><span className="admin-overline">SCREEN RECALL</span><button type="button" className="rail-x" onClick={onClose} aria-label="Close">×</button></div>
          <p className="rail-panel-text">Your recent admin activity.</p>
          {activity.length === 0 ? (
            <p className="rail-empty">No activity yet.</p>
          ) : (
            <ul className="rail-list">
              {activity.map((a, i) => (
                <li key={i}><b>{a.label}</b><span>{a.at}</span></li>
              ))}
            </ul>
          )}
          <div className="rail-row"><button type="button" className="glass-chip-btn" onClick={onClearActivity}>Clear activity</button></div>
        </>
      )}

      {open === 'appearance' && (
        <>
          <div className="rail-panel-head"><span className="admin-overline">APPEARANCE</span><button type="button" className="rail-x" onClick={onClose} aria-label="Close">×</button></div>
          <span className="rail-panel-hint">Choose your surface</span>
          <div className="rail-appearance">
            {([['aurora', 'Aurora', 'Electric blue'], ['midnight', 'Midnight', 'Deep navy'], ['violet', 'Violet', 'Indigo glow']] as const).map(([id, label, detail]) => (
              <button key={id} onClick={() => onThemeChange(id)} className={theme === id ? 'is-selected' : ''}>
                <span className={`theme-preview ${id}`} />
                <span className="rail-appearance-label"><b>{label}</b><small>{detail}</small></span>
                {theme === id && <i>✓</i>}
              </button>
            ))}
          </div>
          <div className="rail-divider" />
          <span className="rail-panel-hint">Interface mode</span>
          <div className="rail-appearance">
            {([['workspace', 'Workspace', 'Inspector + tools'], ['compact', 'Compact', 'More content'], ['focus', 'Focus', 'Canvas first']] as const).map(([id, label, detail]) => (
              <button key={id} onClick={() => onUiModeChange(id)} className={uiMode === id ? 'is-selected' : ''}>
                <span className="rail-appearance-label"><b>{label}</b><small>{detail}</small></span>
                {uiMode === id && <i>✓</i>}
              </button>
            ))}
          </div>
        </>
      )}

      {open === 'launcher' && (
        <>
          <div className="rail-panel-head"><span className="admin-overline">ADD TOOL</span><button type="button" className="rail-x" onClick={onClose} aria-label="Close">×</button></div>
          <p className="rail-panel-text">Pin your most-used surfaces to the tool rail. Click to toggle.</p>
          <ul className="rail-list rail-list--nav">
            {nav.map((n) => (
              <li key={n.id}>
                <button type="button" className={favorites.includes(n.id) ? 'is-on' : ''} onClick={() => onToggleFavorite(n.id)}>
                  <span className="rail-fav-icon">{n.icon}</span><span className="rail-fav-label">{n.label}</span><span className="rail-fav-check">{favorites.includes(n.id) ? '✓' : '+'}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function NotifyPanel({ onClose }: { onClose: () => void }) {
  const [notify, setNotify] = useState<LogEntry[] | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const { alerts, clear: clearAlerts, dismiss: dismissAlert } = useAlerts();

  const loadNotify = async () => {
    setNotifyBusy(true);
    try { setNotify(await getAllLogs({ level: 'error' })); } catch { setNotify([]); }
    finally { setNotifyBusy(false); }
  };

  useEffect(() => {
    void loadNotify();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const errs = alerts.filter((a) => a.kind === 'err').length;
  const warns = alerts.filter((a) => a.kind === 'warn').length;
  const oks = alerts.length - errs - warns;
  const loading = notify === null;
  const hasAlerts = alerts.length > 0;
  const hasLogs = (notify?.length ?? 0) > 0;
  const hasAny = hasAlerts || hasLogs;

  return (
    <div className="notify-panel" role="dialog" aria-modal="false">
      <div className="notify-head">
        <span className="notify-head-icon">⌁</span>
        <div className="notify-head-titles">
          <span className="admin-overline">NOTIFICATIONS</span>
          <strong>{hasAny ? `${alerts.length + (notify?.length ?? 0)} notification${alerts.length + (notify?.length ?? 0) === 1 ? '' : 's'}` : 'All clear'}</strong>
        </div>
        <button type="button" className="notify-refresh" aria-label="Refresh notifications" onClick={() => void loadNotify()} disabled={notifyBusy}>{notifyBusy ? '…' : '↻'}</button>
        <button type="button" className="rail-x" aria-label="Close notifications" onClick={onClose}>×</button>
      </div>

      <div className="notify-body">
        {hasAny ? (
          <>
            <div className="notify-summary">
              {errs > 0 && <span className="is-err">● {errs} error{errs === 1 ? '' : 's'}</span>}
              {warns > 0 && <span className="is-warn">● {warns} warning{warns === 1 ? '' : 's'}</span>}
              {oks > 0 && <span className="is-ok">● {oks} notice{oks === 1 ? '' : 's'}</span>}
              {hasLogs && <span className="is-log">● {notify!.length} log line{(notify?.length ?? 0) === 1 ? '' : 's'}</span>}
            </div>

            {hasAlerts && (
              <>
                <div className="notify-section-title">
                  <span>ADMIN ALERTS</span>
                  <button type="button" onClick={clearAlerts} disabled={alerts.length === 0}>Clear all</button>
                </div>
                <ul className="notify-alerts">
                  {alerts.slice(0, 8).map((a) => (
                    <li key={a.id} className={`is-${a.kind}`}>
                      <span className="notify-alert-bar" />
                      <span className="notify-alert-dot" />
                      <span className="notify-alert-body">
                        <b>{a.message}</b>
                        <small>{a.source} · {a.at}</small>
                      </span>
                      <button type="button" className="notify-alert-x" aria-label="Dismiss alert" onClick={() => dismissAlert(a.id)}>×</button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {hasLogs && (
              <>
                <div className="notify-section-title">
                  <span>SYSTEM ERRORS</span>
                  <span className="notify-section-meta">supervisor · error level</span>
                </div>
                <ul className="notify-logs">
                  {notify!.slice(0, 8).map((l, i) => (
                    <li key={i}>
                      <b>{l.service}</b><span>{new Date(l.ts).toLocaleTimeString()}</span>
                      <p>{l.line.length > 96 ? `${l.line.slice(0, 96)}…` : l.line}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : loading ? (
          <div className="notify-empty"><span className="notify-empty-icon">◍</span><strong>Loading notifications…</strong></div>
        ) : (
          <div className="notify-empty"><span className="notify-empty-icon">◍</span><strong>All clear</strong><p>No errors or alerts right now.</p></div>
        )}
      </div>
    </div>
  );
}

function ThemeCentre({
  theme,
  onThemeChange,
  uiMode,
  onUiModeChange,
  custom,
  onCustom,
  particles,
  onParticles,
}: {
  theme: AdminTheme;
  onThemeChange: (theme: AdminTheme) => void;
  uiMode: UiMode;
  onUiModeChange: (mode: UiMode) => void;
  custom: CustomTheme;
  onCustom: (partial: Partial<CustomTheme>) => void;
  particles: ParticleConfig;
  onParticles: (partial: Partial<ParticleConfig>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const colors: { key: keyof Omit<CustomTheme, 'active'>; label: string; detail: string }[] = [
    { key: 'blue', label: 'Primary blue', detail: 'Buttons, focus rings & links' },
    { key: 'violet', label: 'Accent violet', detail: 'Highlights & gradients' },
    { key: 'pink', label: 'Accent pink', detail: 'Special surfaces & marks' },
    { key: 'bg', label: 'Background', detail: 'Base canvas of the shell' },
    { key: 'ink', label: 'Foreground text', detail: 'Headings & body ink' },
    { key: 'muted', label: 'Muted text', detail: 'Captions & secondary labels' },
  ];
  const setColor = (key: keyof Omit<CustomTheme, 'active'>, value: string) => onCustom({ [key]: value });
  const setParticleColor = (index: number, value: string) => {
    const next = [...particles.colors];
    next[index] = value;
    onParticles({ colors: next });
  };
  const addParticleColor = () => {
    const next = [...particles.colors, SWATCH_CPLAETTE[particles.colors.length % SWATCH_CPLAETTE.length]];
    onParticles({ colors: next });
  };
  const removeParticleColor = (index: number) => {
    if (particles.colors.length <= 1) return;
    onParticles({ colors: particles.colors.filter((_, i) => i !== index) });
  };
  const exportJson = () => {
    const payload = JSON.stringify({ version: 1, theme, uiMode, custom, particles }, null, 2);
    const write = () => { navigator.clipboard.writeText(payload).then(() => setCopied(true)).catch(() => fallback(payload)); };
    const fallback = (text: string) => {
      const el = document.createElement('textarea');
      el.value = text; document.body.appendChild(el); el.select();
      try { document.execCommand('copy'); setCopied(true); } catch { /* ignore */ }
      document.body.removeChild(el);
    };
    write();
    window.setTimeout(() => setCopied(false), 1600);
  };
  const importJson = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { text = window.prompt('Paste theme JSON to import:') ?? ''; }
    if (!text) return;
    try {
      const parsed = JSON.parse(text) as { theme?: AdminTheme; uiMode?: UiMode; custom?: Partial<CustomTheme>; particles?: Partial<ParticleConfig> };
      if (parsed.theme && ['aurora', 'midnight', 'violet'].includes(parsed.theme)) onThemeChange(parsed.theme);
      if (parsed.uiMode && ['workspace', 'compact', 'focus'].includes(parsed.uiMode)) onUiModeChange(parsed.uiMode);
      if (parsed.custom) onCustom(parsed.custom);
      if (parsed.particles) onParticles(parsed.particles);
    } catch { /* ignore bad import */ }
  };
  const resetAll = () => {
    onCustom({ ...THEME_PRESETS[theme], active: false });
    onParticles({ ...DEFAULT_PARTICLES });
    try { localStorage.removeItem(CUSTOM_THEME_KEY); localStorage.removeItem(PARTICLES_KEY); } catch { /* ignore */ }
  };
  const slider = (label: string, detail: string, value: number, min: number, max: number, step: number, display: string, onChange: (v: number) => void) => (
    <label className="surface-row">
      <span className="surface-meta"><b>{label}</b><small>{detail}</small></span>
      <input type="range" className="surface-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <em className="surface-value">{display}</em>
    </label>
  );
  return (
    <div className="space-y-6">
      <PageHead title="Theme Centre">
        <div className="heading-actions">
          <button type="button" className="workspace-action" onClick={() => { void importJson(); }}>⇩ Import</button>
          <button type="button" className="workspace-action" onClick={exportJson}>{copied ? 'Copied' : '⇪ Export'}</button>
          <button type="button" className="workspace-action" onClick={resetAll}>↻ Reset all</button>
        </div>
      </PageHead>
      <PageHero kicker="SURFACE STUDIO" title={<>Make it <em>yours.</em></>} desc="Curated themes, your own palette, particle fields and surface tuning — applied live to this workspace and remembered locally in your browser." glyph="◒" art="palette" />
      <section className="glass-card space-y-4">
        <div className="flex items-center justify-between">
          <div><span className="admin-overline">CURATED THEMES</span><h3 className="glass-h3">Start from a surface</h3></div>
          <span className="live-badge"><i className="status-dot good" /> LIVE</span>
        </div>
        <div className="theme-gallery">
          {([['aurora', 'Aurora', 'Electric blue glow'], ['midnight', 'Midnight', 'Deep navy calm'], ['violet', 'Violet', 'Indigo shimmer']] as const).map(([id, label, detail]) => {
            const preset = THEME_PRESETS[id];
            const isActive = !custom.active && theme === id;
            return (
              <button key={id} type="button" className={`theme-card${isActive ? ' is-active' : ''}`} onClick={() => { onThemeChange(id); onCustom({ ...preset, active: false }); }}>
                <span className={`theme-preview ${id}`} />
                <span className="theme-card-body"><b>{label}</b><small>{detail}</small></span>
                {isActive && <i className="theme-card-check">✓</i>}
              </button>
            );
          })}
        </div>
        <div className="ui-mode-options ui-mode-row">
          {([['workspace', 'Workspace', 'Inspector + tools'], ['compact', 'Compact', 'More content'], ['focus', 'Focus', 'Canvas first']] as const).map(([id, label, detail]) => (
            <button key={id} onClick={() => onUiModeChange(id)} className={uiMode === id ? 'is-selected' : ''}><span>{label}</span><small>{detail}</small></button>
          ))}
        </div>
      </section>
      <section className="glass-card space-y-4">
        <div className="flex items-center justify-between">
          <div><span className="admin-overline">CUSTOM THEME</span><h3 className="glass-h3">Your own palette</h3></div>
          <div className="flex items-center gap-2">
            <button type="button" className="glass-chip-btn" onClick={() => { const p = randomAccentPalette(); onCustom({ ...p, active: !custom.active ? true : custom.active }); }}>✦ Randomize</button>
            <button type="button" className={`custom-toggle${custom.active ? ' is-active' : ''}`} onClick={() => onCustom({ active: !custom.active })}>{custom.active ? 'Applied · live' : 'Apply custom'}</button>
            <button type="button" className="glass-chip-btn" onClick={() => onCustom({ ...THEME_PRESETS[theme], active: true })}>Seed from {theme}</button>
          </div>
        </div>
        <p className="text-sm text-slate-400">Tune each color below — the workspace re-themes instantly while custom is applied. Stored locally in your browser.</p>
        <div className="custom-grid">
          {colors.map((c) => (
            <label key={c.key} className="color-row">
              <span className="color-swatch"><input type="color" value={custom[c.key]} disabled={!custom.active} onChange={(e) => setColor(c.key, e.target.value)} /></span>
              <span className="color-meta"><b>{c.label}</b><small>{c.detail}</small></span>
              <input className="glass-input color-hex" value={custom[c.key]} disabled={!custom.active} onChange={(e) => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{3,8}$/.test(v)) setColor(c.key, v); }} />
            </label>
          ))}
        </div>
        <div className="theme-preview-tile" style={custom.active ? { ['--p-blue' as string]: custom.blue, ['--p-violet' as string]: custom.violet, ['--p-pink' as string]: custom.pink, ['--p-bg' as string]: custom.bg } : undefined}>
          <div className="theme-preview-glow" />
          <div className="theme-preview-card">
            <span className="theme-preview-overline">LIVE PREVIEW</span>
            <b className="theme-preview-title">Surface preview</b>
            <div className="theme-preview-actions"><button className="glass-chip-btn-primary flex-1 justify-center">Primary</button><button className="glass-chip-btn flex-1 justify-center">chip</button></div>
            <div className="theme-preview-dots"><i /><i /><i /></div>
          </div>
        </div>
      </section>
      <section className="glass-card space-y-4">
        <div className="flex items-center justify-between">
          <div><span className="admin-overline">SURFACE TUNING</span><h3 className="glass-h3">Glow, glass & shape</h3></div>
          <span className="live-badge"><i className="status-dot good" /> LIVE</span>
        </div>
        {slider('Ambient glow', 'Mesh & aura strength behind the shell', custom.mesh, 0, 1, 0.02, `${Math.round(custom.mesh * 100)}%`, (v) => onCustom({ mesh: v }))}
        {slider('Panel glass', 'Frosted blur behind cards & panels', custom.glass, 0, 1, 0.02, `${Math.round(custom.glass * 100)}%`, (v) => onCustom({ glass: v }))}
        {slider('Corner radius', 'Roundness of cards, panels & buttons', custom.radius, 0, 24, 1, `${custom.radius}px`, (v) => onCustom({ radius: v }))}
        <div>
          <span className="admin-overline">TOGGLE STYLE</span>
          <div className="toggle-style-row">
            {TOGGLE_STYLES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`toggle-style-btn${custom.toggle === t.id ? ' is-selected' : ''}`}
                onClick={() => onCustom({ toggle: t.id })}
              >
                <span className={`ai-toggle tg-${t.id} is-on toggle-style-preview`}><span className="ai-toggle-knob" /></span>
                <span className="toggle-style-meta"><b>{t.label}</b><small>{t.hint}</small></span>
                {custom.toggle === t.id && <i className="toggle-style-check">✓</i>}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="glass-card space-y-4">
        <div className="flex items-center justify-between">
          <div><span className="admin-overline">PARTICLE FIELD</span><h3 className="glass-h3">Floating background dust</h3></div>
          <div className="flex items-center gap-2">
            <button type="button" className="glass-chip-btn" onClick={() => onParticles({ colors: randomParticleColors() })}>✦ Randomize</button>
            <button type="button" className={`custom-toggle${particles.amount > 0 ? ' is-active' : ''}`} onClick={() => onParticles({ amount: particles.amount > 0 ? 0 : 14 })}>{particles.amount > 0 ? 'On' : 'Off'}</button>
          </div>
        </div>
        <p className="text-sm text-slate-400">Control how many particles drift behind the workspace, how fast they rise, and build a custom color list for them.</p>
        {slider('Particle amount', 'Count of dots in the field', particles.amount, 0, 48, 1, String(particles.amount), (v) => onParticles({ amount: v }))}
        {slider('Particle speed', 'Rise speed multiplier', particles.speed, 0.2, 3, 0.05, `${particles.speed.toFixed(2)}×`, (v) => onParticles({ speed: v }))}
        <div className="palette-list">
          {particles.colors.map((c, i) => (
            <div className="palette-chip" key={i}>
              <span className="color-swatch"><input type="color" value={c} onChange={(e) => setParticleColor(i, e.target.value)} /></span>
              <input className="glass-input color-hex" value={c} onChange={(e) => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{3,8}$/.test(v)) setParticleColor(i, v); }} />
              <button type="button" className="row-delete" onClick={() => removeParticleColor(i)} aria-label="Remove color" disabled={particles.colors.length <= 1}>×</button>
            </div>
          ))}
          <button type="button" className="add-color" onClick={addParticleColor}>+ Add color</button>
        </div>
      </section>
    </div>
  );
}

const CATEGORY_LABEL: Record<string, { label: string; hint: string }> = {
  refused: { label: 'Connection refused', hint: 'the target address is reachable but nothing is listening — is the service running?' },
  timeout: { label: 'Timed out', hint: 'the target did not respond in time — it may be down or filtering traffic.' },
  dns: { label: 'DNS lookup failed', hint: 'the host could not be resolved.' },
  ssl: { label: 'TLS handshake failed', hint: 'the target answered but the TLS handshake failed.' },
  http: { label: 'HTTP error status', hint: 'the endpoint responded with an error status code.' },
  engine_offline: { label: 'Diagnostics engine offline', hint: 'the Python engine is not running — start it with "python main.py" or "nexus dev".' },
};

function friendlyPreflightError(error?: string, category?: string): string {
  if (!error) return 'unreachable';
  const meta = category ? CATEGORY_LABEL[category] : undefined;
  if (!meta || error.toLowerCase().startsWith(meta.label.toLowerCase())) return error;
  return `${meta.label} — ${error}`;
}

function preflightAddress(c: PreflightCheck): string {
  if (c.kind === 'http' && c.url) return c.url;
  if (c.host != null && c.port != null) return `${c.host}:${c.port}`;
  return '';
}

function Overview({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [metrics, setMetrics] = useState<any>(null);
  const [services, setServices] = useState<ServiceState[]>([]);
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [preflightErr, setPreflightErr] = useState('');
  const [traffic, setTraffic] = useState<number[]>([]);
  const prevTotal = useRef<number | null>(null);
  useEffect(() => {
    const load = async () => {
      try { setMetrics(await getMetrics()); } catch { setMetrics(null); }
      try { setServices(await getServices()); } catch { setServices([]); }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!metrics?.metrics?.http_requests_total?.values) return;
    const values = metrics.metrics.http_requests_total.values as Record<string, number>;
    const total = Object.values(values).reduce((sum: number, value) => sum + Number(value ?? 0), 0);
    const prev = prevTotal.current;
    prevTotal.current = total;
    if (prev == null) return;
    const delta = total - prev;
    if (delta < 0) return;
    setTraffic((t) => [...t, delta].slice(-20));
  }, [metrics]);
  const running = services.filter((service) => service.status === 'running').length;
  const requests = metrics?.metrics?.http_requests_total?.values;
  const requestCount = requests ? Object.values(requests).reduce((sum: number, value) => sum + Number(value ?? 0), 0) : 0;
  const runChecks = async () => {
    setPreflightBusy(true);
    setPreflightErr('');
    try {
      setPreflight(await runPreflight());
    } catch (e: any) {
      setPreflight(null);
      setPreflightErr(e?.message || 'Preflight request failed');
    }
    setPreflightBusy(false);
  };
  return (
    <div className="admin-view-stack">
      <PageHead title="Project Overview"><button onClick={() => onNavigate('processes')} className="workspace-action">Open services <span>→</span></button></PageHead>
      <div className="overview-hero"><div><span className="admin-overline">GOOD MORNING, ADMIN</span><h1>Your project is <em>in orbit.</em></h1><p>One calm surface for the services, configuration, data, and AI that power your Nexus application.</p></div><div className="hero-orbit-art"><span /><i /><b /><strong>NX</strong></div></div>
      <div className="overview-stat-grid"><div className="overview-stat"><span>ACTIVE SERVICES</span><strong>{running}<small>/{services.length || 4}</small></strong><b className="stat-good">● running now</b></div><div className="overview-stat"><span>HTTP REQUESTS</span><strong>{requestCount || '—'}</strong><b>since boot</b></div><div className="overview-stat"><span>UPTIME</span><strong>{metrics ? `${Math.round((metrics.uptime ?? 0) / 60)}m` : '—'}</strong><b>backend process</b></div><div className="overview-stat"><span>ENVIRONMENT</span><strong>DEV</strong><b className="stat-violet">local workspace</b></div></div>
      <section className="workspace-panel live-traffic-panel"><div className="panel-title-row"><div><span className="admin-overline">HTTP REQUESTS</span><h3>Live traffic</h3></div><span className="live-badge"><i className="status-dot good" /> LIVE</span></div><TrafficChart samples={traffic} total={requestCount} last={traffic.length ? traffic[traffic.length - 1] : 0} onNavigate={onNavigate} /></section>
      <div className="overview-columns"><section className="workspace-panel"><div className="panel-title-row"><div><span className="admin-overline">PROJECT SURFACES</span><h3>Everything in one place</h3></div><button onClick={() => onNavigate('config')} className="text-action">View config →</button></div><div className="surface-grid"><button className="surface-card acc-blue" onClick={() => onNavigate('config')}><span className="surface-icon">{'{ }'}</span><strong>Runtime config</strong><small>nexus.runtime.json overrides</small><i className="surface-go">→</i></button><button className="surface-card acc-violet" onClick={() => onNavigate('env')}><span className="surface-icon">⌁</span><strong>Environment</strong><small>Masked secrets editor</small><i className="surface-go">→</i></button><button className="surface-card acc-pink" onClick={() => onNavigate('databases')}><span className="surface-icon">▦</span><strong>Data layer</strong><small>Mongo databases &amp; collections</small><i className="surface-go">→</i></button><button className="surface-card acc-blue" onClick={() => onNavigate('theme')}><span className="surface-icon">✦</span><strong>AI theme</strong><small>Generate schemas from English</small><i className="surface-go">→</i></button><button className="surface-card acc-violet" onClick={() => onNavigate('users')}><span className="surface-icon">◎</span><strong>Users &amp; roles</strong><small>Accounts, roles &amp; grants</small><i className="surface-go">→</i></button><button className="surface-card acc-pink" onClick={() => onNavigate('payments')}><span className="surface-icon">$</span><strong>Payments</strong><small>Orders, transactions &amp; providers</small><i className="surface-go">→</i></button><button className="surface-card acc-blue" onClick={() => onNavigate('ai')}><span className="surface-icon">◇</span><strong>AI agents</strong><small>Providers &amp; chat playground</small><i className="surface-go">→</i></button><button className="surface-card acc-violet" onClick={() => onNavigate('cluster')}><span className="surface-icon">⬡</span><strong>Cluster</strong><small>Link and supervise nodes</small><i className="surface-go">→</i></button></div></section><section className="workspace-panel pulse-panel"><div className="panel-title-row"><div><span className="admin-overline">SYSTEM PULSE</span><h3>Services are moving</h3></div><span className="live-badge"><i className="status-dot good" /> LIVE</span></div><div className="pulse-bars">{[34,55,42,78,62,88,52,72,48,66,84,58].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><p>Live supervisor status refreshes every five seconds.</p><button onClick={() => onNavigate('monitoring')} className="text-action">Open monitoring →</button></section></div>
      <section className="workspace-panel">
        <div className="panel-title-row">
          <div><span className="admin-overline">PREFLIGHT DIAGNOSTICS</span><h3>Dependencies are being probed</h3></div>
          <button onClick={runChecks} disabled={preflightBusy} className="glass-chip-btn">{preflightBusy ? 'probing…' : '↻ run checks'}</button>
        </div>
        <p className="preflight-note">The Python server pings the backend API, AI server, GraphQL endpoint and data-store ports, and reports latency per target.</p>
        {preflightErr && (
          <div role="alert" className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
            Preflight failed — {preflightErr}
          </div>
        )}
        {preflight ? (
          <>
            <div className="preflight-summary">
              <span className="preflight-count ok">● {preflight.passed} ok</span>
              <span className="preflight-count warn">◐ {preflight.warnings} slow</span>
              <span className="preflight-count bad">● {preflight.failed} failed</span>
              <span className="preflight-meta">{preflight.durationMs}ms · {preflight.ranAt}</span>
            </div>
            {preflight.engineOk === false || (preflight.checks.length > 0 && preflight.failed === preflight.checks.length) ? (
              <div className="preflight-guidance">
                <strong>Nothing responded.</strong>
                <span>The stack may not be running. Start everything with <code>nexus dev</code>, or Python-only with <code>python main.py</code>. Then press “run checks” again.</span>
                <button onClick={() => onNavigate('processes')} className="text-action">Open services →</button>
              </div>
            ) : null}
          </>
        ) : preflightBusy ? (
          <p className="preflight-empty">Probing dependencies…</p>
        ) : (
          <p className="preflight-empty">No checks run yet — press “run checks”.</p>
        )}
        {preflight && (
          <div className="preflight-list">
            {preflight.checks.map((c) => (
              <div key={c.name} className="preflight-row">
                <span className={`preflight-dot ${c.ok ? 'good' : 'bad'}`} />
                <span className="preflight-check-name">{c.name}</span>
                <span className="preflight-kind">{c.kind}</span>
                {preflightAddress(c) && <span className="preflight-address">{preflightAddress(c)}</span>}
                {c.latencyMs != null && <span className="preflight-latency">{c.latencyMs}ms</span>}
                <span className={`preflight-state ${c.ok ? 'ok' : 'fail'}`}>{c.ok ? 'ok' : 'fail'}</span>
                {c.error && <span className="preflight-error" title={friendlyPreflightError(c.error, c.errorCategory)}>{friendlyPreflightError(c.error, c.errorCategory)}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TrafficChart({ samples, total, last, onNavigate }: { samples: number[]; total: number; last: number; onNavigate: (tab: Tab) => void }) {
  const W = 720;
  const H = 96;
  const PAD = 4;
  const pts = samples.length ? samples : [0, 0];
  const max = Math.max(4, ...pts);
  const stepX = (W - PAD * 2) / (Math.max(pts.length - 1, 1));
  const coords = pts.map((v, i) => [PAD + i * stepX, H - PAD - (v / max) * (H - PAD * 2)] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${(W - PAD).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
  const lastPt = coords[coords.length - 1];
  return (
    <div className="traffic-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Live HTTP request rate">
        <defs>
          <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--admin-blue, #54b7ff)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--admin-blue, #54b7ff)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--admin-border, rgba(125,174,235,0.2))" strokeWidth="1" />
        <path d={area} fill="url(#trafficFill)" />
        <path d={line} fill="none" stroke="var(--admin-blue, #54b7ff)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastPt[0]} cy={lastPt[1]} r="3.5" fill="var(--admin-blue, #54b7ff)" />
      </svg>
      <div className="traffic-meta"><span>{last} req / 5s</span><span>{total} since boot</span><button onClick={() => onNavigate('monitoring')} className="text-action">Open monitoring →</button></div>
    </div>
  );
}

function Processes() {
  const [services, setServices] = useState<ServiceState[]>([]);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [sel, setSel] = useState<string | null>(null);

  const refresh = async () => {
    try { setServices(await getServices()); } catch { setServices([]); }
  };
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); }, []);

  const showLogs = async (name: string) => {
    setSel(name);
    setLogs({ ...logs, [name]: await getServiceLogs(name) });
  };

  const color = (s: string) => (s === 'running' ? 'text-emerald-400' : s === 'errored' ? 'text-rose-400' : 'text-slate-400');

  return (
    <div className="space-y-6">
      <PageHead title="Processes">
        <button onClick={refresh} className="glass-chip-btn">↻ refresh</button>
      </PageHead>
      <PageHero kicker="SERVICE CONTROL PLANE" title={<>Your services, <em>in check.</em></>} desc="Every backend, frontend and AI process the supervisor is tending — live status, uptime, PID and one-click control." glyph="◈" art="bars" />
      <div className="glass-panel overflow-hidden p-2">
        <table className="glass-table">
          <thead><tr className="text-slate-400"><th>Service</th><th className="text-center">Status</th><th className="text-center">PID</th><th className="text-center">Uptime</th><th className="text-center">Actions</th></tr></thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.name}>
                <td className="font-mono text-slate-200">{s.name}</td>
                <td className={`text-center ${color(s.status)}`}>
                  <span className="inline-flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${s.status === 'running' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : s.status === 'errored' ? 'bg-rose-500' : 'bg-slate-500'}`} />
                    {s.status}
                  </span>
                </td>
                <td className="text-center text-slate-400">{s.pid ?? '—'}</td>
                <td className="text-center text-slate-400">{s.startedAt ? `${Math.round((Date.now() - s.startedAt) / 1000)}s` : '—'}</td>
                <td className="text-center">
                  <span className="inline-flex gap-1.5">
                    <button onClick={() => controlService('start', s.name)} className="glass-chip-btn">start</button>
                    <button onClick={() => controlService('stop', s.name)} className="glass-chip-btn-danger">stop</button>
                    <button onClick={() => controlService('restart', s.name)} className="glass-chip-btn">restart</button>
                    <button onClick={() => showLogs(s.name)} className="glass-chip-btn">logs</button>
                  </span>
                </td>
              </tr>
            ))}
            {!services.length && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No services reported by the supervisor.</td></tr>}
          </tbody>
        </table>
      </div>
      {sel && (
        <div className="glass-card space-y-2">
          <h3 className="glass-h3">{sel} logs</h3>
          <pre className="glass-code max-h-80 overflow-auto p-3">{((logs[sel] ?? []).join('\n')) || '— empty —'}</pre>
        </div>
      )}
    </div>
  );
}

/** Color of a service tag in the log viewer (mirrors the supervisor prefixes). */
const SERVICE_TAG_COLORS: Record<string, string> = {
  backend: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  frontend: 'text-cyan-300 border-cyan-300/30 bg-cyan-300/10',
  'ai-server': 'text-amber-300 border-amber-300/30 bg-amber-300/10',
  admin: 'text-pink-300 border-pink-300/30 bg-pink-300/10',
};
const LEVEL_CLASS: Record<LogEntry['level'], string> = {
  error: 'log-row--error',
  warn: 'log-row--warn',
  info: 'log-row--info',
};

function Logs({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [service, setService] = useState('all');
  const [level, setLevel] = useState<'all' | LogEntry['level']>('all');
  const [q, setQ] = useState('');
  const [live, setLive] = useState(true);
  const [sticky, setSticky] = useState(true);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const [criticalFirst, setCriticalFirst] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryBusy, setAiSummaryBusy] = useState(false);
  const [aiSummaryErr, setAiSummaryErr] = useState('');
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [aiProvider, setAiProvider] = useState('');
  const [aiModel, setAiModel] = useState('');
  const aiAbortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [logs, svc] = await Promise.all([getAllLogs(), getServices()]);
      setEntries(logs);
      setServices(svc.map((s) => s.name));
      setErr('');
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!live) return;
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [refresh, live]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (service !== 'all' && e.service !== service) return false;
      if (level !== 'all' && e.level !== level) return false;
      if (needle && !e.line.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, service, level, q]);

  const counts = useMemo(() => {
    const c = { error: 0, warn: 0, info: 0 };
    for (const e of entries) c[e.level] += 1;
    return c;
  }, [entries]);

  const ordered = useMemo(() => {
    if (!criticalFirst) return filtered;
    const rank = (e: LogEntry) => {
      const lvl = e.level === 'error' ? 0 : e.level === 'warn' ? 1 : 2;
      const src = e.source === 'stderr' ? 0 : e.source === 'system' ? 1 : 2;
      return lvl * 3 + src;
    };
    return [...filtered].sort((a, b) => rank(a) - rank(b) || b.ts - a.ts);
  }, [filtered, criticalFirst]);

  const criticalRunEnd = useMemo(() => {
    if (!criticalFirst) return 0;
    let i = 0;
    while (i < ordered.length && ordered[i].level !== 'info') i += 1;
    return i;
  }, [ordered, criticalFirst]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && sticky) el.scrollTop = criticalFirst ? 0 : el.scrollHeight;
  }, [ordered, sticky, criticalFirst]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setSticky(criticalFirst ? el.scrollTop < 80 : el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const copyAll = async () => {
    const text = filtered.map((e) => `[${e.service}] ${e.line}`).join('\n');
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const runAiSummary = async () => {
    if (aiSummaryBusy) return;
    if (!ordered.length) {
      setAiSummary('');
      setAiSummaryErr('No log lines to summarize — widen the filters first.');
      setAiSummaryOpen(true);
      return;
    }
    try {
      let provider = aiProvider;
      let model = aiModel;
      if (!provider || !model) {
        const s = await getAiStatus();
        let pv: AiProviderView | undefined;
        try { pv = (await getAiProviders()).providers?.find((p) => p.enabled); } catch { /* fall back to status */ }
        if (pv) {
          provider = pv.id;
          model = pv.defaultModel ?? '';
        }
        if (!provider) provider = s.autoResolvesTo ?? (s.ollama?.ok ? 'ollama' : s.openai?.ok ? 'openai' : '');
        if (!provider) throw new Error('No AI provider is available. Configure one in the AI Agents tab.');
        if (!model) {
          try { model = (await getAiModels(provider)).data?.[0]?.id ?? ''; } catch { /* fall back below */ }
        }
        if (!model) model = 'llama3:latest';
        setAiProvider(provider);
        setAiModel(model);
      }
      const sample = ordered.slice(-400).map((e) => `[${new Date(e.ts).toLocaleTimeString()}] ${e.service} ${e.source} ${e.level}: ${e.line}`).join('\n');
      const messages: AiChatMessage[] = [
        { role: 'system', content: 'You are a log analyzer for BhooAI Nexus. Summarize the provided service logs concisely. FIRST list the most critical errors (service, source, likely cause and next step), then warnings, then notable patterns. Use short bullet points and do not invent details that are not present in the logs.' },
        { role: 'user', content: `Service logs (${sample.split('\n').length} lines):\n${sample}` },
      ];
      const controller = new AbortController();
      aiAbortRef.current = controller;
      setAiSummary('');
      setAiSummaryErr('');
      setAiSummaryOpen(true);
      setAiSummaryBusy(true);
      let acc = '';
      try {
        await aiChatStream(model, messages, provider, (chunk) => { acc += chunk; setAiSummary(acc); }, controller.signal);
        setAiSummary(acc || 'AI returned an empty summary.');
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setAiSummaryErr(String(e?.message ?? e));
      } finally {
        aiAbortRef.current = null;
        setAiSummaryBusy(false);
      }
    } catch (e: any) {
      setAiSummary('');
      setAiSummaryErr(String(e?.message ?? e));
      setAiSummaryOpen(true);
      setAiSummaryBusy(false);
    }
  };

  const stopAiSummary = () => { aiAbortRef.current?.abort(); };

  const copyAiSummary = async () => {
    try { await navigator.clipboard.writeText(aiSummary); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Logs">
        <div className="flex items-center gap-2">
          <button aria-label="Refresh logs" onClick={() => void refresh()} className="glass-chip-btn">↻ refresh</button>
          <button aria-pressed={live} onClick={() => setLive(!live)} className={`glass-chip-btn log-live-btn${live ? ' is-live' : ''}`}>{live ? '● live' : '○ paused'}</button>
          <button aria-label="Copy filtered logs" onClick={() => void copyAll()} className="glass-chip-btn">{copied ? 'Copied' : '⇪ copy'}</button>
          <button aria-label="Summarize logs with AI" onClick={() => void runAiSummary()} disabled={aiSummaryBusy} className="glass-chip-btn log-ai-btn">✦ {aiSummaryBusy ? 'summarizing…' : 'ai summary'}</button>
          <button aria-label="Clear all logs" onClick={async () => { try { await clearLogs(); await refresh(); } catch { /* supervisor may not be reachable */ } }} className="glass-chip-btn-danger">⌫ clear</button>
        </div>
      </PageHead>
      <PageHero kicker="ERROR CONSOLE" title={<>Every failure, <em>in one stream.</em></>} desc="Aggregated stdout, stderr and supervisor events from every service — live as the supervisor records them, filterable and searchable." glyph="▤" art="wave" />
      {err && (
        <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          Logs unavailable — {err}. Is <code className="font-mono">nexus dev</code> running?
        </div>
      )}
      <div className="glass-card log-card">
        <div className="log-stat-strip">
          <span className="log-stat log-stat--all"><i /><b>{entries.length}</b><em>Total lines</em></span>
          <span className="log-stat log-stat--error"><i /><b>{counts.error}</b><em>Errors</em></span>
          <span className="log-stat log-stat--warn"><i /><b>{counts.warn}</b><em>Warnings</em></span>
          <span className="log-stat log-stat--info"><i /><b>{counts.info}</b><em>Info</em></span>
        </div>
        <div className="log-toolbar">
          <div className="glass-panel log-filter-group" role="group" aria-label="Filter by level">
            {([['all', 'All'], ['error', 'Errors'], ['warn', 'Warnings'], ['info', 'Info']] as const).map(([id, label]) => (
              <button key={id} aria-pressed={level === id} onClick={() => { setLevel(id); setSticky(true); }} className={level === id ? 'log-filter-btn is-active' : 'log-filter-btn'}>
                {label} <b>{id === 'all' ? entries.length : counts[id]}</b>
              </button>
            ))}
          </div>
          <button aria-pressed={criticalFirst} onClick={() => { setCriticalFirst(!criticalFirst); setSticky(true); }} className={criticalFirst ? 'log-crit-btn is-active' : 'log-crit-btn'}>⤓ critical first</button>
          <div className="log-toolbar-right">
            <select value={service} onChange={(e) => { setService(e.target.value); setSticky(true); }} aria-label="Filter by service" className="glass-input log-service-input">
              <option value="all" className="bg-slate-900">All services</option>
              {services.map((s) => <option key={s} value={s} className="bg-slate-900">{s}</option>)}
            </select>
            <input value={q} onChange={(e) => { setQ(e.target.value); setSticky(true); }} placeholder="Filter lines…" aria-label="Filter log lines" className="glass-input log-search-input" />
          </div>
        </div>
        {aiSummaryOpen && (
          <div className="log-ai-panel">
            <div className="log-ai-head">
              <span className="log-ai-title">✦ AI summary{aiModel ? ` · ${aiModel}` : ''}</span>
              <div className="log-ai-actions">
                {aiSummaryBusy && <button onClick={stopAiSummary} className="glass-chip-btn-danger">■ stop</button>}
                {!aiSummaryBusy && aiSummary && <button onClick={() => void copyAiSummary()} className="glass-chip-btn">⇪ copy</button>}
                <button onClick={() => { setAiSummaryOpen(false); setAiSummary(''); setAiSummaryErr(''); }} className="glass-chip-btn">✕ dismiss</button>
              </div>
            </div>
            {aiSummaryErr && (
              <div role="alert" className="log-ai-err">
                AI summary failed: {aiSummaryErr}
                {aiSummaryErr.includes('AI provider') && (
                  <button onClick={() => onNavigate('ai')} className="glass-chip-btn log-ai-open">Open AI Agents →</button>
                )}
              </div>
            )}
            {aiSummaryBusy && !aiSummary && <div className="log-ai-note">Analyzing {ordered.length} lines…</div>}
            {aiSummary && <pre className="log-ai-body">{aiSummary}</pre>}
          </div>
        )}
        <div ref={scrollRef} onScroll={onScroll} className="log-viewer" role="list" aria-label="Service log output" tabIndex={0}>
          <div className="log-colhead" aria-hidden="true">
            <span className="log-time">Time</span>
            <span className="log-service">Service</span>
            <span className="log-source">Source</span>
            <span className="log-level">Level</span>
            <span className="log-line">Message</span>
          </div>
          {ordered.length === 0 ? (
            <div className="log-empty">
              <span className="log-empty-glyph">▤</span>
              <strong>No log lines match the current filters.</strong>
              <p>Try widening the level filter or clearing the search text.</p>
            </div>
          ) : (
            ordered.map((e, i) => (
              <div key={`${e.ts}-${i}`} className={`log-row ${LEVEL_CLASS[e.level]}${criticalFirst && i < criticalRunEnd ? ' log-row--critical' : ''}`} role="listitem">
                <span className="log-time">{new Date(e.ts).toLocaleTimeString()}</span>
                <span className={`log-service log-tag ${SERVICE_TAG_COLORS[e.service] ?? 'log-tag--default'}`}>{e.service}</span>
                <span className={`log-source log-source--${e.source}`}>{e.source}</span>
                <span className={`log-level log-level--${e.level}`}>{e.level}</span>
                <span className="log-line">{e.line || ' '}</span>
              </div>
            ))
          )}
        </div>
        <div className="log-footer">
          <span className="log-foot-left">Aggregated across services · last {entries.length} lines · {live ? <span className="log-foot-left"><span className="log-live-dot" /> polling every 1.5s</span> : 'paused'}</span>
          {!sticky && <button onClick={() => setSticky(true)} className="glass-chip-btn">{criticalFirst ? '▲ jump to top' : '▼ jump to latest'}</button>}
        </div>
      </div>
    </div>
  );
}

function Cluster() {
  const [mode, setMode] = useState<'master' | 'slave'>('master');
  const [overview, setOverview] = useState<ClusterOverview | null>(null);
  const [setup, setSetup] = useState<ClusterSetup | null>(null);
  const [msg, setMsg] = useAdminAlert('cluster');
  const [nodeUrl, setNodeUrl] = useState('');
  const [linkToken, setLinkToken] = useState('');
  const [slaveToken, setSlaveToken] = useState('');
  const [pairingOpen, setPairingOpen] = useState(false);
  const [scaleTarget, setScaleTarget] = useState(1);
  const [busy, setBusy] = useState(false);
  const [lbHost, setLbHost] = useState('');
  const [lbPort, setLbPort] = useState(8080);
  const [agentHost, setAgentHost] = useState('');
  const [agentPort, setAgentPort] = useState(7575);
  const [nodeStatus, setNodeStatus] = useState<ClusterNodeAgentStatus | null>(null);
  const [celebration, setCelebration] = useState<{ key: number; node?: CelebrationNode } | null>(null);

  const celebrate = (node?: CelebrationNode) => {
    setCelebration({ key: Date.now(), node });
  };

  const refresh = async () => {
    try { setOverview(await getClusterOverview()); setMsg(''); } catch (e: any) { setMsg(String(e?.message ?? e)); }
  };
  useEffect(() => {
    if (mode !== 'master') return;
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [mode]);

  useEffect(() => {
    getClusterSetup()
      .then((s) => {
        setSetup(s);
        setLbHost(s.master.lbHost);
        setLbPort(s.master.lbPort);
        setAgentHost(s.master.nodeAgentHost);
        setAgentPort(s.master.nodeAgentPort);
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  useEffect(() => {
    if (mode !== 'slave') return;
    let cancelled = false;
    const load = async () => {
      try {
        const status = await getClusterNodeStatus();
        if (!cancelled) setNodeStatus(status);
      } catch { /* non-fatal while backend starts */ }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [mode]);

  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setMsg('');
    try { const r = await fn(); if (r?.error) setMsg(r.error); }
    catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const link = () => { if (nodeUrl) setPairingOpen(true); };
  const unlink = (id: string) => run(() => clusterUnlink(id));
  const control = (id: string, action: 'start' | 'stop' | 'restart' | 'kill') => run(() => clusterExec(id, action));
  const scale = () => run(() => clusterScale(scaleTarget));
  const saveMaster = () => run(() => saveClusterSetup({
    lbHost: lbHost.trim() || undefined,
    lbPort: Number(lbPort),
    nodeAgentHost: agentHost.trim() || undefined,
    nodeAgentPort: Number(agentPort),
  }).then(async (r) => { if (!r?.error) setSetup(await getClusterSetup()); return r; }));
  const handleStart = () => run(clusterStart);
  const handleStop = () => run(clusterStop);
  const handleNodeStart = () => run(async () => {
    const result = await clusterNodeStart();
    setNodeStatus(await getClusterNodeStatus());
    return result;
  });
  const handleNodeStop = () => run(async () => {
    const result = await clusterNodeStop();
    setNodeStatus(await getClusterNodeStatus());
    return result;
  });

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement('textarea');
      el.value = text; document.body.appendChild(el); el.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(el);
    }
  };

  const generateToken = async () => {
    setBusy(true); setMsg('');
    try {
      const { token } = await generateClusterToken();
      setSlaveToken(token);
      setMsg('Token generated — copy it and paste into the master\'s pairing dialog');
    } catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const confirmLink = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await clusterLink(nodeUrl.trim(), linkToken.trim() || undefined);
      if (r?.error) setMsg(r.error);
      else {
        setPairingOpen(false); setLinkToken(''); setMsg('Node linked successfully'); refresh();
        const node = r?.node?.identity ?? r?.node;
        celebrate({
          id: node?.id,
          role: node?.role,
          project: node?.project,
          version: node?.version,
          baseUrl: node?.baseUrl,
          services: node?.services,
        });
      }
    } catch (e: any) { setMsg(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const running = overview?.running ?? false;
  const statusColor = (s: string) => (s === 'ready' ? 'text-emerald-400' : s === 'unreachable' ? 'text-rose-400' : 'text-amber-300');

  return (
    <div className="space-y-5">
      <PageHead title="Cluster">
        {mode === 'master' && (
          <>
            <button onClick={refresh} className="glass-chip-btn">↻ Refresh</button>
          </>
        )}
      </PageHead>

      <PageHero kicker="NODE MESH" title={<>Servers, <em>connected.</em></>} desc="Link each BhooAI Nexus server by its agent URL, then treat it as a node the central load-balances, supervises and autoscales." glyph="⬡" art="stack" />

      {/* Mode toggle */}
      <div className="glass-card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="workspace-tabs">
            <button onClick={() => setMode('master')} className={mode === 'master' ? 'is-active' : ''}>Master Mode</button>
            <button onClick={() => setMode('slave')} className={mode === 'slave' ? 'is-active' : ''}>Slave Mode</button>
          </div>
          {mode === 'master' ? (
            <div className="ml-auto flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${running ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/40 text-slate-400'}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${running ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {running ? 'LB running' : 'LB stopped'}
              </span>
              <button onClick={handleStart} disabled={busy || running} className="glass-chip-btn text-emerald-300">▶ Start cluster</button>
              <button onClick={handleStop} disabled={busy || !running} className="glass-chip-btn text-rose-300">■ Stop cluster</button>
            </div>
          ) : (
            <div className="ml-auto flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${nodeStatus?.running ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700/40 text-slate-400'}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${nodeStatus?.running ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {nodeStatus?.running ? 'Agent running' : 'Agent stopped'}
              </span>
              <button onClick={handleNodeStart} disabled={busy || !!nodeStatus?.running} className="glass-chip-btn text-emerald-300">▶ Start node</button>
              <button onClick={handleNodeStop} disabled={busy || !nodeStatus?.running} className="glass-chip-btn text-rose-300">■ Stop node</button>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {mode === 'master'
            ? 'Master mode: manage the load balancer, link slave nodes, and autoscale the cluster.'
            : 'Slave mode: generate a pairing token for this node so a master can link it.'}
        </p>
      </div>

      {mode === 'master' ? (
        <>
          {/* status cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="glass-card">
              <span className="admin-overline">LOAD BALANCER</span>
              <h3 className="glass-h3">{overview ? `${overview.lbHost}:${overview.lbPort}` : '—'}</h3>
              <p className="text-sm text-slate-400">{overview?.nodes?.length ?? 0} node{overview?.nodes?.length !== 1 ? 's' : ''} linked</p>
            </div>
            <div className="glass-card">
              <span className="admin-overline">AUTOSCALE</span>
              <h3 className="glass-h3">{overview ? `${overview.autoscale.mode} · ${overview.autoscale.minNodes}–${overview.autoscale.maxNodes} nodes` : '—'}</h3>
              <p className="text-sm text-slate-400">rps/node &gt; {overview?.autoscale.rpsPerNodeHigh ?? 15} or cpu &gt; {overview?.autoscale.cpuHigh ?? 80}%</p>
            </div>
            <div className="glass-card">
              <span className="admin-overline">SCALE TO</span>
              <div className="flex items-center gap-2">
                <input type="number" min={1} value={scaleTarget} onChange={(e) => setScaleTarget(Number(e.target.value))} className="glass-input w-24" />
                <button onClick={scale} disabled={busy} className="glass-btn-primary">Apply</button>
              </div>
              <p className="mt-2 text-sm text-slate-400">Clamped to autoscale min/max.</p>
            </div>
          </div>

          {/* 2-column: master (left) + link (right) */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* LEFT — MASTER */}
            <div className="glass-card space-y-4">
              <div>
                <span className="admin-overline">MASTER — THIS SERVER</span>
                <h3 className="glass-h3">Load balancer + cluster hub</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-400">LB host<input value={lbHost} onChange={(e) => setLbHost(e.target.value)} placeholder="0.0.0.0" className="glass-input mt-1 font-mono" /></label>
                <label className="text-xs text-slate-400">LB port<input type="number" min={1} max={65535} value={lbPort} onChange={(e) => setLbPort(Number(e.target.value))} placeholder="8080" className="glass-input mt-1 font-mono" /></label>
                <label className="text-xs text-slate-400">Agent host<input value={agentHost} onChange={(e) => setAgentHost(e.target.value)} placeholder="0.0.0.0" className="glass-input mt-1 font-mono" /></label>
                <label className="text-xs text-slate-400">Agent port<input type="number" min={1} max={65535} value={agentPort} onChange={(e) => setAgentPort(Number(e.target.value))} placeholder="7575" className="glass-input mt-1 font-mono" /></label>
              </div>
              <button onClick={saveMaster} disabled={busy} className="glass-btn-primary">Save master settings</button>
              {setup?.note && <p className="text-xs text-slate-400">{setup.note}</p>}

              {setup?.self && (
                <div className="mt-4 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
                  <p className="text-xs text-slate-400">This server's agent URL — give this to a remote master to link this node:</p>
                  <div className="mt-2 space-y-1 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 shrink-0">url</span>
                      <code className="flex-1 truncate text-emerald-300">{setup.self.agentUrl}</code>
                      <button disabled={busy} className="glass-chip-btn shrink-0 text-[10px]" onClick={() => copyText(setup.self.agentUrl)}>copy</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 shrink-0">link</span>
                      <code className="flex-1 truncate text-emerald-400">{setup.self.link}</code>
                      <button disabled={busy} className="glass-chip-btn shrink-0 text-[10px]" onClick={() => copyText(setup.self.link)}>copy</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT — LINK A NODE */}
            <div className="glass-card">
              <span className="admin-overline">LINK A NODE</span>
              <p className="mb-2 text-xs text-slate-400">Paste a slave node's agent URL and click Link to open the pairing dialog.</p>
              <div className="flex gap-2">
                <input
                  value={nodeUrl}
                  onChange={(e) => setNodeUrl(e.target.value)}
                  placeholder="http://slave-host:7575"
                  className="glass-input flex-1 font-mono"
                />
                <button onClick={link} disabled={busy || !nodeUrl} className="glass-btn-primary shrink-0">Link node</button>
              </div>
            </div>
          </div>

          {/* linked nodes table */}
          <div className="glass-panel overflow-hidden p-2">
            <table className="glass-table">
              <thead><tr className="text-slate-400"><th>Id</th><th>Role</th><th>Status</th><th className="text-center">RPS</th><th className="text-center">CPU</th><th className="text-center">Mem</th><th className="text-center">Actions</th></tr></thead>
              <tbody>
                {(overview?.nodes ?? []).map((n) => (
                  <tr key={n.id}>
                    <td className="font-mono text-slate-200">{n.id}</td>
                    <td><span className="glass-chip">{n.role}</span></td>
                    <td className={statusColor(n.status)}>
                      <span className="inline-flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${n.status === 'ready' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : n.status === 'unreachable' ? 'bg-rose-500' : 'bg-amber-400'}`} />
                        {n.status}{n.enabled ? '' : ' · standby'}
                      </span>
                    </td>
                    <td className="text-center text-slate-400">{typeof n.rps === 'number' ? n.rps.toFixed(1) : '—'}</td>
                    <td className="text-center text-slate-400">{n.metrics ? `${n.metrics.cpu.toFixed(1)}%` : '—'}</td>
                    <td className="text-center text-slate-400">{n.metrics ? `${n.metrics.memoryMb} MiB` : '—'}</td>
                    <td className="text-center">
                      <span className="inline-flex gap-1.5">
                        <button onClick={() => control(n.id, 'start')} disabled={busy} className="glass-chip-btn">start</button>
                        <button onClick={() => control(n.id, 'restart')} disabled={busy} className="glass-chip-btn">restart</button>
                        <button onClick={() => control(n.id, 'kill')} disabled={busy} className="glass-chip-btn-danger">kill</button>
                        <button onClick={() => unlink(n.id)} disabled={busy} className="glass-chip-btn">unlink</button>
                      </span>
                    </td>
                  </tr>
                ))}
                {!(overview?.nodes?.length) && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No nodes linked yet. Paste a node's agent URL to register it.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {/* SLAVE MODE */}
          <div className="glass-card space-y-4">
            <div>
              <span className="admin-overline">SLAVE — THIS NODE</span>
              <h3 className="glass-h3">Node agent</h3>
               <p className="text-sm text-slate-400">Start this node agent, then share its URL, node id, and token with the master operator.</p>
            </div>

            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
              <p className="text-xs text-slate-400">This node's agent URL — give this to the master:</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 truncate font-mono text-sm text-emerald-300">{setup?.self?.agentUrl ?? '—'}</code>
                <button disabled={busy} className="glass-chip-btn shrink-0 text-[10px]" onClick={() => copyText(setup?.self?.agentUrl ?? '')}>copy</button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 font-mono text-xs">
              <div><span className="block text-slate-500">node id</span><span className="text-slate-200">{nodeStatus?.nodeId ?? '—'}</span></div>
              <div><span className="block text-slate-500">role</span><span className="text-slate-200">{nodeStatus?.role ?? 'backend'}</span></div>
              <div><span className="block text-slate-500">port</span><span className="text-slate-200">{nodeStatus?.port ?? setup?.self?.port ?? '—'}</span></div>
            </div>

            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
              <p className="text-xs text-slate-400">Pairing auth token:</p>
              {(slaveToken || (setup?.self?.token && setup.self.token !== '<empty — set cluster.token>')) ? (
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate font-mono text-sm text-emerald-400">{slaveToken || setup?.self?.token}</code>
                  <button disabled={busy} className="glass-chip-btn shrink-0 text-[10px]" onClick={() => copyText(slaveToken || setup?.self?.token || '')}>copy</button>
                  <button disabled={busy} className="glass-chip-btn shrink-0 text-[10px]" onClick={generateToken}>regenerate</button>
                </div>
              ) : (
                <div className="mt-2">
                  <button onClick={generateToken} disabled={busy} className="glass-btn-primary">Generate token</button>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400">
              On the master admin panel, paste this node's agent URL and the token above into the pairing dialog to link this node.
            </p>
          </div>
        </>
      )}

      {/* PAIRING DIALOG (master mode) */}
      {pairingOpen && mode === 'master' && (
        <div className="provider-modal-backdrop" onClick={() => { setPairingOpen(false); setLinkToken(''); }}>
          <div className="provider-modal space-y-4" role="dialog" aria-modal="true" aria-labelledby="link-node-title" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="admin-overline">NODE PAIRING</span>
                <h3 id="link-node-title" className="mt-1 text-base font-semibold text-slate-100">Link node</h3>
              </div>
              <button type="button" onClick={() => { setPairingOpen(false); setLinkToken(''); }} disabled={busy} className="glass-chip-btn text-xs" aria-label="Close link node dialog">✕</button>
            </div>
            <p className="text-xs text-slate-400">
              Enter the auth token from the slave's pairing dialog to authenticate this link.
            </p>
            <div>
              <label className="text-xs text-slate-400">Node URL</label>
              <code className="block font-mono text-sm text-emerald-300 break-all">{nodeUrl}</code>
            </div>
            <div>
              <label className="text-xs text-slate-400">Auth token (from slave)</label>
              <input value={linkToken} onChange={(e) => setLinkToken(e.target.value)}
                     placeholder="paste the slave's generated token" className="glass-input w-full font-mono" />
            </div>
            {msg && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300">{msg}</div>}
            <div className="flex justify-end gap-2 border-t border-sky-400/20 pt-3">
              <button onClick={() => { setPairingOpen(false); setLinkToken(''); }} disabled={busy} className="glass-chip-btn">Cancel</button>
              <button onClick={confirmLink} disabled={busy || !linkToken} className="glass-chip-btn-primary">Confirm Link</button>
            </div>
          </div>
        </div>
      )}

      {/* CELEBRATION — flying ribbons on successful pairing */}
      {celebration && (
        <ClusterCelebration
          key={celebration.key}
          node={celebration.node}
          onDismiss={() => setCelebration(null)}
        />
      )}
    </div>
  );
}

/** Info about a successfully-linked slave, shown in the celebration dialog. */
interface CelebrationNode {
  id?: string;
  role?: string;
  project?: string;
  version?: string;
  baseUrl?: string;
  services?: Record<string, string>;
}

/** Full-screen "CONGRATULATIONS" overlay with CSS-animated flying ribbons.
 *  Rendered after a successful cluster pairing. Pure CSS — no dependencies.
 *  Fades in on mount and fades/scales out on dismiss. Dismissed only by the user. */
function ClusterCelebration({ node, onDismiss }: { node?: CelebrationNode; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);
  const dismiss = () => {
    if (exiting) return;
    setExiting(true);
    window.setTimeout(onDismiss, 220);
  };
  const ribbons = useMemo(() => {
    const COLORS = ['#34d399', '#fbbf24', '#38bdf8', '#fb7185', '#a78bfa', '#f472b6', '#4ade80', '#facc15'];
    return Array.from({ length: 28 }, (_, i) => ({
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 1.6}s`,
      dur: `${2.6 + Math.random() * 2.2}s`,
      rot: `${(Math.random() - 0.5) * 900}deg`,
      sway: `${(Math.random() - 0.5) * 220}px`,
      color: COLORS[i % COLORS.length]!,
    }));
  }, []);
  const serviceRows = node?.services ? Object.entries(node.services) : [];
  return (
    <div className={`celebrate-overlay${exiting ? ' exiting' : ''}`} role="dialog" aria-label="Cluster node paired successfully">
      <div className="celebrate-ribbons" aria-hidden="true">
        {ribbons.map((r, i) => (
          <span key={i} className="celebrate-ribbon" style={{
            left: r.left,
            background: r.color,
            boxShadow: `0 0 12px ${r.color}`,
            animationDelay: r.delay,
            animationDuration: r.dur,
            ['--rot' as string]: r.rot,
            ['--sway' as string]: r.sway,
          } as React.CSSProperties} />
        ))}
      </div>
      <div className="celebrate-card">
        <span className="celebrate-kicker">MESH LINK ESTABLISHED</span>
        <h2 className="celebrate-title">🎉 CONGRATULATIONS!</h2>
        <p className="celebrate-sub">A new node joined the cluster.</p>

        <div className="celebrate-node">
          {node?.project && <span><b>project</b> {node.project}</span>}
          {node?.id && <span><b>node id</b> {node.id}</span>}
          {node?.role && <span><b>role</b> {node.role}</span>}
          {node?.version && <span><b>version</b> {node.version}</span>}
          {node?.baseUrl && <span><b>agent</b> {node.baseUrl}</span>}
          {serviceRows.map(([role, url]) => <span key={role}><b>{role}</b> {url}</span>)}
        </div>

        <button onClick={dismiss} className="glass-btn-primary celebrate-dismiss">Awesome — continue</button>
      </div>
    </div>
  );
}

type ConfigValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
type ConfigEntry = { key: string; value: string; type: ConfigValueType };

function flattenConfig(value: unknown, prefix = ''): ConfigEntry[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rows = Object.entries(value as Record<string, unknown>);
    if (!rows.length && prefix) return [{ key: prefix, value: '{}', type: 'object' }];
    return rows.flatMap(([key, child]) => flattenConfig(child, prefix ? `${prefix}.${key}` : key));
  }
  if (!prefix) return [];
  if (Array.isArray(value)) return [{ key: prefix, value: JSON.stringify(value), type: 'array' }];
  if (value === null) return [{ key: prefix, value: '', type: 'null' }];
  if (typeof value === 'number') return [{ key: prefix, value: String(value), type: 'number' }];
  if (typeof value === 'boolean') return [{ key: prefix, value: String(value), type: 'boolean' }];
  return [{ key: prefix, value: String(value), type: 'string' }];
}

function configValue(entry: ConfigEntry): unknown {
  if (entry.type === 'null') return null;
  if (entry.type === 'number') return Number(entry.value);
  if (entry.type === 'boolean') return entry.value === 'true';
  if (entry.type === 'object' || entry.type === 'array') return JSON.parse(entry.value);
  return entry.value;
}

function buildConfig(entries: ConfigEntry[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const entry of entries) {
    const parts = entry.key.trim().split('.').filter(Boolean);
    if (!parts.length || parts.some((part) => ['__proto__', 'constructor', 'prototype'].includes(part))) continue;
    const value = configValue(entry);
    let node = root;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) node[part] = value;
      else {
        const child = node[part];
        if (!child || typeof child !== 'object' || Array.isArray(child)) node[part] = {};
        node = node[part] as Record<string, unknown>;
      }
    });
  }
  return root;
}

function topGroup(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return 'unsorted';
  if (trimmed.startsWith('NEXUS_')) return trimmed.slice(6).split('_')[0].toLowerCase() || 'root';
  return trimmed.split('.')[0] || 'root';
}

function groupEntries<T extends { key: string }>(entries: T[]): Array<{ group: string; items: Array<{ index: number; entry: T }> }> {
  const order: string[] = [];
  const map = new Map<string, Array<{ index: number; entry: T }>>();
  entries.forEach((entry, index) => {
    const group = topGroup(entry.key);
    if (!map.has(group)) { map.set(group, []); order.push(group); }
    map.get(group)!.push({ index, entry });
  });
  return order.map((group) => ({ group, items: map.get(group)! }));
}

function LintChecks({ run, title, overline }: { run: () => Promise<LintReport>; title: string; overline: string }) {
  const [report, setReport] = useState<LintReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const doRun = async () => {
    setBusy(true); setErr('');
    try { setReport(await run()); } catch (e: any) { setErr(String(e?.message ?? e)); setReport(null); }
    setBusy(false);
  };
  return (
    <section className="workspace-panel lint-panel">
      <div className="panel-title-row">
        <div><span className="admin-overline">{overline}</span><h3>{title}</h3></div>
        <button onClick={doRun} disabled={busy} className="glass-chip-btn">{busy ? 'linting…' : '↻ run lint'}</button>
      </div>
      {err && <p className="preflight-empty">{err}</p>}
      {report ? (
        <>
          <div className="preflight-summary">
            <span className="preflight-count bad">● {report.summary.error} error{report.summary.error === 1 ? '' : 's'}</span>
            <span className="preflight-count warn">◐ {report.summary.warning} warning{report.summary.warning === 1 ? '' : 's'}</span>
            <span className="preflight-count inf">◌ {report.summary.info} info</span>
            {report.summary.ok > 0 && <span className="preflight-count ok">✓ {report.summary.ok} ok</span>}
            <span className="preflight-meta">{report.ranAt}</span>
          </div>
          {report.engineOk === false && (
            <div className="preflight-guidance">
              <strong>Diagnostics engine offline.</strong>
              <span>The Python engine that runs these checks is not running. Start it with <code>python main.py</code>, or the whole stack with <code>nexus dev</code>.</span>
            </div>
          )}
        </>
      ) : busy ? <p className="preflight-empty">Linting…</p> : <p className="preflight-empty">Run the linter to validate.</p>}
      {report && (
        <div className="preflight-list">
          {report.checks.map((c) => (
            <div key={`${c.severity}-${c.key}-${c.message}`} className="preflight-row">
              <span className={`preflight-dot ${c.severity === 'error' ? 'bad' : c.severity === 'warning' ? 'warn' : 'good'}`} />
              <span className="preflight-check-name">{c.key}</span>
              <span className="preflight-kind">{c.kind}</span>
              <span className={`preflight-message ${c.severity === 'ok' ? 'is-ok' : ''}`}>{c.message}</span>
              <span className={`preflight-state ${c.severity === 'error' ? 'fail' : c.severity === 'warning' ? 'is-warn' : c.severity === 'ok' ? 'ok' : ''}`}>{c.severity}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AiAgents({ toggle }: { toggle: ToggleStyle }) {
  const [aiTab, setAiTab] = useState<'settings' | 'providers' | 'chat'>('settings');
  return (
    <div className="space-y-6">
      <PageHead title="AI Agents" />
      <PageHero kicker="AI WORKSPACE" title={<>Agents, <em>at your command.</em></>} desc="Manage AI settings, configure providers with API keys, and test agents with a live chat playground." glyph="✦" art="spark" />

      {/* Sub-tab nav */}
      <div className="workspace-tabs">
        {([['settings', 'AI Settings', '⚙'], ['providers', 'AI Providers', '◇'], ['chat', 'Chat Playground', '✦']] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setAiTab(id)} className={aiTab === id ? 'is-active' : ''}>
            <span className="mr-1.5">{icon}</span>{label}
          </button>
        ))}
      </div>

      {aiTab === 'settings' && <AiSettings />}
      {aiTab === 'providers' && <AiProviders toggle={toggle} />}
      {aiTab === 'chat' && <AiChatPlayground />}
    </div>
  );
}

function AiSettings() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiErr, setAiErr] = useState('');
  const [msg, setMsg] = useAdminAlert('ai-settings');

  useEffect(() => {
    getAdminConfig().then((c) => setConfig(c)).catch(() => {});
    checkAi();
  }, []);

  const checkAi = async () => {
    setAiErr('');
    try { setAiStatus(await getAiStatus()); }
    catch (e: any) { setAiErr(String(e?.message ?? e)); }
  };

  const ai = config?.config?.ai as { serverUrl: string; timeoutMs: number; defaultProvider: string; schemaModel: string } | undefined;

  return (
    <div className="space-y-4">

      <section className="glass-card space-y-3">
        <h3 className="glass-h3">AI configuration</h3>
        {ai ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['Server URL', ai.serverUrl],
              ['Timeout', `${(ai.timeoutMs / 1000).toFixed(0)}s`],
              ['Default provider', ai.defaultProvider],
              ['Schema model', ai.schemaModel],
            ] as const).map(([label, value]) => (
              <div key={label} className="glass rounded-xl px-3 py-2">
                <span className="admin-overline">{label}</span>
                <code className="block mt-1 truncate font-mono text-sm text-slate-200">{value}</code>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Loading settings…</p>
        )}
      </section>

      <section className="glass-card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="glass-h3">AI server health</h3>
          <button onClick={checkAi} className="glass-chip-btn">re-check</button>
        </div>
        {aiErr && <p className="text-xs text-rose-400">{aiErr}</p>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {aiStatus ? (
            <>
              {([
                ['AI server', aiStatus.aiServer, aiStatus.aiServer.detail ? `health: ${aiStatus.aiServer.detail.status ?? 'unknown'}` : undefined],
                ['Ollama', aiStatus.ollama, aiStatus.ollama.detail?.modelCount != null ? `${aiStatus.ollama.detail.modelCount} model(s)` : undefined],
              ] as const).map(([label, s, detail]) => (
                <div key={label} className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <span className={s.ok ? 'dot-ok' : 'dot-bad'} />
                  <span className="font-medium text-slate-200">{label}</span>
                  <span className={`text-xs ${s.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{s.ok ? (detail ?? 'ok') : (s.error ?? 'down')}</span>
                </div>
              ))}
            </>
          ) : (
            <p className="col-span-3 text-xs text-slate-500">No status yet{aiErr ? '' : ' — run a check'}.</p>
          )}
        </div>
        {aiStatus && <p className="text-xs text-slate-500">"auto" currently resolves to <span className="font-mono text-slate-300">{aiStatus.autoResolvesTo}</span> on the AI server.</p>}
        {aiStatus?.aiServer?.detail?.providers && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-slate-500">Available providers on AI server:</span>
            {aiStatus.aiServer.detail.providers.map((p) => (
              <span key={p} className="glass-chip text-xs">{p}</span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Known built-in provider ids (from nexus-core defaults). Used to classify custom providers. */
const BUILTIN_PROVIDER_IDS = new Set([
  'ollama', 'openai', 'anthropic', 'google', 'groq', 'mistral', 'cohere', 'together',
  'fireworks', 'deepseek', 'perplexity', 'xai', 'replicate', 'huggingface', 'nvidia',
  'openrouter', 'lmstudio', 'alephalpha', 'stability', 'azure',
]);

/** Display metadata for known providers: a glyph + an HSL hue for the avatar accent. */
const PROVIDER_META: Record<string, { glyph: string; hue: number }> = {
  ollama: { glyph: '🦙', hue: 152 },
  openai: { glyph: '✺', hue: 165 },
  anthropic: { glyph: '✦', hue: 265 },
  google: { glyph: '✸', hue: 217 },
  groq: { glyph: '⚡', hue: 38 },
  mistral: { glyph: '🌬', hue: 210 },
  cohere: { glyph: '◈', hue: 190 },
  together: { glyph: '⬢', hue: 230 },
  fireworks: { glyph: '✦', hue: 12 },
  deepseek: { glyph: '◇', hue: 200 },
  perplexity: { glyph: '◉', hue: 280 },
  xai: { glyph: '✕', hue: 0 },
  replicate: { glyph: '⟳', hue: 160 },
  huggingface: { glyph: '🤗', hue: 25 },
  nvidia: { glyph: '▲', hue: 120 },
  openrouter: { glyph: '⇄', hue: 240 },
  lmstudio: { glyph: '⌂', hue: 180 },
  alephalpha: { glyph: 'Α', hue: 300 },
  stability: { glyph: '✺', hue: 320 },
  azure: { glyph: '☁', hue: 200 },
};

/** Derive a deterministic HSL hue from an arbitrary string (for custom provider avatars). */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function providerMeta(id: string): { glyph: string; hue: number } {
  if (PROVIDER_META[id]) return PROVIDER_META[id]!;
  const letter = id.charAt(0).toUpperCase() || '?';
  return { glyph: letter, hue: hashHue(id) };
}

/** Returns true if the provider's baseUrl points to a local host. */
function isLocalProvider(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0';
  } catch { return false; }
}

/** Preset for the "Add provider" dialog — popular providers with autofill data
 *  and a list of well-known models (the user can still edit everything after). */
interface ProviderPreset { id: string; label: string; baseUrl: string; defaultModel: string; models: string[]; }
const POPULAR_PROVIDERS: ProviderPreset[] = [
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434', defaultModel: 'llama3:latest', models: ['llama3:latest', 'llama3.1:8b', 'mistral:latest', 'phi3:latest', 'qwen2.5:latest'] },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-mini', 'o1-preview'] },
  { id: 'anthropic', label: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-20250514', models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'] },
  { id: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1', defaultModel: 'gemini-2.0-flash', models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'] },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'] },
  { id: 'mistral', label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', models: ['mistral-large-latest', 'mistral-small-latest', 'open-mixtral-8x22b', 'open-mistral-7b', 'codestral-latest'] },
  { id: 'cohere', label: 'Cohere', baseUrl: 'https://api.cohere.ai/v1', defaultModel: 'command-r-plus', models: ['command-r-plus', 'command-r', 'command', 'command-light'] },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3-70b-chat-hf', models: ['meta-llama/Llama-3-70b-chat-hf', 'meta-llama/Llama-3-8b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'Qwen/Qwen2.5-72B-Instruct-Turbo'] },
  { id: 'fireworks', label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', defaultModel: 'accounts/fireworks/models/llama-v3-70b-instruct', models: ['accounts/fireworks/models/llama-v3-70b-instruct', 'accounts/fireworks/models/llama-v3-8b-instruct', 'accounts/fireworks/models/mixtral-8x7b-instruct'] },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'] },
  { id: 'perplexity', label: 'Perplexity', baseUrl: 'https://api.perplexity.ai', defaultModel: 'llama-3.1-sonar-large-128k-online', models: ['llama-3.1-sonar-large-128k-online', 'llama-3.1-sonar-small-128k-online', 'llama-3.1-sonar-huge-128k-online'] },
  { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-2-latest', models: ['grok-2-latest', 'grok-2-1212', 'grok-beta', 'grok-vision-beta'] },
  { id: 'replicate', label: 'Replicate', baseUrl: 'https://api.replicate.com/v1', defaultModel: 'meta/llama-3-70b-instruct', models: ['meta/llama-3-70b-instruct', 'meta/llama-3-8b-instruct', 'mistralai/mixtral-8x7b-instruct-v0.1'] },
  { id: 'huggingface', label: 'Hugging Face', baseUrl: 'https://api-inference.huggingface.co/models', defaultModel: 'meta-llama/Llama-3-70b-chat-hf', models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mistral-7B-Instruct-v0.3', 'google/gemma-2-9b'] },
  { id: 'nvidia', label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'meta/llama-3.1-70b-instruct', models: ['meta/llama-3.1-70b-instruct', 'meta/llama-3.1-8b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct'] },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', models: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-exp', 'meta-llama/llama-3.3-70b-instruct'] },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', defaultModel: 'local-model', models: ['local-model', 'loaded-model'] },
  { id: 'alephalpha', label: 'Aleph Alpha', baseUrl: 'https://api.aleph-alpha.com/v1', defaultModel: 'luminous-supreme-control', models: ['luminous-supreme-control', 'luminous-supreme', 'luminous-base'] },
  { id: 'stability', label: 'Stability AI', baseUrl: 'https://api.stability.ai/v1', defaultModel: 'stable-diffusion-xl', models: ['stable-diffusion-xl', 'stable-diffusion-3', 'stable-image-core'] },
  { id: 'azure', label: 'Azure OpenAI', baseUrl: 'https://your-resource.openai.azure.com', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-35-turbo', 'dall-e-3'] },
];

/** Find a preset by id (returns undefined for "other"/custom). */
const PRESET_BY_ID: Record<string, ProviderPreset> = Object.fromEntries(POPULAR_PROVIDERS.map((p) => [p.id, p]));

type ProviderFilter = 'all' | 'enabled' | 'disabled' | 'custom';

function AiProviders({ toggle }: { toggle: ToggleStyle }) {
  const [providers, setProviders] = useState<AiProviderView[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useAdminAlert('ai-providers');
  const [showAdd, setShowAdd] = useState(false);
  const [newProvider, setNewProvider] = useState({ id: '', label: '', baseUrl: '', apiKey: '', defaultModel: '' });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ProviderFilter>('enabled');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, AiProviderTestResult>>({});
  const [keyEditorProvider, setKeyEditorProvider] = useState<AiProviderView | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [switchAnim, setSwitchAnim] = useState<Record<string, 'out' | 'in' | null>>({});

  useEffect(() => { loadProviders(); }, []);

  const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const loadProviders = async () => {
    try { const r = await getAiProviders(); setProviders(r.providers ?? []); } catch { /* non-fatal */ }
  };

  const persistenceNote = (persistence?: AiProviderPersistence): string => {
    if (!persistence) return '';
    const missing = [
      !persistence.runtime ? 'nexus.runtime.json' : '',
      !persistence.database ? 'MongoDB' : '',
    ].filter(Boolean);
    return missing.length ? ` Persistence failed: ${missing.join(' and ')}.` : '';
  };

  const openKeyEditor = (provider: AiProviderView) => {
    setKeyEditorProvider(provider);
    setKeyDraft('');
  };

  const closeKeyEditor = () => {
    if (busy) return;
    setKeyEditorProvider(null);
    setKeyDraft('');
  };

  const saveKeyFromEditor = async () => {
    if (!keyEditorProvider || !keyDraft.trim()) return;
    const saved = await saveApiKey(keyEditorProvider, keyDraft);
    if (saved) {
      setKeyEditorProvider(null);
      setKeyDraft('');
    }
  };

  const toggleProvider = async (p: AiProviderView) => {
    setMsg('');
    setBusy(true);
    setSwitchAnim((prev) => ({ ...prev, [p.id]: 'out' }));
    await wait(280);
    try {
      const result = await updateAiProvider(p.id, { enabled: !p.enabled });
      setProviders((current) => current.map((item) => item.id === p.id ? result.provider : item));
      setSwitchAnim((prev) => ({ ...prev, [p.id]: 'in' }));
      setMsg(`${p.label} ${result.provider.enabled ? 'enabled' : 'disabled'}.${persistenceNote(result.persistence)}`);
    }
    catch (e: any) {
      setSwitchAnim((prev) => { const next = { ...prev }; delete next[p.id]; return next; });
      setMsg(`Failed: ${e?.message ?? e}`);
    }
    finally {
      setBusy(false);
      await wait(420);
      setSwitchAnim((prev) => { const next = { ...prev }; delete next[p.id]; return next; });
    }
  };

  const saveApiKey = async (p: AiProviderView, key: string): Promise<boolean> => {
    if (!key.trim()) return false;
    setBusy(true);
    try {
      const result = await updateAiProvider(p.id, { apiKey: key.trim() });
      // Update only the provider that changed. Refreshing the whole collection
      // here can replace the visible 20-provider list with a stale/empty read
      // while the backend is persisting the key.
      setProviders((current) => current.map((item) => item.id === p.id ? result.provider : item));
      setMsg(`${p.label} API key saved.${persistenceNote(result.persistence)}`);
      return true;
    } catch (e: any) {
      setMsg(`Failed: ${e?.message ?? e}`);
      return false;
    } finally { setBusy(false); }
  };

  const saveDefaultModel = async (p: AiProviderView, m: string) => {
    setBusy(true);
    try {
      const result = await updateAiProvider(p.id, { defaultModel: m.trim() });
      setProviders((current) => current.map((item) => item.id === p.id ? result.provider : item));
      setMsg(`${p.label} model saved.${persistenceNote(result.persistence)}`);
    }
    catch (e: any) { setMsg(`Failed: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };

  const addProvider = async () => {
    if (!newProvider.id.trim() || !newProvider.label.trim() || !newProvider.baseUrl.trim()) { setMsg('id, label and baseUrl are required'); return; }
    setBusy(true);
    try {
      const result = await addAiProvider({ id: newProvider.id.trim().toLowerCase(), label: newProvider.label.trim(), baseUrl: newProvider.baseUrl.trim(), apiKey: newProvider.apiKey.trim() || undefined, defaultModel: newProvider.defaultModel.trim() || undefined, enabled: true });
      setProviders((current) => [...current, result.provider]);
      setShowAdd(false);
      setNewProvider({ id: '', label: '', baseUrl: '', apiKey: '', defaultModel: '' });
      setMsg(`Provider added.${persistenceNote(result.persistence)}`);
    } catch (e: any) { setMsg(`Failed: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };

  const removeProvider = async (id: string) => {
    setBusy(true);
    try {
      const result = await deleteAiProvider(id);
      setProviders((current) => current.filter((item) => item.id !== id));
      setTestResults((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setMsg(`Provider removed.${persistenceNote(result.persistence)}`);
    }
    catch (e: any) { setMsg(`Failed: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };

  const testProvider = async (p: AiProviderView) => {
    setTestingId(p.id);
    setMsg('');
    try {
      const result = await testAiProvider(p.id);
      setTestResults((prev) => ({ ...prev, [p.id]: result }));
      if (result.ok) setMsg(`${p.label}: reachable — ${result.modelCount ?? 0} model(s).`);
      else setMsg(`${p.label}: ${result.error ?? 'unreachable'}.`);
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, [p.id]: { ok: false, provider: p.id, error: String(e?.message ?? e), checkedAt: new Date().toISOString() } }));
      setMsg(`${p.label}: ${e?.message ?? e}`);
    } finally {
      setTestingId(null);
    }
  };

  // Search + filter logic.
  const matchesQuery = (p: AiProviderView) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return p.id.toLowerCase().includes(q) || p.label.toLowerCase().includes(q);
  };

  const enabled = providers.filter((p) => matchesQuery(p) && p.enabled && BUILTIN_PROVIDER_IDS.has(p.id));
  const disabled = providers.filter((p) => matchesQuery(p) && !p.enabled && BUILTIN_PROVIDER_IDS.has(p.id));
  const custom = providers.filter((p) => matchesQuery(p) && !BUILTIN_PROVIDER_IDS.has(p.id));

  const groups: Array<{ id: string; label: string; icon: string; items: AiProviderView[] }> = [];
  if (filter === 'all' || filter === 'enabled') {
    if (enabled.length) groups.push({ id: 'enabled', label: 'Enabled', icon: '●', items: enabled });
  }
  if (filter === 'all' || filter === 'disabled') {
    if (disabled.length) groups.push({ id: 'disabled', label: 'Disabled', icon: '○', items: disabled });
  }
  if (filter === 'all' || filter === 'custom') {
    if (custom.length) groups.push({ id: 'custom', label: 'Custom', icon: '✚', items: custom });
  }

  const filterPills: Array<[ProviderFilter, string, number]> = [
    ['all', 'All', providers.length],
    ['enabled', 'Enabled', enabled.length],
    ['disabled', 'Disabled', disabled.length],
    ['custom', 'Custom', custom.length],
  ];

  return (
    <div className="space-y-4">

      {/* Header */}
      <section className="glass-card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="glass-h3">AI providers ({providers.length})</h3>
          <div className="flex gap-2">
            <button onClick={loadProviders} disabled={busy} className="glass-chip-btn">refresh</button>
            <button onClick={() => setShowAdd(true)} disabled={busy} className="glass-chip-btn">+ add provider</button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="provider-filter-bar">
          <input
            className="glass-input !py-1.5 text-sm w-full sm:w-64"
            placeholder="⌕  search providers…"
            type="search"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {filterPills.map(([id, label, count]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={filter === id ? 'glass-btn-primary !py-1 !px-2.5 text-xs' : 'glass-chip-btn'}
              >
                {label} <span className="ml-1 opacity-60">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Groups */}
        {groups.length === 0 && (
          <p className="text-xs text-slate-500 py-4 text-center">
            {providers.length === 0 ? 'No providers configured.' : 'No providers match your search/filter.'}
          </p>
        )}
        {groups.map((g) => (
          <ProviderGroup
            key={g.id}
            label={g.label}
            icon={g.icon}
            items={g.items}
            toggle={toggle}
            switchAnim={switchAnim}
            busy={busy}
            testingId={testingId}
            testResults={testResults}
            onToggle={toggleProvider}
            onSaveModel={saveDefaultModel}
            onRemove={removeProvider}
            onTest={testProvider}
            onOpenKey={openKeyEditor}
          />
        ))}
      </section>

      {/* Add provider modal */}
      {showAdd && (
        <AddProviderDialog
          value={newProvider}
          onChange={setNewProvider}
          onSubmit={addProvider}
          onCancel={() => setShowAdd(false)}
          busy={busy}
        />
      )}
      {keyEditorProvider && (
        <ProviderKeyDialog
          provider={keyEditorProvider}
          value={keyDraft}
          onChange={setKeyDraft}
          onSave={saveKeyFromEditor}
          onCancel={closeKeyEditor}
          busy={busy}
        />
      )}
    </div>
  );
}

function ProviderGroup({ label, icon, items, toggle, switchAnim, busy, testingId, testResults, onToggle, onSaveModel, onRemove, onTest, onOpenKey }: {
  label: string;
  icon: string;
  items: AiProviderView[];
  toggle: ToggleStyle;
  switchAnim: Record<string, 'out' | 'in' | null>;
  busy: boolean;
  testingId: string | null;
  testResults: Record<string, AiProviderTestResult>;
  onToggle: (p: AiProviderView) => void;
  onSaveModel: (p: AiProviderView, model: string) => void;
  onRemove: (id: string) => void;
  onTest: (p: AiProviderView) => void;
  onOpenKey: (p: AiProviderView) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-300">{icon}</span>
        <h4 className="glass-h3">{label}</h4>
        <span className="glass-chip text-xs">{items.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            toggle={toggle}
            anim={switchAnim[p.id] ?? null}
            busy={busy}
            isCustom={!BUILTIN_PROVIDER_IDS.has(p.id)}
            testing={testingId === p.id}
            testResult={testResults[p.id]}
            onToggle={() => onToggle(p)}
            onSaveModel={(m) => onSaveModel(p, m)}
            onRemove={() => onRemove(p.id)}
            onTest={() => onTest(p)}
            onOpenKey={() => onOpenKey(p)}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({ provider, toggle, anim, busy, isCustom, testing, testResult, onToggle, onSaveModel, onRemove, onTest, onOpenKey }: {
  provider: AiProviderView;
  toggle: ToggleStyle;
  anim: 'out' | 'in' | null;
  busy: boolean;
  isCustom: boolean;
  testing: boolean;
  testResult?: AiProviderTestResult;
  onToggle: () => void;
  onSaveModel: (model: string) => void;
  onRemove: () => void;
  onTest: () => void;
  onOpenKey: () => void;
}) {
  const [editingModel, setEditingModel] = useState(false);
  const [modelInput, setModelInput] = useState(provider.defaultModel ?? '');

  const meta = providerMeta(provider.id);
  const local = isLocalProvider(provider.baseUrl);
  const cardClass = provider.enabled
    ? provider.hasApiKey ? 'is-on' : 'is-warn'
    : 'is-off';

  return (
    <div className={`provider-card ${cardClass}${anim === 'out' ? ' is-switch-out' : ''}${anim === 'in' ? ' is-switch-in' : ''}`} style={{ ['--avatar-hue' as string]: String(meta.hue) }}>
      {/* Header: avatar + label/id + toggle */}
      <div className="flex items-center gap-2.5">
        <span className="provider-avatar" style={{ ['--avatar-hue' as string]: String(meta.hue) }}>{meta.glyph}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-slate-200 truncate">{provider.label}</div>
          <div className="text-[11px] text-slate-500 font-mono truncate">{provider.id}</div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className={`ai-toggle tg-${toggle} ${provider.enabled ? 'is-on' : ''}`}
          title={provider.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
        >
          <span className="ai-toggle-knob" />
        </button>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        {provider.hasApiKey
          ? <span className="provider-badge-ok">✓ key</span>
          : <span className="provider-badge-warn">no key</span>}
        {provider.enabled
          ? <span className="provider-badge-ok">enabled</span>
          : <span className="provider-badge-mute">disabled</span>}
        {isCustom && <span className="provider-badge-accent">custom</span>}
        {local && <span className="provider-badge-local">local</span>}
      </div>

      {/* Model row */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 shrink-0">Model</span>
          {editingModel ? (
            <>
              <input
                className="glass-input !py-1 text-xs font-mono flex-1"
                placeholder="default model"
                value={modelInput}
                onChange={(e) => setModelInput(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                onClick={() => { onSaveModel(modelInput); setEditingModel(false); }}
                disabled={busy || !modelInput.trim()}
                className="glass-chip-btn shrink-0 text-[10px]"
              >save</button>
              <button
                type="button"
                onClick={() => { setEditingModel(false); setModelInput(provider.defaultModel ?? ''); }}
                className="glass-chip-btn shrink-0 text-[10px]"
              >cancel</button>
            </>
          ) : (
            <>
              <code className="text-xs text-slate-300 font-mono truncate flex-1">{provider.defaultModel || '—'}</code>
              <button type="button" onClick={() => setEditingModel(true)} disabled={busy} className="glass-chip-btn shrink-0 text-[10px]" title="Edit model">✎</button>
            </>
          )}
        </div>
        {editingModel && PRESET_BY_ID[provider.id]?.models?.length ? (
          <select
            className="glass-input !py-1 text-xs font-mono"
            value=""
            onChange={(e) => { if (e.target.value) setModelInput(e.target.value); }}
          >
            <option value="" className="bg-slate-900">…or pick a popular model</option>
            {PRESET_BY_ID[provider.id]!.models.map((m) => (
              <option key={m} value={m} className="bg-slate-900">{m}</option>
            ))}
          </select>
        ) : null}
      </div>

      {/* Footer: baseUrl + website + set key */}
      <div className="flex flex-wrap items-center gap-1.5">
        <code className="text-[10px] text-slate-500 truncate flex-1 min-w-[100px]">{provider.baseUrl}</code>
        <SafeGotoLink href={websiteFromBaseUrl(provider.baseUrl)} className="glass-chip-btn shrink-0 text-[10px]">↗</SafeGotoLink>
        <button
          type="button"
          onClick={onOpenKey}
          disabled={busy}
          className="glass-chip-btn shrink-0 text-[10px]"
        >key</button>
        {isCustom && (
          <button type="button" onClick={onRemove} disabled={busy} className="glass-chip-btn-danger shrink-0 text-[10px]" title="Remove provider">✕</button>
        )}
      </div>

      {/* Test row */}
      <div className="flex items-center gap-2 pt-0.5 border-t border-white/[0.06]">
        <button type="button" onClick={onTest} disabled={busy || testing} className="glass-chip-btn shrink-0 text-[10px]">
          {testing ? 'testing…' : '⚡ test'}
        </button>
        {testResult && (
          testResult.ok ? (
            <span className="text-[10px] text-emerald-300 truncate">
              ✓ {testResult.modelCount ?? 0} model{testResult.modelCount === 1 ? '' : 's'}
              {testResult.models && testResult.models.length > 0 && (
                <span className="text-slate-500"> — {testResult.models.slice(0, 3).join(', ')}{testResult.models.length > 3 ? '…' : ''}</span>
              )}
            </span>
          ) : (
            <span className="text-[10px] text-rose-400 truncate" title={testResult.error}>✗ {testResult.error ?? 'unreachable'}</span>
          )
        )}
      </div>
    </div>
  );
}

function ProviderKeyDialog({ provider, value, onChange, onSave, onCancel, busy }: {
  provider: AiProviderView;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="provider-modal-backdrop" onClick={onCancel}>
      <div className="provider-modal space-y-4" role="dialog" aria-modal="true" aria-labelledby="provider-key-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="admin-overline">API CREDENTIAL</span>
            <h3 id="provider-key-title" className="mt-1 text-base font-semibold text-slate-100">{provider.label}</h3>
            <code className="text-xs text-slate-500">{provider.id}</code>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className="glass-chip-btn text-xs" aria-label="Close API key dialog">✕</button>
        </div>

        <div className="rounded-xl border border-sky-400/20 bg-black/20 px-3 py-2 text-xs text-slate-400">
          {provider.hasApiKey ? 'A key is already configured. Enter a new key to replace it.' : 'This key is stored server-side in .env and is never written to the config file.'}
        </div>

        <label className="block">
          <span className="admin-overline">API key</span>
          <input
            className="glass-input mt-1 text-sm"
            type="password"
            id="ai-provider-api-key"
            name="ai-provider-api-key"
            autoComplete="new-password"
            autoFocus
            placeholder={provider.hasApiKey ? '•••••••• (enter new to replace)' : 'paste API key'}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && value.trim() && !busy) {
                event.preventDefault();
                onSave();
              }
            }}
          />
        </label>

        <div className="flex justify-end gap-2 border-t border-sky-400/20 pt-3">
          <button type="button" onClick={onCancel} disabled={busy} className="glass-chip-btn">Cancel</button>
          <button type="button" onClick={onSave} disabled={busy || !value.trim()} className="glass-btn-primary !py-1.5 text-sm">
            {busy ? 'Saving…' : 'Save API key'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddProviderDialog({ value, onChange, onSubmit, onCancel, busy }: {
  value: { id: string; label: string; baseUrl: string; apiKey: string; defaultModel: string };
  onChange: (v: { id: string; label: string; baseUrl: string; apiKey: string; defaultModel: string }) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [presetId, setPresetId] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Track which field the user is actively editing so we don't clobber their
  // manual input when the preset changes the model list.
  const preset = presetId ? PRESET_BY_ID[presetId] : undefined;

  const applyPreset = (id: string) => {
    setPresetId(id);
    if (!id) return; // "— select —"
    if (id === 'other') {
      // Clear fields for a fully custom provider; user fills everything.
      onChange({ id: '', label: '', baseUrl: '', apiKey: value.apiKey, defaultModel: '' });
      return;
    }
    const p = PRESET_BY_ID[id];
    if (p) {
      onChange({ ...value, id: p.id, label: p.label, baseUrl: p.baseUrl, defaultModel: p.defaultModel });
    }
  };

  const missing = {
    id: !value.id.trim(),
    label: !value.label.trim(),
    baseUrl: !value.baseUrl.trim(),
  };

  return (
    <div className="provider-modal-backdrop" onClick={onCancel}>
      <div className="provider-modal space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="glass-h3">Add custom provider</h3>
          <button onClick={onCancel} className="glass-chip-btn text-xs">✕</button>
        </div>

        <div className="space-y-3">
          {/* Preset selector — pick a popular provider or "Other" */}
          <label className="block">
            <span className="admin-overline">Choose a provider</span>
            <select
              className="glass-input mt-1 text-sm"
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="" className="bg-slate-900">— select —</option>
              {POPULAR_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900">{p.label}</option>
              ))}
              <option value="other" className="bg-slate-900">Other (custom)</option>
            </select>
            <span className="text-[10px] text-slate-500">Selecting a provider autofills the fields below — all editable.</span>
          </label>

          <label className="block">
            <span className="admin-overline">Provider ID <span className="text-rose-400">*</span></span>
            <input
              className={`glass-input mt-1 text-sm font-mono ${missing.id ? '!border-amber-500/50' : ''}`}
              placeholder="e.g. myai"
              value={value.id}
              onChange={(e) => onChange({ ...value, id: e.target.value })}
            />
            {missing.id && <span className="text-[10px] text-amber-400">required — lowercase, no spaces</span>}
          </label>

          <label className="block">
            <span className="admin-overline">Label <span className="text-rose-400">*</span></span>
            <input
              className={`glass-input mt-1 text-sm ${missing.label ? '!border-amber-500/50' : ''}`}
              placeholder="e.g. My AI Service"
              value={value.label}
              onChange={(e) => onChange({ ...value, label: e.target.value })}
            />
            {missing.label && <span className="text-[10px] text-amber-400">required</span>}
          </label>

          <label className="block">
            <span className="admin-overline">Base URL <span className="text-rose-400">*</span></span>
            <input
              className={`glass-input mt-1 text-sm font-mono ${missing.baseUrl ? '!border-amber-500/50' : ''}`}
              placeholder="https://api.example.com/v1"
              value={value.baseUrl}
              onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
            />
            {missing.baseUrl && <span className="text-[10px] text-amber-400">required</span>}
          </label>

          <label className="block">
            <span className="admin-overline">API key <span className="text-slate-500">(optional)</span></span>
            <input
              className="glass-input mt-1 text-sm"
              type="password"
              placeholder="paste API key"
              value={value.apiKey}
              onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
            />
          </label>

          {/* Default model — text input + a "pick from popular" select */}
          <label className="block">
            <span className="admin-overline">Default model <span className="text-slate-500">(optional)</span></span>
            <input
              className="glass-input mt-1 text-sm font-mono"
              placeholder="e.g. gpt-4o-mini"
              value={value.defaultModel}
              onChange={(e) => onChange({ ...value, defaultModel: e.target.value })}
            />
          </label>
          {preset && preset.models.length > 0 && (
            <label className="block">
              <span className="admin-overline">…or pick a model</span>
              <select
                className="glass-input mt-1 text-sm font-mono"
                value=""
                onChange={(e) => { if (e.target.value) onChange({ ...value, defaultModel: e.target.value }); }}
              >
                <option value="" className="bg-slate-900">{preset.models.length} popular model{preset.models.length === 1 ? '' : 's'} — click to use</option>
                {preset.models.map((m) => (
                  <option key={m} value={m} className="bg-slate-900">{m}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-sky-400/20">
          <button onClick={onCancel} disabled={busy} className="glass-chip-btn">Cancel</button>
          <button onClick={onSubmit} disabled={busy || missing.id || missing.label || missing.baseUrl} className="glass-btn-primary !py-1.5 text-sm">
            {busy ? 'Adding…' : '+ Add provider'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AiChatPlayground() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [providers, setProviders] = useState<AiProviderView[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [msg, setMsg] = useAdminAlert('ai-playground');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [loadedFor, setLoadedFor] = useState('');
  const loadModelsRef = useRef<(p: string) => Promise<void>>(async () => {});
  const checkAiRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    getAdminConfig().then((c) => { setConfig(c); const a = c?.config?.ai as { schemaModel?: string; defaultProvider?: string } | undefined; setModel((x) => x || (a?.schemaModel ?? 'llama3:latest')); }).catch(() => {});
    getAiProviders().then((r) => {
      setProviders(r.providers ?? []);
      // Auto-select the first enabled provider, then load its models.
      const firstEnabled = (r.providers ?? []).find((p) => p.enabled);
      if (firstEnabled) {
        setProvider(firstEnabled.id);
        setModel(firstEnabled.defaultModel ?? 'llama3:latest');
        // Load its models once the provider state lands.
        setTimeout(() => { void loadModelsRef.current(firstEnabled.id); }, 0);
      } else {
        // No enabled provider — fall back to the AI server's own detection.
        void checkAiRef.current();
      }
    }).catch(() => { void checkAiRef.current(); });
  }, []);

  const checkAi = async () => {
    try {
      const s = await getAiStatus();
      setAiStatus(s);
      // Auto-select ollama if it's the only provider available on the AI server
      if (s.ollama?.ok && s.ollama.detail?.models?.length && !provider) {
        setProvider('ollama');
        setModel(s.ollama.detail.models[0] ?? 'llama3:latest');
      }
      // Load models for the current (or resolved) provider.
      const prov = provider || (s.autoResolvesTo ?? 'ollama');
      await loadModels(prov);
    } catch { /* non-fatal */ }
  };

  const loadModels = async (p: string) => {
    setProvider(p);
    // Find the provider's default model
    const pv = providers.find((x) => x.id === p);
    if (pv?.defaultModel || modelsLoaded) setModel((cur) => pv?.defaultModel ?? cur);
    try {
      const m = await getAiModels(p);
      setModels(m?.data ?? []);
      setModelsLoaded(true);
      setLoadedFor(p);
      const err = m?.error;
      if (err) setMsg(`Models unavailable for "${p}": ${err}`);
      else setMsg('');
    } catch (e: any) {
      setModels([]);
      setModelsLoaded(false);
      setLoadedFor('');
      setMsg(`Could not load models for "${p}": ${e?.message ?? e}`);
    }
  };
  loadModelsRef.current = loadModels;
  checkAiRef.current = () => checkAi();

  const send = async () => {
    if (!input.trim() || streaming) return;
    // Resolve the actual provider to send to the AI server
    const effectiveProvider = provider || aiStatus?.autoResolvesTo || 'ollama';
    const effectiveModel = model || models[0]?.id || 'llama3:latest';

    const userMsg: AiChatMessage = { role: 'user', content: input.trim() };
    const chatMsgs: AiChatMessage[] = [];
    if (systemPrompt.trim()) chatMsgs.push({ role: 'system', content: systemPrompt.trim() });
    chatMsgs.push(...messages, userMsg);
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setStreaming(true);
    setStreamText('');
    setMsg('');
    let acc = '';
    try {
      await aiChatStream(effectiveModel, chatMsgs, effectiveProvider, (chunk) => {
        acc += chunk;
        setStreamText(acc);
      });
      if (!acc) { setMsg('AI returned an empty response. Check that the model is available and the AI server is running.'); }
      else { setMessages((m) => [...m, { role: 'assistant', content: acc }]); }
      setStreamText('');
    } catch (e: any) {
      const errMsg = String(e?.message ?? e);
      setMsg(`Chat failed: ${errMsg}`);
      if (acc) setMessages((m) => [...m, { role: 'assistant', content: acc }]);
      setStreamText('');
    } finally {
      setStreaming(false);
    }
  };

  const clearChat = () => { setMessages([]); setStreamText(''); setMsg(''); };
  const sendOnEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  const modelOptions = models.map((m) => m.id);
  const enabledProviders = providers.filter((p) => p.enabled);
  const ai = config?.config?.ai as { serverUrl: string; timeoutMs: number; defaultProvider: string; schemaModel: string } | undefined;

  // Build provider options: enabled config providers + any from AI server status
  const providerOptions: { id: string; label: string }[] = [];
  if (enabledProviders.length) {
    enabledProviders.forEach((p) => providerOptions.push({ id: p.id, label: p.label }));
  } else {
    // Fall back to AI server's known providers
    if (aiStatus?.aiServer?.ok) providerOptions.push({ id: 'ollama', label: 'Ollama' });
    if (aiStatus?.openai?.ok) providerOptions.push({ id: 'openai', label: 'OpenAI' });
  }

  return (
    <div className="space-y-4">

      <section className="glass-card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="glass-h3">Chat playground</h3>
          <div className="flex gap-2">
            <button onClick={checkAi} disabled={streaming} className="glass-chip-btn">↻ refresh models</button>
            <button onClick={clearChat} disabled={streaming} className="glass-chip-btn">clear</button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-slate-400">Provider
            <select className="glass-input w-44 !py-1.5 text-sm" value={provider} onChange={(e) => loadModels(e.target.value)}>
              {!provider && <option value="" className="bg-slate-900">— select —</option>}
              {providerOptions.map((p) => <option key={p.id} value={p.id} className="bg-slate-900">{p.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Model
            <input className="glass-input w-52 !py-1.5 font-mono text-sm" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. llama3:latest" />
          </label>
          <select
            className="glass-input w-48 !py-1.5 text-sm"
            value=""
            onChange={(e) => { const v = e.target.value; if (v) setModel(v); }}
            disabled={!modelOptions.length}
            title={modelOptions.length ? `Available models for "${loadedFor || provider}"` : 'No models — click refresh models'}
          >
            <option value="" className="bg-slate-900">{modelOptions.length ? `${modelOptions.length} available for "${loadedFor || provider}"` : 'no models loaded'}</option>
            {modelOptions.map((m) => <option key={m} value={m} className="bg-slate-900">{m}</option>)}
          </select>
        </div>

        {!provider && (
          <p className="text-xs text-amber-400">⚠ Select a provider above. If no providers are listed, go to the AI Providers tab and enable one, or click "refresh models" to detect the AI server's available providers.</p>
        )}

        {/* System prompt */}
        <div>
          <label className="text-xs text-slate-400">System prompt</label>
          <textarea className="glass-code mt-1 h-16 w-full p-2 text-sm" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="Set the assistant's behaviour…" />
        </div>

        {/* Chat messages */}
        <div className="glass-code max-h-96 min-h-[200px] space-y-3 overflow-y-auto p-3 text-sm">
          {messages.length === 0 && !streamText && <p className="text-slate-500">Start a conversation by typing below.</p>}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-indigo-500/20 text-slate-100' : m.role === 'assistant' ? 'bg-emerald-500/15 text-slate-100' : 'bg-slate-700/30 text-slate-400'}`}>
                <span className="mb-1 block text-[10px] uppercase tracking-wider opacity-60">{m.role}</span>
                <span className="whitespace-pre-wrap">{m.content}</span>
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-xl bg-emerald-500/15 px-3 py-2 text-slate-100">
                <span className="mb-1 block text-[10px] uppercase tracking-wider opacity-60">assistant <span className="animate-pulse">…</span></span>
                <span className="whitespace-pre-wrap">{streamText}<span className="animate-pulse">▋</span></span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <textarea className="glass-code flex-1 h-12 p-2 text-sm" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={sendOnEnter} placeholder="Type a message…  (Enter to send, Shift+Enter for newline)" disabled={streaming} />
          <button onClick={send} disabled={streaming || !input.trim()} className="glass-btn-primary shrink-0">{streaming ? '…' : 'Send'}</button>
        </div>
      </section>
    </div>
  );
}

/** Derive the marketing website from an API base URL (strip /v1, /api, etc). */
function websiteFromBaseUrl(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    // For local providers (localhost / 127.0.0.1 / 0.0.0.0) just return the origin.
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0';
    if (isLocal) return u.origin;
    // For cloud providers, strip common API path segments and go to the root.
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return baseUrl;
  }
}

function Config({ onNavigate }: { onNavigate?: (tab: Tab) => void }) {
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [fileText, setFileText] = useState('');
  const [filePath, setFilePath] = useState('');
  const [mode, setMode] = useState<'runtime' | 'source' | 'effective'>('runtime');
  const [msg, setMsg] = useAdminAlert('config');
  const [busy, setBusy] = useState(false);
  const [restartDialog, setRestartDialog] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState<ConfigValueType>('string');
  const [newValue, setNewValue] = useState('');

  const addKey = () => {
    if (!newKey.trim()) return;
    setEntries([...entries, { key: newKey.trim(), value: newType === 'null' ? '' : newValue, type: newType }]);
    setNewKey(''); setNewType('string'); setNewValue('');
  };

  const load = async () => {
    try {
      const c = await getAdminConfig();
      setCfg(c);
      const overrides = flattenConfig(c.runtime);
      // Prefer the runtime overrides if there are any; otherwise seed the
      // key/value grid from the current effective config so the user starts
      // with the real values (redacted secret placeholders are skipped so they
      // are never written back as literal overrides).
      const base = overrides.length
        ? overrides
        : flattenConfig(c.config).filter((entry) => entry.value !== '***');
      setEntries(base);
      setFilePath(c.file?.path ?? '');
      setFileText(c.file?.content ?? '');
      setMsg(c.file ? '' : 'No human-edited config file found.');
    } catch (e: any) { setMsg(String(e?.message ?? e)); }
  };
  useEffect(() => { load(); }, []);

  const saveRuntime = async () => {
    setBusy(true); setMsg('');
    try {
      const overrides = buildConfig(entries);
      await putAdminConfig(overrides);
      setMsg('Saved to nexus.runtime.json. Restart services to apply changes.');
      setRestartDialog(true);
    } catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };

  const saveFile = async () => {
    if (!filePath) { setMsg('No config file found.'); return; }
    setBusy(true); setMsg('');
    try { await putAdminConfigFile(fileText); setMsg(`Saved ${filePath}. Restart services to apply changes.`); setRestartDialog(true); }
    catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="admin-view-stack">
      <PageHead title="Configuration"><div className="heading-actions"><span className="restart-badge">RESTART REQUIRED AFTER SAVE</span><button onClick={load} className="workspace-action">↻ Reload</button></div></PageHead>
      <div className="config-intro"><div><span className="admin-overline">PROJECT CONTROL PLANE</span><h1>Configure your <em>runtime.</em></h1><p>Use key/value rows for safe JSON overrides, or switch to source mode for the typed project configuration.</p></div><div className="hero-art hero-art--cubes"><strong>{'{ }'}</strong><span className="ha-a" /><span className="ha-b" /><span className="ha-c" /></div></div>
      <div className="workspace-tabs">{([['runtime', 'Runtime JSON'], ['source', 'Source file'], ['effective', 'Effective view']] as const).map(([id, label]) => <button key={id} onClick={() => setMode(id)} className={mode === id ? 'is-active' : ''}>{label}</button>)}</div>
      {mode === 'runtime' && <section className="workspace-panel config-panel"><div className="panel-title-row"><div><span className="admin-overline">NEXUS CONFIG · KEY/VALUE</span><h3>Configuration overrides</h3></div><button onClick={addKey} className="workspace-action">+ Add key</button></div><p className="panel-description">Existing configuration is loaded into the rows below. Changes are written to nexus.runtime.json and validated against the Nexus schema before saving. Secrets are redacted and managed in the Environment surface.</p><div className="key-add-bar">
        <input value={newKey} onChange={(event) => setNewKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addKey(); }} placeholder="key path — e.g. server.port" />
        <select value={newType} onChange={(event) => { setNewType(event.target.value as ConfigValueType); if (event.target.value === 'null') setNewValue(''); }}><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="null">null</option><option value="object">object</option><option value="array">array</option></select>
        <input value={newValue} disabled={newType === 'null'} onChange={(event) => setNewValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addKey(); }} placeholder={newType === 'object' || newType === 'array' ? '{ }' : 'value'} />
      </div><div className="key-value-table">
        {groupEntries(entries).map(({ group, items }) => (
          <div className="key-group" key={group}>
            <div className="key-group-head"><span className="key-group-name">{group}</span><small>{items.length} key{items.length === 1 ? '' : 's'}</small></div>
            <div className="key-value-head"><span>KEY PATH</span><span>TYPE</span><span>VALUE</span><span /></div>
            {items.map(({ index, entry }) => (
              <div className="key-value-row" key={`${entry.key}-${index}`}>
                <input value={entry.key} onChange={(event) => setEntries(entries.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} placeholder="server.port" />
                <select value={entry.type} onChange={(event) => setEntries(entries.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as ConfigValueType, value: event.target.value === 'null' ? '' : item.value } : item))}><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="null">null</option><option value="object">object</option><option value="array">array</option></select>
                <input value={entry.value} disabled={entry.type === 'null'} onChange={(event) => setEntries(entries.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder={entry.type === 'object' || entry.type === 'array' ? '{ }' : 'value'} />
                <button className="row-delete" onClick={() => setEntries(entries.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Delete ${entry.key || 'entry'}`}>×</button>
              </div>
            ))}
          </div>
        ))}
        {!entries.length && <div className="key-value-empty">No configuration keys loaded.</div>}
      </div><div className="config-footer"><span>{entries.length} override{entries.length === 1 ? '' : 's'} · validated on save</span><button onClick={saveRuntime} disabled={busy} className="glass-chip-btn-primary shrink-0">{busy ? 'Saving…' : 'Save runtime JSON'} <span>→</span></button></div></section>}
      {mode === 'source' && <section className="workspace-panel config-panel"><div className="panel-title-row"><div><span className="admin-overline">HUMAN-EDITED SOURCE</span><h3>{filePath ? filePath.split(/[\\/]/).pop() : 'nexus.config.ts'}</h3></div><button onClick={saveFile} disabled={busy} className="glass-chip-btn-primary shrink-0">{busy ? 'Saving…' : 'Save source'} <span>→</span></button></div><textarea className="source-editor" value={fileText} onChange={(event) => setFileText(event.target.value)} spellCheck={false} /></section>}
      {mode === 'effective' && <section className="workspace-panel config-panel"><div className="panel-title-row"><div><span className="admin-overline">READ-ONLY · SECRETS REDACTED</span><h3>Effective merged config</h3></div></div><pre className="source-editor effective-editor">{cfg ? JSON.stringify(cfg.config, null, 2) : 'Loading configuration…'}</pre></section>}
      <LintChecks run={runLintConfig} title="Configuration checks" overline="VALIDATOR · nexus.runtime.json" />
      <ConfirmDialog
        open={restartDialog}
        title="Restart required"
        message="Your changes have been saved. Restart the backend services to apply the new configuration."
        confirmLabel="Open services"
        onConfirm={() => { setRestartDialog(false); onNavigate?.('processes'); }}
        onCancel={() => setRestartDialog(false)}
      />
    </div>
  );
}

function Environment({ onNavigate }: { onNavigate?: (tab: Tab) => void }) {
  const [data, setData] = useState<AdminEnv | null>(null);
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [msg, setMsg] = useAdminAlert('environment');
  const [busy, setBusy] = useState(false);
  const [restartDialog, setRestartDialog] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [file, setFile] = useState('.env');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const load = async (target: string = file) => { try { const result = await getAdminEnv(target); setData(result); setEntries(result.entries); setMsg(result.exists ? '' : `No ${target} file exists yet. Saving will create it.`); } catch (e: any) { setMsg(String(e?.message ?? e)); } };
  useEffect(() => { load(); }, []);
  const addVariable = () => {
    if (!newKey.trim()) return;
    const secret = /SECRET|PASSWORD|PASS|TOKEN|PRIVATE|API_KEY|CLIENT_SECRET|ACCESS_KEY|KEY_SECRET/i.test(newKey);
    setEntries([...entries, { key: newKey.trim(), value: newValue, secret }]);
    setNewKey(''); setNewValue('');
  };
  const save = async () => { setBusy(true); setMsg(''); try { await putAdminEnv(entries, file); setMsg(`Saved ${file}. Restart services to apply environment changes.`); setRestartDialog(true); await load(); } catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); } finally { setBusy(false); } };
  return (
    <div className="admin-view-stack">
      <PageHead title="Environment"><div className="heading-actions"><span className="secret-badge">SECRETS MASKED</span><button onClick={() => load()} className="workspace-action">↻ Reload</button></div></PageHead>
      <div className="config-intro env-intro"><div><span className="admin-overline">LOCAL ENVIRONMENT · {data?.path ?? '.env'}</span><h1>Your environment, <em>under control.</em></h1><p>Manage project variables as key/value pairs. Secret values stay on disk and are never returned to the browser.</p></div><div className="env-lock-art"><i className="env-lock-glyph">⌁</i><span>PRIVATE</span></div></div>
      <section className="workspace-panel config-panel"><div className="panel-title-row"><div><span className="admin-overline">{file.toUpperCase()} FILE · PRESERVES COMMENTS</span><h3>Environment variables</h3></div><button onClick={addVariable} className="workspace-action">+ Add variable</button></div><div className="env-add-bar">
        <input value={newKey} onChange={(event) => setNewKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addVariable(); }} placeholder="NEXUS_SERVER_PORT" />
        <div className="env-value-wrap"><input value={newValue} onChange={(event) => setNewValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addVariable(); }} placeholder="value" /><span className="secret-mark">{newKey && /SECRET|PASSWORD|PASS|TOKEN|PRIVATE|API_KEY|CLIENT_SECRET|ACCESS_KEY|KEY_SECRET/i.test(newKey) ? '●' : '○'}</span></div>
      </div><div className="key-value-table env-table">{groupEntries(entries).map(({ group, items }) => (
          <div className="key-group" key={group}>
            <div className="key-group-head"><span className="key-group-name">{group}</span><small>{items.length} variable{items.length === 1 ? '' : 's'}</small></div>
            <div className="key-value-head"><span>VARIABLE</span><span>VALUE</span></div>
            {items.map(({ index, entry }) => (
              <div className="key-value-row" key={`${entry.key}-${index}`}>
                <input value={entry.key} onChange={(event) => setEntries(entries.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value, secret: /SECRET|PASSWORD|PASS|TOKEN|PRIVATE|API_KEY|CLIENT_SECRET|ACCESS_KEY|KEY_SECRET/i.test(event.target.value) } : item))} placeholder="NEXUS_SERVER_PORT" />
                <div className="env-value-wrap"><input type={entry.secret ? 'password' : 'text'} value={entry.value ?? ''} placeholder={entry.secret ? '•••••••• · unchanged' : 'value'} onChange={(event) => setEntries(entries.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} /><span className={entry.secret ? 'secret-mark is-secret' : 'secret-mark'}>{entry.secret ? '●' : '○'}</span><button className="row-delete" onClick={() => setDeleteTarget(entry.key)} aria-label={`Delete ${entry.key || 'entry'}`} title={`Delete ${entry.key || 'entry'}`}>×</button></div>
              </div>
            ))}
          </div>
        ))}
        {!entries.length && <div className="key-value-empty">No environment variables found.</div>}</div><div className="config-footer"><span>{entries.length} variable{entries.length === 1 ? '' : 's'} · masked secrets are preserved when unchanged</span><button onClick={save} disabled={busy} className="glass-chip-btn-primary shrink-0">{busy ? 'Saving…' : `Save ${file}`} <span>→</span></button></div></section>
      <LintChecks run={() => runLintEnv(file)} title="Environment checks" overline={`VALIDATOR · ${file}`} />
      <ConfirmDialog
        open={restartDialog}
        title="Restart required"
        message="Your environment changes have been saved. Restart the backend services to apply the new variables."
        confirmLabel="Open services"
        onConfirm={() => { setRestartDialog(false); onNavigate?.('processes'); }}
        onCancel={() => setRestartDialog(false)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete variable"
        message={`Delete "${deleteTarget}" from ${file}? This removes it from the file on the next save.`}
        confirmLabel="Delete"
        onConfirm={() => { if (deleteTarget) setEntries(entries.filter((e) => e.key !== deleteTarget)); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function Plugins() {
  const [data, setData] = useState<{ pages: any[]; slots: Record<string, any[]> } | null>(null);
  useEffect(() => { getPlugins().then(setData).catch(() => {}); }, []);
  if (!data) return <p className="text-slate-400">Loading…</p>;
  return (
    <div className="space-y-6">
      <PageHead title="Plugins" />
      <PageHero kicker="EXTENSION GALLERY" title={<>Extend Nexus, <em>effortlessly.</em></>} desc="Every admin page, slot and surface that plugin modules register — a living index of what's available to your build." glyph="◇" art="grid" />
      <div className="glass-card space-y-4">
        <h3 className="glass-h3">Admin pages</h3>
        <ul className="space-y-1">
          {data.pages.map((p) => (
            <li key={p.path} className="flex items-center gap-2 font-mono text-sm text-slate-200">
              <span className="chip">{p.group ?? 'Plugins'}</span> {p.title} — <span className="text-slate-400">{p.path}</span>
            </li>
          ))}
          {!data.pages.length && <li className="text-sm text-slate-500">No plugin pages registered.</li>}
        </ul>
        {Object.keys(data.slots).length > 0 && (
          <>
            <h3 className="glass-h3">Slots</h3>
            <pre className="glass-code overflow-auto p-3">{JSON.stringify(data.slots, null, 2)}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function Users({ currentUserEmail }: { currentUserEmail?: string }) {
  const [data, setData] = useState<{ users: UserRecord[] } | null>(null);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [msg, setMsg] = useAdminAlert('users');
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([getUsers(), getRoles()]);
      setData(u);
      setRoles(r?.roles ?? []);
    } catch (e: any) {
      setMsg({ kind: 'err', text: `Could not load users or roles: ${e?.message ?? 'unknown error'}` });
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const openEditor = (u: UserRecord) => { setEditing(u); setDraft([...(u.roles ?? [])]); setMsg(null); };
  const toggleRole = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((r) => r !== id) : [...d, id]));

  const saveRoles = async () => {
    if (!editing) return;
    if (!draft.length) { setMsg({ kind: 'err', text: 'A user must keep at least one role.' }); return; }
    setBusy(true);
    try {
      await putUserRoles(editing._id, draft);
      setMsg({ kind: 'ok', text: `Saved roles for ${editing.email}.` });
      setEditing(null);
      await reload();
    } catch (e: any) {
      const raw = String(e?.message ?? 'Update failed');
      const clean = raw.replace(/^.*\/admin\/users[^\s]*\s*\d+\s*/i, '').trim();
      setMsg({ kind: 'err', text: clean || 'Update failed.' });
    } finally { setBusy(false); }
  };

  const roleDef = (id: string) => roles.find((r) => r.id === id);
  const roleChip = (id: string) => {
    const def = roleDef(id);
    const accent = def?.accent ?? '#8ba0bd';
    return <span key={id} className="role-chip" style={{ color: accent, borderColor: `${accent}66`, background: `${accent}1a` }}>{def?.icon ?? '◌'} {def?.label ?? id}</span>;
  };

  if (!data) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="space-y-6">
      <PageHead title="Users & Roles" />
      <PageHero kicker="ACCESS & PERMISSIONS" title={<>Your team, <em>in control.</em></>} desc="Every account that can reach this Nexus surface — with role grants and restrictions applied in one built-in permission catalog." glyph="◎" art="people" />

      <div className="glass-panel overflow-hidden p-2">
        <table className="glass-table">
          <thead><tr><th>Email</th><th className="text-center">Name</th><th>Roles</th><th className="text-center">Verified</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={String(u._id)}>
                <td className="text-slate-200">{u.email}{u.email === currentUserEmail && <span className="you-tag">you</span>}</td>
                <td className="text-slate-300">{u.name ?? '—'}</td>
                <td>
                  {(u.roles ?? []).map(roleChip)}
                  {!(u.roles ?? []).length && '—'}
                </td>
                <td className="text-center text-emerald-400">{u.emailVerified ? '✓' : <span className="text-slate-500">—</span>}</td>
                <td className="text-right"><button className="glass-chip-btn" onClick={() => openEditor(u)}>◈ Edit roles</button></td>
              </tr>
            ))}
            {!data.users.length && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No users registered.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="role-catalog">
        {roles.map((r) => (
          <div className="role-box" key={r.id} style={{ ['--role-accent' as string]: r.accent }}>
            <div className="role-box-head">
              <span className="role-box-icon" style={{ color: r.accent }}>{r.icon}</span>
              <div>
                <strong style={{ color: r.accent }}>{r.label}</strong>
                <code className="role-box-id">{r.id}</code>
              </div>
            </div>
            <p className="role-box-desc">{r.description}</p>
            <div className="role-section">
              <span className="role-section-title is-can">✓ Can do</span>
              <ul className="role-list">
                {r.grants.map((g) => <li key={g.label}><b>{g.label}</b><span>{g.detail}</span></li>)}
              </ul>
            </div>
            <div className="role-section">
              <span className="role-section-title is-no">✕ Restricted from</span>
              <ul className="role-list">
                {r.restricts.map((g) => <li key={g.label}><b>{g.label}</b><span>{g.detail}</span></li>)}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="confirm-overlay" onClick={() => !busy && setEditing(null)}>
          <div className="confirm-dialog role-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-dialog-head">
              <span className="confirm-dialog-mark">◎</span>
              <strong>Edit roles · {editing.email}</strong>
              <button className="confirm-dialog-close" onClick={() => !busy && setEditing(null)} aria-label="Close">×</button>
            </div>
            <p className="confirm-dialog-message">Choose which roles this account holds — every selected role applies.</p>
            <div className="role-options">
              {roles.map((r) => {
                const on = draft.includes(r.id);
                return (
                  <button key={r.id} type="button" className={`role-option${on ? ' is-on' : ''}`} style={{ ['--role-accent' as string]: r.accent }} onClick={() => toggleRole(r.id)}>
                    <span className="role-option-icon" style={{ color: r.accent }}>{on ? '✓' : r.icon}</span>
                    <span className="role-option-text">
                      <b>{r.label}</b>
                      <small>{r.description}</small>
                    </span>
                    <span className="role-option-check">{on ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
            {editing.email === currentUserEmail && (
              <p className="role-hint">Editing your own account — removing <b>Administrator</b> from yourself is blocked server-side.</p>
            )}
            <div className="confirm-dialog-actions">
              <button className="glass-chip-btn" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="glass-chip-btn-danger confirm-dialog-primary" onClick={saveRoles} disabled={busy}>{busy ? 'Saving…' : 'Save roles'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatPointTime(t: number, range: RequestSeriesRange): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (range === 'today' || range === '5d') return time;
  if (range === 'week') return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function RequestSeriesChart({ series }: { series: RequestSeries | null }) {
  const W = 720;
  const H = 96;
  const PAD = 4;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; label: string; count: number } | null>(null);
  const pts = series?.points?.length ? series.points : [];
  if (!series || !pts.length) {
    return (
      <div className="traffic-chart">
        <div className="traffic-chart-body">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="No request data">
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--admin-border, rgba(125,174,235,0.2))" strokeWidth="1" />
          </svg>
        </div>
        <div className="traffic-meta"><span>no data for this range yet</span></div>
      </div>
    );
  }
  const max = Math.max(1, ...pts.map((p) => p.count));
  const minT = pts[0].t;
  const maxT = pts[pts.length - 1].t;
  const span = Math.max(1, maxT - minT);
  const coords = pts.map((p) => [PAD + ((p.t - minT) / span) * (W - PAD * 2), H - PAD - (p.count / max) * (H - PAD * 2)] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${(W - PAD).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
  const showTip = (e: React.MouseEvent<SVGCircleElement>, i: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const [vx, vy] = coords[i];
    setTip({
      x: (vx / W) * rect.width,
      y: (vy / H) * rect.height,
      label: formatPointTime(pts[i].t, series.range),
      count: pts[i].count,
    });
  };
  return (
    <div className="traffic-chart">
      <div className="traffic-chart-body">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="HTTP request traffic">
          <defs>
            <linearGradient id="seriesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--admin-violet, #9f7bff)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--admin-violet, #9f7bff)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--admin-border, rgba(125,174,235,0.2))" strokeWidth="1" />
          <path d={area} fill="url(#seriesFill)" />
          <path d={line} fill="none" stroke="var(--admin-violet, #9f7bff)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => (
            <circle key={i} cx={coords[i][0]} cy={coords[i][1]} r="7" fill="transparent" style={{ cursor: 'crosshair' }} onMouseEnter={(e) => showTip(e, i)} onMouseMove={(e) => showTip(e, i)} onMouseLeave={() => setTip(null)} />
          ))}
        </svg>
        {tip && (
          <div className="traffic-tip" style={{ left: tip.x, top: tip.y }}>
            <span className="traffic-tip-time">{tip.label}</span>
            <span className="traffic-tip-count">{tip.count} req</span>
          </div>
        )}
      </div>
      <div className="traffic-meta"><span>{series.total} requests in range</span><span>peak {max} / bucket</span></div>
    </div>
  );
}

const SERIES_OPTIONS: Array<{ id: RequestSeriesRange; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '5d', label: '5 days' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

function Monitoring() {
  const [data, setData] = useState<any>(null);
  const [series, setSeries] = useState<RequestSeries | null>(null);
  const [logs, setLogs] = useState<RequestLogEntry[]>([]);
  const [range, setRange] = useState<RequestSeriesRange>('today');
  useEffect(() => {
    getMetrics().then(setData).catch(() => {});
    const t = setInterval(() => getMetrics().then(setData).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const s = await getRequestSeries(range); if (alive) setSeries(s); } catch { if (alive) setSeries(null); }
    };
    void load();
    const intervalMs = range === 'today' ? 5000 : range === '5d' ? 30000 : 60000;
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [range]);
  useEffect(() => {
    getRequestLogs().then(setLogs).catch(() => {});
    const t = setInterval(() => getRequestLogs().then(setLogs).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);
  if (!data) return <p className="text-slate-400">Loading…</p>;
  return (
    <div className="space-y-6">
      <PageHead title="Monitoring" />
      <PageHero kicker="LIVE TELEMETRY" title={<>Watch the whole <em>machine.</em></>} desc="A calm, self-refreshing readout of the backend heartbeat — uptime, PID and request traffic without the noise." glyph="⌁" art="coins" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="glass-card"><div className="glass-h3">Uptime</div><div className="mt-2 text-3xl font-bold text-slate-100">{Math.round(data.uptime ?? 0)}<span className="ml-1 text-sm font-normal text-slate-400">s</span></div></div>
        <div className="glass-card"><div className="glass-h3">PID</div><div className="mt-2 font-mono text-3xl font-bold text-slate-100">{data.pid}</div></div>
        <div className="glass-card"><div className="glass-h3">HTTP requests</div><div className="mt-2 text-2xl font-bold text-indigo-300">{(() => { const v = data.metrics?.http_requests_total?.values; return v ? Object.values(v).reduce((a: number, b) => a + Number(b ?? 0), 0) : '—'; })()}</div></div>
      </div>
      <div className="glass-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="glass-h3">Request traffic</h3>
          <div className="series-tabs">
            {SERIES_OPTIONS.map((o) => (
              <button key={o.id} type="button" className={range === o.id ? 'is-active' : ''} onClick={() => setRange(o.id)}>{o.label}</button>
            ))}
          </div>
        </div>
        <RequestSeriesChart series={series} />
      </div>
      <div className="glass-card">
        <h3 className="glass-h3 mb-3">Recent requests</h3>
        {logs.length ? (
          <div className="req-log-table-wrap">
            <table className="glass-table req-log-table">
              <thead><tr className="text-slate-400"><th>Time</th><th>Method</th><th>Path</th><th className="text-center">Status</th><th className="text-right">Dur</th><th>IP</th><th>Referer</th></tr></thead>
              <tbody>
                {logs.map((r, i) => (
                  <tr key={i}>
                    <td className="req-td-time">{new Date(r.time).toLocaleTimeString()}</td>
                    <td className={`req-method req-method-${String(r.method).toLowerCase()}`}>{r.method}</td>
                    <td className="req-td-path" title={r.url ?? r.path}>{r.url ?? r.path}</td>
                    <td className={`text-center req-status ${r.status >= 500 ? 'req-status-err' : r.status >= 400 ? 'req-status-warn' : ''}`}>{r.status}</td>
                    <td className="text-right req-td-dur">{r.durationMs}ms</td>
                    <td className="req-td-ip">{r.ip ?? '—'}</td>
                    <td className="req-td-ref" title={r.referer}>{r.referer ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No requests logged yet.</p>
        )}
      </div>
    </div>
  );
}

interface PaymentOrder {
  provider: string;
  orderId: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  paymentId?: string;
  createdAt?: string;
}
interface PaymentTransaction {
  provider: string;
  event: string;
  verified: boolean;
  orderId?: string;
  paymentId?: string;
  amount?: number;
  currency?: string;
  status?: string;
  createdAt?: string;
}

const ALL_PROVIDERS = ['razorpay', 'paypal', 'payu', 'skrill', 'payoneer'];

function Payments({ toggle }: { toggle: ToggleStyle }) {
  const [tab, setTab] = useState<'orders' | 'transactions' | 'test'>('orders');
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [status, setStatus] = useState<PaymentProviderStatus[]>([]);
  const [provider, setProvider] = useState('all');
  const [msg, setMsg] = useAdminAlert('payments');

  const load = async (q = provider) => {
    setMsg('');
    try {
      const filter = q === 'all' ? undefined : q;
      const [o, t, s] = await Promise.all([getPaymentOrders(filter), getPaymentTransactions(filter), getPaymentStatus()]);
      setOrders(o.orders ?? []);
      setTransactions(t.transactions ?? []);
      setStatus(s.providers ?? []);
    } catch (e: any) { setMsg(String(e?.message ?? e)); }
  };
  useEffect(() => { load('all'); }, []);

  return (
    <div className="space-y-6">
      <PageHead title="Payments">
        <div className="flex items-center gap-3">
          <select value={provider} onChange={(e) => { const v = e.target.value; setProvider(v); load(v); }} className="glass-input w-44 !py-1.5">
            <option value="all" className="bg-slate-900">All providers</option>
            {ALL_PROVIDERS.map((p) => <option key={p} value={p} className="bg-slate-900">{p}</option>)}
          </select>
          <button onClick={() => load()} className="glass-chip-btn">↻ refresh</button>
        </div>
      </PageHead>
      <PageHero kicker="PAYMENT OPERATIONS" title={<>Money flow, <em>on the ledger.</em></>} desc="Every charge, refund and provider event from your payment stack — one surface to reconcile what went through." glyph="$" art="cards" />

      <div className="workspace-tabs">
        {([
          ['orders', `Orders (${orders.length})`],
          ['transactions', `Transactions (${transactions.length})`],
          ['test', 'Test Console'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={tab === id ? 'is-active' : ''}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'orders' && <OrdersTable orders={orders} />}
      {tab === 'transactions' && <TransactionsTable transactions={transactions} />}
      {tab === 'test' && (
        <TestConsole toggle={toggle} status={status} onRun={() => load()} onNotice={setMsg} onCreated={() => { setTab('orders'); load(); }} />
      )}
    </div>
  );
}

function OrdersTable({ orders }: { orders: PaymentOrder[] }) {
  const statusColor = (s: string) => (['paid', 'captured'].includes(s) ? 'text-emerald-400' : ['failed', 'refunded', 'cancelled'].includes(s) ? 'text-rose-400' : 'text-slate-300');
  return (
    <section className="glass-panel overflow-hidden p-2">
      <table className="glass-table">
        <thead><tr><th>Provider</th><th>Order</th><th>Reference</th><th className="text-center">Status</th><th className="text-right">Amount</th><th>Payment ID</th><th>Created</th></tr></thead>
        <tbody>
          {orders.map((o, i) => (
            <tr key={`${o.orderId}-${i}`}>
              <td><span className="chip">{o.provider}</span></td>
              <td className="font-mono text-slate-200">{o.orderId || '—'}</td>
              <td className="font-mono text-slate-400">{o.reference || '—'}</td>
              <td className={`text-center ${statusColor(o.status)}`}>{o.status}</td>
              <td className="text-right font-medium text-slate-200">{o.currency} {o.amount}</td>
              <td className="font-mono text-slate-400">{o.paymentId || '—'}</td>
              <td className="text-slate-400">{o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
          {!orders.length && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No orders recorded yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function TransactionsTable({ transactions }: { transactions: PaymentTransaction[] }) {
  return (
    <section className="glass-panel overflow-hidden p-2">
      <table className="glass-table">
        <thead><tr><th>Provider</th><th>Event</th><th className="text-center">Verified</th><th>Order</th><th>Payment</th><th className="text-right">Amount</th><th>Created</th></tr></thead>
        <tbody>
          {transactions.map((t, i) => (
            <tr key={i}>
              <td><span className="chip">{t.provider}</span></td>
              <td className="font-mono text-slate-200">{t.event}</td>
              <td className={`text-center ${t.verified ? 'text-emerald-400' : 'text-rose-400'}`}>{t.verified ? '✓' : '✗'}</td>
              <td className="font-mono text-slate-400">{t.orderId || '—'}</td>
              <td className="font-mono text-slate-400">{t.paymentId || '—'}</td>
              <td className="text-right text-slate-200">{t.currency ? `${t.currency} ${t.amount ?? ''}` : '—'}</td>
              <td className="text-slate-400">{t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
          {!transactions.length && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No webhook transactions yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function TestConsole({ toggle, status, onRun, onNotice, onCreated }: { toggle: ToggleStyle; status: PaymentProviderStatus[]; onRun: () => Promise<void> | void; onNotice: (msg: string) => void; onCreated: () => void }) {
  const [probeBusy, setProbeBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toggleBusy, setToggleBusy] = useState<string>('');
  const [switchAnim, setSwitchAnim] = useState<Record<string, 'out' | 'in' | null>>({});
  const [provider, setProvider] = useState('');
  const [amount, setAmount] = useState('100');
  const [currency, setCurrency] = useState('INR');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<any>(null);
  const [keyProvider, setKeyProvider] = useState<PaymentProviderStatus | null>(null);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [keyMsgKind, setKeyMsgKind] = useState<'ok' | 'err'>('ok');

  const openKeys = (p: PaymentProviderStatus) => {
    setKeyProvider(p);
    setKeyDraft({});
    setKeyMsg('');
    setKeyMsgKind('ok');
  };

  const saveKeys = async () => {
    if (!keyProvider) return;
    setKeyBusy(true); setKeyMsg(''); setKeyMsgKind('ok');
    try {
      const res = await savePaymentProviderKeys(keyProvider.name, keyDraft);
      setKeyProvider(null);
      setKeyMsg('');
      await onRun();
      onNotice(`Payment provider "${keyProvider.name}" keys saved. Enabled state persisted.`);
    } catch (e: any) { setKeyMsg(String(e?.message ?? e)); setKeyMsgKind('err'); }
    finally { setKeyBusy(false); }
  };

  const testOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setResult(null);
    try {
      const res = await createPaymentOrder({ provider, amount: Number(amount), currency });
      setResult(res.order ?? res);
      onCreated();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const toggleProvider = async (p: PaymentProviderStatus) => {
    setToggleBusy(p.name);
    setSwitchAnim((prev) => ({ ...prev, [p.name]: 'out' }));
    await new Promise<void>((r) => window.setTimeout(r, 280));
    try {
      await updatePaymentProvider(p.name, { enabled: !p.enabled });
      setSwitchAnim((prev) => ({ ...prev, [p.name]: 'in' }));
      await onRun();
    } catch { /* non-fatal */ }
    finally {
      setToggleBusy('');
      await new Promise<void>((r) => window.setTimeout(r, 420));
      setSwitchAnim((prev) => { const next = { ...prev }; delete next[p.name]; return next; });
    }
  };

  const selected = status.find((p) => p.name === provider);

  return (
    <div className="space-y-6">
      <section className="glass-card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="glass-h3">Provider status</h3>
          <button onClick={async () => { setProbeBusy(true); try { await onRun(); } finally { setProbeBusy(false); } }} className="glass-chip-btn" disabled={probeBusy}>
            {probeBusy ? 'checking…' : '↻ re-run checks'}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {status.map((p) => {
            const anim = switchAnim[p.name] ?? null;
            return (
              <div key={p.name} className={`provider-card ${p.enabled ? 'is-on' : 'is-off'}${anim === 'out' ? ' is-switch-out' : ''}${anim === 'in' ? ' is-switch-in' : ''}`}>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => toggleProvider(p)}
                    disabled={!!toggleBusy || !!anim}
                    className={`ai-toggle tg-${toggle} ${p.enabled ? 'is-on' : ''}`}
                    title={p.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                  >
                    <span className="ai-toggle-knob" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-slate-200 truncate">{p.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono truncate">{p.sandbox ? 'sandbox mode' : 'live mode'}</div>
                  </div>
                  <span className={p.ok ? 'dot-ok' : 'dot-bad'} title={p.ok ? 'working' : 'not working'} />
                  <button onClick={() => openKeys(p)} className="glass-chip-btn shrink-0 text-[10px]" title="Set API key / secret">🔑 keys</button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {p.enabled
                    ? <span className="provider-badge-ok">enabled</span>
                    : <span className="provider-badge-mute">disabled</span>}
                  {p.sandbox && <span className="provider-badge-warn">sandbox</span>}
                  {p.configured
                    ? <span className="provider-badge-ok">keys configured</span>
                    : <span className="provider-badge-warn">missing keys</span>}
                </div>
                {p.detail && <div className="text-xs text-emerald-400">{p.detail}</div>}
                {p.error && <div className="text-xs text-rose-400">{p.error}</div>}
                {p.note && <div className="text-xs text-slate-500">{p.note}</div>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="glass-card space-y-3">
        <div>
          <h3 className="glass-h3">Create a test order</h3>
          <p className="mt-1 text-sm text-slate-400">Creates a real order through the selected provider (hosted checkout, no charge) and records it in the orders table — verifies keys, upstream reachability and persistence.</p>
        </div>
        <form onSubmit={testOrder} className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-300">Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value)} required className="glass-input mt-1 block w-44">
              <option value="" disabled className="bg-slate-900">choose…</option>
              {status.map((p) => (
                <option key={p.name} value={p.name} className="bg-slate-900">{p.enabled ? p.name : `${p.name} (disabled)`}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">Amount
            <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="glass-input mt-1 block w-28" />
          </label>
          <label className="text-sm text-slate-300">Currency
            <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="glass-input mt-1 block w-20" />
          </label>
          <button type="submit" disabled={busy || !provider} className="glass-btn-primary">
            {busy ? 'Creating…' : 'Create test order'}
          </button>
        </form>
        {err && <p className="text-sm text-rose-400">{err}</p>}
        {selected && !selected.enabled && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            “{selected.name}” is disabled in the config — it will be rejected by the backend. To enable it, set{' '}
            <code className="font-mono">NEXUS_PAYMENTS_{selected.name.toUpperCase()}_ENABLED=true</code> (plus its keys) in the project <code className="font-mono">.env</code>, or <code className="font-mono">payments.{selected.name}.enabled: true</code> in <code className="font-mono">nexus.config.ts</code>, then restart the backend. A provider also activates automatically once its keys are present.
          </p>
        )}
        {result && (
          <pre className="glass-code max-h-64 overflow-auto p-3">{JSON.stringify(result, null, 2)}</pre>
        )}
      </section>

      {keyProvider && (
        <PaymentKeysDialog
          provider={keyProvider}
          value={keyDraft}
          onChange={setKeyDraft}
          onSave={saveKeys}
          onCancel={() => { setKeyProvider(null); setKeyMsg(''); }}
          busy={keyBusy}
          msg={keyMsg}
          msgKind={keyMsgKind}
        />
      )}
    </div>
  );
}

function PaymentKeysDialog({ provider, value, onChange, onSave, onCancel, busy, msg, msgKind }: {
  provider: PaymentProviderStatus;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  msg: string;
  msgKind: 'ok' | 'err';
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const fields = provider.fields?.length ? provider.fields : (provider.name === 'skrill' ? [{ field: 'merchantEmail', label: 'Merchant email', hasValue: false }] : []);

  return (
    <div className="provider-modal-backdrop" onClick={onCancel}>
      <div className="provider-modal space-y-4" role="dialog" aria-modal="true" aria-labelledby="payment-keys-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="admin-overline">PAYMENT CREDENTIAL</span>
            <h3 id="payment-keys-title" className="mt-1 text-base font-semibold text-slate-100">{provider.name}</h3>
            <code className="text-xs text-slate-500">{provider.name}</code>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className="glass-chip-btn text-xs" aria-label="Close payment keys dialog">✕</button>
        </div>

        <div className="rounded-xl border border-sky-400/20 bg-black/20 px-3 py-2 text-xs text-slate-400">
          Keys are stored server-side in <code className="font-mono">.env</code> as <code className="font-mono">NEXUS_PAYMENTS_{provider.name.toUpperCase()}_*</code> and never written to the config file.
        </div>

        {msg && (
          <div role="alert" className={`rounded-lg border px-3 py-1.5 text-sm ${msgKind === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
            {msg}
          </div>
        )}

        <div className="space-y-3">
          {fields.map((f) => (
            <label key={f.field} className="block">
              <span className="admin-overline">{f.label}</span>
              <input
                className="glass-input mt-1 text-sm font-mono"
                type="password"
                id={`payment-${f.field}`}
                name={`payment-${f.field}`}
                autoComplete="new-password"
                placeholder={f.hasValue ? `•••••••• (enter new to replace)` : `paste ${f.label.toLowerCase()}`}
                value={value[f.field] ?? ''}
                onChange={(event) => onChange({ ...value, [f.field]: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !busy) { event.preventDefault(); onSave(); }
                }}
              />
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-sky-400/20 pt-3">
          <button type="button" onClick={onCancel} disabled={busy} className="glass-chip-btn">Cancel</button>
          <button type="button" onClick={onSave} disabled={busy || fields.length === 0} className="glass-chip-btn-primary">
            {busy ? 'Saving…' : 'Save keys'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Databases() {
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [msg, setMsg] = useAdminAlert('databases');
  const [newDb, setNewDb] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, { count: number; docs: unknown[] }>>({});
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [newColl, setNewColl] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ title: string; message: React.ReactNode; action: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try { setDatabases((await getDatabases()).databases ?? []); setMsg(''); } catch (e: any) { setMsg(String(e?.message ?? e)); }
  };
  useEffect(() => { refresh(); }, []);

  const withOk = async (fn: () => Promise<any>): Promise<boolean> => {
    setMsg('');
    try { await fn(); return true; } catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); return false; }
  };

  const toggleDocs = async (db: string, coll: string) => {
    const key = `${db}/${coll}`;
    if (docs[key]) { const next = { ...docs }; delete next[key]; setDocs(next); return; }
    try { setDocs({ ...docs, [key]: await getCollectionDocs(db, coll) }); } catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); }
  };

  const doRename = async (db: string, coll: string) => {
    const newName = (renames[`${db}/${coll}`] ?? '').trim();
    if (!newName) return;
    if (await withOk(() => modifyCollection(db, coll, { newName }))) { await refresh(); setRenames({ ...renames, [`${db}/${coll}`]: '' }); }
  };

  const doCreateColl = async (db: string) => {
    const name = (newColl[db] ?? '').trim();
    if (!name) return;
    if (await withOk(() => createCollection(db, { name }))) { await refresh(); setNewColl({ ...newColl, [db]: '' }); }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try { await confirm.action(); } finally { setBusy(false); setConfirm(null); }
  };

  return (
    <div className="space-y-6">
      <PageHead title="Databases">
        <button onClick={refresh} className="glass-chip-btn">↻ refresh</button>
      </PageHead>
      <PageHero kicker="DATA FOUNDATION" title={<>Your data, <em>organized.</em></>} desc="Databases and collections backing your project — inspect, create and keep the layer that stores everything sane." glyph="▦" art="cubes" />

      <div className="glass-card flex gap-2">
        <input className="glass-input max-w-xs" placeholder="new database name" value={newDb} onChange={(e) => setNewDb(e.target.value)} />
        <button onClick={async () => { if (newDb.trim() && await withOk(() => createDatabase(newDb.trim()))) { setNewDb(''); await refresh(); } }} className="glass-btn-primary">Create database</button>
      </div>

      <div className="space-y-3">
        {databases.map((db) => (
          <div key={db.name} className="glass-card">
            <div className="flex items-center gap-3">
              <button onClick={() => setExpanded(expanded === db.name ? null : db.name)} className="cursor-pointer font-mono text-base font-semibold text-slate-100 transition-colors hover:text-indigo-300">
                <span className={`mr-1 inline-block transition-transform ${expanded === db.name ? 'rotate-90' : ''}`}>▸</span>{db.name}
              </button>
              <span className="text-xs text-slate-500">{(db.sizeOnDisk / 1024).toFixed(1)} KB · {db.collections.length} collections</span>
              <button onClick={() => setConfirm({ title: `Drop database “${db.name}”?`, message: <>This will permanently delete the database <strong>{db.name}</strong> and all of its collections. This cannot be undone.</>, action: async () => { if (await withOk(() => deleteDatabase(db.name))) await refresh(); } })} className="glass-chip-btn-danger ml-auto">drop</button>
            </div>

            {expanded === db.name && (
              <div className="mt-4 space-y-2.5">
                <div className="flex gap-2">
                  <input className="glass-input max-w-xs !py-1.5 text-sm" placeholder="new collection" value={newColl[db.name] ?? ''} onChange={(e) => setNewColl({ ...newColl, [db.name]: e.target.value })} />
                  <button onClick={() => doCreateColl(db.name)} className="glass-chip-btn">create</button>
                </div>
                {db.collections.length === 0 && <p className="text-sm text-slate-500">No collections.</p>}
                {db.collections.map((c) => (
                  <div key={`${db.name}/${c.name}`} className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2.5 text-sm">
                    <span className="font-mono text-slate-200">{c.name}</span>
                    <span className="text-xs text-slate-500">{c.count} docs</span>
                    <button onClick={() => toggleDocs(db.name, c.name)} className="glass-chip-btn ml-auto">docs</button>
                    <input className="glass-input w-36 !py-1 text-xs" placeholder="rename to…" value={renames[`${db.name}/${c.name}`] ?? ''} onChange={(e) => setRenames({ ...renames, [`${db.name}/${c.name}`]: e.target.value })} />
                    <button onClick={() => doRename(db.name, c.name)} className="glass-chip-btn">rename</button>
                    <button onClick={() => setConfirm({ title: `Drop collection “${c.name}”?`, message: <>This will permanently delete the collection <strong>{db.name}/{c.name}</strong> and its {c.count} document{c.count === 1 ? '' : 's'}. This cannot be undone.</>, action: async () => { if (await withOk(() => dropCollection(db.name, c.name))) await refresh(); } })} className="glass-chip-btn-danger">drop</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {!databases.length && !msg && <p className="text-sm text-slate-500">No databases found.</p>}
        {Object.entries(docs).map(([key, val]) => {
          const [db, coll] = key.split('/') as [string, string];
          return expanded === db ? (
            <div key={key} className="glass-code max-h-64 overflow-auto p-3 text-xs">
              <span className="text-slate-400">{db}/{coll} — {val.count} docs (showing {val.docs.length}):</span>
              <pre className="mt-1 font-mono">{JSON.stringify(val.docs[0] ?? {}, null, 2)}{val.docs.length > 1 ? `\n… and ${val.docs.length - 1} more` : ''}</pre>
            </div>
          ) : null;
        })}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        danger
        busy={busy}
        confirmLabel="Drop"
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function Schema() {
  const [prompt, setPrompt] = useState('');
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [db, setDb] = useState('');
  const [result, setResult] = useState<GeneratedSchema | null>(null);
  const [edited, setEdited] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useAdminAlert('schema');
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiErr, setAiErr] = useState('');

  useEffect(() => { getDatabases().then((d) => setDatabases(d.databases ?? [])).catch(() => {}); }, []);

  const checkAi = async () => {
    setAiErr('');
    try { setAiStatus(await getAiStatus()); } catch (e: any) { setAiErr(String(e?.message ?? e)); }
  };
  useEffect(() => { checkAi(); }, []);

  const generate = async () => {
    if (!prompt.trim()) { setMsg('Describe the data you want to model, e.g. "products with a name, price and category".'); return; }
    setBusy(true); setMsg('');
    try {
      const g = await generateSchema(prompt);
      setResult(g);
      setEdited(JSON.stringify(g.jsonSchema, null, 2));
      setMsg(`Schema generated (${g.model}) — review and create.`);
    } catch (e: any) { setMsg(`Generation failed: ${e?.message ?? e} — check the AI status below (is the AI server running on :8000?).`); }
    finally { setBusy(false); }
  };

  const create = async () => {
    setMsg('');
    let schema: unknown;
    try { schema = JSON.parse(edited); } catch { setMsg('Edited schema is not valid JSON.'); return; }
    const target = db || databases[0]?.name;
    if (!target) { setMsg('Create a database first (Databases tab), then pick it here.'); return; }
    try {
      await createCollection(target, { name: result?.collection ?? 'ai_schema', jsonSchema: schema });
      setMsg(`Created collection "${result?.collection ?? 'ai_schema'}" in "${target}" with the validator attached.`);
    } catch (e: any) { setMsg(`Create failed: ${e?.message ?? e}`); }
  };

  return (
    <div className="space-y-6">
      <PageHead title="AI Schema Creation" />
      <PageHero kicker="AI WORKSPACE" title={<>Schemas, <em>born from language.</em></>} desc="Describe the data you need in plain English and let the model return a validated MongoDB schema you can review before it's live." glyph="✦" art="bolt" />
      <p className="text-sm text-slate-400">Describe the data in plain English — the AI returns a MongoDB <code className="rounded bg-white/10 px-1 font-mono text-xs">$jsonSchema</code> validator plus a field list, which you review and create as a validator-protected collection.</p>

      <section className="glass-card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="glass-h3">AI provider status</h3>
          <button onClick={checkAi} className="glass-chip-btn">re-check</button>
        </div>
        {aiErr && <p className="text-xs text-rose-400">{aiErr}</p>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {aiStatus ? (
            <>
              {([
                ['AI server', aiStatus.aiServer, aiStatus.aiServer.detail ? `health: ${aiStatus.aiServer.detail.status ?? 'unknown'}` : undefined],
                ['Ollama', aiStatus.ollama, aiStatus.ollama.detail?.modelCount != null ? `${aiStatus.ollama.detail.modelCount} model(s) reachable` : undefined],
              ] as const).map(([label, s, detail]) => (
                <div key={label} className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
                  <span className={s.ok ? 'dot-ok' : 'dot-bad'} />
                  <span className="font-medium text-slate-200">{label}</span>
                  <span className={`text-xs ${s.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{s.ok ? (detail ?? 'ok') : (s.error ?? 'down')}</span>
                </div>
              ))}
            </>
          ) : (
            <p className="col-span-3 text-xs text-slate-500">No status yet{aiErr ? '' : ' — run a check'}.</p>
          )}
        </div>
        {aiStatus && <p className="text-xs text-slate-500">"auto" currently resolves to <span className="font-mono text-slate-300">{aiStatus.autoResolvesTo}</span> on the AI server.</p>}
      </section>

      <div className="glass-card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="glass-h3">Describe your collection</h3>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300/30 bg-indigo-400/10 px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-indigo-300"><i className="dot-ok" /> AI auto</span>
        </div>
        <textarea className="glass-code h-32 w-full p-3 text-sm" placeholder='e.g. "a products collection with name, price (number), in-stock flag, category from a fixed enum, created date and an optional description"' value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="mr-1.5 text-sm text-slate-400">Database</label>
          <select className="glass-input w-48 !py-1.5 text-sm" value={db} onChange={(e) => setDb(e.target.value)}>
            <option value="" className="bg-slate-900">{databases.length ? 'pick a database…' : 'no databases yet'}</option>
            {databases.map((d) => <option key={d.name} value={d.name} className="bg-slate-900">{d.name}</option>)}
          </select>
          <span className="text-xs text-slate-500">Provider &amp; model auto-selected on the AI server.</span>
          <button onClick={generate} disabled={busy} className="glass-btn-primary ml-auto">{busy ? 'Generating…' : 'Generate with AI'}</button>
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="glass-card space-y-3">
            <h3 className="glass-h3">Generated schema — <span className="font-mono text-indigo-300">{result.collection}</span></h3>
            <div className="max-h-48 overflow-auto rounded-xl border border-white/10">
              <table className="glass-table">
                <thead><tr><th>Field</th><th>Type</th><th className="text-center">Required</th><th className="text-center">Unique</th><th>Description</th></tr></thead>
                <tbody>
                  {result.fields.map((f) => (
                    <tr key={f.name}>
                      <td className="font-mono text-slate-200">{f.name}</td>
                      <td className="text-slate-300">{f.type}</td>
                      <td className="text-center text-emerald-400">{f.required ? '✓' : ''}</td>
                      <td className="text-center text-indigo-300">{f.unique ? '✓' : ''}</td>
                      <td className="text-slate-400">{f.description ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="glass-h3 mb-2">$jsonSchema validator <span className="ml-1 font-normal normal-case text-slate-500">(editable before creating)</span></h4>
              <textarea className="glass-code h-56 w-full p-3 text-xs" value={edited} onChange={(e) => setEdited(e.target.value)} spellCheck={false} />
            </div>
            <button onClick={create} className="glass-btn-success">Create collection with validator</button>
          </div>
        </div>
      )}
    </div>
  );
}
