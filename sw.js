const CACHE = 'hogwarts-es-v2';
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
  // Let API calls passthrough — only cache local static assets.
  const url = new URL(e.request.url);
  if (url.hostname !== self.location.hostname) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
