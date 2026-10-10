const CACHE_PREFIX = 'goodlease-web-';
const CACHE = `${CACHE_PREFIX}v3`;
const SHELL = ['/app/', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/og-default.png'];
const APP_PATH = /^\/app\/?$/;
const SHARE_PATH = /^\/(?:annonce|profil)\/[1-9]\d{0,18}\/?$/;
const PUBLIC_CATALOG_PATH = /^\/api\/app\/leases\/?$/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (PUBLIC_CATALOG_PATH.test(url.pathname) && !request.headers.has('authorization')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const fresh = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        });
        if (cached) {
          event.waitUntil(fresh.then(() => undefined).catch(() => undefined));
          return cached;
        }
        return fresh;
      }),
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Les fiches partagées restent strictement network-only : une annonce
    // retirée ou un profil supprimé ne doit jamais réapparaître depuis le cache.
    if (SHARE_PATH.test(url.pathname)) {
      event.respondWith(fetch(request));
      return;
    }
    if (!APP_PATH.test(url.pathname)) return;

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((cache) => cache.put('/app/', response.clone()));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/app/');
          return cached || new Response('Application GoodLease indisponible hors connexion.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }),
    );
    return;
  }

  const cacheableAsset = SHELL.includes(url.pathname) || url.pathname.startsWith('/_astro/');
  if (!cacheableAsset || !['style', 'script', 'image', 'font'].includes(request.destination)) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })),
  );
});
