/* Natura Local – destination prototype (Gualba): every visit, service and route on one map, plus a guide.
   Data: data.json (from naturalocal.net, built by scripts/prepara_dades.py). Base map: OpenStreetMap, ICGC
   topographic map or ICGC orthophoto, loaded online; sw.js keeps the ICGC tiles and photos that have been seen.
   Icons: icones.js (Maki, CC0, and the Natura Local route signpost). */
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
// OSM tiles: allowed for light use with attribution (operations.osmfoundation.org/policies/tiles);
// not for heavy traffic or offline download, so the final app needs its own tiles or a provider.
const LAYERS = {
  osm: {name: 'OpenStreetMap', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, attr: '© col·laboradors d’OpenStreetMap'},
  topo: {name: 'Topogràfic ICGC', url: (z, x, y) => `https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/topo/GRID3857/${z}/${x}/${y}.jpeg`, max: 18, attr: '© ICGC'},
  orto: {name: 'Ortofoto ICGC', url: (z, x, y) => `https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/orto/GRID3857/${z}/${x}/${y}.jpeg`, max: 19, attr: '© ICGC'},
};
// One colour per route (pin, line and guide card), distinct from the map colours.
const ROUTE_COLS = ['#d7263d', '#1b6ca8', '#f46036', '#7b2cbf', '#00838f', '#c2185b', '#2e7d32', '#8d6e00', '#3949ab', '#6d4c41'];
// Groups shown as filters; services are grouped by their category.
const GROUPS = {
  ruta: {label: 'Rutes', col: '#69920c', ink: '#fff'},
  visita: {label: 'Visites', col: '#e9bc00', ink: '#322820'},
  menjar: {label: 'Menjar', col: '#c4541c', ink: '#fff'},
  dormir: {label: 'Dormir', col: '#5b4a3b', ink: '#fff'},
  altres: {label: 'Altres serveis', col: '#1f6f8b', ink: '#fff'},
};
// Icon of each resource: by its name when it says what it is, otherwise by its category.
const ICON_BY_NAME = [[/esgl[eé]sia|ermita|bas[ií]lica/i, 'religious-christian'], [/pont/i, 'bridge'], [/salt/i, 'waterfall'], [/gorg/i, 'natural'],
  [/mol[ií]|farga|forn de cal/i, 'town-hall'], [/can figueres/i, 'castle'], [/platg/i, 'beach'], [/port|n[aà]utic/i, 'harbor'], [/museu/i, 'museum'],
  [/piscina/i, 'swimming'], [/roc[oò]drom/i, 'mountain'], [/mercat/i, 'grocery'], [/c[aà]mping/i, 'campsite'],
  [/parc/i, 'park'], [/forn/i, 'bakery'], [/informaci/i, 'information']];
const ICON_BY_CAT = {arquitectura: 'town-hall', paisatges: 'mountain', indrets: 'viewpoint', medi: 'natural', museus: 'museum', altres: 'viewpoint',
  menjar: 'restaurant', dormir: 'lodging', 'producte-local': 'shop', 'lleure-actiu': 'park', ruta: 'ruta'};
const GROUP_ICON = {ruta: 'ruta', visita: 'town-hall', menjar: 'restaurant', dormir: 'lodging', altres: 'information'};
const iconOf = it => it.g === 'ruta' ? 'ruta' : (ICON_BY_NAME.find(([re]) => re.test(it.n)) || [, ICON_BY_CAT[it.cat] || 'viewpoint'])[1];
const PATHS = Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.d.map(d => new Path2D(d))]));
function svgIcon(name, col = 'currentColor', size = 18) {
  const ic = ICONS[name], vb = Array.isArray(ic.vb) ? ic.vb.join(' ') : `0 0 ${ic.vb} ${ic.vb}`;
  return `<svg class="ico" viewBox="${vb}" width="${size}" height="${size}" aria-hidden="true">${ic.d.map(d => `<path d="${d}" fill="${col}"/>`).join('')}</svg>`;
}
function drawIcon(name, cx, cy, size, col) { // centred on (cx, cy)
  const ic = ICONS[name], [x0, y0, w, h] = Array.isArray(ic.vb) ? ic.vb : [0, 0, ic.vb, ic.vb], k = size / Math.max(w, h);
  ctx.save(); ctx.translate(cx - w * k / 2, cy - h * k / 2); ctx.scale(k, k); ctx.translate(-x0, -y0); ctx.fillStyle = col;
  for (const p of PATHS[name]) ctx.fill(p);
  ctx.restore();
}
const CAT_NAME = {arquitectura: 'Arquitectura', paisatges: 'Paisatge', indrets: 'Indret', medi: 'Medi', museus: 'Museu', altres: 'Indret',
  menjar: 'Menjar', dormir: 'Dormir', 'producte-local': 'Producte local', 'lleure-actiu': 'Lleure actiu'};
const NEAR_TRACK = 40;
let D = null, ITEMS = [], filter = 'tot';
const colOf = it => it.g === 'ruta' ? it.col : GROUPS[it.g].col;

/* ---------- connection ---------- */
function updateNet() { const on = navigator.onLine; $('net').textContent = on ? 'Amb connexió' : 'Sense connexió'; $('net').classList.toggle('off', !on); }
addEventListener('online', () => { updateNet(); tiles.clear(); draw(); });
addEventListener('offline', updateNet);
document.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);
if ('serviceWorker' in navigator) {
  // A new version installs in the background: show it straight away (not at the next opening), unless navigating or reading a sheet.
  const c0 = navigator.serviceWorker.controller, hadWorker = !!c0 && c0.scriptURL === new URL('sw.js', location.href).href; // a parent app's worker does not count
  let reloading = false, swReg = null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker || reloading || nav || !$('sheet').hidden) return;
    reloading = true; location.reload();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {}); });
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
}

/* ---------- geometry (local metres around the destination) ---------- */
let LAT0 = 0, LON0 = 0, KX = 0;
const KY = 110574;
const toXY = (lat, lon) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const toLL = ([x, y]) => [y / KY + LAT0, x / KX + LON0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const fmtM = m => m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m) + ' m';

/* ---------- data ---------- */
function prepare() {
  const pts = [...D.V, ...D.S, ...D.R].map(i => [i.lat, i.lon]);
  LAT0 = pts.reduce((s, p) => s + p[0], 0) / pts.length; LON0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
  const svc = c => c === 'menjar' || c === 'dormir' ? c : 'altres';
  ITEMS = [
    ...D.R.map((r, k) => ({...r, g: 'ruta', cat: 'ruta', col: ROUTE_COLS[k % ROUTE_COLS.length]})),
    ...D.V.map(v => ({...v, g: 'visita'})),
    ...D.S.map(s => ({...s, g: svc(s.cat)})),
  ].map((it, i) => {
    it.i = i; [it.x, it.y] = toXY(it.lat, it.lon);
    if (it.trk) { it.tr = it.trk.map(p => toXY(p[0], p[1])); it.cum = [0]; for (let k = 1; k < it.tr.length; k++) it.cum.push(it.cum[k - 1] + dist(it.tr[k - 1], it.tr[k])); it.len = it.cum[it.cum.length - 1]; }
    return it;
  });
}
const shown = it => filter === 'tot' || it.g === filter;
const catLabel = it => it.g === 'ruta' ? 'Ruta' : CAT_NAME[it.cat] || it.cat;
const byName = Object.create(null);
const plain = html => { const t = document.createElement('div'); t.innerHTML = html; return t.textContent.trim(); };

/* ---------- filters ---------- */
function renderChips() {
  const n = g => ITEMS.filter(i => i.g === g).length;
  $('chips').innerHTML = [['tot', 'Tot', ITEMS.length], ...Object.entries(GROUPS).map(([g, v]) => [g, v.label, n(g)])]
    .filter(c => c[2]).map(([g, l, c]) => `<button data-g="${g}" aria-pressed="${g === filter}">${g === 'tot' ? '' : `<span class="dot" style="background:${GROUPS[g].col}">${svgIcon(GROUP_ICON[g], '#fff', 12)}</span>`}${l}<small>${c}</small></button>`).join('');
}
$('chips').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.g; renderChips(); renderGuide(); hidePop(); draw();
};

/* ---------- tabs ---------- */
function showTab(map) {
  $('tMapa').setAttribute('aria-selected', map); $('tGuia').setAttribute('aria-selected', !map);
  $('vMapa').hidden = !map; $('vGuia').hidden = map;
  if (map) requestAnimationFrame(resize);
}
$('tMapa').onclick = () => showTab(true); $('tGuia').onclick = () => showTab(false);

/* ---------- guide ---------- */
// Dots under a gallery: one per photo, the current one longer, so it is clear that you can swipe (Toribio, 11/11/2026).
function setDots(el, n) { el.hidden = n < 2; el.innerHTML = '<i class="on"></i>' + '<i></i>'.repeat(Math.max(0, n - 1)); }
function moveDots(el, g) { const k = Math.round(g.scrollLeft / (g.clientWidth || 1)); el.querySelectorAll('i').forEach((x, j) => x.classList.toggle('on', j === k)); }
function gallery(el, pics) { el.innerHTML = pics.map(([f, c]) => `<img src="${f}" alt="${esc(c)}" loading="lazy">`).join(''); el.scrollLeft = 0; }
function renderGuide() {
  const sec = (g, title) => {
    const list = ITEMS.filter(i => i.g === g && shown(i)); if (!list.length) return '';
    return `<h2 class="gsec">${title}<small>${list.length}</small></h2><ul class="cards">${list.map(it => {
      const th = it.pics[0] ? `<span class="thw"><img src="${it.pics[0][0]}" alt="" loading="lazy"><span class="dot" style="background:${colOf(it)}">${svgIcon(iconOf(it), '#fff', 13)}</span></span>`
        : `<span class="ph" style="background:${colOf(it)}">${svgIcon(iconOf(it), '#fff', 32)}</span>`;
      const sub = it.g === 'ruta' ? [it.km + ' km', it.dur, it.dif].join(' · ') : plain(it.desc[0] || '').slice(0, 70) + '…';
      return `<li><button data-i="${it.i}">${th}<span><small>${esc(catLabel(it))}</small><b>${esc(it.n)}</b><span class="sub">${esc(sub)}</span></span><span class="chev">›</span></button></li>`;
    }).join('')}</ul>`;
  };
  // the editorial parts (plans, calendar, local, did you know) only exist for some destinations (dades/guia.json),
  // and each part is optional
  const G = D.G, f = filter === 'tot' && G;
  $('guide').innerHTML = (f ? (G.proposta ? '<span class="flag lead-flag">Textos de la guia: proposta nova per revisar</span>' : '')
      + `<p class="lead">${G.intro}</p>` + (G.plans ? `<h2 class="gsec">Què fer segons el temps que tinguis</h2>${G.plans.map(plan).join('')}` : '') : '')
    + sec('ruta', 'Rutes') + sec('visita', 'Què visitar') + sec('menjar', 'On menjar') + sec('dormir', 'On dormir') + sec('altres', 'Altres serveis')
    + (f ? (G.calendari ? calendar() : '')
      + (G.local ? `<h2 class="gsec">${esc(G.local.titol || 'Producte local i on menjar')}</h2>${steps(G.local.passos)}`
        + (G.local.esborrany ? `<div class="draft"><span class="flag">Esborrany per validar amb l'Ajuntament</span>${G.local.esborrany}</div>` : '') : '')
      + (G.sabies ? `<div class="know"><h3>Sabies que…?</h3><p>${G.sabies}</p></div>` : '') : '');
}
// «What to do» plans from the first prototype: each one unfolds into an ordered list of places.
function steps(list) {
  return `<ol class="steps">${list.map(([name, note], k) => { const it = byName[name];
    return `<li><button data-i="${it.i}"><span class="n">${k + 1}</span><span class="ph sm" style="background:${colOf(it)}">${svgIcon(iconOf(it), '#fff', 16)}</span><span><b>${esc(it.n)}</b><span class="sub">${esc(note)}</span></span><span class="chev">›</span></button></li>`; }).join('')}</ol>`;
}
function plan(p) {
  return `<details class="plan"><summary><span class="badge">${esc(p.badge)}</span><span class="pt">${esc(p.titol)}</span><span class="chev">⌄</span></summary>
    ${p.proposta ? '<span class="flag">Proposta nova per revisar</span>' : ''}<p class="muted">${esc(p.intro)}</p>${steps(p.passos)}</details>`;
}
function calendar() {
  const c = D.G.calendari, f = c.fira;
  return `<h2 class="gsec">Quan anar-hi</h2>` + (f ? `<article class="fira"><img src="${f.foto}" alt="${esc(f.alt)}" loading="lazy"><div class="pad-s"><span class="flag">${esc(f.quan)}</span><h3>${esc(f.titol)}</h3><p>${esc(f.text)}</p><small>${f.fonts}</small></div></article>` : '')
    + `<ul class="when">${c.dates.map(([q, t]) => `<li><b>${esc(q)}</b><span>${esc(t)}</span></li>`).join('')}</ul>`;
}
$('guide').onclick = e => { const b = e.target.closest('button[data-i]'); if (b) openSheet(+b.dataset.i); };

/* ---------- detail sheet ---------- */
function openSheet(i) {
  const it = ITEMS[i];
  gallery($('shGal'), it.pics);
  setDots($('shDots'), it.pics.length);
  $('shTheme').innerHTML = `<span class="dot" style="background:${colOf(it)}">${svgIcon(iconOf(it), '#fff', 12)}</span>${esc(catLabel(it))}`;
  $('shDist').textContent = me ? 'A ' + fmtM(dist([me.x, me.y], [it.x, it.y])) + ' de tu' : '';
  $('shTitle').textContent = it.n;
  const facts = it.g === 'ruta' ? [['Distància', it.km + ' km'], ['Durada', it.dur], ['Desnivell', it.des], ['Dificultat', it.dif], ['Tipologia', it.tip], ['Temàtica', it.tema]].filter(f => f[1]) : [];
  $('shFacts').innerHTML = facts.map(([k, v]) => `<div${k === 'Temàtica' ? ' class="wide"' : ''}><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  const acts = [];
  // routes with their own route app (points of interest, download): link to it; otherwise, the simple navigation here
  if (it.app) acts.push(`<a class="btn primary grow" href="${it.app}">Navega la ruta</a><p class="appnote">${it.pts} punts d'interès. Des d'allà també la pots descarregar per anar sense cobertura.</p>`);
  else if (it.g === 'ruta') acts.push(`<button class="primary grow" id="aNav">Navega la ruta</button>`);
  if (it.tel) acts.push(`<a class="btn" href="tel:${esc(it.tel)}">📞 Truca</a>`);
  acts.push(`<button id="aMap">Veure al mapa</button>`);
  if (it.url) acts.push(`<a class="btn" href="${esc(it.url)}" target="_blank" rel="noopener">Veure la fitxa a Natura Local ↗</a>`);
  $('shActions').innerHTML = acts.join('');
  if ($('aNav')) $('aNav').onclick = () => { closeSheet(); startNav(it); };
  const appLink = $('shActions').querySelector('a.primary');
  if (appLink) appLink.onclick = rememberView;
  $('aMap').onclick = () => { closeSheet(); showOnMap(it); };
  $('shBody').innerHTML = it.g === 'ruta' ? routeText(it) : (it.desc || []).map(p => `<p>${p}</p>`).join('');
  $('sheet').hidden = false; $('sheet').querySelector('.sheet-in').scrollTop = 0;
}
$('shGal').addEventListener('scroll', () => moveDots($('shDots'), $('shGal')), {passive: true});
$('dGal').addEventListener('scroll', () => moveDots($('dDots'), $('dGal')), {passive: true});
function closeSheet() { $('sheet').hidden = true; }
// Text of a route as on the web: title of the introduction, the description folded under «Llegeix-ne més»,
// and the advice by sections (Traçat, Aigua…) with their points, folded too (Toribio, 11/11/2026).
const CHEV = '<svg class="chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function routeText(it) {
  const intro = (it.intro || []).map(p => `<p>${p}</p>`).join('');
  let h = (it.introTitle ? `<h3 class="rtitle">${esc(it.introTitle)}</h3>` : '')
    + (intro ? `<div class="readmore"><div class="rm-text">${intro}</div><button class="rm-btn" type="button"><span>Llegeix-ne més</span>${CHEV}</button></div>` : '');
  if (it.consells && it.consells.length) {
    h += `<details class="fold"><summary>Consells${CHEV}</summary>${it.consells.map(c =>
      (c.t ? `<h4>${esc(c.t)}</h4>` : '') + `<ul>${c.p.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}</details>`;
  } else if (it.desc && it.desc.length) { // destinations read without sections (Gualba): the rest of the text, folded
    h += `<details class="fold"><summary>Més informació${CHEV}</summary>${it.desc.map(p => `<p>${p}</p>`).join('')}</details>`;
  }
  return h;
}
$('shBody').addEventListener('click', e => {
  const b = e.target.closest('.rm-btn'); if (!b) return;
  const open = b.parentElement.classList.toggle('open'); b.querySelector('span').textContent = open ? 'Mostra\'n menys' : 'Llegeix-ne més';
});
// Going into a route app and back: same sheet, same tab and same filter as when leaving.
function rememberView() { try { sessionStorage.setItem('nl-desti-vista', JSON.stringify({guia: !$('vGuia').hidden, filter})); } catch (e) {} }
function restoreView() {
  const id = location.hash.slice(1); if (!id) return;
  history.replaceState(null, '', location.pathname + location.search);
  let v = null; try { v = JSON.parse(sessionStorage.getItem('nl-desti-vista')); } catch (e) {}
  if (v && v.filter && (v.filter === 'tot' || ITEMS.some(i => i.g === v.filter))) { filter = v.filter; renderChips(); renderGuide(); draw(); }
  if (v && v.guia) showTab(false);
  const it = ITEMS.find(i => i.g === 'ruta' && String(i.id) === id);
  if (it) openSheet(it.i);
}
$('shClose').onclick = closeSheet;
$('sheet').onclick = e => { if (e.target === $('sheet')) closeSheet(); };

/* ---------- map ---------- */
const cv = $('map'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, layer = 'topo', sel = null;
const view = {cx: 0, cy: 0, s: 0.1};
function resize() { const r = cv.getBoundingClientRect(); DPR = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * DPR; cv.height = H * DPR; draw(); }
addEventListener('resize', () => { if (!$('vMapa').hidden) resize(); });
let dirty = false;
function draw() { if (!dirty && W) { dirty = true; requestAnimationFrame(paint); } }
const w2s = (x, y) => [(x - view.cx) * view.s + W / 2, (view.cy - y) * view.s + H / 2];
const s2w = (sx, sy) => [(sx - W / 2) / view.s + view.cx, view.cy - (sy - H / 2) / view.s];
// tiles
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const tx2lon = (x, z) => x / 2 ** z * 360 - 180;
const ty2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };
const tiles = new Map();
function tile(z, x, y) {
  const url = LAYERS[layer].url(z, x, y); let t = tiles.get(url);
  if (!t) { t = {img: new Image(), ok: false}; t.img.crossOrigin = 'anonymous'; t.img.onload = () => { t.ok = true; draw(); }; t.img.src = url; tiles.set(url, t); }
  return t;
}
function paintTiles() {
  const mpp = 1 / (view.s * DPR);
  const z = Math.max(8, Math.min(LAYERS[layer].max, Math.round(Math.log2(156543.03 * Math.cos(LAT0 * Math.PI / 180) / mpp))));
  const [la0, lo0] = toLL(s2w(0, H)), [la1, lo1] = toLL(s2w(W, 0));
  const x0 = Math.floor(lon2tx(lo0, z)), x1 = Math.floor(lon2tx(lo1, z)), y0 = Math.floor(lat2ty(la1, z)), y1 = Math.floor(lat2ty(la0, z));
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 100) return;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    let t = tile(z, x, y), sx = 0, sy = 0, sw = 256;
    for (let up = 1; !t.ok && up <= 4; up++) { // parent tile, enlarged, while the right one loads
      const f = 2 ** up, px = Math.floor(x / f), py = Math.floor(y / f), c = tile(z - up, px, py);
      if (c.ok) { t = c; sw = 256 / f; sx = (x - px * f) * sw; sy = (y - py * f) * sw; }
    }
    if (!t.ok) continue;
    const [ax, ay] = w2s(...toXY(ty2lat(y, z), tx2lon(x, z))), [bx, by] = w2s(...toXY(ty2lat(y + 1, z), tx2lon(x + 1, z)));
    ctx.drawImage(t.img, sx, sy, sw, sw, ax - 0.5, ay - 0.5, bx - ax + 1, by - ay + 1);
  }
}
function pathOf(tr) { ctx.beginPath(); tr.forEach((p, k) => { const [x, y] = w2s(p[0], p[1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); }
function at(it, d) {
  for (let k = 1; k < it.tr.length; k++) if (it.cum[k] >= d) { const t = (d - it.cum[k - 1]) / ((it.cum[k] - it.cum[k - 1]) || 1); return [it.tr[k - 1][0] + t * (it.tr[k][0] - it.tr[k - 1][0]), it.tr[k - 1][1] + t * (it.tr[k][1] - it.tr[k - 1][1])]; }
  return it.tr[it.tr.length - 1];
}
function paint() {
  dirty = false;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = layer === 'orto' ? '#4b4a3f' : '#e8e4da'; ctx.fillRect(0, 0, W, H);
  paintTiles();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // routes: all thin when routes are shown, the selected one gold with direction arrows
  // while navigating, the other routes are hidden so the map stays clean
  const routes = nav ? [] : ITEMS.filter(i => i.g === 'ruta' && shown(i));
  for (const r of routes) if (r !== sel) { pathOf(r.tr); ctx.strokeStyle = '#fffd'; ctx.lineWidth = 6.5; ctx.stroke(); ctx.strokeStyle = r.col; ctx.lineWidth = 3.5; ctx.stroke(); }
  if (sel && sel.tr) {
    pathOf(sel.tr); ctx.strokeStyle = '#fff'; ctx.lineWidth = 11; ctx.stroke(); ctx.strokeStyle = sel.col; ctx.lineWidth = 6.5; ctx.stroke();
    if (walked > 0 && nav === sel) { ctx.beginPath(); let first = true; for (let k = 0; k < sel.tr.length && sel.cum[k] <= walked; k++) { const [x, y] = w2s(...sel.tr[k]); first ? ctx.moveTo(x, y) : ctx.lineTo(x, y); first = false; } ctx.lineTo(...w2s(...at(sel, walked))); ctx.strokeStyle = '#69920c'; ctx.lineWidth = 5.5; ctx.stroke(); }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.6;
    for (let d = 27 / view.s; d < sel.len; d += 55 / view.s) {
      const a = w2s(...at(sel, d)), b = w2s(...at(sel, Math.min(sel.len, d + 2)));
      if (a[0] < -20 || a[1] < -20 || a[0] > W + 20 || a[1] > H + 20) continue;
      ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
      ctx.beginPath(); ctx.moveTo(-3.5, -4.6); ctx.lineTo(2.5, 0); ctx.lineTo(-3.5, 4.6); ctx.stroke(); ctx.restore();
    }
  }
  // pins (routes at their start); the selected one bigger and on top
  const pins = ITEMS.filter(i => (shown(i) && !(nav && i.g === 'ruta')) || i === sel).sort((a, b) => (a === sel) - (b === sel) || b.y - a.y);
  for (const it of pins) {
    const [x, y] = w2s(it.x, it.y), k = it === sel ? 1.3 : 1;
    if (x < -30 || y < -10 || x > W + 30 || y > H + 50) continue;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-5, -9, -14, -14, -14, -24); ctx.arc(0, -24, 14, Math.PI, 0); ctx.bezierCurveTo(14, -14, 5, -9, 0, 0); ctx.closePath();
    ctx.shadowColor = '#0006'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1; ctx.fillStyle = colOf(it); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    drawIcon(iconOf(it), 0, -24, 16, '#fff'); ctx.restore();
  }
  if (me) {
    const [x, y] = w2s(me.x, me.y);
    ctx.fillStyle = 'rgba(26,115,232,.15)'; ctx.beginPath(); ctx.arc(x, y, Math.max(10, Math.min(me.acc * view.s, 150)), 0, 7); ctx.fill();
    ctx.fillStyle = '#1a73e8'; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
  }
}
function fit(pts, pad = 60) {
  let x0 = 1e12, x1 = -1e12, y0 = 1e12, y1 = -1e12;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2;
  view.s = Math.min(4, (W - pad * 2) / (x1 - x0 || 1), (H - pad * 2 - 40) / (y1 - y0 || 1)); draw();
}
const fitAll = () => fit(ITEMS.flatMap(i => i.tr ? [[i.x, i.y], ...i.tr] : [[i.x, i.y]]), 30);
function zoom(f, sx = W / 2, sy = H / 2) { const a = s2w(sx, sy); view.s = Math.max(0.01, Math.min(8, view.s * f)); const b = s2w(sx, sy); view.cx += a[0] - b[0]; view.cy += a[1] - b[1]; draw(); }
$('zin').onclick = () => zoom(1.6); $('zout').onclick = () => zoom(1 / 1.6);
$('layerBtn').onclick = () => { $('layerMenu').hidden = !$('layerMenu').hidden; };
function setLayer(l) {
  layer = l; $('attr').textContent = LAYERS[l].attr; $('layerMenu').hidden = true;
  $('layerMenu').innerHTML = Object.entries(LAYERS).map(([k, v]) => `<button data-l="${k}" aria-pressed="${k === l}">${v.name}</button>`).join('');
  draw();
}
$('layerMenu').onclick = e => { const b = e.target.closest('button'); if (b) setLayer(b.dataset.l); };
// gestures
const ptrs = new Map(); let pinch0 = null, downXY = null, downAt = 0;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); downXY = [e.offsetX, e.offsetY]; downAt = Date.now(); if (ptrs.size === 2) pinch0 = {d: pinchDist(), s: view.s}; });
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId), cur = [e.offsetX, e.offsetY]; ptrs.set(e.pointerId, cur);
  if (ptrs.size === 1) { follow = false; view.cx -= (cur[0] - prev[0]) / view.s; view.cy += (cur[1] - prev[1]) / view.s; draw(); }
  else if (ptrs.size === 2 && pinch0) { view.s = Math.max(0.01, Math.min(8, pinch0.s * pinchDist() / pinch0.d)); draw(); }
});
const endPtr = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; };
cv.addEventListener('pointerup', e => { const tap = ptrs.size === 1 && downXY && Math.hypot(e.offsetX - downXY[0], e.offsetY - downXY[1]) < 8 && Date.now() - downAt < 350; endPtr(e); if (tap) tapAt(e.offsetX, e.offsetY); });
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.25 : 0.8, e.offsetX, e.offsetY); }, {passive: false});
function pinchDist() { const [a, b] = [...ptrs.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; }
function tapAt(x, y) {
  let best = null, bd = 26;
  for (const it of ITEMS) if (shown(it) || it === sel) { const [sx, sy] = w2s(it.x, it.y), d = Math.hypot(sx - x, sy - 24 - y); if (d < bd) { bd = d; best = it; } }
  if (!best && (filter === 'tot' || filter === 'ruta')) { // a tap on a route line selects that route
    let bt = 14; for (const r of ITEMS.filter(i => i.tr && shown(i))) for (const p of r.tr) { const [sx, sy] = w2s(...p), d = Math.hypot(sx - x, sy - y); if (d < bt) { bt = d; best = r; } }
  }
  if (best) showPop(best); else if (!nav) hidePop();
}

/* ---------- small card on the map ---------- */
function showPop(it) {
  sel = it; const p = $('pop');
  const d = me ? ' · a ' + fmtM(dist([me.x, me.y], [it.x, it.y])) : '';
  const txt = it.g === 'ruta' ? [it.km + ' km', it.dur, it.des, it.dif].join(' · ') : plain(it.desc[0] || '').slice(0, 140);
  p.innerHTML = `<span class="t"><span class="dot" style="background:${colOf(it)}">${svgIcon(iconOf(it), '#fff', 12)}</span>${esc(catLabel(it))}${d}</span><h3>${esc(it.n)}</h3>${txt ? `<p>${esc(txt)}</p>` : ''}
    <div class="row"><button class="primary grow" id="pMore">Més informació ›</button>${it.app ? `<a class="btn" href="${it.app}">Navega</a>` : it.g === 'ruta' ? '<button id="pNav">Navega</button>' : ''}<button id="pClose" aria-label="Tanca">×</button></div>`;
  p.hidden = nav != null;
  $('pMore').onclick = () => openSheet(it.i);
  if ($('pNav')) $('pNav').onclick = () => startNav(it);
  $('pClose').onclick = hidePop;
  draw();
}
function hidePop() { $('pop').hidden = true; if (!nav) sel = null; draw(); }
function showOnMap(it) {
  showTab(true); hidePop();
  requestAnimationFrame(() => { if (it.tr) fit(it.tr); else { view.cx = it.x; view.cy = it.y; view.s = Math.max(view.s, 1.2); } showPop(it); });
}

/* ---------- position and route navigation ---------- */
let me = null, gpsWatch = null, follow = false, nav = null, walked = 0, maxAlong = 0, started = false, simTimer = null;
function onPosition(lat, lon, acc, src) {
  const [x, y] = toXY(lat, lon); me = {x, y, acc: acc || 5};
  if (nav) {
    let off = Infinity, along = 0;
    for (let k = 1; k < nav.tr.length; k++) {
      const a = nav.tr[k - 1], b = nav.tr[k], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)), d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      if (d < off) { off = d; along = nav.cum[k - 1] + t * Math.sqrt(L2); }
    }
    if (off <= NEAR_TRACK) { if (!started) { started = true; maxAlong = along; } else if (along >= maxAlong - 30 && along <= maxAlong + 150) maxAlong = Math.max(maxAlong, along); }
    walked = maxAlong;
    $('offroute').hidden = off <= NEAR_TRACK;
    $('progBar').style.width = (100 * walked / nav.len) + '%';
    $('sDone').textContent = fmtM(walked); $('sLeft').textContent = fmtM(Math.max(0, nav.len - walked)); $('sOff').textContent = fmtM(off);
    if (src === 'gps') $('gpsNote').textContent = `GPS: precisió ±${Math.round(acc)} m`;
  }
  if (follow) { view.cx = x; view.cy = y; }
  draw();
}
function startGps() {
  if (gpsWatch != null || !('geolocation' in navigator)) return;
  $('gpsNote').textContent = 'Buscant el GPS…';
  gpsWatch = navigator.geolocation.watchPosition(g => onPosition(g.coords.latitude, g.coords.longitude, g.coords.accuracy, 'gps'),
    err => { $('gpsNote').textContent = 'GPS: ' + ({1: 'permís denegat. Activa la ubicació per a aquesta web.', 2: 'sense senyal.', 3: 'continua buscant…'}[err.code] || err.message); },
    {enableHighAccuracy: true, maximumAge: 2000, timeout: 20000});
}
$('meBtn').onclick = () => {
  startGps(); follow = !follow || !me; $('meBtn').setAttribute('aria-pressed', follow);
  if (me && follow) { view.cx = me.x; view.cy = me.y; view.s = Math.max(view.s, 1); draw(); }
};
function startNav(it) {
  closeSheet(); showTab(true); nav = sel = it; walked = maxAlong = 0; started = false;
  $('pop').hidden = true; $('navBar').hidden = false; $('navName').textContent = it.n;
  $('progBar').style.width = '0'; $('sDone').textContent = '0 m'; $('sLeft').textContent = fmtM(it.len); $('sOff').textContent = '–';
  requestAnimationFrame(() => { fit(it.tr, 40); startGps(); follow = true; $('meBtn').setAttribute('aria-pressed', true); });
}
$('navStop').onclick = () => { nav = null; stopSim(); $('navBar').hidden = true; $('offroute').hidden = true; walked = 0; if (sel) showPop(sel); };
function stopSim() { if (simTimer) { clearInterval(simTimer); simTimer = null; } }
$('simBtn').onclick = () => simTimer ? stopSim() : simulate();
// Walks the route by itself (4× walking speed), to try the navigation at home.
function simulate() {
  if (gpsWatch != null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; }
  stopSim(); let d = 0; follow = true; view.s = Math.max(view.s, 1.2);
  $('gpsNote').textContent = 'Simulació: camina sola pel track (4 vegades més ràpid).';
  simTimer = setInterval(() => { d += 2.8; if (!nav || d >= nav.len) { stopSim(); if (!nav) return; d = nav.len; } const [lat, lon] = toLL(at(nav, d)); onPosition(lat, lon, 5, 'sim'); }, 500);
}

/* ---------- start ---------- */
(async function init() {
  updateNet();
  try { D = await fetch('data.json').then(r => r.json()); }
  catch (e) { document.body.insertAdjacentHTML('beforeend', '<p class="miss pad">No s\'han pogut carregar les dades. Obre-la amb connexió la primera vegada.</p>'); return; }
  prepare(); for (const it of ITEMS) byName[it.n] = it;
  setLayer('osm');
  $('dName').textContent = D.D.nom; document.title = 'Natura Local · ' + D.D.nom;
  gallery($('dGal'), D.D.pics); setDots($('dDots'), D.D.pics.length);
  renderChips(); renderGuide();
  resize(); fitAll();
  restoreView();
})();
