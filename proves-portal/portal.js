/* Natura Local – portal prototype (O-033): every destination on one map, a search of towns, routes and places, and links
   into each destination app (../<folder>/), which has a way back here. Data: cerca.json, built by portal/scripts/genera.py
   from each destination's data.json. Base map: ICGC topographic map (online). */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[·.'’\-]/g, ' ').replace(/\s+/g, ' ');
const GROUPS = {
  ruta: {label: 'Ruta', col: '#69920c'}, visita: {label: 'Visita', col: '#e9bc00'}, menjar: {label: 'Menjar', col: '#c4541c'},
  dormir: {label: 'Dormir', col: '#5b4a3b'}, altres: {label: 'Servei', col: '#1f6f8b'},
};
const TILE = (z, x, y) => `https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/topo/GRID3857/${z}/${x}/${y}.jpeg`;
const ITEMS_FROM_Z = 11.5; // routes and places show from here; below, only the destinations
let DATA = {D: [], I: [], T: []}, sel = null, popItem = null, me = null;

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
  dirty = false; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#e8e2d2'; ctx.fillRect(0, 0, W, H);
  paintTiles();
  if (showItems()) {
    ctx.lineJoin = ctx.lineCap = 'round';
    for (const t of DATA.T) {
      ctx.beginPath(); t.tr.forEach((p, k) => { const [x, y] = ll2s(p[0], p[1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      const on = popItem && popItem.id === t.id;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = on ? 8 : 6; ctx.stroke(); ctx.strokeStyle = on ? '#e8590c' : '#69920c'; ctx.lineWidth = on ? 5 : 3; ctx.stroke();
    }
    for (const it of DATA.I) {
      const [x, y] = ll2s(it.lat, it.lon); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      if (it.g === 'ruta') { pin(x, y, it === popItem ? '#e8590c' : GROUPS.ruta.col, 7); continue; }
      ctx.beginPath(); ctx.arc(x, y, it === popItem ? 8 : 6, 0, 7); ctx.fillStyle = GROUPS[it.g].col; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
  for (const d of DATA.D) {
    const [x, y] = ll2s(d.lat, d.lon), big = d === sel;
    if (showItems()) { label(d.n, x, y + 4, true); continue; } // close up, the town's name is enough
    pin(x, y, big ? '#e8590c' : '#322820', big ? 12 : 10);
    ctx.beginPath(); ctx.arc(x, y - (big ? 21.6 : 18), big ? 4.5 : 3.8, 0, 7); ctx.fillStyle = '#e9bc00'; ctx.fill();
    label(d.n, x, y + 4, big);
  }
  if (popItem) { // the chosen place, on top of everything, so it is clear which one it is
    const [x, y] = ll2s(popItem.lat, popItem.lon); pin(x, y, '#e8590c', 13);
    ctx.beginPath(); ctx.arc(x, y - 23.4, 5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
  }
  if (me) { const [x, y] = ll2s(me[0], me[1]); ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fillStyle = '#1b6ca8'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); }
}
function fit(pts, pad = 50, maxZ = 15) {
  const xs = pts.map(p => mx(p[1])), ys = pts.map(p => my(p[0]));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  view.x = (x0 + x1) / 2; view.y = (y0 + y1) / 2;
  const bottom = $('cards').offsetHeight || 0;
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
  if (showItems()) DATA.I.forEach(it => near(it.lat, it.lon, it.g === 'ruta' ? 12 : 0, it));
  else DATA.D.forEach(d => near(d.lat, d.lon, 18, d));
  if (!best) { hidePop(); return; }
  if (best.c && best.id) showPop(best); else selectDest(best, true);
}

/* ---------- destinations, cards and pop-up ---------- */
const destOf = c => DATA.D.find(d => d.c === c);
const fmtKm = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
function km(a, b) { const R = 6371000, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function renderCards() {
  const list = [...DATA.D];
  if (me) list.sort((a, b) => km(me, [a.lat, a.lon]) - km(me, [b.lat, b.lon])); else list.sort((a, b) => a.n.localeCompare(b.n, 'ca'));
  $('cards').innerHTML = list.map(d => `<article class="pcard${d === sel ? ' on' : ''}" data-c="${esc(d.c)}">
    <img src="${esc(d.c)}/${esc(d.foto)}" alt="" loading="lazy">
    <div class="txt"><h2>${esc(d.n)}</h2>
      <p>${[d.nR && `${d.nR} ${d.nR === 1 ? 'ruta' : 'rutes'}`, d.nV && `${d.nV} ${d.nV === 1 ? 'visita' : 'visites'}`, d.nS && `${d.nS} serveis`].filter(Boolean).join(' · ')}${me ? ` · <b>a ${fmtKm(km(me, [d.lat, d.lon]))}</b>` : ''}</p>
      <a class="open" href="${esc(d.c)}/">Obre ${esc(d.n)} ›</a></div></article>`).join('');
  $('cards').querySelectorAll('.pcard').forEach(el => el.onclick = e => { if (e.target.closest('a')) return; selectDest(destOf(el.dataset.c), false); });
}
function selectDest(d, scrollCard) {
  sel = d; hidePop();
  $('cards').querySelectorAll('.pcard').forEach(el => el.classList.toggle('on', el.dataset.c === d.c));
  if (scrollCard) { const el = $('cards').querySelector(`[data-c="${CSS.escape(d.c)}"]`); if (el) el.scrollIntoView({behavior: 'smooth', inline: 'center', block: 'nearest'}); }
  flyTo(d.lat, d.lon, Math.max(view.z, 10)); remember();
}
function showPop(it) {
  popItem = it; const d = destOf(it.c), g = GROUPS[it.g];
  $('pop').innerHTML = `<span class="t" style="color:${g.col === '#e9bc00' ? '#8a6d00' : g.col}">${g.label} · ${esc(d.n)}</span><h3>${esc(it.n)}</h3>
    <div class="row"><a class="btn primary" href="${esc(it.c)}/#${encodeURIComponent(it.id)}">Obre la fitxa ›</a><button id="popClose" class="small">Tanca</button></div>`;
  $('pop').hidden = false; $('cards').hidden = true; $('popClose').onclick = hidePop; draw(); remember();
}
function hidePop() { if (!popItem && $('pop').hidden) return; popItem = null; $('pop').hidden = true; $('cards').hidden = false; draw(); }

/* ---------- search ---------- */
function search(q) {
  const f = fold(q.trim()); if (f.length < 2) return [];
  const words = f.split(/\s+/), hit = s => { const t = fold(s); return words.every(w => t.includes(w)); };
  const starts = s => fold(s).startsWith(words[0]) ? 0 : 1;
  const towns = DATA.D.filter(d => hit(d.n)).map(d => ({d, rank: starts(d.n)}));
  // a place matches by its name or by its name and its town together («ermita mataro»); the name alone ranks first
  // a place needs at least one word of its own name: the town alone does not list all its places
  const items = DATA.I.filter(it => hit(it.n + ' ' + destOf(it.c).n) && words.some(w => fold(it.n).includes(w))).map(it => ({it, rank: starts(it.n) + (it.g === 'ruta' ? 0 : 0.5) + (hit(it.n) ? 0 : 2)}));
  return [...towns.sort((a, b) => a.rank - b.rank), ...items.sort((a, b) => a.rank - b.rank || a.it.n.localeCompare(b.it.n, 'ca'))].slice(0, 40);
}
function renderResults() {
  const q = $('q').value; $('qClear').hidden = !q;
  if (q.trim().length < 2) { hideResults(); return; }
  const res = search(q);
  $('results').innerHTML = res.length ? res.map((r, k) => r.d
    ? `<button class="res" data-k="${k}"><span class="pdot town"></span><span><b>${esc(r.d.n)}</b><small>Destí · ${r.d.nR} rutes</small></span></button>`
    : `<button class="res" data-k="${k}"><span class="pdot" style="background:${GROUPS[r.it.g].col}"></span><span><b>${esc(r.it.n)}</b><small>${GROUPS[r.it.g].label} · ${esc(destOf(r.it.c).n)}</small></span></button>`).join('')
    : '<p class="none">No hi ha res amb aquest nom en aquests destins.</p>';
  $('results').hidden = false;
  $('results').querySelectorAll('.res').forEach(b => b.onclick = () => {
    const r = res[+b.dataset.k]; hideResults(); $('q').blur();
    if (r.d) selectDest(r.d, true); else { showPop(r.it); flyTo(r.it.lat, r.it.lon, Math.max(view.z, 14)); }
  });
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
function remember() { try { sessionStorage.setItem('tpnl-portal-vista', JSON.stringify({x: view.x, y: view.y, z: view.z, sel: sel && sel.c, q: $('q').value})); } catch (e) {} }
addEventListener('pagehide', remember);
async function start() {
  updateNet(); resize();
  try { DATA = await (await fetch('cerca.json')).json(); } catch (e) { $('cards').innerHTML = '<p class="none">No s’han pogut carregar els destins. Torna-ho a provar amb connexió.</p>'; return; }
  renderCards();
  let v = null; try { v = JSON.parse(sessionStorage.getItem('tpnl-portal-vista')); } catch (e) {}
  if (v && isFinite(v.z)) { Object.assign(view, {x: v.x, y: v.y, z: v.z}); sel = v.sel ? destOf(v.sel) || null : null; renderCards(); if (v.q) { $('q').value = v.q; $('qClear').hidden = false; } draw(); }
  else fit(DATA.D.map(d => [d.lat, d.lon]), 60, 11);
}
start();
