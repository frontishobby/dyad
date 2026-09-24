/*
 * DYAD service worker. Offline for the app shell, on-demand caching for songs.
 *
 *   index.html, manifest      network first, cache fallback (always pick up a new deploy)
 *   /assets/*  (hashed)       cache first (immutable by name)
 *   /songs/**  (hashed files) cache first; index.json and meta.json network first
 *   everything else           network, cache fallback
 *
 * The cache name carries the build id injected at build time, so a new deploy
 * drops the old shell cache on activate. Songs live in their own cache that
 * survives deploys (their names are content hashes).
 */
const BUILD = '__DYAD_BUILD__';
const SHELL = `dyad-shell-${BUILD}`;
const SONGS = 'dyad-songs-v1';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/probe.webm'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dyad-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isHashedAsset(url) {
  return url.pathname.startsWith('/assets/');
}
function isSongFile(url) {
  return url.pathname.startsWith('/songs/') && /\.(webm|avif|json)$/.test(url.pathname) && !/\/(index|meta)\.json$/.test(url.pathname);
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(SHELL, request));
  } else if (isSongFile(url)) {
    event.respondWith(cacheFirst(SONGS, request));
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirst(SHELL, new Request('/index.html')));
  } else {
    event.respondWith(networkFirst(SHELL, request));
  }
});
