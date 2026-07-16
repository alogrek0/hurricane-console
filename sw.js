/*
 * sw.js — Hurricane Console service worker
 * Strategy agreed for a weather app: the app shell must open instantly and work
 * offline, while data must always try live first (a stale outlook during a storm
 * is dangerous). So: cache-first for the shell, network-first for api.weather.gov.
 * Cache-served data responses are stamped X-From-Cache:1 so the UI badge can flip
 * to CACHED honestly instead of guessing.
 *
 * The version lives in version.js (CalVer, single source shared with the page).
 * Browsers byte-check imported scripts during SW update checks, so bumping
 * version.js alone is enough to roll clients forward.
 */
importScripts('./version.js');
const VERSION = self.APP_VERSION;
const SHELL_CACHE = 'shell-' + VERSION;
// Data cache is deliberately NOT versioned: NOAA products are immutable and
// served network-first, so cached issuances stay valid across app updates —
// a version bump must not cost the user their offline products.
const DATA_CACHE = 'data-v1';

const SHELL = [
  './', './index.html', './app.js', './parser.js', './diff.js', './basemap.js', './countries.js',
  './sample.js', './version.js', './manifest.json', './icon-192.png', './icon-512.png',
  './favicon.svg', './icon-maskable-512.png', './apple-touch-icon-180.png',
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

// FIFO trim: the Cache API has no LRU; keys() is insertion-ordered and put()
// re-appends refreshed entries, so dropping from the front evicts the
// oldest-written products. Keeps the persistent data cache bounded.
const DATA_MAX_ENTRIES = 200;
function trimData(c) {
  return c.keys().then(function (keys) {
    if (keys.length <= DATA_MAX_ENTRIES) return;
    return Promise.all(keys.slice(0, keys.length - DATA_MAX_ENTRIES)
      .map(function (k) { return c.delete(k); }));
  });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // DATA: network-first, fall back to cache (stamped)
  if (url.hostname === 'api.weather.gov') {
    e.respondWith(
      fetch(e.request).then(function (resp) {
        if (resp.ok) {
          const copy = resp.clone();
          // waitUntil: don't let the SW be killed mid-write
          e.waitUntil(caches.open(DATA_CACHE).then(function (c) {
            return c.put(e.request, copy).then(function () { return trimData(c); });
          }).catch(function () { }));
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
