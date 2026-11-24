/* Fotos de visitants (prototip, 23/11/2026).
 * - Zones: punt d'interès més proper (< RADI_POI m) o tram de la ruta (TRAM m).
 * - La foto es redibuixa en un canvas: surt en JPEG nou, sense EXIF (ni GPS ni càmera).
 * - Magatzem: en aquest prototip, IndexedDB del mateix mòbil (cap servidor).
 *   Per compartir-les entre mòbils, ENVIA apuntarà a Cloudinary (compte de Toribio, D-011).
 */
const RADI_POI = 75, TRAM = 500, FORA_RUTA = 300, MIDA_MAX = 1600;

function dist(a, b) {                       // [lat,lon] → metres
  const R = 6371000, r = Math.PI / 180;
  const dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Prepara les zones d'una ruta: punts d'interès i trams. */
function zonesDeRuta(track, pois) {
  const acum = [0];
  for (let i = 1; i < track.length; i++) acum.push(acum[i - 1] + dist(track[i - 1], track[i]));
  const total = acum[acum.length - 1];
  const nTrams = Math.max(1, Math.ceil(total / TRAM));
  const km = m => (m / 1000).toFixed(1).replace('.', ',');
  const trams = [];
  for (let t = 0; t < nTrams; t++) {
    const mig = Math.min(total, (t + 0.5) * TRAM);
    const i = acum.findIndex(a => a >= mig);
    trams.push({ id: 't' + t, nom: `Tram del km ${km(t * TRAM)} al ${km(Math.min(total, (t + 1) * TRAM))}`,
                 pos: track[i < 0 ? track.length - 1 : i] });
  }
  const zp = pois.map(p => ({ id: 'p' + p.id, nom: p.name, pos: [p.lat, p.lon] }));
  return {
    llista: [...zp, ...trams],
    perId: Object.fromEntries([...zp, ...trams].map(z => [z.id, z])),
    /* Zona d'una posició; null si és lluny de la ruta. */
    de(pos) {
      let iMin = 0, dMin = Infinity;
      track.forEach((p, i) => { const d = dist(p, pos); if (d < dMin) { dMin = d; iMin = i; } });
      let poi = null, dPoi = Infinity;
      zp.forEach(z => { const d = dist(z.pos, pos); if (d < dPoi) { dPoi = d; poi = z; } });
      if (poi && dPoi <= RADI_POI) return { zona: poi, dRuta: dMin };
      if (dMin > FORA_RUTA) return null;
      return { zona: trams[Math.min(nTrams - 1, Math.floor(acum[iMin] / TRAM))], dRuta: dMin };
    }
  };
}

/* Redibuixa la foto (treu l'EXIF) i la redueix. Retorna un Blob JPEG. */
async function netejaFoto(fitxer) {
  const bmp = await createImageBitmap(fitxer, { imageOrientation: 'from-image' });
  const s = Math.min(1, MIDA_MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}

/* Magatzem local (IndexedDB). Estats: pendent, aprovada, rebutjada, denunciada. */
const Fotos = (() => {
  let db;
  const obre = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('nl-fotos-visitants-prototip', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos', { keyPath: 'id' });
    r.onsuccess = () => res(db = r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await obre();
    return new Promise((res, rej) => {
      const t = d.transaction('fotos', mode), st = t.objectStore('fotos');
      const r = fn(st);
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    totes: () => tx('readonly', st => st.getAll()),
    desa: f => tx('readwrite', st => st.put(f)),
    estat: async (id, estat) => {
      const f = await tx('readonly', st => st.get(id));
      if (f) { f.estat = estat; f.revisada = new Date().toISOString(); await tx('readwrite', st => st.put(f)); }
    },
    buida: () => tx('readwrite', st => st.clear())
  };
})();
