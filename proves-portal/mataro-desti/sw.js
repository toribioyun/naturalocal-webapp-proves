// Service worker of the Mataró destination prototype (built by portal/scripts/genera.py). VERSION is set by portal/scripts/genera.py (hash of the app files).
// App and data are saved on install; photos and ICGC map tiles (zoom ≤ 16) are saved as they are seen.
const VERSION = '9035ede311';
const SHELL = 'tpnlm-shell-' + VERSION, SEEN = 'tpnlm-vist';
const SHELL_FILES = ['./', 'index.html', 'desti.js', 'style.css', 'manifest.webmanifest', 'icones.js', 'filtre.js', 'idiomes.js', 'menu.js', 'icon-192.png', 'icon-512.png',
  'logo.svg', 'fulla.svg', 'fonts/raleway-latin.woff2', 'fonts/raleway-latin-ext.woff2', 'data.json'];
const TILE_HOST = 'geoserveis.icgc.cat', TILE_SAVE_MAX_Z = 16;
// Audit 23/11/2026: offline, a route page that has no service worker of its own (never opened or downloaded) used to get
// this destination's index.html, which looks broken there. Now: without the final slash, go to the slash (the route's own
// service worker may have it); otherwise a short page that says what to do.
const ROUTE_PAGE = /\/rutes\/[^/]+\/(index\.html)?$/, ROUTE_NOSLASH = /\/rutes\/[^/.]+$/;
const NOT_DOWNLOADED = `<!doctype html><html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Natura Local · Ruta no descarregada</title><style>body{font:17px/1.5 system-ui,sans-serif;margin:0;padding:32px 20px;background:#f6f1e7;color:#2f261d}
h1{font-size:22px;margin:0 0 12px}a{display:inline-block;margin-top:18px;padding:12px 18px;border-radius:12px;background:#2f261d;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><h1>Aquesta ruta no està descarregada</h1><p>Ara no tens connexió. Per fer-la sense cobertura, obre-la quan en tinguis i toca «Descarrega la ruta».</p>
<a href="../../">‹ Torna al destí</a></body></html>`;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('tpnlm-shell-') && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url), tile = url.hostname === TILE_HOST;
  if (req.method !== 'GET' || (url.origin !== location.origin && !tile)) return;
  // a shared link (fitxa/<kind>-<id>/, O-042): straight to the app on that sheet, also without connection
  const shared = req.mode === 'navigate' && /\/fitxa\/([a-z]+(?:-[^/]+)?)\/?(index\.html)?$/.exec(url.pathname);
  if (shared) { e.respondWith(Response.redirect(new URL('./#' + shared[1], self.registration.scope).href, 302)); return; }
  if (req.mode === 'navigate' && ROUTE_NOSLASH.test(url.pathname)) { e.respondWith(Response.redirect(url.pathname + '/' + url.search + url.hash, 301)); return; }
  // a route's data.json (its points of interest, shown in the route's sheet): from the network when there is one, so it is never stale
  if (/\/rutes\/[^/]+\/data\.json$/.test(url.pathname)) {
    const net = fetch(req).then(async res => { if (res.ok) await (await caches.open(SEEN)).put(req.url, res.clone()); return res; });
    const saved = () => caches.match(req.url, {ignoreSearch: true});
    // poor coverage (audit 23/11/2026): after 4 s the saved copy, if there is one; the network still refreshes it
    const slow = new Promise(r => setTimeout(r, 4000)).then(saved).then(hit => hit || net);
    e.respondWith(Promise.race([net, slow]).catch(async () => (await saved()) || Response.error()));
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
      if (req.mode === 'navigate' && ROUTE_PAGE.test(url.pathname)) return new Response(NOT_DOWNLOADED, {headers: {'Content-Type': 'text/html; charset=utf-8'}});
      if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
