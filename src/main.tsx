import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline shell: with the on-device model, Blindfold keeps working without a connection.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then(async () => {
        // The files of this first visit loaded before the worker took control,
        // so store them now; otherwise offline would only work after a second visit.
        const urls = performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(location.origin));
        const cache = await caches.open('blindfold-shell-v1');
        await cache.addAll([...new Set(['/', ...urls])]);
      })
      .catch(() => {});
  });
}
