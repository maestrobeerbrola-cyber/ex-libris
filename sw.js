/* Service worker de Ex Libris: funciona sin conexión y guarda las portadas ya vistas. */
const VERSION = 'exlibris-v1.0.2';
const IMG = 'exlibris-portadas';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon.svg', 'icons/favicon-48.png', 'vendor/zxing-0.21.3.min.js'];
const IMG_HOSTS = ['books.google.com', 'books.googleusercontent.com', 'covers.openlibrary.org', 'archive.org'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Solo borra cachés antiguas de Ex Libris: el dominio es compartido con otras apps (p. ej. Farma·Lab).
    for (const k of await caches.keys()) if (k.startsWith('exlibris-') && k !== VERSION && k !== IMG) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/news.json')) { e.respondWith(networkFirst(req)); return; }
    if (req.mode === 'navigate') { e.respondWith(networkFirst(req, 'index.html')); return; }
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (req.destination === 'image' && IMG_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    e.respondWith(cacheFirstImg(req));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req));
  }
});
async function networkFirst(req, fallback) {
  const c = await caches.open(VERSION);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(fallback || req, r.clone());
    return r;
  } catch (err) {
    return (await c.match(fallback || req, { ignoreSearch: true })) || (await c.match('index.html')) || Response.error();
  }
}
async function staleWhileRevalidate(req) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}
async function cacheFirstImg(req) {
  const c = await caches.open(IMG);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r.ok || r.type === 'opaque') c.put(req, r.clone());
    return r;
  } catch (err) { return Response.error(); }
}
