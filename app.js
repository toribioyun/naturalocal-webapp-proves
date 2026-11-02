/* Natura Local – offline route prototype (Parc Mataró gamificada).
   Data: data.json (route + points, from naturalocal.net) and basemap.json (OpenStreetMap ways).
   Offline: sw.js caches the app; "Descarrega la ruta" puts all media in the cache. */
'use strict';
const $ = id => document.getElementById(id);
const MEDIA_CACHE = 'nl-rutes';
const NEAR_M = 20, TREASURE_M = 15, OFFROUTE_M = 40;
let D = null, BASE = null;

/* ---------- diagnostics log ---------- */
const logLines = [];
function log(msg) {
  const t = new Date().toLocaleTimeString('ca-ES');
  logLines.push(t + '  ' + msg);
  if (logLines.length > 200) logLines.shift();
  const el = $('diagLog'); if (el) el.textContent = logLines.join('\n');
}
window.addEventListener('error', e => log('ERROR: ' + e.message));
log('Inici · ' + navigator.userAgent);

/* ---------- connection indicator ---------- */
function updateNet() {
  const on = navigator.onLine;
  for (const id of ['net', 'net2']) {
    const el = $(id); el.textContent = on ? 'Amb connexió' : 'Sense connexió';
    el.classList.toggle('off', !on);
  }
}
addEventListener('online', () => { updateNet(); log('Connexió: sí'); });
addEventListener('offline', () => { updateNet(); log('Connexió: no'); });

/* ---------- service worker + install ---------- */
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
$('installBtn').onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt(); const r = await installEvt.userChoice; log('Instal·lació: ' + r.outcome);
  installEvt = null; $('installBtn').hidden = true;
};
if (isIOS && !standalone) $('iosHint').hidden = false;
log('Mode app instal·lada: ' + (standalone ? 'sí' : 'no'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(r => log('Service worker registrat (' + r.scope + ')'))
    .catch(err => log('Service worker NO registrat: ' + err.message));
} else log('Aquest navegador no té service worker: no funcionarà sense connexió en reobrir.');

/* ---------- geometry helpers (local metres) ---------- */
let LAT0 = 0, LON0 = 0, KX = 0;
const KY = 110574;
const toXY = (lat, lon) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function fmtM(m) { return m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m'; }

let TR = [], CUM = [], TOTAL = 0;
function prepTrack() {
  TR = D.route.track.map(p => toXY(p[0], p[1]));
  CUM = [0];
  for (let i = 1; i < TR.length; i++) CUM.push(CUM[i - 1] + dist(TR[i - 1], TR[i]));
  TOTAL = CUM[CUM.length - 1];
}
// Nearest point on the track: distance off-route and metres along the track.
function snap(p) {
  let best = {off: Infinity, along: 0, pt: TR[0]};
  for (let i = 1; i < TR.length; i++) {
    const a = TR[i - 1], b = TR[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * dx, a[1] + t * dy], d = dist(p, q);
    if (d < best.off) best = {off: d, along: CUM[i - 1] + t * Math.sqrt(L2), pt: q};
  }
  return best;
}
function pointAt(along) {
  for (let i = 1; i < TR.length; i++) if (CUM[i] >= along) {
    const t = (along - CUM[i - 1]) / ((CUM[i] - CUM[i - 1]) || 1);
    return [TR[i - 1][0] + t * (TR[i][0] - TR[i - 1][0]), TR[i - 1][1] + t * (TR[i][1] - TR[i - 1][1])];
  }
  return TR[TR.length - 1];
}

/* ---------- points ---------- */
let POIS = [];
const isTreasure = p => /^tresor/i.test(p.name);
function mediaList() {
  const s = new Set();
  D.route.imgs.forEach(f => s.add('media/' + f));
  for (const p of D.pois) {
    [...p.imgs, ...p.video, ...p.audio].forEach(f => s.add('media/' + f));
    (p.html.match(/media\/[^"]+/g) || []).forEach(f => s.add(f));
  }
  return [...s];
}

/* ---------- home ---------- */
function renderHome() {
  const r = D.route;
  $('rTitle').textContent = r.name;
  $('heroImg').src = 'media/' + r.imgs[0];
  const chips = [r.distancia.replace('.00', ''), r.durada, 'Desnivell ' + r.desnivell.replace('.00', '').replace(' meters', ' m'), r.dificultat, r.tipus].filter(Boolean);
  $('rStats').innerHTML = chips.map(c => `<li>${esc(c)}</li>`).join('');
  $('poiList').innerHTML = POIS.map((p, i) => {
    const img = p.imgs[0] ? `<img src="media/${p.imgs[0]}" alt="" loading="lazy">` : `<span class="ph">${isTreasure(p) ? '★' : '•'}</span>`;
    const extra = [p.theme, p.audio.length ? 'àudio' : '', p.video.length ? 'vídeo' : ''].filter(Boolean).join(' · ');
    return `<li><button data-i="${i}">${img}<span><b>${i + 1}. ${esc(p.name)}</b><small>${esc(extra)}</small></span></button></li>`;
  }).join('');
  $('poiList').onclick = e => { const b = e.target.closest('button'); if (b) openSheet(+b.dataset.i); };
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

/* ---------- offline download ---------- */
async function checkOffline() {
  const files = mediaList();
  if (!('caches' in window)) { setOff(false, 'Aquest navegador no pot guardar la ruta.'); $('dlBtn').disabled = true; return; }
  const c = await caches.open(MEDIA_CACHE);
  let have = 0; for (const f of files) if (await c.match(f)) have++;
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  log(`Fitxers guardats: ${have}/${files.length}` + (est ? ` · espai usat ${(est.usage / 1e6).toFixed(1)} MB` : '') + ` · guardat persistent: ${persisted ? 'sí' : 'no'}`);
  if (have === files.length) {
    setOff(true, 'La ruta, el mapa, les fotos, els àudios i els vídeos estan guardats al mòbil. Ja pots posar el mode avió.');
    $('dlBtn').textContent = 'Torna a descarregar'; $('offBar').style.width = '100%';
  } else setOff(false, `Abans de sortir, descarrega-la amb connexió (uns 8 MB). Guardats: ${have} de ${files.length}.`);
}
function setOff(ok, txt) {
  const s = $('offState'); s.textContent = ok ? 'Preparada ✓' : 'No descarregada'; s.classList.toggle('ok', ok);
  $('offText').textContent = txt;
}
$('dlBtn').onclick = async () => {
  if (!navigator.onLine) { alertMsg('Ara no tens connexió. Descarrega-la abans de posar el mode avió.'); return; }
  const btn = $('dlBtn'); btn.disabled = true; btn.textContent = 'Descarregant…';
  try {
    if (navigator.storage && navigator.storage.persist) log('Demana guardat persistent: ' + (await navigator.storage.persist() ? 'concedit' : 'no concedit'));
    const c = await caches.open(MEDIA_CACHE), files = mediaList();
    let n = 0, bytes = 0;
    for (const f of files) {
      const res = await fetch(f, {cache: 'reload'});
      if (!res.ok) throw new Error(f + ' → ' + res.status);
      const blob = await res.blob(); bytes += blob.size;
      await c.put(f, new Response(blob, {headers: {'Content-Type': res.headers.get('Content-Type') || blob.type}}));
      n++; $('offBar').style.width = (100 * n / files.length) + '%';
    }
    log(`Descàrrega completa: ${n} fitxers, ${(bytes / 1e6).toFixed(1)} MB`);
  } catch (err) { log('Error en descarregar: ' + err.message); alertMsg('No s\'ha pogut descarregar tot. Torna-ho a provar amb bona connexió.'); }
  btn.disabled = false; checkOffline();
};
$('resetBtn').onclick = async () => { await caches.delete(MEDIA_CACHE); log('Descàrrega esborrada'); $('offBar').style.width = '0'; checkOffline(); };
$('copyDiag').onclick = async () => {
  const txt = logLines.join('\n');
  try { await navigator.clipboard.writeText(txt); $('copyDiag').textContent = 'Copiat ✓'; }
  catch (e) { const r = document.createRange(); r.selectNodeContents($('diagLog')); getSelection().removeAllRanges(); getSelection().addRange(r); }
};
function alertMsg(t) { $('offText').textContent = t; }

/* ---------- point sheet ---------- */
let sheetIdx = -1;
function openSheet(i) {
  const p = POIS[i]; sheetIdx = i;
  $('shTitle').textContent = `${i + 1}. ${p.name}`;
  $('shTheme').textContent = p.theme || (isTreasure(p) ? 'Tresor' : '');
  $('shGal').innerHTML = p.imgs.map(f => `<img src="media/${f}" alt="">`).join('');
  const au = $('shAudio'), vi = $('shVideo');
  au.hidden = !p.audio.length; au.src = p.audio.length ? 'media/' + p.audio[0] : '';
  vi.hidden = !p.video.length; vi.src = p.video.length ? 'media/' + p.video[0] : '';
  $('shBody').innerHTML = p.html || (isTreasure(p) ? `<p>${found.has(p.id) ? 'Tresor trobat! ★' : 'Apropa\'t a aquest punt per trobar el tresor.'}</p>` : '<p class="muted">Aquest punt encara no té text.</p>');
  const text = $('shBody').innerText.trim();
  $('shActions').innerHTML = text && 'speechSynthesis' in window ? '<button id="ttsBtn">Llegeix en veu alta</button>' : '';
  if ($('ttsBtn')) $('ttsBtn').onclick = () => speak(p.name + '. ' + text, true);
  $('sheet').hidden = false;
}
function closeSheet() { $('sheet').hidden = true; $('shAudio').pause(); $('shVideo').pause(); try { speechSynthesis.cancel(); } catch (e) {} }
$('shClose').onclick = closeSheet;
$('sheet').onclick = e => { if (e.target === $('sheet')) closeSheet(); };

/* ---------- voice ---------- */
let voiceOn = true, caVoice = null;
function loadVoices() { try { caVoice = speechSynthesis.getVoices().find(v => /^ca/i.test(v.lang)) || null; } catch (e) {} }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speak(t, force) {
  if ((!voiceOn && !force) || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'ca-ES'; if (caVoice) u.voice = caVoice; u.rate = .95; speechSynthesis.speak(u); } catch (e) {}
}
$('voiceBtn').onclick = () => { voiceOn = !voiceOn; $('voiceBtn').textContent = 'Veu: ' + (voiceOn ? 'sí' : 'no'); $('voiceBtn').setAttribute('aria-pressed', voiceOn); };

/* ---------- map ---------- */
const cv = $('map'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const view = {cx: 0, cy: 0, s: 1.2, rot: 0}; // s = pixels per metre
let follow = true, headingUp = false;
let layers = {};
function buildLayers() {
  const mk = (ways, close) => { const p = new Path2D(); for (const w of ways) { w.forEach(([lon, lat], i) => { const [x, y] = toXY(lat, lon); i ? p.lineTo(x, y) : p.moveTo(x, y); }); if (close) p.closePath(); } return p; };
  layers = {};
  for (const k of ['green', 'wood', 'water', 'building']) if (BASE[k]) layers[k] = mk(BASE[k], true);
  for (const k of ['stream', 'rail', 'path', 'minor', 'mid', 'major']) if (BASE[k]) layers[k] = mk(BASE[k], false);
  const t = new Path2D(); TR.forEach((p, i) => i ? t.lineTo(p[0], p[1]) : t.moveTo(p[0], p[1])); layers.track = t;
}
function resize() {
  const r = cv.getBoundingClientRect(); DPR = Math.min(devicePixelRatio || 1, 2);
  W = r.width; H = r.height; cv.width = W * DPR; cv.height = H * DPR; draw();
}
let dirty = false;
function draw() { if (!dirty) { dirty = true; requestAnimationFrame(paint); } }
function worldTransform() {
  const c = Math.cos(view.rot), s = Math.sin(view.rot), k = view.s * DPR;
  // screen = R(rot) * (world - centre) * scale, y flipped, centred (a little lower when following)
  const ox = W * DPR / 2, oy = H * DPR * (follow ? 0.62 : 0.5);
  const a = k * c, b = -k * s, cc = -k * s, d = -k * c; // with y flip
  // x' = a*X + cc*Y + e ; y' = b*X + d*Y + f   (X,Y world metres)
  const e = ox - (a * view.cx + cc * view.cy), f = oy - (b * view.cx + d * view.cy);
  return [a, b, cc, d, e, f];
}
function w2s(x, y) { const [a, b, c, d, e, f] = worldTransform(); return [(a * x + c * y + e) / DPR, (b * x + d * y + f) / DPR]; }
function s2w(sx, sy) {
  const [a, b, c, d, e, f] = worldTransform(), det = a * d - b * c, X = sx * DPR - e, Y = sy * DPR - f;
  return [(d * X - c * Y) / det, (-b * X + a * Y) / det];
}
function paint() {
  dirty = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#f2efe9'; ctx.fillRect(0, 0, cv.width, cv.height);
  const T = worldTransform(); ctx.setTransform(...T);
  const lw = n => n / view.s; // n CSS px → metres
  const fill = (k, c) => { if (layers[k]) { ctx.fillStyle = c; ctx.fill(layers[k]); } };
  const line = (k, c, w, dash) => { if (!layers[k]) return; ctx.strokeStyle = c; ctx.lineWidth = lw(w); ctx.setLineDash(dash ? dash.map(lw) : []); ctx.stroke(layers[k]); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  fill('green', '#cdebb0'); fill('wood', '#add19e'); fill('water', '#aad3df');
  if (layers.building && view.s > 0.5) { ctx.fillStyle = '#d9d0c9'; ctx.fill(layers.building); line('building', '#c4b6ab', 0.6); }
  line('stream', '#aad3df', 2);
  line('major', '#bbb', 9); line('mid', '#bbb', 7.5); line('minor', '#ccc', 6);
  line('major', '#fcd6a4', 7); line('mid', '#f7fabf', 5.5); line('minor', '#fff', 4.5);
  line('rail', '#888', 2, [6, 4]);
  line('path', '#fff', 3.2); line('path', '#a0522d', 1.6, [4, 3]);
  // route
  line('track', '#fff', 9); line('track', '#c4541c', 5.5);
  if (walked > 0) { // walked part in green
    const p = new Path2D(); let started = false;
    for (let i = 0; i < TR.length && CUM[i] <= walked; i++) { started ? p.lineTo(TR[i][0], TR[i][1]) : p.moveTo(TR[i][0], TR[i][1]); started = true; }
    const q = pointAt(walked); p.lineTo(q[0], q[1]);
    ctx.strokeStyle = '#2f7d4f'; ctx.lineWidth = lw(5.5); ctx.setLineDash([]); ctx.stroke(p);
  }
  // screen-space overlays
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.setLineDash([]);
  const st = w2s(TR[0][0], TR[0][1]);
  ctx.fillStyle = '#2f7d4f'; ctx.beginPath(); ctx.arc(st[0], st[1], 7, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  POIS.forEach((p, i) => {
    const [x, y] = w2s(p.x, p.y), tre = isTreasure(p), done = found.has(p.id) || visited.has(p.id);
    ctx.fillStyle = tre ? (found.has(p.id) ? '#2f7d4f' : '#d4a017') : (done ? '#2f7d4f' : '#1f2420');
    ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '700 12px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tre ? '★' : String(i + 1), x, y + 0.5);
  });
  if (me) {
    const [x, y] = w2s(me.x, me.y), acc = Math.min(me.acc * view.s, 200);
    ctx.fillStyle = 'rgba(26,115,232,.15)'; ctx.beginPath(); ctx.arc(x, y, Math.max(acc, 10), 0, 7); ctx.fill();
    if (heading != null) { // direction cone
      const h = heading * Math.PI / 180 - view.rot;
      ctx.fillStyle = 'rgba(26,115,232,.35)'; ctx.beginPath(); ctx.moveTo(x, y);
      ctx.arc(x, y, 34, h - Math.PI / 2 - .45, h - Math.PI / 2 + .45); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#1a73e8'; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
  }
  // north arrow on the rotate button
  $('rotBtn').style.transform = `rotate(${-view.rot}rad)`;
}
function centreOn(x, y) { view.cx = x; view.cy = y; draw(); }
function fitRoute() {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of [...TR, ...POIS.map(p => [p.x, p.y])]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2; view.rot = 0;
  view.s = Math.min((W - 60) / (x1 - x0 || 1), (H - 60) / (y1 - y0 || 1)); draw();
}
function zoom(f, sx, sy) {
  const before = sx != null ? s2w(sx, sy) : null;
  view.s = Math.max(0.15, Math.min(12, view.s * f));
  if (before && !follow) { const after = s2w(sx, sy); view.cx += before[0] - after[0]; view.cy += before[1] - after[1]; }
  draw();
}
$('zin').onclick = () => zoom(1.5); $('zout').onclick = () => zoom(1 / 1.5);
function setFollow(v) { follow = v; $('meBtn').setAttribute('aria-pressed', v); if (v && me) centreOn(me.x, me.y); draw(); }
$('meBtn').onclick = () => { if (!me) { fitRoute(); return; } setFollow(!follow); };
$('rotBtn').onclick = async () => {
  headingUp = !headingUp; $('rotBtn').setAttribute('aria-pressed', headingUp);
  if (headingUp) await startCompass(); else { view.rot = 0; draw(); }
};
// gestures: drag to pan, pinch to zoom, wheel on desktop
const ptrs = new Map(); let pinch0 = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); if (ptrs.size === 2) pinch0 = {d: pinchDist(), s: view.s}; });
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId), cur = [e.offsetX, e.offsetY]; ptrs.set(e.pointerId, cur);
  if (ptrs.size === 1) {
    const a = s2w(prev[0], prev[1]), b = s2w(cur[0], cur[1]);
    if (Math.abs(cur[0] - prev[0]) + Math.abs(cur[1] - prev[1]) > 0) { if (follow) setFollow(false); view.cx += a[0] - b[0]; view.cy += a[1] - b[1]; draw(); }
  } else if (ptrs.size === 2 && pinch0) { view.s = Math.max(0.15, Math.min(12, pinch0.s * pinchDist() / pinch0.d)); draw(); }
});
const endPtr = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; };
cv.addEventListener('pointerup', e => { const st = ptrs.get(e.pointerId), tap = ptrs.size === 1 && st && Math.hypot(st[0] - downXY[0], st[1] - downXY[1]) < 8; endPtr(e); if (tap) tapAt(e.offsetX, e.offsetY); });
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY); }, {passive: false});
function pinchDist() { const [a, b] = [...ptrs.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; }
let downAt = 0, downXY = [0, 0]; cv.addEventListener('pointerdown', e => { downAt = Date.now(); downXY = [e.offsetX, e.offsetY]; });
function tapAt(x, y) {
  if (Date.now() - downAt > 300) return;
  let best = -1, bd = 24;
  POIS.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y), d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = i; } });
  if (best >= 0) openSheet(best);
}
addEventListener('resize', () => { if (!$('nav').hidden) resize(); });

/* ---------- position: GPS or simulation ---------- */
let started = false, me = null, heading = null, walked = 0, gpsWatch = null, simTimer = null, maxAlong = 0;
const visited = new Set(), found = new Set(), notified = new Set();
function onPosition(lat, lon, acc, gpsHeading, src) {
  const [x, y] = toXY(lat, lon);
  if (me && gpsHeading == null && !compassOn) { const d = dist([me.x, me.y], [x, y]); if (d > 2) heading = (Math.atan2(x - me.x, y - me.y) * 180 / Math.PI + 360) % 360; }
  if (gpsHeading != null && !isNaN(gpsHeading) && !compassOn) heading = gpsHeading;
  me = {x, y, acc: acc || 5};
  const s = snap([x, y]);
  $('offroute').hidden = s.off <= OFFROUTE_M;
  // progress only advances when close to the track, and never jumps more than 120 m at once
  if (s.off <= OFFROUTE_M) {
    if (!started) { started = true; maxAlong = s.along; } // first fix: start counting from where you join the route
    else if (s.along >= maxAlong - 30 && s.along <= maxAlong + 120) maxAlong = Math.max(maxAlong, s.along);
  }
  walked = maxAlong;
  $('progBar').style.width = (100 * walked / TOTAL) + '%';
  $('sDone').textContent = fmtM(walked); $('sLeft').textContent = fmtM(Math.max(0, TOTAL - walked));
  // proximity to points
  let nextI = -1, nd = Infinity;
  POIS.forEach((p, i) => {
    const d = dist([x, y], [p.x, p.y]);
    if (isTreasure(p) && d <= TREASURE_M && !found.has(p.id)) { found.add(p.id); arrive(i, true); }
    else if (!isTreasure(p) && d <= NEAR_M && !notified.has(p.id)) { notified.add(p.id); visited.add(p.id); arrive(i, false); }
    if (!visited.has(p.id) && !found.has(p.id) && d < nd) { nd = d; nextI = i; }
  });
  updateNext(nextI, nd); updateTreasures();
  if (follow) centreOn(x, y); else draw();
  if (src === 'gps') $('gpsNote').textContent = `GPS: precisió ±${Math.round(acc)} m · a ${Math.round(s.off)} m del track`;
}
function updateNext(i, d) {
  if (i < 0) { $('nBadge').textContent = '✓'; $('nName').textContent = 'Has vist tots els punts'; $('nDist').textContent = 'Ruta completada'; return; }
  const p = POIS[i];
  $('nBadge').textContent = isTreasure(p) ? '★' : i + 1; $('nName').textContent = p.name;
  $('nDist').textContent = 'Punt més proper · ' + fmtM(d); $('nextBtn').dataset.i = i;
}
$('nextBtn').onclick = () => { const i = $('nextBtn').dataset.i; if (i != null) openSheet(+i); };
function updateTreasures() { const n = POIS.filter(isTreasure).length; $('sTre').textContent = `${found.size}/${n}`; }
function arrive(i, treasure) {
  const p = POIS[i];
  if (navigator.vibrate) navigator.vibrate(treasure ? [200, 100, 200, 100, 400] : [250, 120, 250]);
  const t = $('toast');
  t.innerHTML = `<span class="t">${treasure ? 'Tresor trobat!' : 'Has arribat'}</span><h3>${treasure ? '★ ' : (i + 1) + '. '}${esc(p.name)}</h3><div class="row"><button class="primary" id="tOpen">Obre la fitxa</button><button id="tClose">Continua</button></div>`;
  t.hidden = false;
  $('tOpen').onclick = () => { t.hidden = true; openSheet(i); };
  $('tClose').onclick = () => { t.hidden = true; };
  speak(treasure ? `Enhorabona! Has trobat el ${p.name}.` : `Has arribat a ${p.name}.`);
  log((treasure ? 'Tresor: ' : 'Arribada: ') + p.name);
}
let wake = null;
async function keepAwake() { try { if ('wakeLock' in navigator) { wake = await navigator.wakeLock.request('screen'); log('Pantalla sempre encesa: sí'); } } catch (e) { log('Pantalla sempre encesa: no (' + e.message + ')'); } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (gpsWatch != null || simTimer)) keepAwake(); });
$('gpsBtn').onclick = () => {
  if (gpsWatch != null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; $('gpsBtn').textContent = 'Activa el GPS'; return; }
  if (!('geolocation' in navigator)) { $('gpsNote').textContent = 'Aquest navegador no dona la posició.'; return; }
  stopSim(); speak('', true); // unlocks speech on iOS (needs a tap)
  $('gpsNote').textContent = 'Buscant el GPS… (a l\'aire lliure triga uns segons)';
  gpsWatch = navigator.geolocation.watchPosition(
    g => onPosition(g.coords.latitude, g.coords.longitude, g.coords.accuracy, g.coords.heading, 'gps'),
    err => { $('gpsNote').textContent = 'GPS: ' + ({1: 'permís denegat. Activa la ubicació per a aquesta web.', 2: 'sense senyal.', 3: 'temps esgotat, continua buscant…'}[err.code] || err.message); log('GPS error ' + err.code + ': ' + err.message); },
    {enableHighAccuracy: true, maximumAge: 2000, timeout: 20000});
  $('gpsBtn').textContent = 'Atura el GPS'; keepAwake(); setFollow(true); log('GPS activat');
};
function stopSim() { if (simTimer) { clearInterval(simTimer); simTimer = null; $('simBtn').textContent = 'Simula'; } }
$('simBtn').onclick = () => {
  if (simTimer) { stopSim(); return; }
  if (gpsWatch != null) $('gpsBtn').click();
  speak('', true);
  let along = Math.max(0, walked), last = null; started = true;
  const toLL = ([x, y]) => [y / KY + LAT0, x / KX + LON0];
  simTimer = setInterval(() => {
    along += 1.4 * 4 * 0.5; // walking speed ×4, every 0.5 s
    if (along >= TOTAL) { along = TOTAL; stopSim(); }
    const p = pointAt(along), [lat, lon] = toLL(p);
    onPosition(lat, lon, 5, null, 'sim'); last = p;
  }, 500);
  $('simBtn').textContent = 'Atura la simulació'; setFollow(true); keepAwake();
  $('gpsNote').textContent = 'Simulació: camina sola pel track (4 vegades més ràpid).';
};
// compass (heading-up map)
let compassOn = false;
async function startCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { log('Brúixola: permís denegat'); return; }
    }
  } catch (e) { log('Brúixola: ' + e.message); }
  if (compassOn) return; compassOn = true;
  const onOri = e => {
    let h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.absolute && e.alpha != null ? 360 - e.alpha : null);
    if (h == null) return; heading = h;
    if (headingUp) { view.rot = h * Math.PI / 180; draw(); }
  };
  addEventListener('deviceorientationabsolute', onOri); addEventListener('deviceorientation', onOri);
  log('Brúixola activada');
}

/* ---------- screens ---------- */
function show(nav) {
  $('home').hidden = nav; $('nav').hidden = !nav;
  if (nav) { resize(); if (!me) fitRoute(); }
}
$('startBtn').onclick = () => { show(true); history.pushState({nav: 1}, ''); };
$('backBtn').onclick = () => history.back();
addEventListener('popstate', () => { closeSheet(); show(false); });

/* ---------- start ---------- */
(async function init() {
  updateNet();
  try {
    [D, BASE] = await Promise.all([fetch('data.json').then(r => r.json()), fetch('basemap.json').then(r => r.json())]);
  } catch (e) { log('No s\'han pogut carregar les dades: ' + e.message); $('offText').textContent = 'No s\'han pogut carregar les dades. Obre l\'app amb connexió la primera vegada.'; return; }
  LAT0 = D.route.track[0][0]; LON0 = D.route.track[0][1]; KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
  prepTrack();
  POIS = D.pois.map(p => { const [x, y] = toXY(p.lat, p.lon); return {...p, x, y, along: 0}; });
  POIS.forEach(p => p.along = snap([p.x, p.y]).along);
  POIS.sort((a, b) => a.along - b.along);
  buildLayers(); renderHome(); updateTreasures(); updateNext(0, NaN);
  $('nDist').textContent = 'Primer punt';
  log(`Ruta: ${fmtM(TOTAL)}, ${POIS.length} punts`);
  checkOffline();
})();
