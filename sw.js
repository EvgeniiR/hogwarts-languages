const CACHE = 'hogwarts-es-v3';
const STATIC = [
  '/hogwarts-espanol.html',
  '/css/styles.css',
  '/js/main.js',
  '/js/state.js',
  '/js/storage.js',
  '/js/helpers.js',
  '/js/characters.js',
  '/js/chat.js',
  '/js/portraits.js',
  '/js/llm.js',
  '/js/credentials.js',
  '/js/audio.js',
  '/js/tts.js',
  '/js/progress.js',
  '/js/challenges.js',
  '/js/sidepanel.js',
  '/js/error-explain.js',
  '/js/game-core.js',
  '/js/games.js',
  '/js/game-dictation.js',
  '/js/game-translation.js',
  '/js/game-order.js',
  '/js/game-memory.js',
  '/js/particles.js',
  '/js/settings.js',
  '/js/srs.js',
  '/audio/manifest.json',
  '/manifest.json'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC))
  );
});

self.addEventListener('activate', e => {
  clients.claim();
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname !== self.location.hostname) return;
  // Stale-while-revalidate: serve cached instantly, fetch network in
  // background to update cache for the next page load. Offline falls back.
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    )
  );
});
