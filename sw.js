// Service worker: always shows the newest version of the website (network first,
// but with cheap revalidation so unchanged files are not downloaded again).
// Only your own site's files are handled. Supabase / fonts / CDN go straight to the network.
const CACHE = 'biit-v4';
const STATIC = /\.(?:png|jpe?g|webp|svg|ico|woff2?|json)$/i;   // icons, logo, manifest: rarely change

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // database, storage, fonts, CDN: straight to network
  if (url.pathname === '/sw.js') return;                  // never cache the service worker itself

  // Static files (icons, logo, manifest): serve from cache instantly, refresh quietly in background.
  if (STATIC.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const refresh = fetch(req).then(r => { if (r && r.status === 200) cache.put(req, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(refresh); return hit; }
      const fresh = await refresh;
      if (fresh) return fresh;
      return Response.error();
    })());
    return;
  }

  // Pages (index/admin): network first, always fresh. 'no-cache' = ask the server "changed?"
  // (answer 304 costs almost nothing) instead of re-downloading the whole 500 KB page every time.
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-cache' });
      if (fresh && fresh.status === 200 && (req.mode === 'navigate' || url.pathname === '/')) {
        const c = await caches.open(CACHE);
        // Keep one offline copy per page (ignore ?query so the cache cannot grow forever)
        c.put(url.origin + url.pathname, fresh.clone());
      }
      return fresh;
    } catch (_) {
      const hit = await caches.match(url.origin + url.pathname) || await caches.match(req);
      if (hit) return hit;
      throw _;
    }
  })());
});

// ---- Phone notifications (messages sent by the admin) ----
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'BIIT Computer Institute', {
    body: d.body || '',
    data: { url: d.url || '/' },
    tag: 'biit-msg',
    renotify: true
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
