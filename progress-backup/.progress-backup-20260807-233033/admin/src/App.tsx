import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logoUrl from './assets/bhooai-nexus-logo.svg';
import {
  login, registerAndLogin, setAccessToken, getAccessToken,
  getAdminConfig, putAdminConfig, putAdminConfigFile, getAdminEnv, putAdminEnv, getPlugins, getUsers, getRoles, putUserRoles, getMetrics,
  getServices, controlService, getServiceLogs,
  runPreflight,
  runLintEnv, runLintConfig,
  getPaymentOrders, getPaymentTransactions, getPaymentStatus, createPaymentOrder,
  getDatabases, createDatabase, deleteDatabase,
  createCollection, modifyCollection, dropCollection, getCollectionDocs,
  generateSchema, getAiStatus,
  type ServiceState, type AdminConfig, type AdminEnv, type EnvEntry, type DatabaseInfo, type GeneratedSchema, type PaymentProviderStatus, type AiStatus, type UserRecord, type RoleDefinition, type PreflightReport, type PreflightCheck, type LintReport,
} from './api.js';

type Tab = 'overview' | 'processes' | 'config' | 'env' | 'plugins' | 'users' | 'monitoring' | 'payments' | 'databases' | 'schema' | 'theme';
type AdminTheme = 'aurora' | 'midnight' | 'violet';
type UiMode = 'workspace' | 'compact' | 'focus';

interface CustomTheme { active: boolean; blue: string; violet: string; pink: string; bg: string; ink: string; muted: string; mesh: number; glass: number; radius: number; }

const CUSTOM_THEME_KEY = 'nexus-admin-custom-theme';
const THEME_PRESETS: Record<AdminTheme, Omit<CustomTheme, 'active'>> = {
  aurora: { blue: '#54b7ff', violet: '#9f7bff', pink: '#f36eb8', bg: '#0b0d1a', ink: '#eef6ff', muted: '#98aec9', mesh: 0.32, glass: 0.35, radius: 13 },
  midnight: { blue: '#78bfff', violet: '#7da5d3', pink: '#b8c7db', bg: '#02050b', ink: '#eaf3ff', muted: '#8fa6c2', mesh: 0.2, glass: 0.25, radius: 11 },
  violet: { blue: '#b4a1ff', violet: '#d78bff', pink: '#ff8ed1', bg: '#0b071b', ink: '#f3eaff', muted: '#a592c9', mesh: 0.4, glass: 0.3, radius: 15 },
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

interface AdminUser { email?: string; name?: string; }

const USER_KEY = 'nexus-admin-user';
function readUser(): AdminUser | null {
  if (typeof window === 'undefined') return null;
  try { const raw = window.localStorage.getItem(USER_KEY); return raw ? JSON.parse(raw) as AdminUser : null; } catch { return null; }
}

export function App() {
  const [authed, setAuthed] = useState(() => !!getAccessToken());
  const [user, setUser] = useState<AdminUser | null>(readUser);
  if (!authed) return <Login onAuthed={(u) => { setUser(u); window.localStorage.setItem(USER_KEY, JSON.stringify(u)); setAuthed(true); }} />;
  return <Dashboard user={user} onLogout={() => { setAccessToken(''); setUser(null); window.localStorage.removeItem(USER_KEY); setAuthed(false); }} />;
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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [theme] = useState<AdminTheme>(() => storedPreference('nexus-admin-theme', 'aurora', ['aurora', 'midnight', 'violet']));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      const data = mode === 'login'
        ? await login(email, password)
        : await registerAndLogin(email, password, name || email.split('@')[0]);
      onAuthed({ email: data?.user?.email ?? email, name: data?.user?.name ?? email.split('@')[0] });
    } catch (e: any) { setErr(String(e?.message ?? e)); }
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
        <input className="glass-input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="glass-input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button className="glass-btn-primary w-full" type="submit">
          {mode === 'login' ? 'Sign in' : 'Register & sign in'}
        </button>
        <button type="button" className="w-full cursor-pointer text-sm text-slate-400 transition-colors hover:text-slate-200" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Need an account? Register' : 'Already have one? Sign in'}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ user, onLogout }: { user: AdminUser | null; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [mobileNav, setMobileNav] = useState(false);
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
  const [projectName, setProjectName] = useState('');
  const [projectDb, setProjectDb] = useState('');
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const load = async () => {
      if (cancelled) return;
      try {
        const c = await getAdminConfig();
        const name = c.project?.name ?? '';
        if (name) { setProjectName(name); setProjectDb(c.project?.dbName ?? ''); return; }
      } catch { /* retry below */ }
      if (!cancelled && tries < 15) { tries += 1; window.setTimeout(load, 1500); }
    };
    void load();
    return () => { cancelled = true; };
  }, []);
  const [shellWidth] = useState(() => Math.round((typeof window === 'undefined' ? 0 : window.screen.width) * 0.8));
  const displayName = user?.name || user?.email?.split('@')[0] || 'Admin';
  const initials = displayName.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
  const nav: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '⌂' },
    { id: 'processes', label: 'Processes', icon: '◈' },
    { id: 'config', label: 'Config JSON', icon: '{}' },
    { id: 'env', label: 'Environment', icon: '⌁' },
    { id: 'plugins', label: 'Plugins', icon: '◇' },
    { id: 'users', label: 'Users', icon: '◎' },
    { id: 'monitoring', label: 'Monitoring', icon: '⌁' },
    { id: 'payments', label: 'Payments', icon: '$' },
    { id: 'databases', label: 'Databases', icon: '▦' },
    { id: 'databases', label: 'Databases', icon: '▦' },
    { id: 'schema', label: 'AI Schema', icon: '✦' },
    { id: 'theme', label: 'Theme Centre', icon: '◒' },
  ];
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
      <aside className={`admin-sidebar ${mobileNav ? 'is-open' : ''}`}>
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
        <header className="admin-topbar">
          <button className="admin-mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation">☰</button>
          <div className="admin-window-tab"><span className="window-tab-mark">◈</span><strong>{title}</strong><span className="window-tab-close">×</span></div>
          <div className="admin-search"><span>⌕</span><input placeholder="Search workspace" /><kbd>⌘ K</kbd></div>
          <div className="admin-top-actions">
            <span className="top-live"><i className="status-dot good" /> All systems nominal</span>
            <button className="admin-icon-button" onClick={() => { setAppearanceOpen(!appearanceOpen); setAccountOpen(false); }} aria-label="Open appearance settings" aria-expanded={appearanceOpen}>◒</button>
            <button className="admin-icon-button" aria-label="Notifications">⌁<b>3</b></button>
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
                  <button className="account-item" onClick={() => { setAppearanceOpen(true); setAccountOpen(false); }}>
                    <span className="account-item-icon">◒</span><span><b>Settings</b><small>Appearance, theme & interface mode</small></span>
                  </button>
                  <button className="account-item account-danger" onClick={onLogout}>
                    <span className="account-item-icon">↪</span><span><b>Sign out</b><small>End this session</small></span>
                  </button>
                </div>
              )}
            </div>
            <div ref={appearanceRef} className="admin-account">
              {appearanceOpen && <AppearancePanel theme={theme} uiMode={uiMode} onThemeChange={(value) => { setTheme(value); window.localStorage.setItem('nexus-admin-theme', value); }} onUiModeChange={(value) => { setUiMode(value); window.localStorage.setItem('nexus-admin-ui', value); }} />}
            </div>
          </div>
        </header>
        <div className="admin-breadcrumb"><span>THIS PC</span><b>›</b><strong>{displayProject || 'Project'}</strong><b>›</b><span>{title}</span><button>⋯</button></div>
        <div className="admin-content-layout">
          <main className="admin-content">
            {tab === 'overview' && <Overview onNavigate={setTab} />}
            {tab === 'processes' && <Processes />}
            {tab === 'config' && <Config onNavigate={setTab} />}
            {tab === 'env' && <Environment onNavigate={setTab} />}
            {tab === 'plugins' && <Plugins />}
            {tab === 'users' && <Users currentUserEmail={user?.email} />}
            {tab === 'monitoring' && <Monitoring />}
            {tab === 'payments' && <Payments />}
            {tab === 'databases' && <Databases />}
            {tab === 'schema' && <Schema />}
            {tab === 'theme' && <ThemeCentre theme={theme} onThemeChange={(value) => { setTheme(value); window.localStorage.setItem('nexus-admin-theme', value); }} uiMode={uiMode} onUiModeChange={(value) => { setUiMode(value); window.localStorage.setItem('nexus-admin-ui', value); }} custom={customTheme} onCustom={updateCustomTheme} particles={particles} onParticles={updateParticles} />}
          </main>
          <aside className="admin-inspector">
            <div className="inspector-heading"><span>WORKSPACE INSPECTOR</span><button aria-label="Close inspector">×</button></div>
            <div className="inspector-preview"><div className="preview-orbit"><span /><i /><b /></div><strong>Project Nexus</strong><span>Full-stack application</span></div>
            <div className="inspector-tabs"><b>Summary</b><span>Activity</span></div>
            <div className="inspector-card"><span className="admin-overline">CURRENT SURFACE</span><strong>{title}</strong><p>{tab === 'env' ? 'Masked environment values are ready to edit.' : tab === 'config' ? 'Runtime overrides are stored in nexus.runtime.json.' : 'Manage the running Nexus project from this workspace.'}</p></div>
            <div className="inspector-card inspector-list"><span className="admin-overline">QUICK LINKS</span><button onClick={() => setTab('config')}>Configuration <b>→</b></button><button onClick={() => setTab('env')}>Environment <b>→</b></button><button onClick={() => setTab('processes')}>Service logs <b>→</b></button></div>
            <button className="inspector-primary" onClick={() => setTab('overview')}>⌁ Open project overview <span>→</span></button>
            <div className="admin-side-widget">
              <div className="admin-widget-heading"><span>RUNTIME LOAD</span><b>LIVE</b></div>
              <div className="load-line"><span>CPU</span><i><b style={{ width: '32%' }} /></i><strong>32%</strong></div>
              <div className="load-line"><span>MEM</span><i><b style={{ width: '61%' }} /></i><strong>61%</strong></div>
              <div className="load-line"><span>DB</span><i><b className="violet" style={{ width: '44%' }} /></i><strong>44%</strong></div>
            </div>
          </aside>
        </div>
        <div className="admin-tool-rail"><button title="AI Notes">▣</button><button title="Screen recall">◫</button><button title="Smart search">⌕</button><button title="Live translate">◍</button><button title="Add tool">+</button></div>
        <footer className="admin-dock"><span><b className="dock-logo">◈</b> BhooAI Nexus</span><span>Connected to <strong>localhost:4000</strong></span><span className="dock-right"><i className="status-dot good" /> Secure admin session · {title}</span></footer>
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
                <span className="theme-card-swatch" style={{ background: `linear-gradient(135deg, ${preset.blue}, ${preset.violet} 55%, ${preset.pink})` }} />
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
            <div className="theme-preview-actions"><button className="tp-btn">Primary</button><button className="tp-chip">chip</button></div>
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
  if (!meta || error.startsWith(meta.label)) return error;
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
  useEffect(() => {
    const load = async () => {
      try { setMetrics(await getMetrics()); } catch { setMetrics(null); }
      try { setServices(await getServices()); } catch { setServices([]); }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  const running = services.filter((service) => service.status === 'running').length;
  const requests = metrics?.metrics?.http_requests_total?.values;
  const requestCount = requests ? Object.values(requests).reduce((sum: number, value) => sum + Number(value ?? 0), 0) : 0;
  const runChecks = async () => {
    setPreflightBusy(true);
    try { setPreflight(await runPreflight()); } catch { setPreflight(null); }
    setPreflightBusy(false);
  };
  return (
    <div className="admin-view-stack">
      <PageHead title="Project Overview"><button onClick={() => onNavigate('processes')} className="workspace-action">Open services <span>→</span></button></PageHead>
      <div className="overview-hero"><div><span className="admin-overline">GOOD MORNING, ADMIN</span><h1>Your project is <em>in orbit.</em></h1><p>One calm surface for the services, configuration, data, and AI that power your Nexus application.</p></div><div className="hero-orbit-art"><span /><i /><b /><strong>NX</strong></div></div>
      <div className="overview-stat-grid"><div className="overview-stat"><span>ACTIVE SERVICES</span><strong>{running}<small>/{services.length || 4}</small></strong><b className="stat-good">● running now</b></div><div className="overview-stat"><span>HTTP REQUESTS</span><strong>{requestCount || '—'}</strong><b>since boot</b></div><div className="overview-stat"><span>UPTIME</span><strong>{metrics ? `${Math.round((metrics.uptime ?? 0) / 60)}m` : '—'}</strong><b>backend process</b></div><div className="overview-stat"><span>ENVIRONMENT</span><strong>DEV</strong><b className="stat-violet">local workspace</b></div></div>
      <div className="overview-columns"><section className="workspace-panel"><div className="panel-title-row"><div><span className="admin-overline">PROJECT SURFACES</span><h3>Everything in one place</h3></div><button onClick={() => onNavigate('config')} className="text-action">View config →</button></div><div className="surface-grid"><button onClick={() => onNavigate('config')}><span className="surface-icon blue">{'{}'}</span><strong>Runtime config</strong><small>nexus.runtime.json</small></button><button onClick={() => onNavigate('env')}><span className="surface-icon pink">⌁</span><strong>Environment</strong><small>Masked key/value editor</small></button><button onClick={() => onNavigate('databases')}><span className="surface-icon green">▦</span><strong>Data layer</strong><small>Databases and collections</small></button><button onClick={() => onNavigate('schema')}><span className="surface-icon violet">✦</span><strong>AI workspace</strong><small>Generate Mongo schemas</small></button></div></section><section className="workspace-panel pulse-panel"><div className="panel-title-row"><div><span className="admin-overline">SYSTEM PULSE</span><h3>Services are moving</h3></div><span className="live-badge"><i className="status-dot good" /> LIVE</span></div><div className="pulse-bars">{[34,55,42,78,62,88,52,72,48,66,84,58].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><p>Live supervisor status refreshes every five seconds.</p><button onClick={() => onNavigate('monitoring')} className="text-action">Open monitoring →</button></section></div>
      <section className="workspace-panel">
        <div className="panel-title-row">
          <div><span className="admin-overline">PREFLIGHT DIAGNOSTICS</span><h3>Dependencies are being probed</h3></div>
          <button onClick={runChecks} disabled={preflightBusy} className="glass-chip-btn">{preflightBusy ? 'probing…' : '↻ run checks'}</button>
        </div>
        <p className="preflight-note">The Python server pings the backend API, AI server, GraphQL endpoint and data-store ports, and reports latency per target.</p>
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

function Config({ onNavigate }: { onNavigate?: (tab: Tab) => void }) {
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [fileText, setFileText] = useState('');
  const [filePath, setFilePath] = useState('');
  const [mode, setMode] = useState<'runtime' | 'source' | 'effective'>('runtime');
  const [msg, setMsg] = useState('');
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
      setMsg(c.file ? `Loaded ${c.file.path}` : 'No human-edited config file found.');
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
      <div className="config-intro"><div><span className="admin-overline">PROJECT CONTROL PLANE</span><h1>Configure your <em>runtime.</em></h1><p>Use key/value rows for safe JSON overrides, or switch to source mode for the typed project configuration.</p></div><div className="config-layer-stack"><span>DEFAULTS</span><b>CONFIG FILE</b><strong>RUNTIME JSON</strong><i>ENVIRONMENT</i></div></div>
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
      </div><div className="config-footer"><span>{entries.length} override{entries.length === 1 ? '' : 's'} · validated on save</span><button onClick={saveRuntime} disabled={busy} className="inspector-primary">{busy ? 'Saving…' : 'Save runtime JSON'} <span>→</span></button></div></section>}
      {mode === 'source' && <section className="workspace-panel config-panel"><div className="panel-title-row"><div><span className="admin-overline">HUMAN-EDITED SOURCE</span><h3>{filePath || 'nexus.config.ts'}</h3></div><button onClick={saveFile} disabled={busy} className="inspector-primary">{busy ? 'Saving…' : 'Save source'} <span>→</span></button></div><textarea className="source-editor" value={fileText} onChange={(event) => setFileText(event.target.value)} spellCheck={false} /></section>}
      {mode === 'effective' && <section className="workspace-panel config-panel"><div className="panel-title-row"><div><span className="admin-overline">READ-ONLY · SECRETS REDACTED</span><h3>Effective merged config</h3></div></div><pre className="source-editor effective-editor">{cfg ? JSON.stringify(cfg.config, null, 2) : 'Loading configuration…'}</pre></section>}
      <LintChecks run={runLintConfig} title="Configuration checks" overline="VALIDATOR · nexus.runtime.json" />
      {msg && <div className="admin-notice">{msg}</div>}
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
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [restartDialog, setRestartDialog] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [file, setFile] = useState('.env');
  const load = async (target: string = file) => { try { const result = await getAdminEnv(target); setData(result); setEntries(result.entries); setMsg(result.exists ? `Loaded ${result.path}` : `No ${target} file exists yet. Saving will create it.`); } catch (e: any) { setMsg(String(e?.message ?? e)); } };
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
      <PageHead title="Environment"><div className="heading-actions"><span className="secret-badge">SECRETS MASKED</span><div className="env-file-switch">{['.env', '.env.example'].map((f) => <button key={f} type="button" className={file === f ? 'is-active' : ''} onClick={() => { setFile(f); load(f); }}>{f}</button>)}</div><button onClick={() => load()} className="workspace-action">↻ Reload</button></div></PageHead>
      <div className="config-intro env-intro"><div><span className="admin-overline">LOCAL ENVIRONMENT · {data?.path ?? '.env'}</span><h1>Your environment, <em>under control.</em></h1><p>Manage project variables as key/value pairs. Secret values stay on disk and are never returned to the browser.</p></div><div className="env-lock-art">⌁<span>PRIVATE</span></div></div>
      <section className="workspace-panel config-panel"><div className="panel-title-row"><div><span className="admin-overline">{file.toUpperCase()} FILE · PRESERVES COMMENTS</span><h3>Environment variables</h3></div><button onClick={addVariable} className="workspace-action">+ Add variable</button></div><div className="env-add-bar">
        <input value={newKey} onChange={(event) => setNewKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addVariable(); }} placeholder="NEXUS_SERVER_PORT" />
        <div className="env-value-wrap"><input value={newValue} onChange={(event) => setNewValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addVariable(); }} placeholder="value" /><span className="secret-mark">{newKey && /SECRET|PASSWORD|PASS|TOKEN|PRIVATE|API_KEY|CLIENT_SECRET|ACCESS_KEY|KEY_SECRET/i.test(newKey) ? '●' : '○'}</span></div>
      </div><div className="key-value-table env-table">{groupEntries(entries).map(({ group, items }) => (
          <div className="key-group" key={group}>
            <div className="key-group-head"><span className="key-group-name">{group}</span><small>{items.length} variable{items.length === 1 ? '' : 's'}</small></div>
            <div className="key-value-head"><span>VARIABLE</span><span>VALUE</span><span /></div>
            {items.map(({ index, entry }) => (
              <div className="key-value-row" key={`${entry.key}-${index}`}>
                <input value={entry.key} onChange={(event) => setEntries(entries.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value, secret: /SECRET|PASSWORD|PASS|TOKEN|PRIVATE|API_KEY|CLIENT_SECRET|ACCESS_KEY|KEY_SECRET/i.test(event.target.value) } : item))} placeholder="NEXUS_SERVER_PORT" />
                <div className="env-value-wrap"><input type={entry.secret ? 'password' : 'text'} value={entry.value ?? ''} placeholder={entry.secret ? '•••••••• · unchanged' : 'value'} onChange={(event) => setEntries(entries.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} /><span className={entry.secret ? 'secret-mark is-secret' : 'secret-mark'}>{entry.secret ? '●' : '○'}</span></div>
                <button className="row-delete" onClick={() => setEntries(entries.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Delete ${entry.key || 'entry'}`}>×</button>
              </div>
            ))}
          </div>
        ))}
        {!entries.length && <div className="key-value-empty">No environment variables found.</div>}</div><div className="config-footer"><span>{entries.length} variable{entries.length === 1 ? '' : 's'} · masked secrets are preserved when unchanged</span><button onClick={save} disabled={busy} className="inspector-primary">{busy ? 'Saving…' : 'Save .env'} <span>→</span></button></div></section>
      <LintChecks run={() => runLintEnv(file)} title="Environment checks" overline={`VALIDATOR · ${file}`} />
      {msg && <div className="admin-notice">{msg}</div>}
      <ConfirmDialog
        open={restartDialog}
        title="Restart required"
        message="Your environment changes have been saved. Restart the backend services to apply the new variables."
        confirmLabel="Open services"
        onConfirm={() => { setRestartDialog(false); onNavigate?.('processes'); }}
        onCancel={() => setRestartDialog(false)}
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
      <PageHero kicker="EXTENSION GALLERY" title={<>Extend Nexus, <em>effortlessly.</em></>} desc="Every admin page, slot and surface that plugin modules register — a living index of what's available to your build." glyph="◇" art="stack" />
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
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
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
      {msg && <div className={`notice-line ${msg.kind === 'ok' ? 'is-ok' : 'is-err'}`}>{msg.text}</div>}

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

function Monitoring() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { getMetrics().then(setData).catch(() => {}); const t = setInterval(() => getMetrics().then(setData), 5000); return () => clearInterval(t); }, []);
  if (!data) return <p className="text-slate-400">Loading…</p>;
  return (
    <div className="space-y-6">
      <PageHead title="Monitoring" />
      <PageHero kicker="LIVE TELEMETRY" title={<>Watch the whole <em>machine.</em></>} desc="A calm, self-refreshing readout of the backend heartbeat — uptime, PID and request traffic without the noise." glyph="⌁" art="wave" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="glass-card"><div className="glass-h3">Uptime</div><div className="mt-2 text-3xl font-bold text-slate-100">{Math.round(data.uptime ?? 0)}<span className="ml-1 text-sm font-normal text-slate-400">s</span></div></div>
        <div className="glass-card"><div className="glass-h3">PID</div><div className="mt-2 font-mono text-3xl font-bold text-slate-100">{data.pid}</div></div>
        <div className="glass-card"><div className="glass-h3">HTTP requests</div><div className="mt-2 text-2xl font-bold text-indigo-300">{(() => { const v = data.metrics?.http_requests_total?.values; return v ? Object.values(v).reduce((a: number, b) => a + Number(b ?? 0), 0) : '—'; })()}</div></div>
      </div>
      <div className="glass-card">
        <h3 className="glass-h3 mb-3">Metrics</h3>
        <pre className="glass-code max-h-96 overflow-auto p-3">{JSON.stringify(data.metrics, null, 2)}</pre>
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

function Payments() {
  const [tab, setTab] = useState<'orders' | 'transactions' | 'test'>('orders');
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [status, setStatus] = useState<PaymentProviderStatus[]>([]);
  const [provider, setProvider] = useState('all');
  const [msg, setMsg] = useState('');

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
      <PageHero kicker="PAYMENT OPERATIONS" title={<>Money flow, <em>on the ledger.</em></>} desc="Every charge, refund and provider event from your payment stack — one surface to reconcile what went through." glyph="$" art="coins" />
      {msg && <p className="text-sm text-amber-300">{msg}</p>}

      <div className="glass-panel inline-flex gap-1 p-1">
        {([
          ['orders', `Orders (${orders.length})`],
          ['transactions', `Transactions (${transactions.length})`],
          ['test', 'Test Console'],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={tab === id ? 'glass-btn-primary !rounded-lg !px-4 !py-1.5 text-xs' : 'glass-chip-btn !px-4 !py-1.5'}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'orders' && <OrdersTable orders={orders} />}
      {tab === 'transactions' && <TransactionsTable transactions={transactions} />}
      {tab === 'test' && (
        <TestConsole status={status} onRun={() => load()} onCreated={() => { setTab('orders'); load(); }} />
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

function TestConsole({ status, onRun, onCreated }: { status: PaymentProviderStatus[]; onRun: () => Promise<void> | void; onCreated: () => void }) {
  const [probeBusy, setProbeBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('');
  const [amount, setAmount] = useState('100');
  const [currency, setCurrency] = useState('INR');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<any>(null);

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
          {status.map((p) => (
            <div key={p.name} className={`glass rounded-xl p-3 ${p.ok ? 'shadow-[0_0_24px_-8px_rgba(52,211,153,0.5)]' : 'shadow-[0_0_24px_-8px_rgba(244,63,94,0.5)]'}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-slate-100">{p.name}</span>
                <span className={p.ok ? 'dot-ok' : 'dot-bad'} title={p.ok ? 'working' : 'not working'} />
              </div>
              <div className="mt-1.5 space-y-0.5 text-xs text-slate-400">
                <div>
                  <span className="chip !px-2 !py-0.5">{p.enabled ? 'enabled' : 'disabled'}{p.sandbox ? ' · sandbox' : ''}</span>
                  <span className={`ml-1 ${p.configured ? 'text-emerald-400' : 'text-amber-400'}`}>{p.configured ? 'keys configured' : 'missing keys'}</span>
                </div>
                {p.detail && <div className="text-emerald-400">{p.detail}</div>}
                {p.error && <div className="text-rose-400">{p.error}</div>}
                {p.note && <div className="text-slate-500">{p.note}</div>}
              </div>
            </div>
          ))}
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
    </div>
  );
}

function Databases() {
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [msg, setMsg] = useState('');
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
      {msg && <p className="text-sm text-amber-300">{msg}</p>}

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
  const [model, setModel] = useState('gpt-4o-mini');
  const [provider, setProvider] = useState('auto');
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [db, setDb] = useState('');
  const [result, setResult] = useState<GeneratedSchema | null>(null);
  const [edited, setEdited] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiErr, setAiErr] = useState('');

  useEffect(() => { getDatabases().then((d) => setDatabases(d.databases ?? [])).catch(() => {}); }, []);

  const checkAi = async () => {
    setAiErr('');
    try { setAiStatus(await getAiStatus()); } catch (e: any) { setAiErr(String(e?.message ?? e)); }
  };
  useEffect(() => { checkAi(); }, []);

  // Model picker: union of models advertised by the AI server for the selected
  // provider (auto = both). The text input stays editable for custom models.
  const modelOptions = (() => {
    if (!aiStatus) return [] as string[];
    const lists: string[] = [];
    if (provider === 'auto' || provider === 'openai') lists.push(...(aiStatus.openai.detail?.models ?? []));
    if (provider === 'auto' || provider === 'ollama') lists.push(...(aiStatus.ollama.detail?.models ?? []));
    return [...new Set(lists)];
  })();

  const generate = async () => {
    if (!prompt.trim()) { setMsg('Describe the data you want to model, e.g. "products with a name, price and category".'); return; }
    setBusy(true); setMsg('');
    try {
      const g = await generateSchema(prompt, { model: model.trim() || undefined, provider: provider === 'auto' ? undefined : provider });
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
      <PageHero kicker="AI WORKSPACE" title={<>Schemas, <em>born from language.</em></>} desc="Describe the data you need in plain English and let the model return a validated MongoDB schema you can review before it's live." glyph="✦" art="spark" />
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
                ['OpenAI', aiStatus.openai, aiStatus.openai.detail?.modelCount != null ? `${aiStatus.openai.detail.modelCount} model(s) reachable` : undefined],
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
        <textarea className="glass-code h-32 w-full p-3 text-sm" placeholder='e.g. "a products collection with name, price (number), in-stock flag, category from a fixed enum, created date and an optional description"' value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-400">Model</label>
          <input className="glass-input w-52 !py-1.5 font-mono text-sm" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gpt-4o-mini" />
          <select
            className="glass-input w-44 !py-1.5 text-sm"
            value=""
            onChange={(e) => { const v = e.target.value; if (v) setModel(v); }}
            disabled={!modelOptions.length}
            title={modelOptions.length ? 'Available models on the selected provider' : 'No models advertised — run a status re-check'}
          >
            <option value="" className="bg-slate-900">{modelOptions.length ? 'pick a model…' : 'no models listed'}</option>
            {modelOptions.map((m) => <option key={m} value={m} className="bg-slate-900">{m}</option>)}
          </select>
          <label className="text-sm text-slate-400">Provider</label>
          <select className="glass-input w-32 !py-1.5 text-sm" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="auto" className="bg-slate-900">auto</option>
            <option value="openai" className="bg-slate-900">openai</option>
            <option value="ollama" className="bg-slate-900">ollama</option>
          </select>
          <label className="text-sm text-slate-400">Database</label>
          <select className="glass-input w-48 !py-1.5 text-sm" value={db} onChange={(e) => setDb(e.target.value)}>
            <option value="" className="bg-slate-900">{databases.length ? 'pick a database…' : 'no databases yet'}</option>
            {databases.map((d) => <option key={d.name} value={d.name} className="bg-slate-900">{d.name}</option>)}
          </select>
          <button onClick={generate} disabled={busy} className="glass-btn-primary ml-auto">{busy ? 'Generating…' : 'Generate with AI'}</button>
        </div>
      </div>

      {msg && <p className="text-sm text-amber-300">{msg}</p>}

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
