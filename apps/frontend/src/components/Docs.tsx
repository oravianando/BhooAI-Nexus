import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Docs page metadata. NAV is fetched at runtime from /docs/assets/nav.js
// (served by the vite plugin) so there's one source of truth shared with
// docs/assets/docs.js — no build-time path above the frontend project root.
interface NavItem {
  label: string;
  file: string;
  pkg?: string;
  tag?: string;
}
interface NavGroup {
  group: string;
  items: NavItem[];
}

// A section (h2/h3) extracted from the currently-loaded doc page.
interface PageSection {
  id: string;
  title: string;
  level: 2 | 3;
}

const DOCS_PREFIX = '/docs/';

// Resolve a doc route (e.g. 'api/core.html' or 'index.html') to an absolute
// URL string suitable for fetch(). Routes are always relative to /docs/.
function docsUrl(route: string): string {
  const clean = route.replace(/^\/+/, '');
  return `${DOCS_PREFIX}${clean}`;
}

// Convert an in-page href (which may be relative like 'core.html', '../core.html',
// or absolute like '/docs/api/core.html') into a normalized docs route
// ('api/core.html') relative to /docs/, or null if it's not a docs .html link.
function hrefToRoute(href: string, currentRoute: string): string | null {
  if (href.startsWith('#')) return null;
  try {
    const url = new URL(href, `${location.origin}${DOCS_PREFIX}${currentRoute}`);
    if (url.origin !== location.origin || !url.pathname.endsWith('.html')) return null;
    if (!url.pathname.startsWith(DOCS_PREFIX)) return null;
    return decodeURIComponent(url.pathname.slice(DOCS_PREFIX.length));
  } catch {
    return null;
  }
}

// The docs HTML is fetched and injected into this app's DOM (not rendered as a
// standalone page), so relative asset URLs like "../assets/screenshots/x.png"
// would resolve against the app origin instead of the docs folder. Rewrite any
// relative src/href (images, scripts, stylesheets) into absolute /docs/... URLs
// resolved against the current page's directory.
function absolutizeAssets(html: string, currentRoute: string): string {
  const base = `${location.origin}${DOCS_PREFIX}${currentRoute}`;
  return html.replace(
    /(src|href)=("|')([^"']+)\2/g,
    (match, attr: string, quote: string, value: string) => {
      if (/^(?:https?:|data:|#|\/|mailto:|blob:)/i.test(value)) return match;
      try {
        const abs = new URL(value, base).href;
        return `${attr}=${quote}${abs}${quote}`;
      } catch {
        return match;
      }
    },
  );
}

// Fetch the shared nav tree from the served docs folder (one source of
// truth with docs/assets/docs.js). Returns a sensible fallback on error.
async function loadNav(): Promise<NavGroup[]> {
  try {
    const res = await fetch(`${DOCS_PREFIX}assets/nav.js`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const body = text
      .replace(/export\s+default\s+.*;?$/, '')
      .replace(/export\s+/g, '');
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${body}; return NAV;`);
    return fn() as NavGroup[];
  } catch {
    return FALLBACK_NAV;
  }
}

// Minimal fallback used only if /docs/assets/nav.js can't be fetched.
const FALLBACK_NAV: NavGroup[] = [
  { group: 'Start', items: [
    { label: 'Overview', file: 'index.html' },
    { label: 'Getting Started', file: 'getting-started.html' },
  ] },
  { group: 'API Reference', items: [
    { label: 'Core', file: 'api/core.html' },
  ] },
];

function routeLabel(nav: NavGroup[], route: string): string {
  for (const g of nav) {
    const item = g.items.find((entry) => entry.file === route);
    if (item) return item.label;
  }
  return 'Documentation';
}

// Extract h2/h3 headings (with their id) from a parsed doc page's #content.
// These become the "exports and topics" sub-items under the active page.
function extractSections(doc: Document): PageSection[] {
  const content = doc.querySelector('main#content');
  if (!content) return [];
  const headings = Array.from(content.querySelectorAll('h2, h3'));
  const out: PageSection[] = [];
  for (const h of headings) {
    const id = h.id || h.textContent?.trim().toLowerCase().replace(/\s+/g, '-') || '';
    if (!id) continue;
    if (!h.id) h.id = id;
    out.push({
      id,
      title: h.textContent?.trim() ?? '',
      level: h.tagName === 'H2' ? 2 : 3,
    });
  }
  return out;
}

// Load the docs site stylesheet + playground.js once, on first mount, and
// re-init playgrounds after each page injection so "Try it live" stays
// interactive. Both are served by the vite dev plugin at /docs/assets/*.
let playgroundLoaded = false;
let cssLoaded = false;
async function ensureDocsAssets(): Promise<void> {
  if (!cssLoaded) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/docs/assets/style.css';
    link.onload = () => { cssLoaded = true; };
    document.head.appendChild(link);
  }
  if (!playgroundLoaded) {
    await new Promise<void>((resolve) => {
      const s = document.createElement('script');
      s.src = '/docs/assets/playground.js';
      s.onload = () => { playgroundLoaded = true; resolve(); };
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
}

interface DocsProps {
  initialRoute?: string;
  onBack?: () => void;
}

export function Docs({ initialRoute = 'index.html', onBack }: DocsProps) {
  // Open doc tabs (routes relative to /docs/). At least one tab stays open.
  const [tabs, setTabs] = useState<string[]>([initialRoute]);
  const [activeTab, setActiveTab] = useState(0);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [nav, setNav] = useState<NavGroup[]>(FALLBACK_NAV);
  const [sections, setSections] = useState<PageSection[]>([]);
  // Which groups are collapsed (group name → collapsed). Default: all open.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Whether the active page's section list is expanded. Default: expanded.
  const [sectionsOpen, setSectionsOpen] = useState(true);
  const [activeSection, setActiveSection] = useState('');
  // Whether the sidebar drawer is open (mobile). Ignored on desktop.
  const [mobileNav, setMobileNav] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The page currently shown — derived from the active tab.
  const route = tabs[activeTab] ?? initialRoute;

  const loadPage = useCallback(async (next: string) => {
    setLoading(true);
    setError('');
    setSectionsOpen(true);
    setActiveSection('');
    try {
      const res = await fetch(docsUrl(next));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = new DOMParser().parseFromString(text, 'text/html');
      const content = parsed.querySelector('main#content');
      if (!content) throw new Error('Page has no #content main');
      // Extract sections (and assign missing IDs) BEFORE capturing innerHTML
      // so the injected DOM has the IDs the scroll-spy + section links need.
      setSections(extractSections(parsed));
      // Rewrite relative asset URLs (images/styles/scripts) to absolute /docs/
      // URLs so they resolve when the HTML is injected into this app.
      setHtml(absolutizeAssets(content.innerHTML, next));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { document.title = `BhooAI Nexus Docs - ${routeLabel(nav, route)}`; }, [nav, route]);

  // Navigate the current tab: activates an already-open page, otherwise it
  // replaces the active tab's route with the clicked page.
  const navigateTab = useCallback((file: string) => {
    const existing = tabs.indexOf(file);
    if (existing >= 0) {
      setActiveTab(existing);
    } else {
      setTabs((prev) => prev.map((t, i) => (i === activeTab ? file : t)));
    }
    void loadPage(file);
  }, [tabs, activeTab, loadPage]);

  // Open a page in a brand-new tab, reusing the tab if it's already open.
  const openInNewTab = useCallback((file: string) => {
    const existing = tabs.indexOf(file);
    if (existing >= 0) {
      setActiveTab(existing);
    } else {
      setTabs((prev) => [...prev, file]);
      setActiveTab(tabs.length);
    }
    void loadPage(file);
  }, [tabs, loadPage]);

  // Close a tab by index. The last remaining tab cannot be closed.
  const closeTab = useCallback((idx: number) => {
    if (tabs.length <= 1) return;
    const next = tabs.filter((_, i) => i !== idx);
    setTabs(next);
    if (idx === activeTab) {
      const newActive = Math.min(idx, next.length - 1);
      setActiveTab(newActive);
      void loadPage(next[newActive]);
    } else if (idx < activeTab) {
      setActiveTab(activeTab - 1);
    }
  }, [tabs, activeTab, loadPage]);

  useEffect(() => { void loadPage(route); void loadNav().then(setNav); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (loading || !html) return;
    const node = contentRef.current;
    if (node) {
      void ensureDocsAssets().then(() => {
        if (window.NexusPlayground) window.NexusPlayground.initAll(node);
      });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [html, loading]);

  // Scroll-spy: highlight the section heading currently in view.
  useEffect(() => {
    if (!sections.length || !contentRef.current) return;
    const node = contentRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection((entry.target as HTMLElement).id);
            break;
          }
        }
      },
      { root: null, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const s of sections) {
      const el = node.querySelector(`#${CSS.escape(s.id)}`);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [sections, html]);

  const scrollToSection = useCallback((id: string) => {
    const node = contentRef.current;
    if (!node) return;
    const el = node.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    if (el) {
      setActiveSection(id);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Intercept in-page link clicks: docs .html links → load page; #anchors → scroll.
  const onContentClick = useCallback((e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('mailto:') || anchor.target === '_blank') return;
    if (href.startsWith('#')) {
      e.preventDefault();
      scrollToSection(href.slice(1));
      return;
    }
    const rel = hrefToRoute(href, route);
    if (!rel) return;
    e.preventDefault();
    void loadPage(rel);
  }, [route, loadPage, scrollToSection]);

  // Keyboard: "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') { searchRef.current?.blur(); setMobileNav(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleGroup = useCallback((group: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return nav;
    return nav.map((g) => ({
      ...g,
      items: g.items.filter((it) => (it.label + ' ' + (it.tag ?? '')).toLowerCase().includes(q)),
    })).filter((g) => g.items.length > 0);
  }, [search, nav]);

  const activeLabel = useMemo(() => routeLabel(nav, route), [nav, route]);
  const activeGroup = useMemo(() => {
    for (const g of nav) {
      if (g.items.some((it) => it.file === route)) return g.group;
    }
    return '';
  }, [nav, route]);

  return (
    <div className="docs-view">
      <aside className={`docs-sidebar ${mobileNav ? 'is-open' : ''}`}>
        <div className="docs-sidebar-head">
          <img className="docs-logo" src="/bhooai-nexus-logo.svg" alt="BhooAI Nexus" />
          <div className="docs-sidebar-title">
            <strong>DOCS</strong>
            <span>API reference</span>
          </div>
          <a className="docs-open-new" href="/docs/index.html" target="_blank" rel="noopener noreferrer" aria-label="Open docs in new tab">↗</a>
          <button className="docs-close-mobile" onClick={() => setMobileNav(false)} aria-label="Close navigation">×</button>
        </div>
        <input
          ref={searchRef}
          className="docs-search"
          type="search"
          placeholder="Filter docs… (press /)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <nav className="docs-nav">
          {filteredGroups.map((g) => {
            const isCollapsed = collapsed.has(g.group) && !search;
            return (
              <div key={g.group} className="docs-nav-group">
                <button
                  className="docs-nav-group-toggle"
                  onClick={() => toggleGroup(g.group)}
                  aria-expanded={!isCollapsed}
                >
                  <span className={`docs-chevron ${isCollapsed ? 'collapsed' : ''}`}>▾</span>
                  <span className="docs-nav-label">{g.group}</span>
                </button>
                {!isCollapsed && (
                  <div className="docs-nav-items">
                    {g.items.map((it) => {
                      const isActive = route === it.file;
                      const showSections = isActive && sections.length > 0;
                      return (
                        <div key={it.file} className="docs-nav-page">
                          <div className="docs-nav-row">
                            <button
                              className={isActive ? 'docs-nav-item active' : 'docs-nav-item'}
                              onClick={() => { setMobileNav(false); navigateTab(it.file); }}
                            >
                              <span>{it.label}</span>
                              {it.pkg ? <span className="docs-nav-pkg">{it.pkg}</span> : null}
                              {showSections ? (
                                <span
                                  className={`docs-sections-chevron ${sectionsOpen ? 'open' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); setSectionsOpen((v) => !v); }}
                                  role="button"
                                  aria-label={sectionsOpen ? 'Collapse sections' : 'Expand sections'}
                                >▸</span>
                              ) : null}
                            </button>
                            <button
                              className="docs-nav-newtab"
                              onClick={() => { setMobileNav(false); openInNewTab(it.file); }}
                              aria-label={`Open ${it.label} in new tab`}
                              title="Open in new tab"
                            >+</button>
                          </div>
                          {showSections && sectionsOpen && (
                            <ul className="docs-sections">
                              {sections.map((s) => (
                                <li
                                  key={s.id}
                                  className={`docs-section ${s.level === 3 ? 'sub' : ''} ${activeSection === s.id ? 'active' : ''}`}
                                >
                                  <button onClick={() => { setMobileNav(false); scrollToSection(s.id); }} title={s.title}>
                                    {s.title}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="docs-main-col">
        <header className="docs-topbar">
          <button className="docs-mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation">☰</button>
          <div className="docs-tabbar">
            {tabs.map((t, i) => (
              <div
                key={t}
                className={i === activeTab ? 'docs-window-tab active' : 'docs-window-tab'}
                onClick={() => { if (i !== activeTab) { setActiveTab(i); void loadPage(t); } }}
                role="tab"
                aria-selected={i === activeTab}
              >
                <span className="docs-window-tab-mark">◈</span>
                <strong>{routeLabel(nav, t)}</strong>
                <button
                  className="docs-tab-close"
                  onClick={(e) => { e.stopPropagation(); closeTab(i); }}
                  aria-label={`Close ${routeLabel(nav, t)} tab`}
                  disabled={tabs.length <= 1}
                >×</button>
              </div>
            ))}
          </div>
          <span className="docs-topbar-live"><span className="status-dot" /> LOCAL DOCS</span>
          <button className="docs-back-btn" onClick={onBack}>← Back to app</button>
        </header>
        <div className="docs-breadcrumb">
          <span>DOCS</span>
          <b>›</b>
          <span>{activeGroup || 'Reference'}</span>
          <b>›</b>
          <strong>{activeLabel}</strong>
        </div>
        <section
          ref={contentRef}
          className="docs-content"
          onClick={onContentClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      {mobileNav && <div className="docs-backdrop" onClick={() => setMobileNav(false)} />}
      {loading && <div className="docs-loading">Loading…</div>}
      {error && (
        <div className="docs-error">
          <p>Failed to load <code>{route}</code>: {error}</p>
          <p><a href={`/docs/${route}`} target="_blank" rel="noopener noreferrer">Open in new tab →</a></p>
        </div>
      )}
    </div>
  );
}