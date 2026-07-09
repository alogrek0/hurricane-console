/*
 * sw.js — Hurricane Console service worker
 * Strategy agreed for a weather app: the app shell must open instantly and work
 * offline, while data must always try live first (a stale outlook during a storm
 * is dangerous). So: cache-first for the shell, network-first for api.weather.gov.
 * Cache-served data responses are stamped X-From-Cache:1 so the UI badge can flip
 * to CACHED honestly instead of guessing.
 *
 * Bump VERSION whenever you ship changed shell files so clients pick them up.
 */
const VERSION = 'v11';
const SHELL_CACHE = 'shell-' + VERSION;
const DATA_CACHE = 'data-' + VERSION;

const SHELL = [
  './', './index.html', './app.js', './parser.js', './coastlines.js',
  './sample.js', './manifest.json', './icon-192.png', './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys
        .filter(function (k) { return k !== SHELL_CACHE && k !== DATA_CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function stampCached(resp) {
  const h = new Headers(resp.headers);
  h.set('X-From-Cache', '1');
  return resp.blob().then(function (b) {
    return new Response(b, { status: resp.status, statusText: resp.statusText, headers: h });
  });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // TILES: never intercept or cache (CARTO ToS + unbounded growth). Tiles are
  // online-only by design; the embedded coastlines are the offline basemap.
  if (url.hostname.endsWith('cartocdn.com')) return;

  // DATA: network-first, fall back to cache (stamped)
  if (url.hostname === 'api.weather.gov') {
    e.respondWith(
      fetch(e.request).then(function (resp) {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(DATA_CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      }).catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit ? stampCached(hit) : Response.error();
        });
      })
    );
    return;
  }

  // SHELL: cache-first, revalidate in the background
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      const net = fetch(e.request).then(function (resp) {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return resp;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
