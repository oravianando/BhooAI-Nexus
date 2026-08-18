import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@bhooai/admin';
import '@bhooai/admin/style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
