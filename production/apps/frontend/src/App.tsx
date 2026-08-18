import { useEffect, useState } from 'react';
import { consumeOAuthToken, loadMe, onAuthChange, type NexusUser } from './lib/auth.js';
import { AuthBar } from './components/AuthBar.js';
import { Home } from './components/Home.js';
import { Chat } from './components/Chat.js';
import { Checkout } from './components/Checkout.js';
import { LiveStream } from './components/LiveStream.js';
import { RealtimeRoom } from './components/RealtimeRoom.js';
import { Docs } from './components/Docs.js';

type Tab = 'home' | 'chat' | 'checkout' | 'stream' | 'room';
type View = 'app' | 'docs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'chat', label: 'AI Chat' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'stream', label: 'Live Stream' },
  { id: 'room', label: 'Realtime Room' },
];

export function App() {
  const [user, setUser] = useState<NexusUser | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [view, setView] = useState<View>('app');

  useEffect(() => {
    const hadToken = consumeOAuthToken();
    onAuthChange(setUser);
    if (hadToken) loadMe(); else setUser(null);
  }, []);

  if (view === 'docs') {
    return (
      <div className="site-shell docs-shell">
        <main className="site-main site-container docs-main">
          <Docs onBack={() => setView('app')} />
        </main>
      </div>
    );
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="site-nav site-container">
          <a className="brand-link" href="#top" aria-label="BhooAI Nexus home">
            <img src="/bhooai-nexus-logo.svg" alt="BhooAI Nexus" />
          </a>
          <nav className="site-links" aria-label="Main navigation">
            <a href="#platform">Platform</a>
            <a href="#architecture">Architecture</a>
            <a href="#access">Access</a>
            <button className="site-link-btn" onClick={() => setView('docs')} title="Browse the full API reference">Docs</button>
          </nav>
          {user ? <AuthBar /> : <a className="nav-launch" href="#access">Launch console</a>}
        </div>
        {user && (
          <nav className="demo-tabs site-container">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={tab === t.id ? 'demo-tab active' : 'demo-tab'}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main className="site-main site-container">
        {!user ? (
          <Landing />
        ) : tab === 'home' ? (
          <Home />
        ) : tab === 'chat' ? (
          <Chat />
        ) : tab === 'checkout' ? (
          <Checkout />
        ) : tab === 'stream' ? (
          <LiveStream />
        ) : (
          <RealtimeRoom />
        )}
      </main>

      <footer className="site-footer">
        <div className="site-container footer-inner">
          <span>BhooAI Nexus / framework demo</span>
          <span>React + Vite + TypeScript</span>
        </div>
      </footer>
    </div>
  );
}

function Landing() {
  return (
    <div className="landing" id="top">
      <section className="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span />SOURCE-FIRST FULL-STACK RUNTIME</div>
          <h1>Build the system behind your next <em>signal.</em></h1>
          <p className="hero-lede">BhooAI Nexus connects your backend, realtime layer, AI services, payments, and operator console in one deliberate runtime.</p>
          <div className="hero-actions">
            <a className="button button-primary" href="#access">Enter the console <span>-&gt;</span></a>
            <a className="button button-ghost" href="#platform">Explore the platform</a>
          </div>
          <div className="hero-proof"><span className="pulse-dot" /> Local-first by default <span className="proof-divider" /> TypeScript + Python <span className="proof-divider" /> No Apollo required</div>
        </div>
        <div className="cover-stage" aria-label="Nexus platform overview">
          <div className="cover-orbit orbit-one" />
          <div className="cover-orbit orbit-two" />
          <img className="cover-image" src="/nexus-cover.svg" alt="Nexus core connecting AI, data, realtime, payments, GraphQL, and auth" />
          <div className="cover-caption"><span className="cover-caption-dot" /> RUNTIME / ONLINE <strong>v0.1</strong></div>
        </div>
      </section>

      <section className="signal-row" aria-label="Platform metrics">
        <div><strong>01</strong><span>One config surface</span></div>
        <div><strong>04</strong><span>Managed services</span></div>
        <div><strong>14</strong><span>Composable packages</span></div>
        <div><strong>∞</strong><span>Signals in motion</span></div>
      </section>

      <section className="platform-section" id="platform">
        <div className="section-heading"><div className="eyebrow"><span />THE NEXUS LAYER</div><h2>Everything your product needs to stay in orbit.</h2><p>Keep the primitives close. Compose only what your product needs, then operate it from one surface.</p></div>
        <div className="feature-grid">
          <Feature index="01" title="Native backend" text="A Node HTTP core, typed routing, security middleware, GraphQL, and a custom MongoDB data layer." />
          <Feature index="02" title="Realtime by design" text="Rooms, subscriptions, Redis fanout, WebRTC signaling, and a mediasoup-ready stream layer." />
          <Feature index="03" title="AI in the loop" text="OpenAI-compatible providers, Ollama support, streaming responses, and a Python service contract." />
          <Feature index="04" title="Payments connected" text="Razorpay, PayPal, PayU, Skrill, and Payoneer behind one provider interface and webhook router." />
          <Feature index="05" title="Operator surface" text="Admin config, users, databases, metrics, schema generation, plugin pages, and process controls." />
          <Feature index="06" title="Plugins with boundaries" text="Trusted in-process extensions or capability-gated worker runtimes for modular growth." />
        </div>
      </section>

      <section className="architecture-band" id="architecture">
        <div className="architecture-copy">
          <div className="eyebrow"><span />THE CONTROL PLANE</div>
          <h2>One command. Four terminals. Zero ceremony.</h2>
          <p>The supervisor keeps the backend, frontend, AI server, and admin console aligned while your config stays readable and your secrets stay in <code>.env</code>.</p>
          <a className="text-link" href="#access">Start the runtime -&gt;</a>
        </div>
        <div className="terminal-card">
          <div className="terminal-top"><span /><span /><span /><b>nexus / boot</b></div>
          <pre><code>{`$ node bin/nexus.js dev

[backend] listening on :4000
[frontend] vite ready on :3000
[ai-server] contract online on :8000
[admin] control plane on :3001

// all systems nominal`}</code></pre>
        </div>
      </section>

      <section className="access-section" id="access">
        <div className="access-copy"><div className="eyebrow"><span />READY WHEN YOU ARE</div><h2>Enter the Nexus.</h2><p>Sign in to explore live GraphQL data, AI chat, checkout, realtime rooms, and streaming demos.</p></div>
        <div className="access-card"><div className="access-card-top"><span>AUTH GATEWAY</span><span className="secure-pill">SECURE</span></div><AuthBar /></div>
      </section>
    </div>
  );
}

function Feature({ index, title, text }: { index: string; title: string; text: string }) {
  return <article className="feature-card"><span className="feature-index">{index}</span><h3>{title}</h3><p>{text}</p><span className="feature-arrow">-&gt;</span></article>;
}
