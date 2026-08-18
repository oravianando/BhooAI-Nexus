import React from 'react';
import { createRoot } from 'react-dom/client';

// Generated placeholder frontend. The framework's own apps/frontend has the full
// auth / GraphQL / streaming / checkout UI — copy what you need from there.
async function pingHealth() {
  try {
    const res = await fetch('/health');
    const body = await res.json();
    document.getElementById('status')!.textContent = `${body.status} @ ${new Date(body.time).toLocaleTimeString()}`;
  } catch {
    document.getElementById('status')!.textContent = 'backend not reachable';
  }
}

function App() {
  const [file, setFile] = React.useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = React.useState('');

  React.useEffect(() => {
    pingHealth();
    const id = setInterval(pingHealth, 5000);
    return () => clearInterval(id);
  }, []);

  async function uploadFile() {
    if (!file) return;
    setUploadStatus('uploading...');
    try {
      const csrfResponse = await fetch('/csrf-token', { credentials: 'include' });
      const { token } = await csrfResponse.json() as { token: string };
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/uploads', {
        method: 'POST',
        body: form,
        credentials: 'include',
        headers: { 'x-csrf-token': token },
      });
      const body = await response.json() as { files?: Array<{ url: string }>; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'upload failed');
      setUploadStatus(`uploaded: ${body.files?.[0]?.url ?? 'ok'}`);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'upload failed');
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>My Nexus App</h1>
      <p>Backend health: <span id="status">checking…</span></p>
      <h2>Upload a file</h2>
      <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <button type="button" onClick={uploadFile} disabled={!file}>Upload</button>
      <p>{uploadStatus}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
