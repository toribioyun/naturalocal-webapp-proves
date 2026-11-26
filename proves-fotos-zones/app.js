/* Prototip: fotos de visitants agrupades per zones (icona de càmera + carrusel). */
const $ = id => document.getElementById(id);
const ICONA_CAM = '<svg viewBox="0 0 24 24"><path d="M9 4h6l1.5 2H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
let zones, mapa, capaCam, ultimaPos = null;
const urls = [];                               // object URLs a alliberar

function avis(text, ms = 3200) {
  const a = $('avis'); a.textContent = text; a.hidden = false;
  clearTimeout(avis.t); avis.t = setTimeout(() => a.hidden = true, ms);
}

let ruta = null, rutaServ = null;
// D-175: publicació directa (model Wikiloc). Només les fitxes que paga un ajuntament passen per revisió:
// ho decideix el servidor (REVISIO_RUTES) i la resposta de cada pujada diu si ha quedat «pendent».
let delServidor = [], servidorOk = false;          // fotos publicades de la ruta (de tothom)
async function carregaServidor() {
  try { delServidor = await Servidor.fotos(rutaServ); servidorOk = true; }
  catch (e) { servidorOk = false; console.warn('Servidor de fotos:', e.message); }
}
/* Compartir: la foto va amb l'enllaç de la ruta, per portar-hi visites */
async function comparteix(f) {
  const z = zones.perId[f.zona];
  if (!f.blob && f.blobP) { try { await f.blobP; } catch { } }
  // Enllaç a la ruta dins de la web app (la fitxa amb foto i previsualització), no a la web de Drupal
  const url = (ruta.urlApp || ruta.url) + '?utm_source=fotos-visitants&utm_medium=compartir&utm_campaign=ruta-' + ruta.id;
  const text = `${z ? z.nom + ' · ' : ''}${ruta.name}. Fes-la tu també amb Natura Local: ${url}`;
  const fitxer = f.blob && new File([f.blob], 'natura-local.jpg', { type: 'image/jpeg' });
  try {
    if (fitxer && navigator.canShare && navigator.canShare({ files: [fitxer] })) await navigator.share({ files: [fitxer], title: ruta.name, text });
    else if (navigator.share) await navigator.share({ title: ruta.name, text, url });
    else { await navigator.clipboard.writeText(text); avis("Enllaç copiat. Enganxa'l on vulguis."); }
  } catch (e) { if (e.name !== 'AbortError') avis("No s'ha pogut compartir des d'aquest navegador."); }
}
window.comparteix = comparteix;

async function inicia() {
  const d = await (await fetch('dades/data.json')).json();
  const r = d.route; ruta = r;
  $('titol').textContent = r.name;
  document.title = r.name + ' · fotos de visitants (prototip)';
  zones = zonesDeRuta(r.track, d.pois);
  rutaServ = Servidor.ruta(r.id);

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
  await pinta();                                 // primer les meves (sense esperar la xarxa)
  await carregaServidor(); await pinta();
}

/* Una icona de càmera per zona: les publicades de tothom (servidor) + les meves no publicades o pendents.
   Estats de pantalla: aprovada (publicada) · pendent (només la veig jo) · meva (no publicada). */
async function pinta() {
  const perZona = {}, meves = await Fotos.totes();
  capaCam.clearLayers();
  const idsServ = new Set(delServidor.map(f => f.id));
  const mevaDe = Object.fromEntries(meves.filter(f => f.servidorId).map(f => [f.servidorId, f]));
  delServidor.forEach(f => (perZona[f.zona] ||= []).push({ ...f, estat: 'aprovada', servidor: true,
                                                          propia: !!mevaDe[f.id], blob: mevaDe[f.id] && mevaDe[f.id].blob }));
  meves.forEach(f => {
    let e = null;
    if (f.estat === 'meva') e = 'meva';
    else if (f.estat === 'enviada' && !idsServ.has(f.servidorId)) {
      if (f.servidorEstat === 'pendent') e = 'pendent';
      else if (!servidorOk) e = 'aprovada';        // sense connexió: la meva publicada, des del mòbil
    }
    if (e) (perZona[f.zona] ||= []).push({ ...f, estat: e, propia: true });
  });
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
    let u;
    if (f.blob) { u = URL.createObjectURL(f.blob); urls.push(u); }
    else u = Servidor.imatge(f.id, 'gran');
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
  $('car-denuncia').hidden = f.estat !== 'aprovada' || !f.servidor || f.propia;
  // per compartir-la com a fitxer cal tenir-la abans del clic (l'iPhone no espera)
  if (!f.blob && !f.blobP && f.servidor) f.blobP = fetch(Servidor.imatge(f.id, 'gran')).then(r => r.ok ? r.blob() : null).then(b => f.blob = b);
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
$('car-comparteix').onclick = () => carLlista[carI] && comparteix(carLlista[carI]);
$('car-denuncia').onclick = async () => {
  const f = carLlista[carI]; if (!f || !f.servidor) return;
  const motiu = prompt('Per què la denuncies? (opcional; si hi surts tu i vols que la traiem, digues-ho)');
  if (motiu === null) return;
  try { await Servidor.denuncia(f.id, motiu); }
  catch { avis("No s'ha pogut enviar la denúncia. Comprova la connexió i torna-ho a provar."); return; }
  delServidor = delServidor.filter(x => x.id !== f.id);
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
$('envia-comp').onclick = () => comparteix(fotoNova);
$('envia-ara').onclick = () => { $('envia').hidden = true; obrePublica([fotoNova], false); };

/* ---------- Publicar (una ara, o les de la ruta en acabar) ---------- */
let perPublicar = [];
function obrePublica(llista, final) {
  perPublicar = llista;
  $('veure-record').hidden = !final;
  $('pub-revisio').textContent = 'Sortiran a la ruta de seguida, amb el teu nom, i les veurà tothom.';
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
  valida();
  $('publica').hidden = false;
}
function triades() { return [...$('pub-graella').querySelectorAll('input:checked')].map(c => c.value); }
function valida() {
  const n = triades().length;
  $('envia-si').disabled = !n;   // les condicions s'accepten una sola vegada (Toribio, 24/11)
  $('envia-si').textContent = perPublicar.length > 1 ? `Publica ${n === 1 ? '1 foto' : n + ' fotos'}` : 'Publica';
}
$('pub-graella').addEventListener('change', valida);
$('pub-no').onclick = () => { $('publica').hidden = true; };
/* Condicions legals: s'accepten la primera vegada que es publica (i de nou si canvia la versió).
   Al prototip es desa al mòbil; a la versió real, l'acceptació (versió i data) es desarà al servidor com a prova. */
const VERSIO_COND = 'v0-2026-11-24';
const condAcceptades = () => { try { return JSON.parse(localStorage.getItem('nl-condicions-fotos') || '{}').versio === VERSIO_COND; } catch { return false; } };
function obreCondicions(perPublicar) {
  $('cond-accepto').checked = false; $('cond-si').disabled = true;
  $('cond-si').hidden = !perPublicar; $('cond-accepto').parentElement.hidden = !perPublicar;
  $('cond-no').textContent = perPublicar ? 'Ara no' : 'Tanca';
  $('condicions').hidden = false;
}
$('cond-accepto').onchange = () => $('cond-si').disabled = !$('cond-accepto').checked;
$('cond-no').onclick = () => { $('condicions').hidden = true; };
$('cond-si').onclick = () => {
  try { localStorage.setItem('nl-condicions-fotos', JSON.stringify({ versio: VERSIO_COND, data: new Date().toISOString() })); } catch { }
  $('condicions').hidden = true; publica();
};
$('obre-cond').onclick = e => { e.preventDefault(); obreCondicions(false); };
$('envia-si').onclick = () => condAcceptades() ? publica() : obreCondicions(true);
let publicant = false;
async function publica() {
  if (publicant) return; publicant = true;
  const ids = triades(), autor = $('envia-autor').value.trim();
  $('envia-si').disabled = true; $('envia-si').textContent = 'Enviant…';
  let pub = 0, pend = 0, ko = 0;
  for (const f of perPublicar.filter(f => ids.includes(f.id))) {
    try {
      const r = await Servidor.puja(f, rutaServ, autor, VERSIO_COND);
      await Fotos.desa({ ...f, estat: 'enviada', servidorId: r.id, servidorEstat: r.estat, autor, llicencia: 'CC BY 4.0', enviada: new Date().toISOString() });
      r.estat === 'pendent' ? pend++ : pub++;
    } catch (e) { ko++; console.warn('Pujada:', e.message); }
  }
  publicant = false; valida();
  $('publica').hidden = true;
  const t = [];
  if (pub) t.push(pub > 1 ? `Publicades ${pub} fotos! Ja surten a la ruta per a tothom.` : 'Publicada! Ja surt a la ruta per a tothom.');
  if (pend) t.push(pend > 1 ? `${pend} fotos sortiran quan les haguem revisades.` : "La foto sortirà quan l'haguem revisada.");
  if (ko) t.push((ko > 1 ? `${ko} fotos no s'han pogut enviar` : "La foto no s'ha pogut enviar") + ': no hi ha connexió. Queda desada al mòbil; torna-ho a provar en acabar la ruta.');
  avis(t.join(' '), ko ? 7000 : 4000);
  await carregaServidor(); pinta();
}
$('acaba').onclick = async () => {
  const meves = (await Fotos.totes()).filter(f => f.estat === 'meva').sort((a, b) => a.data.localeCompare(b.data));
  if (!meves.length) { location.href = 'record.html'; return; }      // sense fotos per publicar: directe al record
  obrePublica(meves, true);
};

inicia().catch(e => { $('titol').textContent = 'No s\'ha pogut carregar la ruta'; console.error(e); });
