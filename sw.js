// Service worker: keeps a full copy of the app on the device so it opens and works with no connection.
// Data lives in localStorage and is never touched here. Stage 14: requests to Supabase (another origin) are never
// handled or cached here, so no answer or token from the server is ever stored by the worker. A new VERSION means a new cache; the new worker
// waits until the user taps "Update" in the app (message SKIP_WAITING), then old caches are deleted.
const VERSION = '1.1.3';
const CACHE = `tisa-${VERSION}`;
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/css/fonts.css',
  './src/css/main.css',
  './src/css/tokens.css',
  './src/js/app.js',
  './src/js/itinerary-view.js',
  './src/js/money-view.js',
  './src/js/checklist-view.js',
  './src/js/search-view.js',
  './src/js/transfers-view.js',
  './src/js/assistant-view.js',
  './src/js/calendar-view.js',
  './src/js/checkins-view.js',
  './src/js/luggage-view.js',
  './src/js/photo-store.js',
  './src/js/photos-view.js',
  './src/js/summary-view.js',
  './src/js/places-view.js',
  './src/js/info-view.js',
  './src/js/tip.js',
  './src/js/smart-bag-view.js',
  './src/js/cloud-view.js',
  './src/js/admin-view.js',
  './src/js/theme-boot.js',
  './src/js/core/autosave.js',
  './src/js/core/backup.js',
  './src/js/core/contrast.js',
  './src/js/core/country.js',
  './src/js/core/i18n.js',
  './src/js/core/checklist.js',
  './src/js/core/device-data.js',
  './src/js/core/ids.js',
  './src/js/core/search.js',
  './src/js/core/transfers.js',
  './src/js/core/flights.js',
  './src/js/core/assistant.js',
  './src/js/core/calendar.js',
  './src/js/core/journal.js',
  './src/js/core/checkins.js',
  './src/js/core/timezones.js',
  './src/js/core/luggage.js',
  './src/js/core/photos.js',
  './src/js/core/zip.js',
  './src/js/core/photo-backup.js',
  './src/js/core/summary.js',
  './src/js/core/places.js',
  './src/js/core/geo.js',
  './src/js/core/place-share.js',
  './src/js/core/info.js',
  './src/js/core/tips.js',
  './src/js/core/smart-bag.js',
  './src/js/core/route-plan.js',
  './src/js/core/template.js',
  './src/js/core/itinerary.js',
  './src/js/core/load.js',
  './src/js/core/money.js',
  './src/js/core/split.js',
  './src/js/core/schema.js',
  './src/js/core/storage.js',
  './src/js/core/store.js',
  './src/js/core/cloud-api.js',
  './src/js/core/sync-map.js',
  './src/js/core/sync-engine.js',
  './src/js/core/trip.js',
  './locales/en.json',
  './locales/he.json',
  './config/app.config.json',
  './data/countries/th.json',
  './data/info/th.json',
  './data/packing/th.json',
  './data/packs/th.js',
  './vendor/supabase/supabase-js-2.119.2.umd.js',
  './assets/icons.svg',
  './assets/brand/latisa-mark.png',
  './assets/brand/latisa-logo-dark.png',
  './assets/brand/latisa-logo-light.png',
  './assets/fonts/Heebo-VF.ttf',
  './assets/fonts/IBMPlexMono-Medium.ttf',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png',
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
