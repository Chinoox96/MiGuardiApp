// ↑ BUMP de versión para forzar update
const CACHE_NAME = 'guardias-pwa-v6';

// Lista de archivos a cachear (rutas relativas funcionan en GitHub Pages)
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
  // si tu index inyecta librerías por CDN, no hace falta listarlas
];

// Helper para registrar sin romper si algún asset 404
async function safeAddAll(cache, urls) {
  for (const url of urls) {
    try {
      await cache.add(url);
    } catch (e) {
      // Log pero no romper toda la instalación
      console.warn('[SW] No se pudo cachear:', url, e);
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await safeAddAll(cache, CORE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const res = await fetch(event.request);
      // cache en background si es 200
      if (res && res.status === 200 && res.type !== 'opaque') {
        cache.put(event.request, res.clone());
      }
      return res;
    } catch (err) {
      // fallback al shell si existe
      const shell = await cache.match('./');
      if (shell) return shell;
      throw err;
    }
  })());
});
