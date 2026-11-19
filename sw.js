// Service worker: keeps a full copy of the app on the device so it opens and works with no connection.
// Data lives in localStorage and is never touched here. A new VERSION means a new cache; the new worker
// waits until the user taps "Update" in the app (message SKIP_WAITING), then old caches are deleted.
const VERSION = '0.3.0';
const CACHE = `tisa-${VERSION}`;
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/css/fonts.css',
  './src/css/main.css',
  './src/css/tokens.css',
  './src/js/app.js',
  './src/js/theme-boot.js',
  './src/js/core/autosave.js',
  './src/js/core/backup.js',
  './src/js/core/contrast.js',
  './src/js/core/country.js',
  './src/js/core/i18n.js',
  './src/js/core/ids.js',
  './src/js/core/itinerary.js',
  './src/js/core/load.js',
  './src/js/core/schema.js',
  './src/js/core/storage.js',
  './src/js/core/store.js',
  './src/js/core/trip.js',
  './locales/en.json',
  './locales/he.json',
  './config/app.config.json',
  './data/countries/th.json',
  './data/packs/th.js',
  './assets/icons.svg',
  './assets/fonts/Heebo-VF.ttf',
  './assets/fonts/IBMPlexMono-Medium.ttf',
  './icons/apple-touch-icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('tisa-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Cache first, so every file comes from the same version. Pages fall back to the cached index.html.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(request);
    } catch (error) {
      if (request.mode === 'navigate') return (await cache.match('./index.html')) ?? Response.error();
      throw error;
    }
  })());
});
