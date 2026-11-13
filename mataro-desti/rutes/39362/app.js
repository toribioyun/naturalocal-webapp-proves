/* Natura Local – offline route prototype (Parc Mataró gamificada).
   Data: data.json (route + points + elevation, from naturalocal.net) and basemap.json (OpenStreetMap ways).
   Two ways: online (no download; sw.js saves app, data, map and every media file or ortho tile opened)
   or downloaded ("Descarrega la ruta" puts all media and the ortho tiles in the cache before leaving). */
'use strict';
const $ = id => document.getElementById(id);
const MEDIA_CACHE = 'nlr39362-media';
const NEAR_M = 15, TREASURE_M = 15, OFFROUTE_M = 30, OFF_READINGS = 3; // Toribio, 08/11/2026
const TRACK_M = 40; // progress keeps counting up to here: a GPS jump must not stop it
// Free orthophoto of the ICGC (CC BY 4.0). Zooms 14–17 go in the download; 18–19 only online.
const ORTO_URL = (z, x, y) => `https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/orto/GRID3857/${z}/${x}/${y}.jpeg`;
const ORTO_DL_Z = [14, 15, 16, 17], ORTO_MAX_Z = 19, ORTO_KB = 30;
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
addEventListener('online', () => { updateNet(); log('Connexió: sí'); tiles.clear(); draw(); if (D) checkOffline(); });
addEventListener('offline', () => { updateNet(); log('Connexió: no'); if (D) checkOffline(); });
// Images that can't load (offline and not saved) are hidden instead of showing a broken icon.
document.addEventListener('error', e => {
  if (e.target.tagName !== 'IMG') return;
  e.target.classList.add('broken');
  if (e.target.closest('#shGal')) noteMissing('fotos');
}, true);

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
  // A new version installs in the background: show it straight away (not at the next opening), unless the walker is busy.
  const c0 = navigator.serviceWorker.controller, hadWorker = !!c0 && c0.scriptURL === new URL('sw.js', location.href).href; // a parent app's worker does not count
  let reloading = false, swReg = null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadWorker || reloading || !$('nav').hidden || !$('sheet').hidden || $('dlBtn').disabled) return;
    reloading = true; location.reload();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {}); });
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; log('Service worker registrat (' + r.scope + ')'); })
    .catch(err => log('Service worker NO registrat: ' + err.message));
} else log('Aquest navegador no té service worker: no funcionarà sense connexió en reobrir.');

/* ---------- geometry helpers (local metres) ---------- */
let LAT0 = 0, LON0 = 0, KX = 0;
const KY = 110574;
const toXY = (lat, lon) => [(lon - LON0) * KX, (lat - LAT0) * KY];
const toLL = ([x, y]) => [y / KY + LAT0, x / KX + LON0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function fmtM(m) { return m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m'; }

let TR = [], CUM = [], ELE = [], TOTAL = 0;
function prepTrack() {
  TR = D.route.track.map(p => toXY(p[0], p[1]));
  ELE = D.route.ele || [];
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
// Point (and elevation) at a distance along the track.
// Climb done up to each track point. Small ups and downs (< 5 m) are noise of the elevation data and are not added.
let UP = [];
function buildClimb() {
  UP = []; if (!ELE.length) return;
  let ref = ELE[0], up = 0;
  ELE.forEach(e => { if (e - ref >= 5) { up += e - ref; ref = e; } else if (ref - e >= 5) ref = e; UP.push(up); });
}
const climbAt = along => UP.length ? UP[Math.max(0, at(along).i - 1)] : null;
function at(along) {
  for (let i = 1; i < TR.length; i++) if (CUM[i] >= along) {
    const t = (along - CUM[i - 1]) / ((CUM[i] - CUM[i - 1]) || 1);
    return {pt: [TR[i - 1][0] + t * (TR[i][0] - TR[i - 1][0]), TR[i - 1][1] + t * (TR[i][1] - TR[i - 1][1])],
      ele: ELE.length ? ELE[i - 1] + t * (ELE[i] - ELE[i - 1]) : null, i};
  }
  return {pt: TR[TR.length - 1], ele: ELE[ELE.length - 1] ?? null, i: TR.length - 1};
}
const pointAt = along => at(along).pt;

/* ---------- points ---------- */
let POIS = [];
const SIGNPOST = new Path2D('M-6-7.5H3.5L7-5 3.5-2.5H-6ZM6 .5H-3.5L-7 3-3.5 5.5H6Z'); // two direction boards, drawn in a 24 px circle
const isTreasure = p => /^tresor/i.test(p.name);
// Information points (directions, warnings): on the map and as a notice, but not in the list of points of interest.
const isInfo = p => p.kind === 'info';
const hasContent = p => p.imgs.length || p.audio.length || p.video.length || /<img|<a /.test(p.html || '') || /\S/.test((p.html || '').replace(/<[^>]*>|&nbsp;/g, ''));
function mediaList() {
  const s = new Set();
  D.route.imgs.forEach(f => s.add('media/' + f));
  for (const p of D.pois) {
    [...p.imgs, ...p.video, ...p.audio].forEach(f => s.add('media/' + f));
    (p.html.match(/media\/[^"]+/g) || []).forEach(f => s.add(f));
  }
  return [...s];
}

/* ---------- orthophoto tiles ---------- */
const lon2tx = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2ty = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const tx2lon = (x, z) => x / 2 ** z * 360 - 180;
const ty2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };
// Tiles along the route (150 m to each side), for the download: long routes must not fetch a whole rectangle.
let orthoCache = null;
function orthoList() {
  if (orthoCache) return orthoCache;
  const set = new Set(), M = 150;
  const add = p => { const [la, lo] = toLL(p); for (const z of ORTO_DL_Z) set.add(ORTO_URL(z, Math.floor(lon2tx(lo, z)), Math.floor(lat2ty(la, z)))); };
  for (let d = 0; d <= TOTAL; d += 40) { const p = pointAt(d); for (const i of [-M, 0, M]) for (const j of [-M, 0, M]) add([p[0] + i, p[1] + j]); }
  POIS.forEach(p => add([p.x, p.y]));
  return orthoCache = [...set];
}
const downloadList = () => [...mediaList(), ...orthoList()];

/* ---------- home ---------- */
function renderHome() {
  const r = D.route;
  $('rTitle').textContent = r.name;
  $('heroImg').src = 'media/' + r.imgs[0];
  const facts = [['Distància', r.distancia.replace('.00', '').replace('.', ',')], ['Durada', r.durada],
    ['Desnivell', r.desnivell.replace('.00', '').replace(' meters', ' m')], ['Dificultat', r.dificultat],
    ['Tipologia', r.tipus], ['Temàtica', r.tema]].filter(f => f[1]);
  $('rStats').innerHTML = facts.map(([k, v]) => `<div${k === 'Temàtica' ? ' class="wide"' : ''}><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('poiList').innerHTML = POIS.map((p, i) => {
    if (isInfo(p)) return '';
    const th = p.imgs[0] ? `<img src="media/${p.imgs[0]}" alt="" loading="lazy">` : `<span class="ph">${isTreasure(p) ? '★' : '•'}</span>`;
    const extra = [p.theme || (isTreasure(p) ? 'Tresor' : ''), p.audio.length ? 'àudio' : '', p.video.length ? 'vídeo' : ''].filter(Boolean).join(' · ');
    return `<li><button data-i="${i}"><span class="th">${th}<span class="num">${isTreasure(p) ? '★' : p.num}</span></span><span><small>${esc(extra)}</small><b>${esc(p.name)}</b></span><span class="chev">›</span></button></li>`;
  }).join('');
  $('poiList').onclick = e => { const b = e.target.closest('button'); if (b) openSheet(+b.dataset.i); };
  const mediaMB = r.mediaMB || 8;
  document.querySelectorAll('.mbOnline').forEach(e => e.textContent = `uns ${Math.round(mediaMB)} MB`);
  document.title = 'Natura Local · ' + r.name;
  if (r.url) { $('fitxaLink').href = r.url; $('fitxaLink').hidden = false; }
  if (r.back) { $('backLink').href = r.back; $('backLink').textContent = '‹ Torna a ' + r.backName; $('backLink').hidden = false; $('protoTag').hidden = true; }
  const mb = (mediaMB + orthoList().length * ORTO_KB / 1000).toFixed(0);
  $('dlBtn').dataset.label = `Descarrega la ruta (uns ${mb} MB)`;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

/* ---------- offline download ---------- */
async function checkOffline() {
  const files = downloadList();
  if (!('caches' in window)) { setOff(false, 'Aquest navegador no pot guardar la ruta: només es pot fer amb cobertura.'); $('dlBtn').disabled = true; return; }
  const c = await caches.open(MEDIA_CACHE);
  let have = 0; for (const f of files) if (await c.match(f)) have++;
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  log(`Fitxers guardats: ${have}/${files.length}` + (est ? ` · espai usat ${(est.usage / 1e6).toFixed(1)} MB` : '') + ` · guardat persistent: ${persisted ? 'sí' : 'no'}`);
  $('offBar').style.width = (100 * have / files.length) + '%';
  if (have === files.length) {
    setOff(true, 'Tot guardat al mòbil: ja pots posar el mode avió.');
    $('dlBtn').textContent = 'Torna a descarregar';
  } else if (!navigator.onLine) {
    setOff(false, `Ara no tens connexió. Pots fer la ruta igualment, però sense les fotos, els àudios, els vídeos i l'ortofoto que no tens guardats.`);
  } else {
    setOff(false, have ? `Ja tens guardada una part (${Math.round(100 * have / files.length)} %): el que has obert.` : '');
    $('dlBtn').textContent = $('dlBtn').dataset.label || 'Descarrega la ruta';
  }
}
function setOff(ok, txt) {
  const s = $('offState'); s.textContent = ok ? 'Descarregada ✓' : 'No descarregada'; s.classList.toggle('ok', ok); s.classList.toggle('info', !ok);
  $('offText').textContent = txt; $('offText').hidden = !txt;
}
$('dlBtn').onclick = async () => {
  if (!navigator.onLine) { alertMsg('Ara no tens connexió. Descarrega-la abans de posar el mode avió.'); return; }
  const btn = $('dlBtn'); btn.disabled = true; btn.textContent = 'Descarregant…';
  try {
    if (navigator.storage && navigator.storage.persist) log('Demana guardat persistent: ' + (await navigator.storage.persist() ? 'concedit' : 'no concedit'));
    const c = await caches.open(MEDIA_CACHE), files = downloadList();
    let n = 0, bytes = 0;
    for (const f of files) {
      if (!(await c.match(f))) {
        let res = null;
        for (let k = 0; k < 3; k++) { // up to 3 tries per file: a busy server answers 503 now and then
          try { res = await fetch(f, {cache: 'reload'}); if (res.ok) break; } catch (e) { res = null; }
          await new Promise(r => setTimeout(r, 1500 * (k + 1)));
        }
        if (!res || !res.ok) throw new Error(f + ' → ' + (res ? res.status : 'sense resposta'));
        const blob = await res.blob(); bytes += blob.size;
        await c.put(f, new Response(blob, {headers: {'Content-Type': res.headers.get('Content-Type') || blob.type}}));
      }
      n++; $('offBar').style.width = (100 * n / files.length) + '%';
    }
    log(`Descàrrega completa: ${n} fitxers, ${(bytes / 1e6).toFixed(1)} MB nous`);
  } catch (err) { log('Error en descarregar: ' + err.message); alertMsg('No s\'ha pogut descarregar tot. Torna-ho a provar amb bona connexió.'); }
  btn.disabled = false; checkOffline();
};
$('resetBtn').onclick = async () => { await caches.delete(MEDIA_CACHE); tiles.clear(); log('Descàrrega esborrada'); $('offBar').style.width = '0'; checkOffline(); };
$('copyDiag').onclick = async () => {
  const txt = logLines.join('\n');
  try { await navigator.clipboard.writeText(txt); $('copyDiag').textContent = 'Copiat ✓'; }
  catch (e) { const r = document.createRange(); r.selectNodeContents($('diagLog')); getSelection().removeAllRanges(); getSelection().addRange(r); }
};
function alertMsg(t) { $('offText').textContent = t; $('offText').hidden = false; }

/* ---------- point sheet ---------- */
// Dots under a gallery: one per photo, the current one longer, so it is clear that you can swipe (Toribio, 11/11/2026).
function setDots(el, n) { el.hidden = n < 2; el.innerHTML = '<i class="on"></i>' + '<i></i>'.repeat(Math.max(0, n - 1)); }
function moveDots(el, g) { const k = Math.round(g.scrollLeft / (g.clientWidth || 1)); el.querySelectorAll('i').forEach((x, j) => x.classList.toggle('on', j === k)); }

let sheetIdx = -1;
function openSheet(i) {
  const p = POIS[i]; sheetIdx = i;
  $('shTitle').textContent = isTreasure(p) || isInfo(p) ? p.name : `${p.num}. ${p.name}`;
  $('shTheme').textContent = p.theme || (isTreasure(p) ? 'Tresor' : isInfo(p) ? 'Indicació' : '');
  $('shDist').textContent = me ? 'A ' + fmtM(dist([me.x, me.y], [p.x, p.y])) + ' de tu' : '';
  $('shGal').innerHTML = p.imgs.map(f => `<img src="media/${f}" alt="">`).join('');
  $('shCountM').innerHTML = [[p.audio.length, '🔊 àudio'], [p.imgs.length, '🖼 ' + (p.imgs.length > 1 ? 'fotos' : 'foto')], [p.video.length, '▶ vídeo']]
    .filter(m => m[0]).map(m => `<span>${m[1].replace(' ', ' ' + m[0] + ' ')}</span>`).join('');
  $('shGal').scrollLeft = 0;
  setDots($('shDots'), p.imgs.length);
  const au = $('shAudio'), vi = $('shVideo');
  $('shAudioBox').hidden = !p.audio.length; au.src = p.audio.length ? 'media/' + p.audio[0] : '';
  vi.hidden = !p.video.length; vi.src = p.video.length ? 'media/' + p.video[0] : '';
  missKinds.clear(); $('shMiss').hidden = true;
  if (!navigator.onLine) checkMissing(p);
  $('shBody').innerHTML = p.html || (isTreasure(p) ? `<p>${found.has(p.id) ? 'Tresor trobat! ★' : 'Apropa\'t a aquest punt per trobar el tresor.'}</p>` : '<p class="muted">Aquest punt encara no té text.</p>');
  if (!navigator.onLine) $('shBody').querySelectorAll('a[href^="http"]').forEach(a => { // games and other links need the network
    a.removeAttribute('href'); a.insertAdjacentHTML('afterend', '<small class="muted linknote">Aquest enllaç necessita connexió.</small>');
  });
  const text = $('shBody').innerText.trim();
  $('shActions').innerHTML = text && 'speechSynthesis' in window ? '<button id="ttsBtn">🔊 Llegeix en veu alta</button>' : '';
  if ($('ttsBtn')) $('ttsBtn').onclick = () => speak(p.name + '. ' + text, true);
  $('shPrev').disabled = isInfo(p) || stepIdx(i, -1) < 0; $('shNext').disabled = isInfo(p) || stepIdx(i, 1) < 0;
  $('shFitxa').hidden = !p.url || isInfo(p); if (p.url) $('shFitxa').href = p.url; // information points have no page of their own to show
  $('sheet').hidden = false; $('sheet').querySelector('.sheet-in').scrollTop = 0;
}
$('shGal').addEventListener('scroll', () => {
  const g = $('shGal'), n = g.children.length;
  if (n > 1) moveDots($('shDots'), g);
}, {passive: true});
// Previous / next skip the information points.
function stepIdx(i, dir) { for (let j = i + dir; j >= 0 && j < POIS.length; j += dir) if (!isInfo(POIS[j])) return j; return -1; }
$('shPrev').onclick = () => { stopMedia(); openSheet(stepIdx(sheetIdx, -1)); };
$('shNext').onclick = () => { stopMedia(); openSheet(stepIdx(sheetIdx, 1)); };
// Offline and not saved: hide that audio/video and say what is missing.
const missKinds = new Set();
function noteMissing(kind) {
  missKinds.add(kind);
  $('shMiss').textContent = 'Sense cobertura i no descarregat, no es pot mostrar: ' + [...missKinds].join(', ') + '.';
  $('shMiss').hidden = false;
}
async function checkMissing(p) {
  const c = await caches.open(MEDIA_CACHE);
  if (p.audio.length && !(await c.match('media/' + p.audio[0]))) { $('shAudioBox').hidden = true; noteMissing('àudio'); }
  if (p.video.length && !(await c.match('media/' + p.video[0]))) { $('shVideo').hidden = true; noteMissing('vídeo'); }
}
$('shAudio').onerror = () => { if (sheetIdx >= 0 && POIS[sheetIdx].audio.length) { $('shAudioBox').hidden = true; noteMissing('àudio'); } };
$('shVideo').onerror = () => { if (sheetIdx >= 0 && POIS[sheetIdx].video.length) { $('shVideo').hidden = true; noteMissing('vídeo'); } };
function stopMedia() { $('shAudio').pause(); $('shVideo').pause(); try { speechSynthesis.cancel(); } catch (e) {} }
function closeSheet() { $('sheet').hidden = true; stopMedia(); }
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
let follow = true, headingUp = false, ortho = false;
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
function draw() { if (!dirty && W) { dirty = true; requestAnimationFrame(paint); } }
function worldTransform() {
  const c = Math.cos(view.rot), s = Math.sin(view.rot), k = view.s * DPR;
  // screen = R(rot) * (world - centre) * scale, y flipped, centred (a little lower when following)
  const ox = W * DPR / 2, oy = H * DPR * (follow && me ? 0.62 : 0.5);
  const a = k * c, b = -k * s, cc = -k * s, d = -k * c; // with y flip
  const e = ox - (a * view.cx + cc * view.cy), f = oy - (b * view.cx + d * view.cy);
  return [a, b, cc, d, e, f];
}
function w2s(x, y) { const [a, b, c, d, e, f] = worldTransform(); return [(a * x + c * y + e) / DPR, (b * x + d * y + f) / DPR]; }
function s2w(sx, sy) {
  const [a, b, c, d, e, f] = worldTransform(), det = a * d - b * c, X = sx * DPR - e, Y = sy * DPR - f;
  return [(d * X - c * Y) / det, (-b * X + a * Y) / det];
}
// Ortho tiles: loaded on demand (the service worker serves saved ones offline).
const tiles = new Map();
function tile(z, x, y) {
  const url = ORTO_URL(z, x, y); let t = tiles.get(url);
  if (!t) {
    t = {img: new Image(), ok: false, bad: false}; t.img.crossOrigin = 'anonymous';
    t.img.onload = () => { t.ok = true; draw(); }; t.img.onerror = () => { t.bad = true; };
    t.img.src = url; tiles.set(url, t);
  }
  return t;
}
function paintOrtho() {
  const mpp = 1 / (view.s * DPR), lat = LAT0 * Math.PI / 180;
  let z = Math.round(Math.log2(156543.03 * Math.cos(lat) / mpp));
  z = Math.max(12, Math.min(navigator.onLine ? ORTO_MAX_Z : ORTO_DL_Z[ORTO_DL_Z.length - 1], z));
  const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([sx, sy]) => toLL(s2w(sx, sy)));
  const xs = corners.map(c => lon2tx(c[1], z)), ys = corners.map(c => lat2ty(c[0], z));
  const tx0 = Math.floor(Math.min(...xs)), tx1 = Math.floor(Math.max(...xs)), ty0 = Math.floor(Math.min(...ys)), ty1 = Math.floor(Math.max(...ys));
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 80) return;
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
    // not loaded yet or missing: use the closest parent tile already loaded, enlarged
    let t = tile(z, x, y), sx = 0, sy = 0, sw = 256;
    for (let up = 1; !t.ok && up <= 4 && z - up >= 12; up++) {
      const f = 2 ** up, px = Math.floor(x / f), py = Math.floor(y / f), cand = tile(z - up, px, py);
      if (cand.ok) { t = cand; sw = 256 / f; sx = (x - px * f) * sw; sy = (y - py * f) * sw; }
    }
    if (!t.ok) continue;
    const [xa, ya] = toXY(ty2lat(y, z), tx2lon(x, z)), [xb, yb] = toXY(ty2lat(y + 1, z), tx2lon(x + 1, z));
    ctx.save(); ctx.translate(xa, ya); ctx.scale((xb - xa) / 256, (yb - ya) / 256);
    ctx.drawImage(t.img, sx, sy, sw, sw, -0.5, -0.5, 257, 257); ctx.restore();
  }
}
function paint() {
  dirty = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = ortho ? '#4b4a3f' : '#f2efe9'; ctx.fillRect(0, 0, cv.width, cv.height);
  const T = worldTransform(); ctx.setTransform(...T);
  const lw = n => n / view.s; // n CSS px → metres
  const fill = (k, c) => { if (layers[k]) { ctx.fillStyle = c; ctx.fill(layers[k]); } };
  const line = (k, c, w, dash) => { if (!layers[k]) return; ctx.strokeStyle = c; ctx.lineWidth = lw(w); ctx.setLineDash(dash ? dash.map(lw) : []); ctx.stroke(layers[k]); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (ortho) paintOrtho();
  else {
    fill('green', '#cdebb0'); fill('wood', '#add19e'); fill('water', '#aad3df');
    if (layers.building && view.s > 0.5) { ctx.fillStyle = '#d9d0c9'; ctx.fill(layers.building); line('building', '#c4b6ab', 0.6); }
    line('stream', '#aad3df', 2);
    line('major', '#bbb', 9); line('mid', '#bbb', 7.5); line('minor', '#ccc', 6);
    line('major', '#fcd6a4', 7); line('mid', '#f7fabf', 5.5); line('minor', '#fff', 4.5);
    line('rail', '#888', 2, [6, 4]);
    line('path', '#fff', 3.2); line('path', '#a0522d', 1.6, [4, 3]);
  }
  // route as in the Natura Local app: gold line with a brown edge, walked part in olive
  line('track', '#322820', 9); line('track', '#e9bc00', 5.5);
  if (walked > 0) {
    const p = new Path2D(); let first = true;
    for (let i = 0; i < TR.length && CUM[i] <= walked; i++) { first ? p.moveTo(TR[i][0], TR[i][1]) : p.lineTo(TR[i][0], TR[i][1]); first = false; }
    const q = pointAt(walked); p.lineTo(q[0], q[1]);
    ctx.strokeStyle = '#69920c'; ctx.lineWidth = lw(5.5); ctx.setLineDash([]); ctx.stroke(p);
  }
  // screen-space overlays
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.setLineDash([]);
  paintArrows();
  const st = w2s(TR[0][0], TR[0][1]);
  ctx.fillStyle = '#322820'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(st[0] - 21, st[1] - 10, 42, 20, 10) : ctx.rect(st[0] - 21, st[1] - 10, 42, 20); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = '#e9bc00'; ctx.font = '800 10px Raleway,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('INICI', st[0], st[1] + 0.5);
  // information points: a round signpost sitting on the track, below the pins; faded once passed
  POIS.forEach((p, i) => {
    if (!isInfo(p)) return;
    const [x, y] = w2s(p.x, p.y), k = i === popIdx ? 1.3 : 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.globalAlpha = notified.has(p.id) ? 0.55 : 1;
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.shadowColor = '#0005'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1; ctx.fillStyle = '#fff'; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#322820'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#322820'; ctx.fillRect(-1, -8, 2, 16); ctx.fill(SIGNPOST); ctx.restore();
  });
  // points: pins (gold; treasures brown with a star; done in olive), selected one bigger
  POIS.forEach((p, i) => {
    if (isInfo(p)) return;
    const [x, y] = w2s(p.x, p.y), tre = isTreasure(p), done = found.has(p.id) || visited.has(p.id), k = i === popIdx ? 1.25 : 1;
    const col = done ? '#69920c' : tre ? '#322820' : '#e9bc00';
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-5, -9, -14, -14, -14, -24); ctx.arc(0, -24, 14, Math.PI, 0); ctx.bezierCurveTo(14, -14, 5, -9, 0, 0); ctx.closePath();
    ctx.shadowColor = '#0005'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1; ctx.fillStyle = col; ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = tre && !done ? '#e9bc00' : done ? '#fff' : '#322820'; ctx.font = '800 13px Raleway,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tre ? '★' : String(p.num), 0, -23.5); ctx.restore();
  });
  if (profMark != null) { // point touched on the elevation profile
    const [x, y] = w2s(...pointAt(profMark));
    ctx.fillStyle = '#322820'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
  }
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
  $('rotBtn').style.transform = `rotate(${-view.rot}rad)`;
}
// Direction of travel: white chevrons on the line, every ~55 px whatever the zoom.
function paintArrows() {
  const step = 55 / view.s;
  ctx.strokeStyle = '#322820'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let k = 1; // walks the track once, so long routes stay smooth
  for (let d = step / 2; d < TOTAL; d += step) {
    while (k < TR.length - 1 && CUM[k] < d) k++;
    const t = (d - CUM[k - 1]) / ((CUM[k] - CUM[k - 1]) || 1), P = TR[k - 1], Q = TR[k];
    const a = w2s(P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])), b = w2s(Q[0], Q[1]), c = w2s(P[0], P[1]);
    if (a[0] < -20 || a[1] < -20 || a[0] > W + 20 || a[1] > H + 20) continue;
    const ang = Math.atan2(b[1] - c[1], b[0] - c[0]);
    ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(-3.5, -4.6); ctx.lineTo(2.5, 0); ctx.lineTo(-3.5, 4.6); ctx.stroke(); ctx.restore();
  }
}
function centreOn(x, y) { view.cx = x; view.cy = y; draw(); }
function fitRoute() {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of [...TR, ...POIS.map(p => [p.x, p.y])]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  view.cx = (x0 + x1) / 2; view.cy = (y0 + y1) / 2; view.rot = 0;
  view.s = Math.min((W - 70) / (x1 - x0 || 1), (H - 90) / (y1 - y0 || 1)); draw();
}
function zoom(f, sx, sy) {
  const before = sx != null ? s2w(sx, sy) : null;
  view.s = Math.max(0.02, Math.min(12, view.s * f));
  if (before && !follow) { const after = s2w(sx, sy); view.cx += before[0] - after[0]; view.cy += before[1] - after[1]; }
  draw();
}
$('zin').onclick = () => zoom(1.5); $('zout').onclick = () => zoom(1 / 1.5);
function setFollow(v) { follow = v; $('meBtn').setAttribute('aria-pressed', v); if (v && me) centreOn(me.x, me.y); draw(); }
$('meBtn').onclick = () => { if (!me) { fitRoute(); return; } setFollow(!follow); };
$('rotBtn').onclick = async () => {
  headingUp = !headingUp; $('rotBtn').setAttribute('aria-pressed', headingUp);
  if (headingUp && !simTimer) await startCompass(); else if (!headingUp) { view.rot = 0; draw(); }
};
$('layerBtn').onclick = () => {
  ortho = !ortho; $('layerBtn').setAttribute('aria-pressed', ortho); $('layerBtn').textContent = ortho ? 'Mapa' : 'Orto';
  $('attr').textContent = ortho ? '© ICGC · © OpenStreetMap' : '© OpenStreetMap';
  log('Capa: ' + (ortho ? 'ortofoto' : 'mapa')); draw();
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
  } else if (ptrs.size === 2 && pinch0) { view.s = Math.max(0.02, Math.min(12, pinch0.s * pinchDist() / pinch0.d)); draw(); }
});
const endPtr = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; };
cv.addEventListener('pointerup', e => { const st = ptrs.get(e.pointerId), tap = ptrs.size === 1 && st && Math.hypot(st[0] - downXY[0], st[1] - downXY[1]) < 8; endPtr(e); if (tap) tapAt(e.offsetX, e.offsetY); });
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY); }, {passive: false});
function pinchDist() { const [a, b] = [...ptrs.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; }
let downAt = 0, downXY = [0, 0]; cv.addEventListener('pointerdown', e => { downAt = Date.now(); downXY = [e.offsetX, e.offsetY]; });
function tapAt(x, y) {
  if (Date.now() - downAt > 300) return;
  let best = -1, bd = 26;
  POIS.forEach((p, i) => { const [sx, sy] = w2s(p.x, p.y), d = Math.hypot(sx - x, sy - (isInfo(p) ? 0 : 24) - y); if (d < bd) { bd = d; best = i; } });
  if (best >= 0) showPop(best); else hidePop();
}
// Small card for a point tapped on the map (as in the app): name, start of the text, «Més informació».
let popIdx = -1;
function showPop(i) {
  const p = POIS[i], t = $('toast'); popIdx = i;
  const tmp = document.createElement('div'); tmp.innerHTML = p.html || '';
  const txt = tmp.textContent.trim().slice(0, 160);
  const d = me ? ' · a ' + fmtM(dist([me.x, me.y], [p.x, p.y])) : '';
  t.className = 'toast info';
  const info = isInfo(p), more = !info || hasContent(p);
  t.innerHTML = `<span class="t">${esc(p.theme || (isTreasure(p) ? 'Tresor' : info ? 'Indicació' : 'Punt'))}${d}</span><h3>${isTreasure(p) ? '★ ' : info ? '' : p.num + '. '}${esc(p.name)}</h3>${txt ? `<p>${esc(txt)}</p>` : ''}<div class="row">${more ? '<button class="primary grow" id="tOpen">Més informació ›</button>' : ''}<button id="tClose"${more ? '' : ' class="grow"'}>${more ? 'Tanca' : 'D\'acord'}</button></div>`;
  t.hidden = false;
  if (more) $('tOpen').onclick = () => { hidePop(); openSheet(i); };
  $('tClose').onclick = hidePop;
  draw();
}
function hidePop() { if ($('toast').classList.contains('info')) $('toast').hidden = true; popIdx = -1; draw(); }
addEventListener('resize', () => { if (!$('nav').hidden) { resize(); drawProfile(); } });

/* ---------- full screen: map only, with a small bar for the next point ---------- */
function setFull(on) {
  $('nav').classList.toggle('full', on); $('miniBar').hidden = !on;
  $('fullBtn').setAttribute('aria-pressed', on); $('fullBtn').textContent = on ? '⤡' : '⤢';
  const de = document.documentElement;
  try {
    if (on && de.requestFullscreen && !document.fullscreenElement) de.requestFullscreen({navigationUI: 'hide'}).catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) {}
  requestAnimationFrame(resize);
}
$('fullBtn').onclick = () => setFull(!$('nav').classList.contains('full'));
$('miniBar').onclick = () => setFull(false);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && $('nav').classList.contains('full')) setFull(false); });

/* ---------- elevation profile ---------- */
let profMark = null;
const pc = $('prof');
// The whole of a long route hardly moves while walking (1 px every ~50 m on a 14 km route), so by default the profile
// shows the stretch you are on: 400 m behind and what comes next, up to 2 km (Toribio, 10/11/2026).
const TRAM_M = 2000, TRAM_BACK_M = 400;
let profMode = 'tram';
const tramOn = () => profMode === 'tram' && TOTAL > TRAM_M * 1.5;
function profRange() {
  if (!tramOn()) return [0, TOTAL];
  const b = Math.min(TOTAL, Math.max(0, (started ? walked : 0) - TRAM_BACK_M) + TRAM_M);
  return [Math.max(0, b - TRAM_M), b];
}
$('profMode').onclick = e => {
  const btn = e.target.closest('button'); if (!btn) return;
  profMode = btn.dataset.m; $('profMode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === btn));
  drawProfile(); log('Gràfica: ' + btn.textContent);
};
function drawProfile() {
  if (!ELE.length || $('profBox').hidden || !$('profBox').open) return;
  const r = pc.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  if (!r.width) return;
  pc.width = r.width * dpr; pc.height = r.height * dpr;
  const g = pc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width, h = r.height, L = 44, B = 16, T = 8;
  const [a, b] = profRange();
  let emin = Infinity, emax = -Infinity;
  CUM.forEach((d, i) => { if (d >= a - 60 && d <= b + 60) { emin = Math.min(emin, ELE[i]); emax = Math.max(emax, ELE[i]); } });
  const lo = Math.floor(emin / 5) * 5, hi = Math.max(Math.ceil(emax / 5) * 5, lo + 30); // at least 30 m high, so a flat stretch looks flat
  const X = d => L + (w - L - 6) * (d - a) / ((b - a) || 1), Y = e => T + (h - T - B) * (1 - (e - lo) / (hi - lo || 1));
  const css = getComputedStyle(document.documentElement), ink = css.getPropertyValue('--muted').trim(), olive = css.getPropertyValue('--olive').trim();
  g.clearRect(0, 0, w, h);
  g.font = '600 10px Raleway,system-ui,sans-serif'; g.fillStyle = ink; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText(hi + ' m', L - 4, Y(hi)); g.fillText(lo + ' m', L - 4, Y(lo));
  g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillText(a ? 'km ' + (a / 1000).toFixed(1).replace('.', ',') : '0', L, h - 3);
  g.textAlign = 'right'; g.fillText(b < TOTAL ? 'km ' + (b / 1000).toFixed(1).replace('.', ',') : fmtM(TOTAL), w - 2, h - 3);
  g.save(); g.beginPath(); g.rect(L, 0, w - L, h); g.clip(); // only the stretch shown
  const path = () => { g.beginPath(); g.moveTo(X(0), Y(ELE[0])); CUM.forEach((d, i) => g.lineTo(X(d), Y(ELE[i]))); };
  path(); g.lineTo(X(TOTAL), Y(lo)); g.lineTo(X(0), Y(lo)); g.closePath(); g.fillStyle = 'rgba(233,188,0,.25)'; g.fill();
  path(); g.strokeStyle = '#c99f00'; g.lineWidth = 2; g.stroke();
  if (walked > 0) { // walked part
    g.save(); g.beginPath(); g.rect(0, 0, X(walked), h); g.clip();
    path(); g.lineTo(X(TOTAL), Y(lo)); g.lineTo(X(0), Y(lo)); g.closePath(); g.fillStyle = 'rgba(105,146,12,.28)'; g.fill();
    path(); g.strokeStyle = olive; g.stroke(); g.restore();
  }
  for (const p of POIS) { // points of interest as small ticks
    if (isInfo(p)) continue;
    g.fillStyle = isTreasure(p) ? '#e9bc00' : '#322820'; g.beginPath(); g.arc(X(p.along), Y(at(p.along).ele), 3, 0, 7); g.fill();
  }
  const mark = (d, col) => { const e = at(d).ele; g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(d), T); g.lineTo(X(d), h - B); g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(X(d), Y(e), 5.5, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); };
  if (started) mark(walked, '#1a73e8');
  if (profMark != null) mark(profMark, '#322820');
  g.restore();
}
$('profBox').addEventListener('toggle', () => { drawProfile(); log('Perfil de desnivell: ' + ($('profBox').open ? 'obert' : 'tancat')); });
// touching the profile shows that point on the map
function profAt(e) { const r = pc.getBoundingClientRect(), [a, b] = profRange(); return Math.max(a, Math.min(b, a + (e.clientX - r.left - 44) / (r.width - 50) * (b - a))); }
pc.addEventListener('pointerdown', e => { pc.setPointerCapture(e.pointerId); profMark = profAt(e); showProfMark(); });
pc.addEventListener('pointermove', e => { if (profMark != null) { profMark = profAt(e); showProfMark(); } });
const endProf = () => { if (profMark == null) return; profMark = null; drawProfile(); $('profSum').textContent = profSummary(); draw(); };
pc.addEventListener('pointerup', endProf); pc.addEventListener('pointercancel', endProf);
function showProfMark() {
  const a = at(profMark); drawProfile(); draw();
  $('profSum').textContent = `· km ${(profMark / 1000).toFixed(2).replace('.', ',')} · ${Math.round(a.ele)} m`;
}
function profSummary() {
  if (!ELE.length) return '';
  return `· ↗ ${Math.round(UP[UP.length - 1])} m`;
}

/* ---------- position: GPS or simulation ---------- */
let started = false, me = null, heading = null, walked = 0, gpsWatch = null, simTimer = null, maxAlong = 0;
const visited = new Set(), found = new Set(), notified = new Set();
function onPosition(lat, lon, acc, gpsHeading, src) {
  const [x, y] = toXY(lat, lon);
  if (me && gpsHeading == null && !compassOn) { const d = dist([me.x, me.y], [x, y]); if (d > 2) heading = (Math.atan2(x - me.x, y - me.y) * 180 / Math.PI + 360) % 360; }
  if (gpsHeading != null && !isNaN(gpsHeading) && !compassOn) heading = gpsHeading;
  me = {x, y, acc: acc || 5};
  // simulation with the map turned to the walking direction (smoothly), as when walking with the phone in hand
  if (src === 'sim' && headingUp && heading != null) { const t = heading * Math.PI / 180; let d = t - view.rot; d = Math.atan2(Math.sin(d), Math.cos(d)); view.rot += d * 0.35; }
  const s = snap([x, y]);
  checkOffRoute(s.off);
  // progress only advances when close to the track, and never jumps more than 120 m at once
  if (s.off <= TRACK_M) {
    if (!started) { started = true; maxAlong = s.along; } // first fix: start counting from where you join the route
    else if (s.along >= maxAlong - 30 && s.along <= maxAlong + 120) maxAlong = Math.max(maxAlong, s.along);
  }
  walked = maxAlong;
  $('progBar').style.width = (100 * walked / TOTAL) + '%';
  $('sDone').textContent = fmtM(walked); $('sLeft').textContent = fmtM(Math.max(0, TOTAL - walked));
  showClimb();
  // proximity to points
  let nextI = -1, nd = Infinity;
  const hits = []; // [order, distance, index, kind]: treasures first, then the nearest
  POIS.forEach((p, i) => {
    const d = dist([x, y], [p.x, p.y]);
    if (isInfo(p)) { if (isClose(p, d, s) && !notified.has(p.id)) { notified.add(p.id); hits.push([2, d, i, 'info']); } return; }
    if (isTreasure(p) && d <= TREASURE_M && !found.has(p.id)) { found.add(p.id); hits.push([0, d, i, 'tre']); }
    else if (!isTreasure(p) && isClose(p, d, s) && !notified.has(p.id)) { notified.add(p.id); visited.add(p.id); hits.push([1, d, i, 'poi']); }
    if (!visited.has(p.id) && !found.has(p.id) && d < nd) { nd = d; nextI = i; }
  });
  if (hits.length) {
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const [, , i, k] = hits[0], more = hits.filter(h => h[3] !== 'info').length - (k === 'info' ? 0 : 1);
    if (k === 'info') arriveInfo(i); else arrive(i, k === 'tre', more);
    hits.slice(1).forEach(h => log((h[3] === 'tre' ? 'Tresor: ' : h[3] === 'info' ? 'Indicació: ' : 'Arribada: ') + POIS[h[2]].name + ' (alhora)'));
  }
  updateNext(nextI, nd); updateTreasures(); drawProfile();
  if (follow) centreOn(x, y); else draw();
  if (src === 'gps') $('gpsNote').textContent = `GPS: precisió ±${Math.round(acc)} m · a ${Math.round(s.off)} m del track`;
}
// A point set back from the track would never be reached: it fires when passing the closest spot of the route.
const isClose = (p, d, s) => d <= NEAR_M || (p.off > NEAR_M && s.off <= TRACK_M && Math.abs(s.along - p.along) <= NEAR_M);
// Off the route only after several readings in a row (one bad GPS reading is not enough), and said once until back on it.
let offCount = 0, offWarned = false;
function checkOffRoute(off) {
  offCount = off > OFFROUTE_M ? offCount + 1 : 0;
  $('offroute').hidden = offCount < OFF_READINGS;
  if (offCount >= OFF_READINGS && !offWarned) {
    offWarned = true;
    if (navigator.vibrate) navigator.vibrate([400, 150, 400]);
    speak('Atenció, estàs fora de la ruta.');
    log('Fora de la ruta: a ' + Math.round(off) + ' m del track');
  }
  if (off <= OFFROUTE_M - 10) offWarned = false;
}
function updateNext(i, d) {
  let badge, name, txt;
  if (i < 0) { badge = '✓'; name = 'Has vist tots els punts'; txt = 'Ruta completada'; }
  else { const p = POIS[i]; badge = isTreasure(p) ? '★' : p.num; name = p.name; txt = isNaN(d) ? 'Primer punt' : 'Punt més proper · ' + fmtM(d); $('nextBtn').dataset.i = i; }
  $('nBadge').textContent = $('mBadge').textContent = badge;
  $('nName').textContent = $('mName').textContent = name;
  $('nDist').textContent = $('mDist').textContent = txt;
}
$('nextBtn').onclick = () => { const i = $('nextBtn').dataset.i; if (i != null) openSheet(+i); };
function showClimb() {
  if (!UP.length) return;
  const done = climbAt(walked), all = UP[UP.length - 1];
  $('sUp').textContent = Math.round(done) + ' m'; $('sUpLeft').textContent = Math.round(all - done) + ' m';
}
function updateTreasures() { const n = POIS.filter(isTreasure).length; $('sTre').textContent = `${found.size}/${n}`; $('sTre').parentElement.hidden = !n; }
function arrive(i, treasure, more = 0) {
  const p = POIS[i], far = !treasure && p.off > NEAR_M; // far: seen from the track, not reached
  if (navigator.vibrate) navigator.vibrate(treasure ? [200, 100, 200, 100, 400] : [250, 120, 250]);
  const t = $('toast'); popIdx = -1; t.className = 'toast';
  t.innerHTML = `<span class="t">${treasure ? 'Tresor trobat!' : far ? `A ${fmtM(dist([me.x, me.y], [p.x, p.y]))} de tu` : 'Has arribat'}</span><h3>${treasure ? '★ ' : p.num + '. '}${esc(p.name)}</h3>${more ? `<p class="muted">I ${more} punt${more > 1 ? 's' : ''} més a prop: els tens a la llista.</p>` : ''}<div class="row"><button class="primary grow" id="tOpen">Obre la fitxa</button><button id="tClose">Continua</button></div>`;
  t.hidden = false;
  $('tOpen').onclick = () => { t.hidden = true; openSheet(i); };
  $('tClose').onclick = () => { t.hidden = true; };
  speak(treasure ? `Enhorabona! Has trobat el ${p.name}.` : far ? `Tens a prop: ${p.name}.` : `Has arribat a ${p.name}.`);
  log((treasure ? 'Tresor: ' : 'Arribada: ') + p.name);
}
// A direction or warning: short notice, it does not count as a visited point.
function arriveInfo(i) {
  const p = POIS[i];
  if (navigator.vibrate) navigator.vibrate(150);
  showPop(i);
  speak(p.name.toLowerCase());
  log('Indicació: ' + p.name);
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
// Simulation: walks the track by itself (to feel the route from home). Speed ×1 (walking), ×4 or ×10.
const SPEEDS = [1, 4, 10];
let simSpeed = 4;
function stopSim() {
  if (!simTimer) return;
  clearInterval(simTimer); simTimer = null; $('simBtn').textContent = 'Simula'; $('speedBtn').hidden = true;
  if (headingUp && !compassOn) { headingUp = false; $('rotBtn').setAttribute('aria-pressed', false); view.rot = 0; draw(); }
}
const simNote = () => { $('gpsNote').textContent = `Simulació: camina sola pel track${simSpeed === 1 ? ' a pas normal' : ` ${simSpeed} vegades més ràpid`}. El mapa gira cap on camines (botó N per treure-ho).`; };
function startSim() {
  if (simTimer) return;
  if (gpsWatch != null) $('gpsBtn').click();
  speak('', true); // unlocks speech on iOS (needs a tap)
  let along = walked >= TOTAL - 1 ? 0 : Math.max(0, walked); started = true;
  if (along === 0) { maxAlong = walked = 0; visited.clear(); found.clear(); notified.clear(); offCount = 0; offWarned = false; }
  headingUp = true; $('rotBtn').setAttribute('aria-pressed', true);
  view.s = Math.max(view.s, 2.2);
  simTimer = setInterval(() => {
    along += 1.4 * simSpeed * 0.2; // 1.4 m/s walking, every 0.2 s
    if (along >= TOTAL) { along = TOTAL; stopSim(); }
    const a = pointAt(along), b = pointAt(Math.min(TOTAL, along + 8));
    const h = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360;
    const [lat, lon] = toLL(a);
    onPosition(lat, lon, 5, h, 'sim');
  }, 200);
  $('simBtn').textContent = 'Atura'; $('speedBtn').hidden = false; $('speedBtn').textContent = '×' + simSpeed;
  setFollow(true); keepAwake(); simNote(); log('Simulació ×' + simSpeed);
}
$('simBtn').onclick = () => simTimer ? stopSim() : startSim();
$('speedBtn').onclick = () => { simSpeed = SPEEDS[(SPEEDS.indexOf(simSpeed) + 1) % SPEEDS.length]; $('speedBtn').textContent = '×' + simSpeed; simNote(); };
$('demoBtn').onclick = () => { show(true); history.pushState({nav: 1}, ''); startSim(); };
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
  if (nav) { resize(); if (!me) fitRoute(); drawProfile(); } else { if ($('nav').classList.contains('full')) setFull(false); checkOffline(); }
}
$('startBtn').onclick = () => { show(true); history.pushState({nav: 1}, ''); };
$('backBtn').onclick = () => history.back();
addEventListener('popstate', () => { closeSheet(); show(false); });

/* ---------- start ---------- */
(async function init() {
  updateNet();
  try {
    [D, BASE] = await Promise.all([fetch('data.json').then(r => r.json()), fetch('basemap.json').then(r => r.json())]);
  } catch (e) { log('No s\'han pogut carregar les dades: ' + e.message); alertMsg('No s\'han pogut carregar les dades. Obre l\'app amb connexió la primera vegada.'); return; }
  LAT0 = D.route.track[0][0]; LON0 = D.route.track[0][1]; KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
  prepTrack();
  POIS = D.pois.map(p => { const [x, y] = toXY(p.lat, p.lon); return {...p, x, y, along: 0}; });
  POIS.forEach(p => { const s = snap([p.x, p.y]); p.along = s.along; p.off = s.off; });
  POIS.sort((a, b) => a.along - b.along);
  let num = 0; POIS.forEach(p => { if (!isInfo(p) && !isTreasure(p)) p.num = ++num; }); // numbered in walking order; information points and treasures apart
  buildLayers(); renderHome(); updateTreasures(); updateNext(0, NaN);
  buildClimb();
  $('profBox').hidden = !ELE.length; $('profSum').textContent = profSummary(); $('profMode').hidden = TOTAL <= TRAM_M * 1.5;
  document.querySelectorAll('.stat.ele').forEach(t => t.hidden = !ELE.length); showClimb();
  log(`Ruta: ${fmtM(TOTAL)}, ${POIS.filter(p => !isInfo(p)).length} punts d'interès, ${POIS.filter(isInfo).length} d'informació, ${orthoList().length} tessel·les d'ortofoto per descarregar`);
  checkOffline();
})();
