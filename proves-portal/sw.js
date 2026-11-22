// Service worker of the portal (O-033). VERSION is set by portal/scripts/genera.py (hash of the app files).
// It is at the root of the site, so its scope covers every destination: it only answers for the portal's own files,
// and leaves the rest to each destination's and route's own worker (or to the network).
const VERSION = '9ed3d148ec';
const SHELL = 'tpnlp-shell-' + VERSION, SEEN = 'tpnlp-vist';
const SHELL_FILES = ['./', 'index.html', 'portal.js', 'portal.css', 'style.css', 'manifest.webmanifest', 'icones.js', 'filtre.js', 'icon-192.png', 'icon-512.png',
  'logo.svg', 'fulla.svg', 'fonts/raleway-latin.woff2', 'fonts/raleway-latin-ext.woff2', 'cerca.json'];
const TILE_HOST = 'tile.openstreetmap.org', TILE_SAVE_MAX_Z = 12; // only the tiles seen, as the browser would (OSM tile policy: no bulk download)
const ROOT = new URL('./', self.location).pathname;
const OWN = new Set(SHELL_FILES.map(f => new URL(f, self.location).pathname));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    // also the caches of the app that was at the root before the portal (Parc de Mataró, nl-…; now in parc-mataro/ with nlpm-…)
    keys.filter(k => (k.startsWith('tpnlp-shell-') && k !== SHELL) || k.startsWith('tpnl-shell-') || k === 'tpnl-rutes').map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url), tile = url.hostname === TILE_HOST;
  if (req.method !== 'GET') return;
  if (!tile && (url.origin !== location.origin || !OWN.has(url.pathname))) return; // a destination, a route, a photo: not ours
  e.respondWith((async () => {
    const hit = await caches.match(req.url, {ignoreSearch: true, cacheName: tile ? SEEN : SHELL});
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (tile && res.ok && Number(url.pathname.split('/').slice(-3)[0]) <= TILE_SAVE_MAX_Z) (await caches.open(SEEN)).put(req.url, res.clone());
      return res;
    } catch (err) {
      return hit || Response.error();
    }
  })());
});
