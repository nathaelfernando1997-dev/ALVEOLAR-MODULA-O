import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

// Depois de uma versão nova, um pedaço do sistema que ainda não tinha sido aberto pode não existir mais no servidor:
// recarrega a página uma vez (no máximo a cada 30 s) em vez de travar.
const pedacoFaltando = (e: unknown) => /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(String((e as Error)?.message ?? e));
const recarregarUmaVez = () => {
  try { const t = Number(sessionStorage.getItem('alv-recarga') || 0); if (Date.now() - t < 30000) return false; sessionStorage.setItem('alv-recarga', String(Date.now())); } catch { /* sem armazenamento */ }
  location.reload(); return true;
};
window.addEventListener('vite:preloadError', ev => { if (recarregarUmaVez()) ev.preventDefault(); });
window.addEventListener('unhandledrejection', ev => { if (pedacoFaltando(ev.reason)) recarregarUmaVez(); });

// Se uma parte do sistema der erro, mostra o aviso com o botão de recarregar em vez de deixar a tela em branco.
class Protecao extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null };
  static getDerivedStateFromError(erro: Error) { return { erro }; }
  componentDidCatch(erro: Error) { if (pedacoFaltando(erro)) recarregarUmaVez(); }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 560 }}>
        <h2>O sistema encontrou um erro</h2>
        <p>Seu projeto está salvo. Recarregue a página; se continuar, me mande esta mensagem:</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f3f3f3', padding: 10, borderRadius: 6 }}>{String(this.state.erro?.message || this.state.erro)}</pre>
        <button onClick={() => location.reload()} style={{ fontSize: 16, padding: '8px 16px' }}>Recarregar</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><Protecao><App /></Protecao></StrictMode>);

// app abre sem internet (tela do QR na obra)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => {
    // guarda já a página e os arquivos desta versão (a primeira abertura acontece antes do service worker existir)
    const arqs = ['/', ...performance.getEntriesByType('resource').map(e => new URL(e.name))
      .filter(u => u.origin === location.origin && u.pathname.startsWith('/assets/')).map(u => u.pathname)];
    caches.open('alv-app-v2').then(c => c.addAll([...new Set(arqs)])).catch(() => { /* sem armazenamento */ });
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
