/* El teu record (prototip, 24/11/2026). Versió mínima del «record tipus Relive», només a la web app.
 * - Recorre el track conegut de la ruta sobre el relleu en 3D (MapLibre) i s'atura a cada foto teva.
 * - Fa servir les fotos del mòbil (IndexedDB), publicades o no: no cal esperar cap aprovació.
 * - Tot es dibuixa en un canvas 9:16 (#comp): és el que es veu i el que es grava en vídeo (MediaRecorder).
 * Fonts: ortofoto ICGC (CC BY 4.0), relleu AWS Terrain Tiles (Terrarium), dades de la ruta de Natura Local.
 */
const $ = id => document.getElementById(id);
const W = 360, H = 640;                         // mida lògica de l'escena (el canvas és el doble)
const T_INTRO = 3000, T_FOTO = 2800, T_OUTRO = 4000, MAX_FOTOS = 12;
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const GROC = '#e8b02e', VERD = '#2f5d3a';

function avis(text, ms = 3500) {
  const a = $('avis'); a.textContent = text; a.hidden = false;
  clearTimeout(avis.t); avis.t = setTimeout(() => a.hidden = true, ms);
}
const estat = t => $('estat').textContent = t;
const ease = x => x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
const lerp = (a, b, x) => a + (b - a) * x;
const angDif = (a, b) => ((b - a + 540) % 360) - 180;
function rumb(a, b) {                           // [lat,lon] → graus (0 = nord)
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

let ruta, track, acum, total, mapa, fotos = [], linia = [], cam0, camVista, video = null, reproduint = false;

/* Punt del track a una distància (m) des de l'inici */
function punt(d) {
  d = Math.max(0, Math.min(total, d));
  let i = acum.findIndex(a => a >= d); if (i <= 0) return track[0];
  const x = (d - acum[i - 1]) / ((acum[i] - acum[i - 1]) || 1);
  return [lerp(track[i - 1][0], track[i][0], x), lerp(track[i - 1][1], track[i][1], x)];
}
function fet(d) {                                // tros recorregut, per a la línia groga
  const c = [];
  for (let i = 0; i < track.length && acum[i] <= d; i++) c.push([track[i][1], track[i][0]]);
  const p = punt(d); c.push([p[1], p[0]]);
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: c.length > 1 ? c : [c[0], c[0]] } };
}
const camSeguint = (d, rumbAct) => { const p = punt(d); return { center: [p[1], p[0]], zoom: 15.3, pitch: 62, bearing: rumbAct }; };

/* Línia de temps: intro, trams de viatge, una parada per foto, final */
function ferLinia() {
  const viatge = Math.min(18000, Math.max(10000, total / 1000 * 4000));   // record de ~20–30 s, bo per a stories
  const parades = fotos.map(f => f.d).sort((a, b) => a - b);
  const l = [{ tipus: 'intro', dur: T_INTRO }];
  let d = 0;
  fotos.forEach(f => {
    if (f.d > d) l.push({ tipus: 'viatge', d0: d, d1: f.d, dur: (f.d - d) / total * viatge });
    l.push({ tipus: 'foto', d0: f.d, d1: f.d, dur: T_FOTO, foto: f });
    d = f.d;
  });
  if (d < total) l.push({ tipus: 'viatge', d0: d, d1: total, dur: (total - d) / total * viatge });
  l.push({ tipus: 'outro', d0: total, d1: total, dur: T_OUTRO });
  let t = 0; l.forEach(s => { s.t0 = t; t += s.dur; s.t1 = t; });
  return l;
}

/* ---------- Dibuix del canvas ---------- */
const ctx = $('comp').getContext('2d');
function text(t, x, y, mida, pes = 700, color = '#fff', alinea = 'left') {
  ctx.font = `${pes} ${mida}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = alinea; ctx.fillText(t, x, y);
}
function textAjustat(t, x, y, ample, mida, interlinia) {
  ctx.font = `700 ${mida}px ${FONT}`;
  const mots = t.split(' '); let l = '', n = 0;
  for (const m of mots) {
    if (ctx.measureText(l + m).width > ample && l) { ctx.fillText(l.trim(), x, y + n * interlinia); l = ''; n++; }
    l += m + ' ';
  }
  ctx.fillText(l.trim(), x, y + n * interlinia); return n + 1;
}
function rodo(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function dibuixa(s, x, dAct) {
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.drawImage(mapa.getCanvas(), 0, 0, W, H);
  // capçalera
  const g = ctx.createLinearGradient(0, 0, 0, 150); g.addColorStop(0, 'rgba(0,0,0,.72)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 150);
  ctx.letterSpacing = '2px'; text('NATURA LOCAL', 18, 30, 11, 800, GROC); ctx.letterSpacing = '0px';
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  const n = textAjustat(ruta.name, 18, 56, W - 36, 21, 25);
  const kmRuta = parseFloat(ruta.distancia), km = (dAct / total * kmRuta).toFixed(1).replace('.', ',');   // escalat a la distància oficial
  text(`${km} km de ${kmRuta.toFixed(1).replace('.', ',')} km · ${ruta.desnivell.replace(/\.00 meters/, ' m')} de desnivell`, 18, 56 + n * 25, 13, 500, 'rgba(255,255,255,.9)');
  // foto
  if (s.tipus === 'foto') {
    const f = s.foto, entra = Math.min(1, x / .14), surt = Math.min(1, (1 - x) / .1), a = Math.min(entra, surt);
    const esc = .86 + .14 * ease(entra);
    const amax = 296, hmax = 330, k = Math.min(amax / f.img.width, hmax / f.img.height);
    const w = f.img.width * k, h = f.img.height * k, cx = W / 2, cy = 330;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(esc, esc);
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff'; rodo(-w / 2 - 8, -h / 2 - 8, w + 16, h + 16, 12); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.save(); rodo(-w / 2, -h / 2, w, h, 6); ctx.clip(); ctx.drawImage(f.img, -w / 2, -h / 2, w, h); ctx.restore();
    ctx.font = `700 14px ${FONT}`; const tw = Math.min(W - 40, ctx.measureText('📍 ' + f.zona).width + 24);
    ctx.fillStyle = 'rgba(0,0,0,.72)'; rodo(-tw / 2, h / 2 + 18, tw, 30, 15); ctx.fill();
    text('📍 ' + f.zona, 0, h / 2 + 38, 14, 700, '#fff', 'center');
    ctx.restore();
  }
  // placa final
  if (s.tipus === 'outro' && x > .35) {
    const a = Math.min(1, (x - .35) / .25);
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(15,25,18,.62)'; ctx.fillRect(0, 0, W, H);
    text('Fet amb', W / 2, 268, 15, 500, 'rgba(255,255,255,.85)', 'center');
    text('Natura Local', W / 2, 306, 34, 800, '#fff', 'center');
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `600 16px ${FONT}`;
    ctx.fillText(ruta.name, W / 2, 342);
    const kmR = parseFloat(ruta.distancia).toFixed(1).replace('.', ',') + ' km';
    text(fotos.length ? `${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'} · ${kmR}` : kmR, W / 2, 368, 13, 500, 'rgba(255,255,255,.8)', 'center');
    text('naturalocal.net', W / 2, 410, 16, 700, GROC, 'center');
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, H - 16, W, 16);
  text('Ortofoto © ICGC · Relleu: AWS Terrain Tiles · Ruta: Natura Local', W / 2, H - 5, 8.5, 500, 'rgba(255,255,255,.85)', 'center');
}

/* ---------- Animació ---------- */
/* Dibuixa el fotograma del temps t (ms). «st» guarda el rumb suavitzat entre fotogrames. */
function fotograma(t, st) {
  const s = linia.find(s => t <= s.t1) || linia[linia.length - 1];
  const x = Math.min(1, (t - s.t0) / (s.dur || 1));
  if (s.tipus !== window.recordSeg) { window.recordSeg = s.tipus; (window.recordSegs = window.recordSegs || []).push(s.tipus); }
  let cam, dAct = 0;
  if (s.tipus === 'intro') {
    const y = ease(Math.max(0, (x - .3) / .7));
    cam = { center: [lerp(camVista.center[0], cam0.center[0], y), lerp(camVista.center[1], cam0.center[1], y)],
            zoom: lerp(camVista.zoom, cam0.zoom, y), pitch: lerp(camVista.pitch, cam0.pitch, y),
            bearing: camVista.bearing + angDif(camVista.bearing, cam0.bearing) * y + (1 - y) * x * 12 };
  } else if (s.tipus === 'outro') {
    dAct = total;
    const y = ease(Math.min(1, x / .55)), u = st.ultim;
    cam = { center: [lerp(u.center[0], camVista.center[0], y), lerp(u.center[1], camVista.center[1], y)],
            zoom: lerp(u.zoom, camVista.zoom, y), pitch: lerp(u.pitch, camVista.pitch, y),
            bearing: u.bearing + angDif(u.bearing, camVista.bearing) * y };
  } else {
    dAct = s.tipus === 'foto' ? s.d0 : lerp(s.d0, s.d1, x);
    const obj = rumb(punt(dAct), punt(dAct + 220));
    const k = Math.min(1, (t - st.tAnt) / 16.7) * (s.tipus === 'foto' ? .02 : .06);     // suavitzat independent dels fps
    st.rumb = (st.rumb + angDif(st.rumb, obj) * k + 360) % 360;
    cam = st.ultim = camSeguint(dAct, st.rumb);
  }
  st.tAnt = t;
  mapa.jumpTo(cam);
  const p = punt(dAct);
  mapa.getSource('fet').setData(fet(dAct));
  mapa.getSource('jo').setData({ type: 'Point', coordinates: [p[1], p[0]] });
  return () => { dibuixa(s, x, dAct); window.recordFrames = (window.recordFrames || 0) + 1; };
}
const nouEstat = () => ({ rumb: cam0.bearing, ultim: cam0, tAnt: 0 });
const botons = actius => ['torna', 'baixa', 'comparteix'].forEach(id => $(id).disabled = !actius);

/* Reproducció en temps real (el que es veu a la pantalla) */
function reprodueix() {
  if (reproduint) return Promise.resolve();
  reproduint = true; botons(false);
  const durada = linia[linia.length - 1].t1, st = nouEstat();
  let inici = null;
  return new Promise(fi => {
    function pas(ara) {
      if (inici === null) inici = ara;
      const t = Math.min(durada, ara - inici);
      fotograma(t, st)();
      if (t < durada) requestAnimationFrame(pas);
      else { reproduint = false; botons(true); fi(); }
    }
    requestAnimationFrame(pas);
  });
}

/* ---------- Vídeo ----------
 * 1r intent: WebCodecs (VideoEncoder H.264) + mp4-muxer. Es dibuixa fotograma a fotograma a 30 fps exactes,
 *   esperant que el mapa estigui carregat: el vídeo surt fluid encara que el mòbil vagi lent.
 * 2n intent: MediaRecorder (en temps real), si el navegador no té WebCodecs. */
const FPS = 30;
async function videoWebCodecs() {
  if (!window.VideoEncoder || !window.Mp4Muxer) return null;
  let config = null;
  for (const codec of ['avc1.42001f', 'avc1.4d0028', 'avc1.640028']) {
    const c = { codec, width: 720, height: 1280, bitrate: 3e6, framerate: FPS };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; } } catch { }
  }
  if (!config) return null;
  const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), fastStart: 'in-memory',
                                      video: { codec: 'avc', width: 720, height: 1280, frameRate: FPS } });
  let error = null;
  const enc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: e => error = e });
  enc.configure(config);
  const durada = linia[linia.length - 1].t1, n = Math.ceil(durada / 1000 * FPS), st = nouEstat();
  for (let i = 0; i <= n && !error; i++) {
    const t = Math.min(durada, i * 1000 / FPS);
    const dibuixa = fotograma(t, st);
    mapa.redraw();
    const limit = performance.now() + 1500;                 // si falten rajoles, les espera (com a molt 1,5 s)
    while (!mapa.areTilesLoaded() && performance.now() < limit) { await new Promise(r => setTimeout(r, 40)); mapa.redraw(); }
    dibuixa();
    if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));   // deixa respirar la pàgina
    const vf = new VideoFrame($('comp'), { timestamp: Math.round(t * 1000), duration: Math.round(1e6 / FPS) });
    enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 }); vf.close();
    if (enc.encodeQueueSize > 8) await new Promise(r => enc.addEventListener('dequeue', r, { once: true }));
    if (i % 15 === 0) estat(`Fent el vídeo… ${Math.round(i / n * 100)} %`);
  }
  await enc.flush(); enc.close();
  if (error) { console.error(error); return null; }
  muxer.finalize();
  return new File([muxer.target.buffer], `record-${ruta.id}-natura-local.mp4`, { type: 'video/mp4' });
}
async function videoMediaRecorder() {
  if (!window.MediaRecorder || !$('comp').captureStream) return null;
  const tipus = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!tipus) return null;
  const flux = $('comp').captureStream(FPS), trossos = [];
  const rec = new MediaRecorder(flux, { mimeType: tipus, videoBitsPerSecond: 5e6 });
  rec.ondataavailable = e => e.data.size && trossos.push(e.data);
  const parat = new Promise(r => rec.onstop = r);
  rec.start(250); reproduint = false; await reprodueix(); await new Promise(r => setTimeout(r, 300));
  rec.stop(); await parat;
  if (!trossos.length) return null;
  const mime = tipus.split(';')[0];
  return new File([new Blob(trossos, { type: mime })], `record-${ruta.id}-natura-local.${mime.includes('mp4') ? 'mp4' : 'webm'}`, { type: mime });
}
$('baixa').onclick = async () => {
  if (reproduint) return;
  reproduint = true; botons(false);
  estat('Fent el vídeo… no tanquis la pantalla.');
  try { video = await videoWebCodecs(); } catch (e) { console.error(e); video = null; }
  if (!video) { estat('Gravant el vídeo… no tanquis la pantalla.'); try { video = await videoMediaRecorder(); } catch (e) { console.error(e); video = null; } }
  reproduint = false; botons(true);
  if (!video) { estat("Aquest navegador no pot fer el vídeo. Pots compartir l'enllaç amb «Comparteix»."); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(video); a.download = video.name;
  document.body.appendChild(a); a.click(); a.remove();
  estat(`Vídeo fet (${(video.size / 1048576).toFixed(1).replace('.', ',')} MB). Si no s'ha baixat sol, prem «Comparteix».`);
};
$('comparteix').onclick = async () => {
  const url = (ruta.urlApp || ruta.url) + '?utm_source=record&utm_medium=compartir&utm_campaign=ruta-' + ruta.id;
  const textC = `El meu record de la ${ruta.name} amb Natura Local. Fes-la tu també: ${url}`;
  try {
    if (video && navigator.canShare && navigator.canShare({ files: [video] })) await navigator.share({ files: [video], title: ruta.name, text: textC });
    else if (navigator.share) await navigator.share({ title: ruta.name, text: textC, url });
    else { await navigator.clipboard.writeText(textC); avis("Enllaç copiat. Enganxa'l on vulguis."); }
  } catch (e) { if (e.name !== 'AbortError') avis("No s'ha pogut compartir des d'aquest navegador."); }
};
window.comparteixRecord = $('comparteix').onclick;
$('torna').onclick = () => reprodueix();

/* ---------- Inici ---------- */
function encaixa() {
  const s = Math.min(1.5, (innerWidth - 32) / W, (innerHeight - 210) / H);
  $('caixa').style.width = W * s + 'px'; $('caixa').style.height = H * s + 'px';
  $('escena').style.transform = `scale(${s})`;
}
addEventListener('resize', encaixa);

async function inicia() {
  encaixa();
  estat('Preparant el record…');
  const d = await (await fetch('dades/data.json')).json();
  ruta = d.route; track = ruta.track;
  acum = [0]; for (let i = 1; i < track.length; i++) acum.push(acum[i - 1] + dist(track[i - 1], track[i]));
  total = acum[acum.length - 1];
  const zones = zonesDeRuta(track, d.pois);

  // Les teves fotos d'aquesta ruta, en qualsevol estat menys rebutjada, en l'ordre del recorregut
  const meves = (await Fotos.totes()).filter(f => f.estat !== 'rebutjada' && zones.perId[f.zona]);
  for (const f of meves) {
    const z = zones.perId[f.zona];
    let iMin = 0, dMin = Infinity; track.forEach((p, i) => { const dd = dist(p, z.pos); if (dd < dMin) { dMin = dd; iMin = i; } });
    try { fotos.push({ id: f.id, zona: z.nom, pos: z.pos, d: acum[iMin], data: f.data, img: await createImageBitmap(f.blob) }); } catch { }
  }
  fotos.sort((a, b) => a.d - b.d || a.data.localeCompare(b.data));
  fotos = fotos.slice(0, MAX_FOTOS);

  const lonlat = track.map(p => [p[1], p[0]]);
  try {
    mapa = new maplibregl.Map({
      container: 'rmapa', interactive: false, attributionControl: false, preserveDrawingBuffer: true,
      pixelRatio: 2, fadeDuration: 0, maxPitch: 75,
      style: {
        version: 8,
        sources: {
          orto: { type: 'raster', tileSize: 256, maxzoom: 19,
                  tiles: ['https://geoserveis.icgc.cat/icc_mapesmultibase/noutm/wmts/orto/GRID3857/{z}/{x}/{y}.jpeg'] },
          dem: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
                 tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'] },
          ruta: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: lonlat } } },
          fet: { type: 'geojson', data: fet(0) },
          jo: { type: 'geojson', data: { type: 'Point', coordinates: lonlat[0] } },
          fotos: { type: 'geojson', data: { type: 'FeatureCollection', features: fotos.map(f => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.pos[1], f.pos[0]] } })) } }
        },
        layers: [
          { id: 'fons', type: 'background', paint: { 'background-color': '#bcd3e2' } },
          { id: 'orto', type: 'raster', source: 'orto' },
          { id: 'ruta', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 3, 'line-opacity': .75 } },
          { id: 'fet-vora', type: 'line', source: 'fet', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2b2620', 'line-width': 8 } },
          { id: 'fet', type: 'line', source: 'fet', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': GROC, 'line-width': 5 } },
          { id: 'fotos', type: 'circle', source: 'fotos', paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#2b2620', 'circle-stroke-width': 2.5 } },
          { id: 'jo', type: 'circle', source: 'jo', paint: { 'circle-radius': 8, 'circle-color': GROC, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } }
        ],
        terrain: { source: 'dem', exaggeration: 1.4 }
      }
    });
  } catch (e) {
    estat('Aquest mòbil no pot mostrar el mapa en 3D (cal WebGL).'); console.error(e); return;
  }
  await new Promise(r => mapa.on('load', r));
  const bounds = lonlat.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(lonlat[0], lonlat[0]));
  const c = mapa.cameraForBounds(bounds, { padding: { top: 170, bottom: 90, left: 40, right: 40 }, pitch: 0 });
  camVista = { center: [c.center.lng, c.center.lat], zoom: c.zoom - .2, pitch: 48, bearing: -20 };
  cam0 = camSeguint(0, rumb(punt(0), punt(220)));
  mapa.jumpTo(camVista);
  // Precarrega les rajoles del principi i espera (com a molt 8 s)
  await Promise.race([new Promise(r => mapa.once('idle', r)), new Promise(r => setTimeout(r, 8000))]);
  linia = ferLinia();
  estat(fotos.length ? `${fotos.length} ${fotos.length === 1 ? 'foto teva' : 'fotos teves'} en el recorregut` : 'Encara no tens fotos d\'aquesta ruta: el record només mostra el recorregut.');
  window.recordLlest = true;
  await reprodueix();
}
inicia().catch(e => { estat('No s\'ha pogut fer el record.'); console.error(e); });
