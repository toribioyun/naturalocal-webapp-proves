/* Natura Local – portal prototype (O-033): every destination on one map, a search of towns, routes and places, and links
   into each destination app (../<folder>/), which has a way back here. Data: cerca.json, built by portal/scripts/genera.py
   from each destination's data.json. Base map: OpenStreetMap (online). */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[·.'’\-]/g, ' ').replace(/\s+/g, ' ');
const GROUPS = {
  ruta: {label: 'Ruta', col: '#69920c'}, visita: {label: 'Visita', col: '#e9bc00'}, menjar: {label: 'Menjar', col: '#c4541c'},
  dormir: {label: 'Dormir', col: '#5b4a3b'}, altres: {label: 'Servei', col: '#1f6f8b'},
};
// OpenStreetMap, the same map as the destination app (Toribio, 19/11/2026: one map everywhere, with its credit below)
const TILE = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const ITEMS_FROM_Z = 11.5; // routes and places show from here; below, only the destinations
let DATA = {D: [], I: [], T: []}, sel = null, popItem = null, me = null;
// «Destins» (the destinations) or «Rutes» (every route of every destination, with the route filter, O-047, 19/11/2026)
let mode = 'dest', TRK = new Map();
const routes = () => DATA.I.filter(i => i.g === 'ruta' && RF.ok(i));

function updateNet() { const on = navigator.onLine; $('net').textContent = on ? 'Amb connexió' : 'Sense connexió'; $('net').classList.toggle('off', !on); }
addEventListener('online', () => { updateNet(); tiles.clear(); draw(); });
addEventListener('offline', updateNet);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

/* ---------- map (Web Mercator, pixels of zoom 0 × 2^z) ---------- */
const cv = $('map'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const view = {x: 0, y: 0, z: 8}; // centre in zoom-0 pixels
const mx = lon => (lon + 180) / 360 * 256;
const my = lat => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256; };
const scale = () => 2 ** view.z;
const w2s = (x, y) => [(x - view.x) * scale() + W / 2, (y - view.y) * scale() + H / 2];
const s2w = (sx, sy) => [(sx - W / 2) / scale() + view.x, (sy - H / 2) / scale() + view.y];
const ll2s = (lat, lon) => w2s(mx(lon), my(lat));
function resize() { const r = cv.getBoundingClientRect(); DPR = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * DPR; cv.height = H * DPR; draw(); }
addEventListener('resize', resize);
let dirty = false;
function draw() { if (!dirty && W) { dirty = true; requestAnimationFrame(paint); } }
const tiles = new Map();
function tile(z, x, y) {
  const url = TILE(z, x, y); let t = tiles.get(url);
  if (!t) { t = {img: new Image(), ok: false}; t.img.crossOrigin = 'anonymous'; t.img.onload = () => { t.ok = true; draw(); }; t.img.src = url; tiles.set(url, t); }
  return t;
}
function paintTiles() {
  const z = Math.max(0, Math.min(18, Math.round(view.z + Math.log2(DPR) - 0.3))), n = 2 ** z, k = 256 / n; // k: zoom-0 pixels per tile
  const [ax, ay] = s2w(0, 0), [bx, by] = s2w(W, H);
  const x0 = Math.floor(ax / k), x1 = Math.floor(bx / k), y0 = Math.max(0, Math.floor(ay / k)), y1 = Math.min(n - 1, Math.floor(by / k));
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 120) return;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    let t = tile(z, ((x % n) + n) % n, y), sx = 0, sy = 0, sw = 256;
    for (let up = 1; !t.ok && up <= 4 && z - up >= 0; up++) { // parent tile, enlarged, while the right one loads
      const f = 2 ** up, px = Math.floor(x / f), py = Math.floor(y / f), c = tile(z - up, ((px % (n / f)) + n / f) % (n / f), py);
      if (c.ok) { t = c; sw = 256 / f; sx = (x - px * f) * sw; sy = (y - py * f) * sw; }
    }
    if (!t.ok) continue;
    const [px0, py0] = w2s(x * k, y * k), [px1, py1] = w2s((x + 1) * k, (y + 1) * k);
    ctx.drawImage(t.img, sx, sy, sw, sw, px0 - 0.5, py0 - 0.5, px1 - px0 + 1, py1 - py0 + 1);
  }
}
/* Routes as in a destination's map (Toribio, 22/11/2026): each one with its own colour (cerca.json, col) and the
   destination's pin with the route signpost; the chosen one bigger and thicker, in its colour. */
const PATHS = Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.d.map(d => new Path2D(d))]));
function drawIcon(name, cx, cy, size, col) {
  const ic = ICONS[name], [x0, y0, w, h] = Array.isArray(ic.vb) ? ic.vb : [0, 0, ic.vb, ic.vb], k = size / Math.max(w, h);
  ctx.save(); ctx.translate(cx - w * k / 2, cy - h * k / 2); ctx.scale(k, k); ctx.translate(-x0, -y0); ctx.fillStyle = col;
  for (const p of PATHS[name]) ctx.fill(p);
  ctx.restore();
}
const routeCol = it => it.col || (it.mo === 'bici' ? '#1f6f8b' : '#69920c');
function routePin(x, y, col, big) {
  const k = big ? 1.3 : 1;
  ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-5, -9, -14, -14, -14, -24); ctx.arc(0, -24, 14, Math.PI, 0); ctx.bezierCurveTo(14, -14, 5, -9, 0, 0); ctx.closePath();
  ctx.shadowColor = '#0006'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1; ctx.fillStyle = col; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  drawIcon('ruta', 0, -24, 16, '#fff'); ctx.restore();
}
function track(tr, col, on) {
  ctx.beginPath(); tr.forEach((p, k) => { const [x, y] = ll2s(p[0], p[1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#fff'; ctx.lineWidth = on ? 11 : 6.5; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = on ? 6.5 : 3.5; ctx.stroke();
}
function pin(sx, sy, col, r) { // teardrop pin with its tip at (sx, sy)
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.bezierCurveTo(sx - r * 0.6, sy - r, sx - r, sy - r * 1.3, sx - r, sy - r * 1.8);
  ctx.arc(sx, sy - r * 1.8, r, Math.PI, 0); ctx.bezierCurveTo(sx + r, sy - r * 1.3, sx + r * 0.6, sy - r, sx, sy); ctx.closePath();
  ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
}
function label(text, sx, sy, bold) {
  ctx.font = `${bold ? 800 : 700} ${bold ? 14 : 12}px Raleway, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.lineWidth = 4; ctx.strokeStyle = '#fffe'; ctx.strokeText(text, sx, sy); ctx.fillStyle = '#322820'; ctx.fillText(text, sx, sy);
}
const showItems = () => view.z >= ITEMS_FROM_Z;
function paint() {
  dirty = false; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); syncCards();
  ctx.fillStyle = '#e8e2d2'; ctx.fillRect(0, 0, W, H);
  paintTiles();
  if (mode === 'rut') { paintRoutes(); return; }
  if (mode === 'fav') { paintFavs(); return; }
  if (showItems()) {
    ctx.lineJoin = ctx.lineCap = 'round';
    const onT = popItem && popItem.g === 'ruta' ? TRK.get(popItem.c + '/' + popItem.id) : null;
    for (const t of DATA.T) if (t !== onT) track(t.tr, t.col || '#69920c', false);
    if (onT) track(onT.tr, routeCol(popItem), true);
    for (const it of DATA.I) {
      const [x, y] = ll2s(it.lat, it.lon); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      if (it.g === 'ruta') { if (it !== popItem) routePin(x, y, routeCol(it), false); continue; }
      ctx.beginPath(); ctx.arc(x, y, it === popItem ? 8 : 6, 0, 7); ctx.fillStyle = GROUPS[it.g].col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
  for (const d of DATA.D) {
    const [x, y] = ll2s(d.lat, d.lon), big = d === sel;
    if (showItems()) { label(short(d), x, y + 4, true); continue; } // close up, the town's name is enough
    pin(x, y, big ? '#e8590c' : '#322820', big ? 12 : 10);
    ctx.beginPath(); ctx.arc(x, y - (big ? 21.6 : 18), big ? 4.5 : 3.8, 0, 7); ctx.fillStyle = '#e9bc00'; ctx.fill();
    label(short(d), x, y + 4, big);
  }
  if (popItem && popItem.g === 'ruta') { const [x, y] = ll2s(popItem.lat, popItem.lon); routePin(x, y, routeCol(popItem), true); }
  else if (popItem) { // the chosen place, on top of everything, so it is clear which one it is
    const [x, y] = ll2s(popItem.lat, popItem.lon); pin(x, y, '#e8590c', 13);
    ctx.beginPath(); ctx.arc(x, y - 23.4, 5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
  }
  if (me) { const [x, y] = ll2s(me[0], me[1]); ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fillStyle = '#1b6ca8'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); }
}
function paintRoutes() { // «Rutes»: the routes that pass the filter, at any zoom; destinations only as a name
  ctx.lineJoin = ctx.lineCap = 'round';
  const list = routes();
  if (view.z >= 9.5) for (const it of list) { const t = TRK.get(it.c + '/' + it.id); if (t && it !== popItem) track(t.tr, routeCol(it), false); }
  if (popItem && popItem.g === 'ruta') { const t = TRK.get(popItem.c + '/' + popItem.id); if (t) track(t.tr, routeCol(popItem), true); }
  for (const d of DATA.D) { const [x, y] = ll2s(d.lat, d.lon); label(short(d), x, y + 4, false); }
  for (const it of list) {
    const [x, y] = ll2s(it.lat, it.lon); if (x < -20 || y < -20 || x > W + 20 || y > H + 20 || it === popItem) continue;
    routePin(x, y, routeCol(it), false);
  }
  if (popItem) { const [x, y] = ll2s(popItem.lat, popItem.lon); routePin(x, y, routeCol(popItem), true); }
  if (me) { const [x, y] = ll2s(me[0], me[1]); ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fillStyle = '#1b6ca8'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); }
}
/* ---------- favourites (O-066): what was kept with ♡ in any app, on the map and in the cards ---------- */
const FAV_COL = {desti: '#322820', ruta: '#69920c', visita: '#e9bc00', servei: '#1f6f8b'};
const favList = () => NLM.favs().filter(f => isFinite(f.lat) && isFinite(f.lon));
function paintFavs() {
  for (const d of DATA.D) { const [x, y] = ll2s(d.lat, d.lon); label(short(d), x, y + 4, false); }
  for (const f of favList()) {
    if (popItem && f.k === popItem.k) continue;
    const [x, y] = ll2s(f.lat, f.lon); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    pin(x, y, FAV_COL[f.kind] || '#c2185b', f.kind === 'desti' ? 10 : 8);
    ctx.beginPath(); ctx.arc(x, y - (f.kind === 'desti' ? 18 : 14.4), 3.6, 0, 7); ctx.fillStyle = '#c2185b'; ctx.fill();
  }
  if (popItem) { const [x, y] = ll2s(popItem.lat, popItem.lon); pin(x, y, '#e8590c', 13); ctx.beginPath(); ctx.arc(x, y - 23.4, 5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); }
  if (me) { const [x, y] = ll2s(me[0], me[1]); ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fillStyle = '#1b6ca8'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); }
}
const favHref = f => f.kind === 'desti' ? f.k.split('/')[0] + '/' : f.k.replace('/', '/#');
const KIND_NAME = {desti: 'Destí', ruta: 'Ruta', visita: 'Visita', servei: 'Servei'};
function renderFavCards() {
  const all = favList(), list = all.filter(f => inView(f.lat, f.lon));
  $('cards').innerHTML = list.length ? list.map(f => `<article class="pcard rcard" data-fk="${esc(f.k)}">
    ${f.foto ? `<img src="${esc(f.foto)}" alt="" loading="lazy">` : ''}
    <div class="txt"><h2>${esc(f.n)}</h2><p>${KIND_NAME[f.kind]}${f.kind !== 'desti' && f.d ? ' · ' + esc(f.d) : ''}</p>
      <a class="open" href="${esc(favHref(f))}">Obre la fitxa ›</a></div></article>`).join('')
    : all.length ? OUTSIDE('favorit') : '<p class="none">Encara no tens cap favorit.</p>';
  $('cards').querySelectorAll('[data-fk]').forEach(el => el.onclick = e => {
    if (e.target.closest('a')) return;
    const f = favList().find(x => x.k === el.dataset.fk); showFavPop(f); flyTo(f.lat, f.lon, Math.max(view.z, 13));
  });
}
function showFavPop(f) {
  popItem = f;
  $('pop').innerHTML = `<span class="t" style="color:#c2185b">♥ ${KIND_NAME[f.kind]}${f.kind !== 'desti' && f.d ? ' · ' + esc(f.d) : ''}</span><h3>${esc(f.n)}</h3>
    <div class="row"><a class="btn primary" href="${esc(favHref(f))}">Obre la fitxa ›</a><button id="popClose" class="small">Tanca</button></div>`;
  $('pop').hidden = false; $('cards').hidden = true; $('popClose').onclick = hidePop; draw();
}
function syncFavChip() { $('mFav').hidden = !NLM.favs().length && mode !== 'fav'; }
addEventListener('tpnlfav', () => { syncFavChip(); if (mode === 'fav') { renderCards(); draw(); } });
function fit(pts, pad = 50, maxZ = 15) {
  const xs = pts.map(p => mx(p[1])), ys = pts.map(p => my(p[0]));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
  const bottom = Math.max($('cards').offsetHeight, cardH, 150); // the cards grow when the fonts and photos arrive
  view.z = Math.min(maxZ, Math.log2(Math.min((W - 2 * pad) / Math.max(x1 - x0, 1e-9), (H - bottom - 2 * pad) / Math.max(y1 - y0, 1e-9))));
  view.y += bottom / 2 / scale(); // keep the points above the cards
  draw();
}
function flyTo(lat, lon, z) { view.z = z; view.x = mx(lon); view.y = my(lat) + Math.max($('cards').offsetHeight, $('pop').offsetHeight, 0) / 2 / scale(); draw(); }
function zoom(f, sx = W / 2, sy = H / 2) { const a = s2w(sx, sy); view.z = Math.max(5, Math.min(18, view.z + Math.log2(f))); const b = s2w(sx, sy); view.x += a[0] - b[0]; view.y += a[1] - b[1]; draw(); }
$('zin').onclick = () => zoom(2); $('zout').onclick = () => zoom(0.5);
cv.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.25 : 0.8, e.offsetX, e.offsetY); }, {passive: false});
const ptrs = new Map(); let pinch0 = null, downXY = null, downAt = 0;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); if (ptrs.size === 1) { downXY = [e.offsetX, e.offsetY]; downAt = Date.now(); } else { pinch0 = pinchDist(); downXY = null; } });
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (ptrs.size === 1) { view.x -= (e.offsetX - prev[0]) / scale(); view.y -= (e.offsetY - prev[1]) / scale(); draw(); }
  else if (ptrs.size === 2 && pinch0) { const d = pinchDist(), [a, b] = [...ptrs.values()]; zoom(d / pinch0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch0 = d; }
});
const endPtr = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; };
cv.addEventListener('pointerup', e => { if (downXY && ptrs.size === 1 && Date.now() - downAt < 400 && Math.hypot(e.offsetX - downXY[0], e.offsetY - downXY[1]) < 8) tapAt(e.offsetX, e.offsetY); endPtr(e); });
cv.addEventListener('pointercancel', endPtr);
function pinchDist() { const [a, b] = [...ptrs.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; }
function tapAt(x, y) {
  hideResults();
  let best = null, bd = 30;
  const near = (lat, lon, dy, obj) => { const [sx, sy] = ll2s(lat, lon), d = Math.hypot(sx - x, sy - dy - y); if (d < bd) { bd = d; best = obj; } };
  if (mode === 'fav') { favList().forEach(f => near(f.lat, f.lon, 12, f)); if (best) showFavPop(best); else hidePop(); return; }
  if (mode === 'rut') routes().forEach(it => near(it.lat, it.lon, 12, it));
  else if (showItems()) DATA.I.forEach(it => near(it.lat, it.lon, it.g === 'ruta' ? 12 : 0, it));
  else DATA.D.forEach(d => near(d.lat, d.lon, 18, d));
  if (!best) { hidePop(); return; }
  if (best.c && best.id) showPop(best); else selectDest(best, true);
}

/* ---------- destinations, cards and pop-up ---------- */
// The cards show only what is on the visible part of the map, above the cards (Juanjo, 20/11/2026): zooming in or
// moving the map leaves fewer cards. They are drawn again only when that set changes, so a swipe is not lost.
let cardH = 0, cardKey = null, cardTimer = 0;
function inView(lat, lon) {
  if (!W) return true; // before the map has a size (the first cards, which the first fit needs to measure)
  const [x, y] = ll2s(lat, lon); cardH = Math.max(cardH, $('cards').offsetHeight); // the tallest: a short «none» line must not widen the area and loop
  return x >= 0 && x <= W && y >= 0 && y <= H - cardH + 30; // a pin whose tip just touches the cards still shows
}
function syncCards() { clearTimeout(cardTimer); cardTimer = setTimeout(() => { if (W && cardsKey() !== cardKey) renderCards(); }, 150); }
const cardsKey = () => mode + '|' + (mode === 'fav' ? favList().filter(f => inView(f.lat, f.lon)).map(f => f.k) : mode === 'rut' ? routes().filter(i => inView(i.lat, i.lon)).map(i => i.c + '/' + i.id) : DATA.D.filter(d => inView(d.lat, d.lon)).map(d => d.c)).join(',') + '|' + !!me;
const OUTSIDE = what => `<p class="none">Cap ${what} en aquesta part del mapa. Allunya'l o mou-lo per veure'n més.</p>`;
const destOf = c => DATA.D.find(d => d.c === c);
const short = d => d.nc || d.n; // a park has a long name: «Montgrí» in labels and buttons
const fmtKm = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
function km(a, b) { const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
const MODE_NAME = {peu: 'A peu', bici: 'En bici', cavall: 'A cavall'};
function renderRouteCards() {
  const all = routes(), list = all.filter(i => inView(i.lat, i.lon));
  if (me) list.sort((a, b) => km(me, [a.lat, a.lon]) - km(me, [b.lat, b.lon])); else list.sort((a, b) => a.n.localeCompare(b.n, 'ca'));
  $('cards').innerHTML = list.length ? list.map(it => `<article class="pcard rcard" data-k="${esc(it.c + '/' + it.id)}">
    ${it.f ? `<img src="${esc(it.c)}/${esc(it.f)}" alt="" loading="lazy">` : ''}
    <div class="txt"><h2>${esc(it.n)}</h2>
      <p>${[MODE_NAME[it.mo], it.km && it.km + ' km', it.df, it.tp].filter(Boolean).map(esc).join(' · ')}${me ? ` · <b>a ${fmtKm(km(me, [it.lat, it.lon]))}</b>` : ''}</p>
      <p class="muns">${esc(short(destOf(it.c)))}${it.m ? ' · ' + esc(it.m.split(', ')[0]) : ''}</p>
      <a class="open" href="${esc(it.c)}/#ruta-${encodeURIComponent(it.id)}">Obre la fitxa ›</a></div></article>`).join('')
    : all.length ? OUTSIDE('ruta') : '<p class="none">Cap ruta amb aquests filtres.</p>';
  $('cards').querySelectorAll('.rcard').forEach(el => el.onclick = e => {
    if (e.target.closest('a')) return;
    const it = DATA.I.find(i => i.g === 'ruta' && i.c + '/' + i.id === el.dataset.k); showPop(it); flyTo(it.lat, it.lon, Math.max(view.z, 13));
  });
}
function setMode(m, refit) {
  mode = m; $('mDest').setAttribute('aria-pressed', m === 'dest'); $('mRut').setAttribute('aria-pressed', m === 'rut'); $('mFav').setAttribute('aria-pressed', m === 'fav'); syncFavChip();
  $('fBtn').hidden = m !== 'rut'; $('fBtn').innerHTML = FUNNEL + RF.label(); $('fBtn').setAttribute('aria-pressed', RF.count() > 0);
  hidePop(); renderCards();
  const ph = m === 'dest' ? 'Cerca un poble o un destí' : m === 'rut' ? 'Cerca una ruta o un poble' : 'Cerca un poble, una ruta o un lloc';
  $('q').placeholder = NLM.T(ph); $('q').setAttribute('aria-label', NLM.T(ph));
  if (!$('results').hidden) renderResults();
  if (refit) { const pts = m === 'fav' ? favList().map(f => [f.lat, f.lon]) : m === 'rut' ? routes().map(i => [i.lat, i.lon]) : DATA.D.map(d => [d.lat, d.lon]); if (pts.length) fit(pts, 60, m === 'fav' ? 14 : 12); }
  draw(); remember();
}
const FUNNEL = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="vertical-align:-3px;margin-right:4px"><path d="M3 5h18l-7 8v6l-4 2v-8z" fill="currentColor"/></svg>';
$('mDest').onclick = () => setMode('dest', true);
$('mRut').onclick = () => setMode('rut', true);
$('mFav').onclick = () => setMode('fav', true);
$('fBtn').onclick = () => RF.open(DATA.I.filter(i => i.g === 'ruta'), () => setMode('rut', true));
function renderCards() {
  cardKey = cardsKey();
  if (mode === 'rut') { renderRouteCards(); return; }
  if (mode === 'fav') { renderFavCards(); return; }
  const list = DATA.D.filter(d => inView(d.lat, d.lon));
  if (me) list.sort((a, b) => km(me, [a.lat, a.lon]) - km(me, [b.lat, b.lon])); else list.sort((a, b) => a.n.localeCompare(b.n, 'ca'));
  $('cards').innerHTML = list.map(d => `<article class="pcard${d === sel ? ' on' : ''}" data-c="${esc(d.c)}">
    <img src="${esc(d.c)}/${esc(d.foto)}" alt="" loading="lazy">
    <div class="txt"><h2>${esc(d.n)}</h2>
      <p>${[d.nR && `${d.nR} ${d.nR === 1 ? 'ruta' : 'rutes'}`, d.nV && `${d.nV} ${d.nV === 1 ? 'visita' : 'visites'}`, d.nS && `${d.nS} serveis`].filter(Boolean).join(' · ')}${me ? ` · <b>a ${fmtKm(km(me, [d.lat, d.lon]))}</b>` : ''}</p>
      ${d.parc ? `<p class="muns">Parc · ${d.m.length} municipis: ${esc(d.m.slice(0, 3).join(', '))}${d.m.length > 3 ? '…' : ''}</p>` : ''}
      <a class="open" href="${esc(d.c)}/">Obre ${esc(short(d))} ›</a></div></article>`).join('') || OUTSIDE('destí');
  $('cards').querySelectorAll('.pcard').forEach(el => el.onclick = e => { if (e.target.closest('a')) return; selectDest(destOf(el.dataset.c), false); });
  if (sel) { const el = $('cards').querySelector(`[data-c="${CSS.escape(sel.c)}"]`); if (el) el.scrollIntoView({inline: 'center', block: 'nearest'}); }
}
function selectDest(d, scrollCard) {
  sel = d; hidePop();
  $('cards').querySelectorAll('.pcard').forEach(el => el.classList.toggle('on', el.dataset.c === d.c));
  if (scrollCard) { const el = $('cards').querySelector(`[data-c="${CSS.escape(d.c)}"]`); if (el) el.scrollIntoView({behavior: 'smooth', inline: 'center', block: 'nearest'}); }
  flyTo(d.lat, d.lon, Math.max(view.z, 10)); remember();
}
function showPop(it) {
  popItem = it; const d = destOf(it.c), g = GROUPS[it.g];
  $('pop').innerHTML = `<span class="t" style="color:${g.col === '#e9bc00' ? '#8a6d00' : g.col}"><span>${g.label}</span> · ${esc(short(d))}${it.m ? ' · ' + esc(it.m.split(', ')[0]) : ''}</span><h3>${esc(it.n)}</h3>
    <div class="pop-acts"><button id="popFav" class="hero-btn"></button><button id="popShare" class="hero-btn" aria-label="Comparteix" title="Comparteix"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg></button></div>
    <div class="row"><a class="btn primary" href="${esc(it.c)}/#${it.g === 'ruta' ? 'ruta' : it.g === 'visita' ? 'visita' : 'servei'}-${encodeURIComponent(it.id)}">Obre la fitxa ›</a><button id="popClose" class="small">Tanca</button></div>`;
  $('pop').hidden = false; $('cards').hidden = true; $('popClose').onclick = hidePop; draw(); remember();
  const kind = it.g === 'ruta' ? 'ruta' : it.g === 'visita' ? 'visita' : 'servei';
  NLM.heart($('popFav'), {k: it.c + '/' + kind + '-' + it.id, kind, n: it.n, d: short(d), foto: it.f ? it.c + '/' + it.f : '', lat: it.lat, lon: it.lon}, {icon: true});
  $('popShare').onclick = () => NLM.share(it.n, new URL(it.c + '/fitxa/' + kind + '-' + encodeURIComponent(it.id) + '/', location.href).href, $('popShare'));
}
function hidePop() { if (!popItem && $('pop').hidden) return; popItem = null; $('pop').hidden = true; $('cards').hidden = false; draw(); }

/* ---------- search ---------- */
function search(q) {
  const f = fold(q.trim()); if (f.length < 2) return [];
  // a one-letter word («l» of «l'Escala», «d» of «d'Aro») matches almost anything: it counts only if it is alone
  const all = f.split(/\s+/), words = all.some(w => w.length > 1) ? all.filter(w => w.length > 1) : all, hit = s => { const t = fold(s); return words.every(w => t.includes(w)); };
  const starts = s => fold(s).startsWith(words[0]) ? 0 : 1;
  // a park is found by its name or by any of its municipalities («Torroella», «l'Escala»)
  const towns = DATA.D.filter(d => hit(d.n + ' ' + (d.nc || '') + ' ' + (d.m || []).join(' '))).map(d => ({d, rank: starts(d.n) + (hit(d.n + ' ' + (d.nc || '')) ? 0 : 1),
    via: hit(d.n + ' ' + (d.nc || '')) ? '' : (d.m || []).map(m => [m, words.filter(w => fold(m).includes(w)).join('').length]).sort((x, y) => y[1] - x[1]).filter(x => x[1])[0]?.[0]}));
  // a place matches by its name or by its name and its town together («ermita mataro»); the name alone ranks first
  // a place needs at least one word of its own name: the town alone does not list all its places
  const items = DATA.I.filter(it => hit(it.n + ' ' + destOf(it.c).n + ' ' + (destOf(it.c).nc || '') + ' ' + (it.m || '')) && words.some(w => fold(it.n).includes(w))).map(it => ({it, rank: starts(it.n) + (it.g === 'ruta' ? 0 : 0.5) + (hit(it.n) ? 0 : 2)}));
  // Each result in its own place (Juanjo, 23/11/2026): «Destins» lists only destinations, «Rutes» only routes (those of
  // the filter, also found by their town: «Gualba» lists the routes of Gualba). Favourites keep the whole search.
  const byName = (a, b) => a.rank - b.rank || (a.it ? a.it.n.localeCompare(b.it.n, 'ca') : 0);
  if (mode === 'dest') return towns.sort(byName).slice(0, 40);
  if (mode === 'rut') return routes().filter(it => hit(it.n + ' ' + destOf(it.c).n + ' ' + (destOf(it.c).nc || '') + ' ' + (it.m || ''))).map(it => ({it, rank: starts(it.n) + (hit(it.n) ? 0 : 2)})).sort(byName).slice(0, 40);
  return [...towns.sort((a, b) => a.rank - b.rank), ...items.sort((a, b) => a.rank - b.rank || a.it.n.localeCompare(b.it.n, 'ca'))].slice(0, 40);
}
// What the other mode would find, to offer it when this one finds nothing («Can Mata» in «Destins» → 2 routes)
function otherHits(q) { const keep = mode; mode = keep === 'dest' ? 'rut' : 'dest'; const n = search(q).length; mode = keep; return n; }
function renderResults() {
  const q = $('q').value; $('qClear').hidden = !q;
  if (q.trim().length < 2) { hideResults(); return; }
  const res = search(q);
  $('results').innerHTML = res.length ? res.map((r, k) => r.d
    ? `<button class="res" data-k="${k}"><span class="pdot town"></span><span><b>${esc(r.d.n)}</b><small>${r.d.parc ? 'Parc' : 'Destí'} · ${r.d.nR} rutes${r.via ? ' · inclou ' + esc(r.via) : ''}</small></span></button>`
    : `<button class="res" data-k="${k}"><span class="pdot" style="background:${GROUPS[r.it.g].col}"></span><span><b>${esc(r.it.n)}</b><small>${GROUPS[r.it.g].label} · ${esc(short(destOf(r.it.c)))}${r.it.m ? ' · ' + esc(r.it.m.split(', ')[0]) : ''}</small></span></button>`).join('')
    : noneMsg(q);
  $('results').hidden = false;
  const sw = $('results').querySelector('.res-switch'); if (sw) sw.onclick = () => { setMode(mode === 'dest' ? 'rut' : 'dest', false); renderResults(); $('q').focus(); };
  $('results').querySelectorAll('.res:not(.res-switch)').forEach(b => b.onclick = () => {
    const r = res[+b.dataset.k]; hideResults(); $('q').blur();
    if (r.d) selectDest(r.d, true); else { showPop(r.it); flyTo(r.it.lat, r.it.lon, Math.max(view.z, 14)); }
  });
}
function noneMsg(q) {
  const none = mode === 'dest' ? 'No hi ha cap destí amb aquest nom.' : mode === 'rut' ? (RF.count() ? 'Amb aquest filtre no hi ha cap ruta amb aquest nom.' : 'No hi ha cap ruta amb aquest nom.') : 'No hi ha res amb aquest nom.';
  const n = mode === 'fav' ? 0 : otherHits(q), other = mode === 'dest' ? (n === 1 ? '1 ruta' : n + ' rutes') : (n === 1 ? '1 destí' : n + ' destins');
  return `<p class="none">${none}</p>` + (n ? `<button class="res res-switch"><span class="pdot${mode === 'dest' ? '' : ' town'}"${mode === 'dest' ? ' style="background:#69920c"' : ''}></span><span><b>Mira-ho a «${mode === 'dest' ? 'Rutes' : 'Destins'}»</b><small>Hi ha ${other} amb aquest nom</small></span></button>` : '');
}
function hideResults() { $('results').hidden = true; }
$('q').addEventListener('input', renderResults);
$('q').addEventListener('focus', renderResults);
$('qClear').onclick = () => { $('q').value = ''; renderResults(); $('q').focus(); };
$('searchForm').onsubmit = e => { e.preventDefault(); const b = $('results').querySelector('.res'); if (b) b.click(); };

/* ---------- where I am ---------- */
$('meBtn').onclick = () => {
  if (!navigator.geolocation) return;
  $('meBtn').setAttribute('aria-pressed', 'true');
  navigator.geolocation.getCurrentPosition(p => {
    me = [p.coords.latitude, p.coords.longitude]; renderCards();
    const near = [...DATA.D].sort((a, b) => km(me, [a.lat, a.lon]) - km(me, [b.lat, b.lon]))[0];
    fit([me, [near.lat, near.lon]], 70, 13); $('cards').scrollLeft = 0;
  }, () => { $('meBtn').setAttribute('aria-pressed', 'false'); }, {enableHighAccuracy: false, timeout: 15000, maximumAge: 300000});
};

/* ---------- start: back from a destination returns to the same view ---------- */
function remember() { try { sessionStorage.setItem('tpnl-portal-vista', JSON.stringify({x: view.x, y: view.y, z: view.z, sel: sel && sel.c, q: $('q').value, mode})); } catch (e) {} }
addEventListener('pagehide', remember);
NLM.init({root: './', onFavMap: () => setMode('fav', true)}); // the ☰ menu (O-066)
async function start() {
  updateNet(); resize();
  try { DATA = await (await fetch('cerca.json')).json(); } catch (e) { $('cards').innerHTML = '<p class="none">No s’han pogut carregar els destins. Torna-ho a provar amb connexió.</p>'; return; }
  TRK = new Map(DATA.T.map(t => [t.c + '/' + t.id, t]));
  renderCards();
  let v = null; try { v = JSON.parse(sessionStorage.getItem('tpnl-portal-vista')); } catch (e) {}
  syncFavChip();
  if (location.hash === '#favorits') { history.replaceState(null, '', location.pathname + location.search); setMode('fav', true); return; }
  if (v && isFinite(v.z)) { Object.assign(view, {x: v.x, y: v.y, z: v.z}); sel = v.sel ? destOf(v.sel) || null : null; if (v.mode === 'rut' || (v.mode === 'fav' && NLM.favs().length)) setMode(v.mode, false); else renderCards(); if (v.q) { $('q').value = v.q; $('qClear').hidden = false; } draw(); }
  else fit(DATA.D.map(d => [d.lat, d.lon]), 60, 11);
}
start();
