/* Route filter (O-047, Toribio 19/11/2026): the same filter in the portal and in every destination app, like the one of
   the Natura Local app (activity, difficulty) plus the type of route, which Toribio asked for. Each route carries mo, df
   and tp (portal/scripts/genera.py, route_attrs). Only the options that some route has are shown. The choice is kept for
   the session (sessionStorage), so a filter chosen in the portal is still on in the destination, and the other way round.
   Two switches as in the app: only gamified routes (gam) and only inclusive routes (inc), marks of the route API of the web
   (portal/scripts/marques_rutes.py); «recommended» is not wanted (Toribio, 19/11/2026).
   Usage: RF.ok(route) → shown or not; RF.count() → how many choices are on; RF.open(routes, onChange) → the panel. */
'use strict';
const RF = (() => {
  const ICON = {
    peu: '<path d="M13 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM9.6 8.2 7 21h2.2l1.6-7.2 2.2 2.2V21h2v-6.4l-2.2-2.2.7-3.2A6 6 0 0 0 18 12v-2a4 4 0 0 1-3.4-1.9l-1-1.6A2 2 0 0 0 11.9 6c-.3 0-.5 0-.8.1L6 8.3V13h2V9.6zM17 6l2 15h1.4L18.6 6z"/>',
    bici: '<path d="M15.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 12a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm5.8-10L13 8.3l.8.8A7 7 0 0 0 19 11V9a5 5 0 0 1-3.5-1.5l-1.9-1.9a2 2 0 0 0-1.4-.6 2 2 0 0 0-1.4.6L7.4 9a2 2 0 0 0 0 2.8L10 14v5h2v-6.2l-2.2-2.3zM19 12a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
    cavall: '<path d="M20 4l-3 1-2-1-1 2c-3 0-5 2-6 4l-4 1-1 3 2 1 2-2h1l-1 6h2l1-4h4l1 4h2l-1-5c2-1 3-3 3-5l2-1z"/>',
  };
  const GROUPS = [
    ['mo', "Tipus d'activitat", [['peu', 'Senderisme'], ['bici', 'Bicicleta'], ['cavall', 'Cavall']]],
    ['df', 'Dificultat', [['Familiar', 'Famílies', 1], ['Fàcil', 'Fàcil', 1], ['Mitjana', 'Mitjana', 2], ['Difícil', 'Difícil', 3]]],
    ['tp', 'Tipologia', [['Circular', 'Circular'], ['Lineal', 'Lineal'], ['Travessa', 'Travessa']]],
  ];
  const KEY = 'tpnl-filtre-rutes';
  const SWITCHES = [['gam', 'Només rutes gamificades', 'Amb premis i recompenses', '<path d="M6 3h12l4 6-10 12L2 9zm1.2 2L4.6 9h3.9l1.6-4zm5 0-1.7 4h3.1l-1.4-4zm3.8 0 1.6 4h3.9l-2.6-4zM4.7 11l5.6 6.7L8.2 11zm5.6 0 1.7 5.3 1.7-5.3zm5.6 0-2.1 6.7 5.6-6.7z"/>'],
    ['inc', 'Només rutes inclusives', 'Accessibles per a tothom', '<path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-1 5h2v5h4l3 6-1.8.9L16.8 14H11zm-1.5 3.2.4 2A5 5 0 1 0 15.6 18l1.6 1.2A7 7 0 1 1 9.5 10.2z"/>']];
  const empty = () => ({mo: [], df: [], tp: [], gam: false, inc: false});
  let on = empty();
  try { const s = JSON.parse(sessionStorage.getItem(KEY)); if (s) on = {...empty(), ...s}; } catch (e) {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(on)); } catch (e) {} };
  const okWith = (sel, r) => GROUPS.every(([k]) => !sel[k].length || sel[k].includes(r[k])) && SWITCHES.every(([k]) => !sel[k] || r[k]);
  const ok = r => okWith(on, r);
  const countOf = sel => sel.mo.length + sel.df.length + sel.tp.length + (sel.gam ? 1 : 0) + (sel.inc ? 1 : 0);
  const count = () => countOf(on);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  function open(routes, onChange) {
    let draft = {...on, mo: [...on.mo], df: [...on.df], tp: [...on.tp]};
    let el = document.getElementById('rfSheet');
    if (!el) { el = document.createElement('div'); el.id = 'rfSheet'; el.className = 'sheet rf'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Filtra les rutes'); document.body.appendChild(el); }
    const render = () => {
      const n = routes.filter(r => okWith(draft, r)).length;
      el.innerHTML = `<div class="sheet-in rf-in"><span class="rf-grip"></span><button class="round close" id="rfClose" aria-label="Tanca">×</button>
        <h2 class="rf-h">Filtra les rutes</h2>
        ${GROUPS.map(([k, title, opts]) => {
          const have = opts.filter(([v]) => routes.some(r => r[k] === v)); if (!have.length) return '';
          return `<h3>${title}</h3><div class="rf-opts rf-${k}">${have.map(([v, label, dots]) => {
            const c = routes.filter(r => r[k] === v).length, p = draft[k].includes(v);
            const pic = k === 'mo' ? `<span class="rf-ic"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="currentColor">${ICON[v]}</svg></span>`
              : k === 'df' ? `<span class="rf-dots">${[1, 2, 3].map(i => `<i${i <= dots ? ' class="f"' : ''}></i>`).join('')}</span>` : '';
            return `<button data-k="${k}" data-v="${esc(v)}" aria-pressed="${p}">${pic}<span>${label}</span><small>${c}</small></button>`;
          }).join('')}</div>`;
        }).join('')}
        <div class="rf-sw">${SWITCHES.map(([k, title, sub, ic]) => {
          const c = routes.filter(r => r[k]).length;
          return `<button class="rf-swi" data-sw="${k}" aria-pressed="${!!draft[k]}" ${c ? '' : 'disabled'}><span class="rf-swic"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">${ic}</svg></span>
            <span class="rf-swt"><b>${title}</b><small>${c ? `${sub} · ${c} ${c === 1 ? 'ruta' : 'rutes'}` : 'Cap ruta encara'}</small></span><span class="rf-tog" aria-hidden="true"></span></button>`;
        }).join('')}</div>
        <div class="rf-foot"><button id="rfClear" ${countOf(draft) ? '' : 'disabled'}>Treu els filtres</button>
        <button class="primary grow" id="rfApply" ${n ? '' : 'disabled'}>${n ? `Mostra ${n} ${n === 1 ? 'ruta' : 'rutes'}` : 'Cap ruta amb aquests filtres'}</button></div></div>`;
      el.querySelectorAll('.rf-opts button').forEach(b => b.onclick = () => {
        const a = draft[b.dataset.k], i = a.indexOf(b.dataset.v); i < 0 ? a.push(b.dataset.v) : a.splice(i, 1); render();
      });
      el.querySelectorAll('.rf-swi').forEach(b => b.onclick = () => { draft[b.dataset.sw] = !draft[b.dataset.sw]; render(); });
      el.querySelector('#rfClear').onclick = () => { draft = empty(); render(); };
      el.querySelector('#rfApply').onclick = () => { on = draft; save(); close(); onChange(); };
      el.querySelector('#rfClose').onclick = close;
    };
    const close = () => { el.hidden = true; };
    el.onclick = e => { if (e.target === el) close(); };
    render(); el.hidden = false;
  }
  const clear = () => { on = empty(); save(); };
  const label = () => count() ? `Filtres · ${count()}` : 'Filtra les rutes';
  return {ok, count, open, clear, label};
})();
