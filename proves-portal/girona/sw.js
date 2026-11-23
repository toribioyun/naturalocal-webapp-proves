// Service worker of the Girona destination prototype (built by portal/scripts/genera.py). VERSION is set by portal/scripts/genera.py (hash of the app files).
// App and data are saved on install; photos and ICGC map tiles (zoom ≤ 16) are saved as they are seen.
const VERSION = 'd267d283e3';
const SHELL = 'tpnlgi-shell-' + VERSION, SEEN = 'tpnlgi-vist';
const SHELL_FILES = ['./', 'index.html', 'desti.js', 'style.css', 'manifest.webmanifest', 'icones.js', 'filtre.js', 'idiomes.js', 'menu.js', 'icon-192.png', 'icon-512.png',
  'logo.svg', 'fulla.svg', 'fonts/raleway-latin.woff2', 'fonts/raleway-latin-ext.woff2', 'data.json'];
const TILE_HOST = 'geoserveis.icgc.cat', TILE_SAVE_MAX_Z = 16;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('tpnlgi-shell-') && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url), tile = url.hostname === TILE_HOST;
  if (req.method !== 'GET' || (url.origin !== location.origin && !tile)) return;
  // a shared link (fitxa/<kind>-<id>/, O-042): straight to the app on that sheet, also without connection
  const shared = req.mode === 'navigate' && /\/fitxa\/([a-z]+(?:-[^/]+)?)\/?(index\.html)?$/.exec(url.pathname);
  if (shared) { e.respondWith(Response.redirect(new URL('./#' + shared[1], self.registration.scope).href, 302)); return; }
  // a route's data.json (its points of interest, shown in the route's sheet): from the network when there is one, so it is never stale
  if (/\/rutes\/[^/]+\/data\.json$/.test(url.pathname)) {
    e.respondWith(fetch(req).then(async res => { if (res.ok) await (await caches.open(SEEN)).put(req.url, res.clone()); return res; })
      .catch(async () => (await caches.match(req.url, {ignoreSearch: true})) || Response.error()));
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req.url, {ignoreSearch: true});
    if (hit) return hit;
    try {
      const res = await fetch(req);
      const keep = tile ? Number(url.pathname.split('/').slice(-3)[0]) <= TILE_SAVE_MAX_Z : url.pathname.includes('/media/');
      if (res.ok && keep) await (await caches.open(SEEN)).put(req.url, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
