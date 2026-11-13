// Alveolar Modulação: deixa o app abrir sem internet (tela do QR na obra).
// Páginas: tenta a internet primeiro e guarda a última versão; arquivos /assets (nome muda a cada versão): guarda e reusa.
const CACHE = 'alv-app-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put('/', cp)); }
      return res;
    }).catch(() => caches.match('/').then(m => m || Response.error())));
    return;
  }
  if (u.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
      return res;
    })));
  }
});
