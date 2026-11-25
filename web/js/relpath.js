// Relationship path between two people (route #relpath/A?b=B, like MyHeritage's Relationship Diagram).
// The walk is the kin engine's own (engine.js shortest), so the steps and the kin terms agree with the Quan he section.
// Client-side only: the viewer's loaded tree (M) and relation rows (relsOf). Every visible string comes from relpath-vi.js (VI).
import { esc } from './model.js';
import { section, card, emptyState, toolbar } from './ui.js';
import { personItem } from './person-item.js';
import { searchPeople } from './fuzzy.js';
import { relsOf, kinOpts, kinRegion } from './relui.js';
import { kinPath, term as kinTerm } from './kin/index.js';
import { relPath } from './relpath-path.js';
import { VI } from './relpath-vi.js';

const enc = (x) => encodeURIComponent(x);
// One line of the kin summary: speaker (a) first, the person addressed (b) second, then the term the speaker uses.
export const callLine = (speaker, target, term) => VI.call_line.replace('{a}', speaker).replace('{b}', target).replace('{term}', term);

// The page in #main. a = the person A (route arg, preset from the profile), b = person B (?b=).
export function relpathPage(main, { hf, M, a = '', b = '' }) {
  const { ix } = relsOf(M);
  const region = kinRegion(); const kin = kinOpts(M);
  const visible = (id) => M.byId.has(id);
  const nameOf = (id) => M.byId.get(id)?.data.name || '';
  const sexOf = (id) => M.byId.get(id)?.data.sex || '';
  const term = (x, y) => kinTerm(kinPath(ix, x, y, kin), { locale: 'vi', region });
  const go = (x, y) => { location.hash = hf(`relpath/${enc(x)}${y ? `?b=${enc(y)}` : ''}`); };
  let q = '';

  // The chain: one shared person row per node, the step relation between two rows (a couple hop says so).
  function chain(r) {
    return r.nodes.map((id, i) => {
      const sub = i === r.apexIndex ? VI.common_ancestor : '';
      const who = r.hidden[i]
        ? personItem({ name: '', sex: '' }, { tile: false, sub, trailing: 'none' }) // hidden person: the row without the name
        : personItem({ name: nameOf(id), sex: sexOf(id) }, { href: hf(`person/${enc(id)}`), sub });
      const between = i < r.steps.length
        ? `<li class="sub">${esc(term(id, r.nodes[i + 1]))}${r.viaMarriage[i] ? ` \u00b7 ${esc(VI.via_marriage)}` : ''}</li>` : '';
      return `<li>${who}</li>${between}`;
    }).join('');
  }

  function pathHtml() {
    if (!a || !b) return '';
    const r = relPath(ix, a, b, { visible });
    if (!r) return emptyState(VI.no_path);
    if (r.same) return emptyState(VI.same_person);
    const sum = card(`<p>${esc(callLine(nameOf(a), nameOf(b), term(a, b)))}</p>`
      + `<p>${esc(callLine(nameOf(b), nameOf(a), term(b, a)))}</p>`
      + `<p class="sub">${r.steps.length} ${esc(VI.steps)}</p>`);
    return `${section(VI.page_title, `<ul class="ped">${chain(r)}</ul>${sum}`, { variant: 'card', label: VI.page_title, level: 2 })}`;
  }

  // Person B picker: the shared search helper over the people on screen (never a hidden person).
  function results() {
    const hits = q.trim() ? searchPeople(M.all.filter((p) => p.id !== a), q, { limit: 8 }) : [];
    return hits.map((p) => `<li>${personItem({ name: p.data.name, sex: p.data.sex || '' }, { variant: 'compact', attrs: `data-pick="${esc(p.id)}"` })}</li>`).join('');
  }

  main.innerHTML = `<h1>${esc(VI.page_title)}</h1>`
    + (a && b ? `<div class="row end"><button type="button" class="btn ter sm" id="rpswap">${esc(VI.swap)}</button></div>` : '')
    + pathHtml()
    + section(VI.pick_second, `${toolbar({ id: 'rpq', ph: VI.search_ph, val: q })}<ul class="ped" id="rpres">${results()}</ul>`,
      { label: VI.pick_second, level: 2 });

  // Delegated handlers: main is redrawn per route, so these replace the previous ones.
  main.oninput = (e) => { if (e.target.id !== 'rpq') return; q = e.target.value; main.querySelector('#rpres').innerHTML = results(); };
  main.onclick = (e) => {
    const pick = e.target.closest?.('[data-pick]');
    if (pick) { if (a) go(a, pick.dataset.pick); else go(pick.dataset.pick, ''); return; }
    if (e.target.closest?.('#rpswap')) go(b, a);
  };
}
