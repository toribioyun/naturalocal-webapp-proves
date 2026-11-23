/* The ☰ menu of every web app (O-066, Toribio 22/11/2026): the same in the portal, in each destination and in each route.
   - Favourites: ♡ on any destination, route, visit or service; the list, and the map of them (the portal, #favorits).
   - Downloaded routes: the ones saved for going without coverage, to open or delete.
   - Settings: alerts (off route, near a point, sound, vibration) and the language of the interface (idiomes.js).
   Everything is kept on this phone (localStorage), with no account. The site's root is given by each app (NLM.init),
   so a favourite saved in one destination opens from any other app of the site.
   Usage: NLM.init({root}); NLM.heart(button, item); NLM.cfg(); NLM.markDownloaded(id, info) / NLM.unmarkDownloaded(id). */
'use strict';
const NLM = (() => {
  const FAV = 'tpnl-favorits', CFG = 'tpnl-config', DL = 'tpnl-descarregades', DL_PRE = 'tpnlr'; // names become tpnl… in the test copy
  const LANGS = [['ca', 'Català'], ['es', 'Castellano'], ['en', 'English'], ['fr', 'Français'], ['de', 'Deutsch']];
  const KIND = {desti: 'Destí', ruta: 'Ruta', visita: 'Visita', servei: 'Servei'};
  const COL = {desti: '#322820', ruta: '#69920c', visita: '#e9bc00', servei: '#1f6f8b'};
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const cfg = () => ({lang: 'ca', off: true, prox: true, so: true, vib: true, ...get(CFG, {})});
  const setCfg = (k, v) => { const c = cfg(); c[k] = v; put(CFG, c); };
  let ROOT = './', onFavMap = null, el = null, view = 'main', onDlMap = null;

  /* ---------- favourites ---------- */
  // item: {k: '<destination folder>/<kind>-<id>' or '<folder>/desti', kind, n, d (destination name), foto (from the root), lat, lon}
  const favs = () => get(FAV, []);
  const isFav = k => favs().some(f => f.k === k);
  const hrefOf = f => f.kind === 'desti' ? f.k.split('/')[0] + '/' : f.k.replace('/', '/#');
  function toggle(item) {
    let list = favs(); const on = list.some(f => f.k === item.k);
    list = on ? list.filter(f => f.k !== item.k) : [{...item, t: Date.now()}, ...list];
    put(FAV, list); dispatchEvent(new CustomEvent('tpnlfav', {detail: {k: item.k, on: !on}})); refreshButton();
    return !on;
  }
  // A ♡ button: filled when the item is a favourite. The item is given as a function when it is only known later.
  function heart(btn, item, o = {}) {
    const it = () => typeof item === 'function' ? item() : item;
    const show = () => { const on = isFav(it().k); btn.innerHTML = o.icon ? (on ? '♥' : '♡') : (on ? '♥ ' : '♡ ') + T(on ? 'Desat' : 'Desa'); btn.setAttribute('aria-pressed', on); btn.title = T(on ? 'Treu dels favorits' : 'Afegeix als favorits'); btn.setAttribute('aria-label', btn.title); };
    btn.classList.add('mn-heart'); btn.onclick = e => { e.stopPropagation(); toggle(it()); show(); };
    btn._nlmShow = show; show();
  }
  // one listener for every ♡ on the page (audit 23/11/2026: one per button used to pile up, 51 after 50 popups)
  addEventListener('tpnlfav', () => document.querySelectorAll('.mn-heart').forEach(b => b._nlmShow && b._nlmShow()));

  /* ---------- downloaded routes (written by the route app when a download is complete) ---------- */
  const markDownloaded = (id, info) => { const d = get(DL, {}); d[id] = {...d[id], ...info, t: Date.now()}; put(DL, d); };
  const unmarkDownloaded = id => { const d = get(DL, {}); if (d[id]) { delete d[id]; put(DL, d); } };
  async function downloads() {
    const d = get(DL, {}), out = [];
    for (const [id, r] of Object.entries(d)) {
      let ok = true; try { ok = 'caches' in window ? await caches.has(DL_PRE + id + '-media') : true; } catch (e) {}
      if (ok) out.push({id, ...r}); else unmarkDownloaded(id); // deleted by the phone or by the route app
    }
    return out.sort((a, b) => b.t - a.t);
  }
  async function deleteDownload(id) { try { await caches.delete(DL_PRE + id + '-media'); } catch (e) {} unmarkDownloaded(id); }

  /* ---------- language: the app's own words (idiomes.js); the content stays as it comes ---------- */
  const L = () => cfg().lang, LI = () => ({es: 0, en: 1, fr: 2, de: 3})[L()];
  function T(s) {
    if (L() === 'ca' || typeof NL_I18N === 'undefined') return s;
    const k = s.trim(), w = NL_I18N[k];
    if (w) return s.replace(k, w[LI()]);
    for (const r of NL_I18N_RE) if (r[0].test(k)) return s.replace(k, k.replace(r[0], r[1 + LI()]));
    return s;
  }
  const SKIP = '[data-notr],#shBody,.poi-in,.lead,.know,.plan,.steps,.when,.fira,.draft,script,style,canvas,textarea,input[type=search]';
  function translate(root) {
    if (L() === 'ca') return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue.trim() || (n.parentElement && n.parentElement.closest(SKIP))) continue;
      const t = T(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t;
    }
    const els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[aria-label],[title]') : [];
    for (const e of els) for (const a of ['placeholder', 'aria-label', 'title']) { const v = e.getAttribute(a); if (v) { const t = T(v); if (t !== v) e.setAttribute(a, t); } }
  }
  function startTranslating() {
    if (L() === 'ca') return;
    document.documentElement.lang = L();
    translate(document.body);
    let busy = false;
    new MutationObserver(ms => {
      if (busy) return; busy = true;
      for (const m of ms) {
        if (m.type === 'characterData') { const n = m.target, p = n.parentElement; if (p && !p.closest(SKIP)) { const t = T(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; } }
        else for (const a of m.addedNodes) { if (a.nodeType === 1) { if (!a.closest(SKIP)) translate(a); } else if (a.nodeType === 3 && a.parentElement && !a.parentElement.closest(SKIP)) { const t = T(a.nodeValue); if (t !== a.nodeValue) a.nodeValue = t; } }
      }
      busy = false;
    }).observe(document.body, {childList: true, subtree: true, characterData: true});
  }

  /* ---------- the menu ---------- */
  const ICON = {
    menu: '<path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>',
    fav: '<path d="M12 21 10.6 19.7C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1a6 6 0 0 1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z"/>',
    dl: '<path d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3zM4 18h16v2H4z"/>',
    cfg: '<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7 7 0 0 0-1.7-1L15 3h-4l-.4 2.7a7 7 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7 7 0 0 0 1.7 1L11 21h4l.4-2.7a7 7 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/>',
    map: '<path d="M9 3 3 5.5v15.5l6-2.5 6 2.5 6-2.5V3l-6 2.5zm0 2.2 6 2.5v11.1l-6-2.5zM5 6.8l2-.8v11.1l-2 .8zm12 .2 2-.8v11.1l-2 .8z"/>',
    home: '<path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/>',
  };
  const svg = (k, s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" fill="currentColor">${ICON[k]}</svg>`;
  const CSS = `
.mn-btn{flex:none;min-height:40px;width:44px;padding:0;border:0;border-radius:10px;background:transparent;color:#fff;display:grid;place-items:center;margin-left:4px}
.mn-btn:active{background:#fff2}
.hero-acts{position:absolute;top:10px;right:10px;z-index:3;display:flex;gap:8px}.gal-wrap .hero-acts{right:64px}
.hero-btn{min-height:0;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:#0009;color:#fff;font-size:1.25rem;line-height:1;display:grid;place-items:center}.hero-btn[aria-pressed="true"]{color:#ff5c8a}
html:not([lang=ca]) .facts{grid-template-columns:repeat(2,1fr)} /* other languages have longer words */
.facts>div{min-width:0}.facts dd,.facts dt{overflow-wrap:break-word;hyphens:auto;-webkit-hyphens:auto} /* long words of other languages (Familienfreundlich) */
.appbar:has(.mn-btn){flex-wrap:nowrap}.appbar:has(.mn-btn) .logo{min-width:0;flex:0 1 auto;max-width:44vw}
@media (max-width:520px){.appbar:has(.mn-btn) .proto{display:none}.appbar:has(.mn-btn) .net{font-size:.72rem;padding:3px 7px;white-space:nowrap}}
.mn{position:fixed;inset:0;z-index:60;background:#0007;display:flex;justify-content:flex-end}
.mn-in{width:min(380px,90vw);height:100%;background:var(--bg,#f6f2e8);color:var(--ink,#333);display:flex;flex-direction:column;box-shadow:-6px 0 20px #0005;animation:mn-in .18s ease-out}
@keyframes mn-in{from{transform:translateX(30px);opacity:.4}}
.mn-top{display:flex;align-items:center;gap:8px;background:var(--brown,#322820);color:#fff;padding:calc(12px + env(safe-area-inset-top)) 12px 12px 16px}
.mn-top h2{margin:0;font-size:1.15rem;flex:1}
.mn-top button{min-height:40px;padding:6px 12px;background:transparent;border:1.5px solid #fff6;color:#fff}
.mn-body{flex:1;overflow-y:auto;padding:8px 0 calc(20px + env(safe-area-inset-bottom))}
.mn-item{display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line,#e4dccb);border-radius:0;background:none;padding:14px 18px;min-height:60px;font-weight:700;font-size:1rem;color:var(--ink,#333);text-decoration:none}
.mn-item .ic{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#fff}
.mn-item small{display:block;font-weight:400;color:var(--muted,#6f675e);font-size:.85rem}
.mn-item .n{margin-left:auto;font-weight:800;color:var(--muted,#6f675e)}
.mn-sec{margin:18px 18px 6px;font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;color:var(--olive,#69920c);font-weight:800}
.mn-note{margin:6px 18px 12px;color:var(--muted,#6f675e);font-size:.88rem}
.mn-seg{display:flex;gap:6px;margin:8px 16px 10px}.mn-seg button{flex:1;min-height:40px}
.mn-card{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line,#e4dccb)}
.mn-card a{display:flex;align-items:center;gap:12px;flex:1;min-width:0;color:inherit;text-decoration:none}
.mn-card img,.mn-card .ph{flex:none;width:58px;height:58px;border-radius:10px;object-fit:cover;background:var(--brown-2,#5b4a3b)}
.mn-card b{display:block;line-height:1.25}
.mn-card small{color:var(--muted,#6f675e);font-size:.8rem}
.mn-card button{flex:none;min-height:36px;padding:4px 12px;font-size:.85rem}
.mn-sw{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line,#e4dccb);border-radius:0;background:none;padding:12px 18px;min-height:64px;font-weight:400;color:var(--ink,#333)}
.mn-sw span:first-child{flex:1}.mn-sw b{display:block;font-weight:700}.mn-sw small{color:var(--muted,#6f675e);font-size:.85rem}
.mn-tog{flex:none;width:50px;height:30px;border-radius:15px;background:var(--line,#e4dccb);position:relative;transition:background .15s}
.mn-tog::after{content:'';position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0004;transition:left .15s}
.mn-sw[aria-pressed="true"] .mn-tog{background:var(--olive,#69920c)}.mn-sw[aria-pressed="true"] .mn-tog::after{left:23px}
.mn-sw:disabled{opacity:.55}
.mn-lang{display:flex;flex-wrap:wrap;gap:8px;padding:4px 16px 8px}.mn-lang button{min-height:42px}
.mn-heart[aria-pressed="true"]{color:#c2185b;border-color:#c2185b}
.mn-empty{padding:18px;color:var(--muted,#6f675e)}`;

  function init(o) {
    ROOT = o.root || './'; onFavMap = o.onFavMap || null; onDlMap = o.onDlMap || null;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const bar = document.querySelector(o.bar || '.appbar');
    if (bar) {
      const b = document.createElement('button'); b.className = 'mn-btn'; b.id = 'mnBtn'; b.setAttribute('aria-label', 'Obre el menú'); b.innerHTML = svg('menu', 26);
      b.onclick = () => open('main'); bar.appendChild(b);
    }
    startTranslating();
  }
  function refreshButton() { if (el && !el.hidden) render(); }
  function open(v) {
    if (!el) {
      el = document.createElement('div'); el.className = 'mn'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Menú');
      el.onclick = e => { if (e.target === el) close(); };
      document.body.appendChild(el);
      addEventListener('keydown', e => { if (e.key === 'Escape' && el && !el.hidden) close(); });
    }
    view = v; el.hidden = false; render();
  }
  function close() { if (el) el.hidden = true; }
  const top = (title, back) => `<div class="mn-top">${back ? `<button data-go="main" aria-label="${T('Torna')}">‹</button>` : ''}<h2>${T(title)}</h2><button data-close aria-label="${T('Tanca')}">×</button></div>`;
  async function render() {
    const c = cfg(), F = favs();
    let h = '';
    if (view === 'main') {
      const n = (await downloads()).length;
      h = top('Menú') + `<div class="mn-body">
        <button class="mn-item" data-go="fav"><span class="ic" style="background:#c2185b">${svg('fav')}</span><span>${T('Els meus favorits')}</span><span class="n">${F.length}</span></button>
        <button class="mn-item" data-go="dl"><span class="ic" style="background:#1f6f8b">${svg('dl')}</span><span>${T('Rutes descarregades')}<small>${T('Sense cobertura')}</small></span><span class="n">${n}</span></button>
        <button class="mn-item" data-go="cfg"><span class="ic" style="background:#5b4a3b">${svg('cfg')}</span><span>${T('Configuració')}<small>${T('Avisos')} · ${T('Idioma')}: ${LANGS.find(l => l[0] === c.lang)[1]}</small></span></button>
        <a class="mn-item" href="${ROOT}"><span class="ic" style="background:#69920c">${svg('home')}</span><span>${T('Tots els destins')}</span></a>
        <p class="mn-note">${T('Es desen en aquest mòbil, no en cap compte.')}</p></div>`;
    } else if (view === 'fav') {
      h = top('Els meus favorits', true) + `<div class="mn-body">` + (F.length ? `<div class="mn-seg"><button aria-pressed="true">${T('Llista')}</button><button data-favmap>${svg('map', 18)} ${T('Mapa')}</button></div>` +
        F.map(f => `<div class="mn-card"><a href="${esc(ROOT + hrefOf(f))}">${f.foto ? `<img src="${esc(ROOT + f.foto)}" alt="" loading="lazy">` : `<span class="ph" style="background:${COL[f.kind]}"></span>`}
          <span><small>${T(KIND[f.kind])}${f.kind !== 'desti' && f.d ? ' · ' + esc(f.d) : ''}</small><b>${esc(f.n)}</b></span></a><button data-unfav="${esc(f.k)}" aria-label="${T('Treu dels favorits')}">♥</button></div>`).join('')
        : `<p class="mn-empty">${T('Encara no tens cap favorit.')}<br>${T('Toca ♡ a la fitxa d’un destí, una ruta, una visita o un servei per tenir-lo aquí.')}</p>`) + '</div>';
    } else if (view === 'dl') {
      const D = await downloads();
      h = top('Rutes descarregades', true) + `<div class="mn-body">` + (D.length ? `<div class="mn-seg"><button aria-pressed="true">${T('Llista')}</button><button data-dlmap>${svg('map', 18)} ${T('Mapa')}</button></div>` + D.map(r => `<div class="mn-card"><a href="${esc(ROOT + r.href)}">${r.foto ? `<img src="${esc(ROOT + r.foto)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
          <span><small>${esc(r.d || '')}${r.mb ? ` · ${r.mb} MB` : ''}</small><b>${esc(r.n)}</b></span></a><button data-undl="${esc(r.id)}">${T('Esborra')}</button></div>`).join('')
        : `<p class="mn-empty">${T('Encara no has descarregat cap ruta.')}<br>${T('Obre una ruta i toca «Descarrega-la per anar sense cobertura».')}</p>`) + '</div>';
    } else if (view === 'cfg') {
      const vib = !!navigator.vibrate;
      const sw = (k, title, sub, dis) => `<button class="mn-sw" data-sw="${k}" aria-pressed="${!!c[k] && !dis}"${dis ? ' disabled' : ''}><span><b>${T(title)}</b><small>${T(sub)}</small></span><span class="mn-tog" aria-hidden="true"></span></button>`;
      h = top('Configuració', true) + `<div class="mn-body"><h3 class="mn-sec">${T('Avisos')}</h3>
        ${sw('off', 'Fora de ruta', 'Avisa quan t’allunyes de la ruta')}${sw('prox', 'A prop d’un punt d’interès', 'Avisa en arribar a cada punt de la ruta')}
        ${sw('so', 'So', 'Fa sonar els avisos')}${sw('vib', 'Vibració', vib ? 'Fa vibrar el mòbil amb els avisos' : 'L’iPhone no deixa vibrar des d’una web.', !vib)}
        <p class="mn-note">${T('Els avisos funcionen mentre la ruta és oberta a la pantalla.')}</p>
        <h3 class="mn-sec">${T('Idioma')}</h3><div class="mn-lang">${LANGS.map(([k, n]) => `<button data-lang="${k}" aria-pressed="${k === c.lang}">${n}</button>`).join('')}</div>
        <p class="mn-note">${T('Els textos de les rutes i dels llocs surten en català fins que estiguin traduïts.')}</p></div>`;
    }
    el.innerHTML = `<div class="mn-in" data-notr>${h}</div>`;
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { view = b.dataset.go; render(); });
    el.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
    el.querySelectorAll('[data-unfav]').forEach(b => b.onclick = () => { const f = favs().find(x => x.k === b.dataset.unfav); if (f) toggle(f); render(); });
    el.querySelectorAll('[data-undl]').forEach(b => b.onclick = async () => { if (!confirm(T('Esborrar aquesta ruta del mòbil? La podràs tornar a descarregar.'))) return; await deleteDownload(b.dataset.undl); dispatchEvent(new CustomEvent('tpnldl')); render(); });
    el.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { setCfg(b.dataset.sw, !cfg()[b.dataset.sw]); dispatchEvent(new CustomEvent('tpnlcfg')); render(); });
    el.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { if (b.dataset.lang === cfg().lang) return; setCfg('lang', b.dataset.lang); location.reload(); });
    const m = el.querySelector('[data-favmap]');
    if (m) m.onclick = () => { close(); if (onFavMap) onFavMap(); else location.href = ROOT + '#favorits'; };
    const dm = el.querySelector('[data-dlmap]');
    if (dm) dm.onclick = () => { close(); if (onDlMap) onDlMap(); else location.href = ROOT + '#descarregades'; };
  }
  async function share(title, url, btn) {
    if (navigator.share) { try { await navigator.share({title, text: title + ' · Natura Local', url}); } catch (e) {} return; }
    let ok = false; try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {}
    const old = btn.innerHTML; btn.innerHTML = ok ? '✓' : '!'; btn.title = ok ? T('Enllaç copiat ✓') : url; setTimeout(() => { btn.innerHTML = old; btn.title = T('Comparteix'); }, 2000);
  }
  const isDownloaded = id => !!get(DL, {})[id];
  return {share, init, heart, isFav, favs, toggle, cfg, T, markDownloaded, unmarkDownloaded, isDownloaded, downloads, open};
})();
