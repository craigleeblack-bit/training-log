import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { db } from './db/schema';
import { importBackup } from './db/backup';
import './styles.css';

registerSW({ immediate: true });

// Ask the browser not to evict the log under storage pressure. Installed apps are normally granted this.
void navigator.storage?.persist?.();

if (import.meta.env.DEV) {
  // Development-only hook for loading a starter file from the console.
  (window as unknown as Record<string, unknown>).__importBackup = (raw: unknown) => importBackup(db, raw, 'replace');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
