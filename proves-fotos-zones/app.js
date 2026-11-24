/* Prototip: fotos de visitants agrupades per zones (icona de càmera + carrusel). */
const $ = id => document.getElementById(id);
const ICONA_CAM = '<svg viewBox="0 0 24 24"><path d="M9 4h6l1.5 2H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
let zones, mapa, capaCam, ultimaPos = null;
const urls = [];                               // object URLs a alliberar

function avis(text, ms = 3200) {
  const a = $('avis'); a.textContent = text; a.hidden = false;
  clearTimeout(avis.t); avis.t = setTimeout(() => a.hidden = true, ms);
}

async function inicia() {
  const d = await (await fetch('dades/data.json')).json();
  const r = d.route;
  $('titol').textContent = r.name;
  document.title = r.name + ' · fotos de visitants (prototip)';
  zones = zonesDeRuta(r.track, d.pois);

  mapa = L.map('mapa', { zoomControl: false, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(mapa);
  L.control.zoom({ position: 'topright' }).addTo(mapa);
  const linia = L.polyline(r.track, { color: '#2f5d3a', weight: 5, opacity: .85 }).addTo(mapa);
  mapa.fitBounds(linia.getBounds(), { padding: [30, 30] });
  d.pois.forEach(p => L.marker([p.lat, p.lon], {
    icon: L.divIcon({ className: '', html: '<div class="poi"></div>', iconSize: [14, 14] }),
    keyboard: false
  }).bindTooltip(p.name).addTo(mapa));
  capaCam = L.layerGroup().addTo(mapa);
  mapa.on('click', clicMapa);
  if (ultimaPos) posaJo(ultimaPos);
  await pinta();
}

/* Una icona de càmera per zona que té fotos aprovades (o pendents meves). */
async function pinta() {
  capaCam.clearLayers();
  const perZona = {};
  (await Fotos.totes()).filter(f => ['aprovada', 'pendent', 'meva'].includes(f.estat))
    .forEach(f => (perZona[f.zona] ||= []).push(f));
  Object.entries(perZona).forEach(([zid, llista]) => {
    const z = zones.perId[zid]; if (!z) return;
    llista.sort((a, b) => (a.estat === 'aprovada' ? 0 : 1) - (b.estat === 'aprovada' ? 0 : 1) || a.data.localeCompare(b.data));
    const nomesPend = llista.every(f => f.estat !== 'aprovada');
    const m = L.marker(z.pos, {
      icon: L.divIcon({ className: 'cam' + (nomesPend ? ' cam-pend' : ''), iconSize: [38, 38], iconAnchor: [19, 50],
        html: `<div class="cam-b" role="button" aria-label="${llista.length} fotos: ${z.nom}">${ICONA_CAM}<span class="cam-n">${llista.length}</span></div>` }),
      zIndexOffset: 500
    });
    m.on('click', () => obreCarrusel(z, llista));
    capaCam.addLayer(m);
  });
}

/* ---------- Carrusel ---------- */
let carLlista = [], carI = 0;
function obreCarrusel(z, llista) {
  urls.splice(0).forEach(u => URL.revokeObjectURL(u));
  carLlista = llista; carI = 0;
  $('car-t').textContent = z.nom;
  $('car-pista').innerHTML = llista.map((f, i) => {
    const u = URL.createObjectURL(f.blob); urls.push(u);
    return `<div class="car-dia">${f.estat === 'pendent' ? '<span class="car-pend">Pendent de revisió · només la veus tu</span>' : f.estat === 'meva' ? '<span class="car-pend">No publicada · només la veus tu</span>' : ''}<img src="${u}" alt="Foto ${i + 1} de ${llista.length}: ${z.nom}"></div>`;
  }).join('');
  $('carrusel').hidden = false;
  $('car-pista').scrollLeft = 0;
  peuCarrusel();
}
function peuCarrusel() {
  const f = carLlista[carI]; if (!f) return;
  const data = new Date(f.data).toLocaleDateString('ca', { day: 'numeric', month: 'long', year: 'numeric' });
  $('car-credit').textContent = f.estat === 'meva' ? `La teva foto · ${data}` : `Foto: ${f.autor || 'Visitant'} · CC BY 4.0 · ${data}`;
  $('car-num').textContent = `${carI + 1} / ${carLlista.length}`;
  $('car-denuncia').hidden = f.estat !== 'aprovada';
  $('car-ant').style.visibility = carI > 0 ? 'visible' : 'hidden';
  $('car-seg').style.visibility = carI < carLlista.length - 1 ? 'visible' : 'hidden';
}
function veesA(i) {
  const p = $('car-pista');
  p.scrollTo({ left: i * p.clientWidth, behavior: 'smooth' });
}
$('car-pista').addEventListener('scroll', () => {
  const p = $('car-pista'), i = Math.round(p.scrollLeft / p.clientWidth);
  if (i !== carI) { carI = i; peuCarrusel(); }
});
$('car-ant').onclick = () => veesA(Math.max(0, carI - 1));
$('car-seg').onclick = () => veesA(Math.min(carLlista.length - 1, carI + 1));
$('car-tanca').onclick = () => { $('carrusel').hidden = true; };
document.addEventListener('keydown', e => {
  if ($('carrusel').hidden) return;
  if (e.key === 'Escape') $('car-tanca').click();
  if (e.key === 'ArrowLeft') $('car-ant').click();
  if (e.key === 'ArrowRight') $('car-seg').click();
});
$('car-denuncia').onclick = async () => {
  const f = carLlista[carI]; if (!f) return;
  await Fotos.estat(f.id, 'denunciada');
  $('carrusel').hidden = true;
  avis('Gràcies. L\'hem amagada fins que la tornem a revisar.');
  pinta();
};

/* ---------- Posició (només es fan fotos a la ruta) ---------- */
let simula = false, puntJo = null;
function posaJo(pos) {
  ultimaPos = pos;
  if (!mapa) return;
  if (!puntJo) puntJo = L.circleMarker(pos, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(mapa);
  else puntJo.setLatLng(pos);
}
if (navigator.geolocation) navigator.geolocation.watchPosition(
  p => { if (!simula) posaJo([p.coords.latitude, p.coords.longitude]); }, () => {},
  { enableHighAccuracy: true, maximumAge: 5000 });
$('simula').onclick = () => {
  simula = !simula;
  $('simula').setAttribute('aria-pressed', simula);
  $('simula').textContent = simula ? 'Prova des de casa: toca el mapa per situar-te' : 'Prova des de casa';
  if (simula) avis('Mode prova: toca el mapa on vols ser. Al mòbil real no cal.', 4500);
};
function clicMapa(e) { if (simula) posaJo([e.latlng.lat, e.latlng.lng]); }

/* ---------- Fer una foto ---------- */
let fotoNova = null;
$('afegeix').onclick = () => {
  const det = ultimaPos && zones.de(ultimaPos);
  if (!det) {
    avis(ultimaPos ? 'Només pots fer fotos mentre fas la ruta. Ara ets lluny del recorregut.'
                   : 'Encara no sabem on ets. Activa la ubicació i torna-ho a provar.', 4500);
    return;
  }
  zonaFoto = det.zona;
  $('fitxer').value = '';
  $('fitxer').click();
};
let zonaFoto = null;

$('fitxer').onchange = async () => {
  const f = $('fitxer').files[0]; if (!f || !zonaFoto) return;
  let blob;
  try { blob = await netejaFoto(f); }
  catch { avis('No hem pogut llegir aquesta foto. Prova-ho una altra vegada.'); return; }
  fotoNova = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), zona: zonaFoto.id,
               data: new Date().toISOString(), estat: 'meva', blob };
  await Fotos.desa(fotoNova);                 // es desa al mòbil: no es perd si no la publica
  const u = URL.createObjectURL(blob); urls.push(u);
  $('envia-img').src = u;
  $('envia-zona').textContent = zonaFoto.nom;
  $('avis').hidden = true;
  $('envia').hidden = false;
  pinta();
};
$('envia-no').onclick = () => { $('envia').hidden = true; avis('Desada. En acabar la ruta et preguntarem si la vols publicar.'); };
$('envia-ara').onclick = () => { $('envia').hidden = true; obrePublica([fotoNova], false); };

/* ---------- Publicar (una ara, o les de la ruta en acabar) ---------- */
let perPublicar = [];
function obrePublica(llista, final) {
  perPublicar = llista;
  $('avis').hidden = true;
  $('pub-t').textContent = final ? 'Has acabat la ruta!' : 'Publica la teva foto';
  $('pub-intro').textContent = final
    ? `Vols publicar les teves fotos al recorregut de Natura Local? Treu la marca de les que no vulguis.`
    : 'Sortirà al mapa de la ruta, al punt on l\'has feta.';
  $('pub-graella').innerHTML = llista.map(f => {
    const u = URL.createObjectURL(f.blob); urls.push(u);
    const z = zones.perId[f.zona];
    return `<label class="g-f"><input type="checkbox" value="${f.id}" checked ${final ? '' : 'hidden'}><img src="${u}" alt=""><span>${z ? z.nom : ''}</span></label>`;
  }).join('');
  ['envia-cc', 'envia-pers'].forEach(id => $(id).checked = false);
  valida();
  $('publica').hidden = false;
}
function triades() { return [...$('pub-graella').querySelectorAll('input:checked')].map(c => c.value); }
function valida() {
  const n = triades().length;
  $('envia-si').disabled = !($('envia-cc').checked && $('envia-pers').checked && n);
  $('envia-si').textContent = perPublicar.length > 1 ? `Publica ${n === 1 ? '1 foto' : n + ' fotos'}` : 'Publica';
}
['envia-cc', 'envia-pers'].forEach(id => $(id).addEventListener('change', valida));
$('pub-graella').addEventListener('change', valida);
$('pub-no').onclick = () => { $('publica').hidden = true; };
$('envia-si').onclick = async () => {
  const ids = triades(), autor = $('envia-autor').value.trim();
  for (const f of perPublicar.filter(f => ids.includes(f.id)))
    await Fotos.desa({ ...f, estat: 'pendent', autor, llicencia: 'CC BY 4.0', enviada: new Date().toISOString() });
  $('publica').hidden = true;
  avis(ids.length > 1 ? `Enviades ${ids.length} fotos! Sortiran a la ruta quan les haguem revisades.` : 'Enviada! Sortirà a la ruta quan l\'haguem revisada.');
  pinta();
};
$('acaba').onclick = async () => {
  const meves = (await Fotos.totes()).filter(f => f.estat === 'meva').sort((a, b) => a.data.localeCompare(b.data));
  if (!meves.length) { avis('Has acabat la ruta! No tens cap foto per publicar.'); return; }
  obrePublica(meves, true);
};

inicia().catch(e => { $('titol').textContent = 'No s\'ha pogut carregar la ruta'; console.error(e); });
