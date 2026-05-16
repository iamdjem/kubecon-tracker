// Keep in lockstep with APP_VERSION in index.html. Changing this string
// is what makes the service worker drop the old cache on activate, so a
// new deploy actually reaches users instead of serving stale HTML.
const CACHE = 'tracker-2026.05.16.3';
const ASSETS = ['/kubecon-tracker/', '/kubecon-tracker/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Always network-first for Firebase (live sync must work)
  if (e.request.url.includes('firebase') || e.request.url.includes('googleapis')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
