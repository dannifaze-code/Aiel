/* Aiel AI - Service Worker for offline support */
const CACHE_NAME = 'aiel-ai-v4';
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
  './ai-mood.js',
  './auto-learner.js',
  './ai-graph.js',
  './manifest.json',
  /* Provider system (v2.0) */
  './providers/stream-decoder.js',
  './providers/provider-base.js',
  './providers/chrome-ai-provider.js',
  './providers/ollama-provider.js',
  './providers/openai-compat-provider.js',
  './providers/local-provider.js',
  './providers/provider-manager.js',
  /* Custom model (v2.0) */
  './model/intent-classifier.js',
  './model/topic-extractor.js',
  './model/confidence-scorer.js',
  './model/response-generator.js',
  './model/aiel-model.js'
];

/* Domains used by the self-training data fetchers — let them pass through */
const TRAINING_DOMAINS = [
  'api.dictionaryapi.dev',
  'en.wikipedia.org',
  'opentdb.com',
  'numbersapi.com',
  'openlibrary.org',
  'picsum.photos',
  'hacker-news.firebaseio.com',
  'dev.to',
  'api.stackexchange.com',
  'api.allorigins.win'
];

/* Domains used by AI providers — always pass through to network */
const PROVIDER_DOMAINS = [
  'localhost',
  '127.0.0.1'
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
    /* For AI provider domains (Ollama, local servers), always pass through to network */
    const isProviderDomain = PROVIDER_DOMAINS.some((d) => url.hostname === d || url.hostname.includes(d));
    if (isProviderDomain) {
      event.respondWith(fetch(event.request).catch(() => new Response('Provider unavailable', { status: 503 })));
      return;
    }
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
