/* Service worker de Ex Libris: funciona sin conexión y guarda las portadas ya vistas.
   La página y su código se piden siempre a la red primero (con la copia guardada solo sin conexión),
   para que nunca se mezcle una página nueva con un código antiguo. */
const VERSION = 'exlibris-v1.5.1';
const IMG = 'exlibris-portadas';
const VENDOR = 'exlibris-vendor'; // bibliotecas con la versión en el nombre: se guardan una vez y se conservan entre versiones
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon.svg', 'icons/favicon-48.png', 'vendor/zxing-0.21.3.min.js'];
const IMG_HOSTS = ['books.google.com', 'books.googleusercontent.com', 'covers.openlibrary.org', 'archive.org'];
const FRESH = /(\/|\.html|\/app\.js|\/config\.js|\.webmanifest|\/news\.json)$/;

self.addEventListener('install', e => {
  // cache:'reload' evita guardar copias antiguas de la caché HTTP del navegador.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Solo borra cachés antiguas de Ex Libris: el dominio es compartido con otras apps (p. ej. Farma·Lab).
    for (const k of await caches.keys()) if (k.startsWith('exlibris-') && k !== VERSION && k !== IMG && k !== VENDOR) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') { e.respondWith(networkFirst(req, new URL('index.html', self.registration.scope).href)); return; }
    if (FRESH.test(url.pathname)) { e.respondWith(networkFirst(req, url.origin + url.pathname)); return; }
    if (url.pathname.includes('/vendor/')) { e.respondWith(cacheFirstVendor(req)); return; }
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
async function networkFirst(req, key) {
  const c = await caches.open(VERSION);
  try {
    const r = await fetch(req, { cache: 'no-cache' });
    if (r.ok) c.put(key, r.clone());
    return r;
  } catch (err) {
    return (await c.match(key, { ignoreSearch: true })) || (await c.match(new URL('index.html', self.registration.scope).href)) || Response.error();
  }
}
async function staleWhileRevalidate(req) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}
async function cacheFirstVendor(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok) (await caches.open(VENDOR)).put(req, r.clone());
  return r;
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
