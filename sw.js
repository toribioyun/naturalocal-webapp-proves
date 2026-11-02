// Service worker: keeps the app and the downloaded route available without connection.
// Cache-first for everything in this folder. Bump VERSION when files change.
const VERSION = 'v1-20261102';
const SHELL = 'nl-shell-' + VERSION;
const ROUTES = 'nl-rutes'; // media of downloaded routes (kept across app versions)
const SHELL_FILES = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'data.json', 'basemap.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('nl-shell-') && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Range requests (video/audio seeking) are answered from the full cached file.
  e.respondWith((async () => {
    const hit = await caches.match(req.url, {ignoreSearch: true});
    if (hit) {
      const range = req.headers.get('range');
      if (!range) return hit;
      const buf = await hit.clone().arrayBuffer();
      const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
      const start = Number(m[1] || 0), end = m[2] ? Number(m[2]) : buf.byteLength - 1;
      return new Response(buf.slice(start, end + 1), {status: 206, headers: {
        'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
        'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes'}});
    }
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
