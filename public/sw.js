// Alveolar Modulação: deixa o app abrir sem internet (tela do QR na obra).
// Páginas: tenta a internet primeiro e guarda a última versão; arquivos /assets (nome muda a cada versão): guarda e reusa.
const CACHE = 'alv-app-v2';   // v2: apaga as versões antigas guardadas (ocupavam espaço no tablet)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (r.mode === 'navigate') {
    // internet primeiro; se demorar mais de 5 s (sinal fraco) abre a última versão guardada e atualiza por trás
    const rede = fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put('/', cp)); }
      return res;
    });
    const espera = new Promise(ok => setTimeout(ok, 5000)).then(() => caches.match('/')).then(m => m || rede);
    e.respondWith(Promise.race([rede.catch(() => caches.match('/').then(m => m || Response.error())), espera]));
    return;
  }
  if (u.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
      return res;
    })));
  }
});
