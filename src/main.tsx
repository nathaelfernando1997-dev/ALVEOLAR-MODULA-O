import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// app abre sem internet (tela do QR na obra)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => {
    // guarda já a página e os arquivos desta versão (a primeira abertura acontece antes do service worker existir)
    const arqs = ['/', ...performance.getEntriesByType('resource').map(e => new URL(e.name))
      .filter(u => u.origin === location.origin && u.pathname.startsWith('/assets/')).map(u => u.pathname)];
    caches.open('alv-app-v1').then(c => c.addAll([...new Set(arqs)])).catch(() => { /* sem armazenamento */ });
  }).catch(() => { /* sem suporte */ });
}

// Avisa quando sai uma versão nova do sistema (a aba aberta continua com a antiga até recarregar).
if (import.meta.env.PROD) {
  const atual = (document.querySelector('script[type=module][src*="/assets/index-"]') as HTMLScriptElement | null)?.src.split('/assets/')[1];
  const checar = async () => {
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text();
      const nova = html.match(/\/assets\/(index-[^"']+\.js)/)?.[1];
      if (atual && nova && nova !== atual && !document.getElementById('versao-nova')) {
        const d = document.createElement('div');
        d.id = 'versao-nova';
        d.textContent = 'Há uma versão nova do sistema. Clique aqui para atualizar (seu projeto fica salvo).';
        d.onclick = () => location.reload();
        document.body.appendChild(d);
      }
    } catch { /* sem internet: tenta depois */ }
  };
  setInterval(checar, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checar(); });
}
