// Nexus docs interactive playground.
//
// Two execution modes per block:
//   js  — runs plain JS in a sandboxed <iframe sandbox="allow-scripts">. A shim
//         inside the frame captures console.log/info/warn/error + uncaught
//         errors and posts them to the parent, which renders them in the output
//         pane. The snippet never touches the page's globals.
//   api — issues a real fetch to a running Nexus service (default localhost:4000)
//         and shows request -> status -> JSON. The CSRF double-submit flow is
//         handled automatically for unsafe methods when the target exposes
//         /csrf-token.
//
// A block is declared as:
//   <section data-playground='{
//     "title": "...",
//     "apiBase": "http://localhost:4000",
//     "js": "code...",                 // default snippet shown in JS mode
//     "api": { "method":"GET", "path":"/health", "query":{...}, "body":{...} }
//   }'></section>
// Call window.NexusPlayground.initAll() after content is in the DOM (the docs
// SPA does this on every route load).

(function () {
  'use strict';

  const DEFAULT_API_BASE = 'http://localhost:4000';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function jsonOut(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  // Minimal syntax highlighter for the editor (not a full tokenizer — keeps the
  // docs dependency-free and fast enough for the small snippets used here).
  function highlight(code) {
    const tokens = [];
    let i = 0;
    let last = 0;
    const re =
      /(\/\/[^\n]*|#![^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|async|await|if|else|for|while|new|import|from|export|class|true|false|null|undefined|typeof|instanceof|try|catch|throw|switch|case|break|continue|yield|of|in)\b|\b\d+(?:\.\d+)?\b)/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const token = m[0];
      let cls = '';
      if (/^\/\//.test(token) || /^#!/.test(token) || /^\/\*/.test(token)) cls = 'com';
      else if (/^["'`]/.test(token)) cls = 'str';
      else if (/^\d/.test(token)) cls = 'num';
      else if (/^(const|let|var|function|return|async|await|if|else|for|while|new|import|from|export|class|true|false|null|undefined|typeof|instanceof|try|catch|throw|switch|case|break|continue|yield|of|in)$/.test(token)) cls = 'kw';
      tokens.push([last, m.index, ''], [m.index, m.index + token.length, cls]);
      last = m.index + token.length;
    }
    tokens.push([last, code.length, '']);
    let html = '';
    for (const [start, end, cls] of tokens) {
      const part = code.slice(start, end);
      if (!part) continue;
      html += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
    }
    return html;
  }

  function mount(el, cfg) {
    const apiBase = (cfg.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
    let mode = 'js';
    let jsCode = cfg.js || '';
    let apiReq = Object.assign({ method: 'GET', path: '/health', query: {}, body: undefined }, cfg.api || {});

    const root = document.createElement('div');
    root.className = 'playground';

    const head = document.createElement('div');
    head.className = 'playground-head';
    head.innerHTML =
      '<span class="playground-title"></span>' +
      '<div class="playground-tabs">' +
      '<button type="button" data-mode="js" class="active">JS sandbox</button>' +
      '<button type="button" data-mode="api">Live API</button>' +
      '</div>';
    head.querySelector('.playground-title').textContent = cfg.title || 'Try it live';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'playground-body';

    // --- JS editor ---
    const jsPane = document.createElement('div');
    jsPane.className = 'playground-pane';
    jsPane.innerHTML =
      '<div class="playground-bar"><code class="playground-file">snippet.js</code>' +
      '<div class="playground-actions"><button type="button" class="pg-run">Run ▶</button><button type="button" class="pg-reset">Reset</button></div></div>' +
      '<pre class="playground-editor" contenteditable="true" spellcheck="false"></pre>' +
      '<div class="playground-output"><div class="playground-output-label">Output</div><pre class="playground-console"></pre></div>';

    // --- API editor ---
    const apiPane = document.createElement('div');
    apiPane.className = 'playground-pane';
    apiPane.style.display = 'none';
    apiPane.innerHTML =
      '<div class="playground-bar"><code class="playground-file">api call</code>' +
      '<div class="playground-actions"><button type="button" class="pg-run">Run ▶</button></div></div>' +
      '<div class="playground-form">' +
      '<label>Method <select class="pg-method">' +
      '<option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option>' +
      '</select></label>' +
      '<label class="pg-path-label">Path <input class="pg-path" type="text" spellcheck="false"></label>' +
      '<label>Base <code class="pg-base"></code></label>' +
      '</div>' +
      '<label class="pg-body-label">JSON body <textarea class="pg-body" rows="5" spellcheck="false" placeholder="{ optional }"></textarea></label>' +
      '<div class="playground-output"><div class="playground-output-label">Response</div><pre class="playground-console"></pre></div>';

    bodyEl.appendChild(jsPane);
    bodyEl.appendChild(apiPane);

    root.appendChild(head);
    root.appendChild(bodyEl);
    el.appendChild(root);

    const editor = jsPane.querySelector('.playground-editor');
    const consoleEl = jsPane.querySelector('.playground-console');
    const apiConsole = apiPane.querySelector('.playground-console');
    const methodSel = apiPane.querySelector('.pg-method');
    const pathInput = apiPane.querySelector('.pg-path');
    const bodyInput = apiPane.querySelector('.pg-body');
    const baseCode = apiPane.querySelector('.pg-base');

    baseCode.textContent = apiBase;

    function setHighlighted() {
      editor.innerHTML = highlight(jsCode);
    }
    function applyEditorInput() {
      jsCode = editor.innerText;
    }
    editor.addEventListener('input', applyEditorInput);
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      }
    });

    // Wire mode tabs.
    head.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        head.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === btn));
        jsPane.style.display = mode === 'js' ? '' : 'none';
        apiPane.style.display = mode === 'api' ? '' : 'none';
      });
    });

    // --- JS execution ---
    function runJs() {
      applyEditorInput();
      consoleEl.textContent = '';
      const frame = document.createElement('iframe');
      frame.className = 'playground-frame';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.display = 'none';
      bodyEl.appendChild(frame);

      const src =
        '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
        'var __out = function (t, a) { parent.postMessage({ __nexusPlay: true, t: t, a: Array.prototype.slice.call(a).map(function (x) { return (x && x.message !== undefined && x.stack !== undefined) ? x.message : x; }) }, "*"); };' +
        'var console = { log: function () { __out("log", arguments); }, info: function () { __out("info", arguments); }, warn: function () { __out("warn", arguments); }, error: function () { __out("error", arguments); } };' +
        'window.addEventListener("error", function (ev) { __out("error", [ev.message]); });' +
        'window.addEventListener("unhandledrejection", function (ev) { __out("error", ["Unhandled rejection: " + (ev.reason && ev.reason.message || ev.reason)]); });' +
        'try { (function () { ' + jsCode + '\n })(); } catch (e) { __out("error", [e.message]); }' +
        '<\/script></body></html>';

      const onMessage = (event) => {
        const d = event.data;
        if (!d || d.__nexusPlay !== true) return;
        const line = document.createElement('div');
        line.className = 'console-' + (d.t === 'error' ? 'error' : d.t === 'warn' ? 'warn' : 'log');
        line.textContent = d.t.toUpperCase() + ' ' + d.a.map((v) => (typeof v === 'string' ? v : jsonOut(v))).join(' ');
        consoleEl.appendChild(line);
      };
      window.addEventListener('message', onMessage);
      frame.srcdoc = src;
      // Cleanup: keep the frame until the user runs again or leaves.
      setTimeout(() => {
        window.removeEventListener('message', onMessage);
        frame.remove();
      }, 800);
    }

    // --- API execution ---
    async function runApi() {
      apiConsole.textContent = 'Requesting…';
      const method = methodSel.value.toUpperCase();
      let path = pathInput.value.trim();
      let body = bodyInput.value.trim() ? JSON.parse(bodyInput.value) : undefined;
      const safe = ['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method);
      const headers = { 'content-type': 'application/json', accept: 'application/json' };

      const log = (cls, text) => {
        const line = document.createElement('div');
        line.className = 'console-' + cls;
        line.textContent = text;
        apiConsole.appendChild(line);
      };

      try {
        if (!safe) {
          const csrf = await fetch(apiBase + '/csrf-token', { credentials: 'include' });
          if (csrf.ok) {
            const data = await csrf.json();
            if (data.token) headers['x-csrf-token'] = data.token;
          }
        }
        const url = new URL(apiBase + path);
        for (const [k, v] of Object.entries(apiReq.query || {})) url.searchParams.set(k, String(v));
        const init = { method, headers, credentials: 'include' };
        if (!safe && body !== undefined) init.body = JSON.stringify(body);
        const res = await fetch(url.href, init);
        log('log', method + ' ' + url.pathname + url.search + ' → ' + res.status);
        const text = await res.text();
        let rendered = text;
        try { rendered = jsonOut(JSON.parse(text)); } catch { /* keep raw */ }
        log('log', rendered);
      } catch (e) {
        log('error', 'Request failed: ' + (e && e.message ? e.message : e));
        log('warn', 'Is the Nexus backend running? Try: node bin/nexus.js dev  (or a different apiBase).');
      }
    }

    function syncApiForm() {
      methodSel.value = apiReq.method || 'GET';
      pathInput.value = apiReq.path || '/';
      bodyInput.value = apiReq.body !== undefined ? jsonOut(apiReq.body) : '';
      baseCode.textContent = apiBase;
    }

    // Reset buttons.
    jsPane.querySelector('.pg-reset').addEventListener('click', () => {
      jsCode = cfg.js || '';
      setHighlighted();
      consoleEl.textContent = '';
    });
    jsPane.querySelector('.pg-run').addEventListener('click', runJs);
    apiPane.querySelector('.pg-run').addEventListener('click', runApi);

    // Path input re-parses on demand; Enter triggers run.
    pathInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runApi(); });
    bodyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runApi();
    });

    // Initial render.
    setHighlighted();
    syncApiForm();
    return {
      reset() { jsCode = cfg.js || ''; setHighlighted(); consoleEl.textContent = ''; syncApiForm(); },
      run() { if (mode === 'api') runApi(); else runJs(); },
      setMode(m) { const b = head.querySelector(`[data-mode="${m}"]`); if (b) b.click(); },
    };
  }

  function initAll(scope = document) {
    scope.querySelectorAll('[data-playground]').forEach((el) => {
      if (el.dataset.playgroundInit === '1') return;
      let cfg;
      try { cfg = JSON.parse(el.dataset.playground); } catch (e) { return; }
      if (!cfg) return;
      el.dataset.playgroundInit = '1';
      mount(el, cfg);
    });
  }

  window.NexusPlayground = { initAll, mount, highlight };
})();
