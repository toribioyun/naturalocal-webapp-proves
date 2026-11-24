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
  await pinta();
}

/* Una icona de càmera per zona que té fotos aprovades (o pendents meves). */
async function pinta() {
  capaCam.clearLayers();
  const perZona = {};
  (await Fotos.totes()).filter(f => f.estat === 'aprovada' || f.estat === 'pendent')
    .forEach(f => (perZona[f.zona] ||= []).push(f));
  Object.entries(perZona).forEach(([zid, llista]) => {
    const z = zones.perId[zid]; if (!z) return;
    llista.sort((a, b) => (a.estat === 'aprovada' ? 0 : 1) - (b.estat === 'aprovada' ? 0 : 1) || a.data.localeCompare(b.data));
    const nomesPend = llista.every(f => f.estat === 'pendent');
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
    return `<div class="car-dia">${f.estat === 'pendent' ? '<span class="car-pend">Pendent de revisió · només la veus tu</span>' : ''}<img src="${u}" alt="Foto ${i + 1} de ${llista.length}: ${z.nom}"></div>`;
  }).join('');
  $('carrusel').hidden = false;
  $('car-pista').scrollLeft = 0;
  peuCarrusel();
}
function peuCarrusel() {
  const f = carLlista[carI]; if (!f) return;
  const data = new Date(f.data).toLocaleDateString('ca', { day: 'numeric', month: 'long', year: 'numeric' });
  $('car-credit').textContent = `Foto: ${f.autor || 'Visitant'} · CC BY 4.0 · ${data}`;
  $('car-num').textContent = `${carI + 1} / ${carLlista.length}`;
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

/* ---------- Enviar una foto ---------- */
let blobNet = null;
$('afegeix').onclick = () => {
  $('fitxer').value = '';
  $('fitxer').click();
  // demanem la posició ara, mentre es fa la foto; en acabar l'esperem com a molt 5 s més
  ultimaPos = null;
  posicio = new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res([p.coords.latitude, p.coords.longitude]), () => res(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 });
  });
};
let posicio = Promise.resolve(null);

$('fitxer').onchange = async () => {
  const f = $('fitxer').files[0]; if (!f) return;
  ultimaPos = await Promise.race([posicio, new Promise(r => setTimeout(() => r(null), 5000))]);
  try { blobNet = await netejaFoto(f); }
  catch { avis('No hem pogut llegir aquesta foto. Prova amb una altra.'); return; }
  const u = URL.createObjectURL(blobNet); urls.push(u);
  $('envia-img').src = u;
  const sel = $('envia-zona');
  sel.innerHTML = '<option value="">— Tria on l\'has feta —</option>' +
    '<optgroup label="Punts d\'interès">' + zones.llista.filter(z => z.id[0] === 'p').map(z => `<option value="${z.id}">${z.nom}</option>`).join('') + '</optgroup>' +
    '<optgroup label="Trams de la ruta">' + zones.llista.filter(z => z.id[0] === 't').map(z => `<option value="${z.id}">${z.nom}</option>`).join('') + '</optgroup>';
  const det = ultimaPos && zones.de(ultimaPos);
  if (det) { sel.value = det.zona.id; $('envia-pos').textContent = 'Hem trobat la zona amb la teva posició. Si no és correcta, canvia-la.'; }
  else { sel.value = ''; $('envia-pos').textContent = ultimaPos ? 'Ara no ets a la ruta: tria on vas fer la foto.' : 'No sabem on ets: tria on vas fer la foto.'; }
  ['envia-cc', 'envia-pers'].forEach(id => $(id).checked = false);
  valida();
  $('envia').hidden = false;
};
function valida() { $('envia-si').disabled = !($('envia-cc').checked && $('envia-pers').checked && $('envia-zona').value); }
['envia-cc', 'envia-pers', 'envia-zona'].forEach(id => $(id).addEventListener('change', valida));
$('envia-no').onclick = () => { $('envia').hidden = true; blobNet = null; };
$('envia-si').onclick = async () => {
  if (!blobNet) return;
  await Fotos.desa({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    zona: $('envia-zona').value, autor: $('envia-autor').value.trim(),
    data: new Date().toISOString(), estat: 'pendent', llicencia: 'CC BY 4.0', blob: blobNet
  });
  $('envia').hidden = true; blobNet = null;
  avis('Enviada! Sortirà a la ruta quan l\'haguem revisada.');
  pinta();
};

inicia().catch(e => { $('titol').textContent = 'No s\'ha pogut carregar la ruta'; console.error(e); });
