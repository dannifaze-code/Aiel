/* Aiel AI - Service Worker for offline support */
const CACHE_NAME = 'aiel-ai-v2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './ai-engine.js',
  './learning.js',
  './data-fetcher.js',
  './knowledge-ingestor.js',
  './ai-learning-bridge.js',
  './self-training.js',
  './manifest.json'
];

/* Domains used by the self-training data fetchers — let them pass through */
const TRAINING_DOMAINS = [
  'api.dictionaryapi.dev',
  'en.wikipedia.org',
  'opentdb.com',
  'numbersapi.com',
  'openlibrary.org',
  'picsum.photos'
];

/* Install: cache all static assets */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

/* Activate: clean up old caches */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* Fetch: serve from cache, fall back to network */
self.addEventListener('fetch', (event) => {
  /* Skip non-GET requests */
  if (event.request.method !== 'GET') return;

  /* Skip cross-origin requests (e.g. CDN model downloads — let them pass through) */
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    /* For training API domains, use network-first with cache fallback */
    const isTrainingDomain = TRAINING_DOMAINS.some((d) => url.hostname.includes(d));
    if (isTrainingDomain) {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const cloned = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
            }
            return response;
          })
          .catch(() => caches.match(event.request))
      );
      return;
    }
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      });
    })
  );
});
