const CACHE = 'guardias-pwa-v7';
const base = self.registration.scope;
const abs = (p) => new URL(p, base).toString();

const PRECACHE = [
  '',              // raíz (index.html)
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
].map(abs);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of PRECACHE) {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && res.ok) await cache.put(url, res.clone());
      } catch (_) {}
    }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
        try { await cache.put(req, res.clone()); } catch (_) {}
      }
      return res;
    } catch (err) {
      if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
        const shell = await cache.match(abs('index.html'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
