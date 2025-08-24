// sw.js
const CACHE = 'guardias-pwa-v9';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of CORE) {
      try { await cache.add(url); } catch (e) { console.warn('[SW] fallo en', url, e); }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  // ⚠️ Sólo cachear peticiones same-origin (tu GitHub Pages). El CDN queda fuera.
  if (new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request);
    if (hit) return hit;
    try {
      const res = await fetch(event.request);
      if (res && res.status === 200) cache.put(event.request, res.clone());
      return res;
    } catch (e) {
      const shell = await cache.match('./');
      if (shell) return shell;
      throw e;
    }
  })());
});
