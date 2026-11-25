// Service worker: keeps the app and the downloaded route available without connection.
// Cache-first for everything in this folder. VERSION is set by portal/scripts/genera.py (hash of the app files).
// App, data and map are always saved; media and ortho tiles (zoom ≤ 17) opened online are saved too
// (nl-rutes), so the route keeps working if coverage is lost without having downloaded it.
const VERSION = '6612b5109f';
const SHELL = 'tpnlr36321-shell-' + VERSION;
const ROUTES = 'tpnlr36321-media'; // media of downloaded routes (kept across app versions)
const SHELL_FILES = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'idiomes.js', 'menu.js',
  'icon-192.png', 'icon-512.png', 'logo.svg', 'fulla.svg', 'fonts/raleway-latin.woff2',
  'fonts/raleway-latin-ext.woff2', 'data.json', 'basemap.json'];
const ORTO_HOST = 'geoserveis.icgc.cat', ORTO_SAVE_MAX_Z = 17;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('tpnlr36321-shell-') && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  const orto = url.hostname === ORTO_HOST && url.pathname.includes('/orto/'); // the topographic map (off the route) is online only, not saved
  if (req.method !== 'GET' || (url.origin !== location.origin && !orto)) return;
  e.respondWith((async () => {
    const hit = await caches.match(req.url, {ignoreSearch: true});
    if (hit) return serve(hit, req);
    try {
      // Media not yet saved: fetch the whole file (not just a range), keep it and serve it.
      if (url.pathname.includes('/media/')) {
        const res = await fetch(req.url);
        if (!res.ok) return res;
        await (await caches.open(ROUTES)).put(req.url, res.clone());
        return serve(res, req);
      }
      if (orto) {
        const res = await fetch(req);
        const z = Number(url.pathname.split('/').slice(-3)[0]);
        if (res.ok && z <= ORTO_SAVE_MAX_Z) await (await caches.open(ROUTES)).put(req.url, res.clone());
        return res;
      }
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
// Range requests (video/audio seeking) are answered from the full file.
async function serve(full, req) {
  const range = req.headers.get('range');
  if (!range) return full;
  const buf = await full.clone().arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [], len = buf.byteLength;
  // "bytes=-N" are the last N bytes; the end never passes the file (audit 23/11/2026: Safari is strict with 206)
  let start = m[1] ? Number(m[1]) : m[2] ? Math.max(0, len - Number(m[2])) : 0;
  let end = m[1] && m[2] ? Math.min(Number(m[2]), len - 1) : len - 1;
  if (start >= len) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${len}`}});
  return new Response(buf.slice(start, end + 1), {status: 206, headers: {
    'Content-Type': full.headers.get('Content-Type') || 'application/octet-stream',
    'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
    'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes'}});
}
