// Book view: the printed A4 book, built lazily. The outline (GET /api/book/outline) gives the page list at once; every page
// is a fixed A4 box, filled with its persons (GET /api/persons?ids=) only when it is near the viewport, and emptied again
// when it is far away. Print loads every page first. No store sync: the book needs no IndexedDB and no full pull.
import { rank, years } from './bookplan.js';
import { figSvg } from './bookchart.js';
import { lbar, ltags, fpanel, setUntag, cic, familyCrest } from './ui.js';
import { isDead } from './model.js';
import { tx, childOf, kinRegionPref, setKinRegion, LANGS, REGIONS } from './booktext.js';

const qs = new URLSearchParams(location.search);
const EMBED = qs.get('embed') === '1';
const FAM = qs.get('family') || 'duong';
// Scope (Bộ lọc): root person, direction, generations, spouses, daughters, status. Kept in the address; defaults = whole family.
const Q = {
  root: qs.get('root') || qs.get('chi') || '',
  dir: ['up', 'both'].includes(qs.get('dir')) ? qs.get('dir') : 'down',
  gen: Math.max(0, parseInt(qs.get('gen'), 10) || 0),
  spouses: qs.get('spouses') !== '0',
  daughters: qs.get('daughters') === 'name' ? 'name' : 'full',
  status: ['living', 'dead'].includes(qs.get('status')) ? qs.get('status') : 'all',
};
const CHI = Q.root;
// Settings (Cài đặt), per device: applied before the first render. Layout and hide-living change the page, so they reload.
const PREF_DEF = { theme: 'classic', font: 'serif', size: 'm', layout: 'branch', hideLiving: false, lang: 'vi', orient: 'land' };
const PREF_OK = { theme: ['classic', 'calm', 'modern'], font: ['serif', 'sans'], size: ['s', 'm', 'l'], layout: ['branch', 'gen', 'summary'], lang: LANGS, orient: ['land', 'port'] };
// Cách gọi: the app's kinRegion setting (not a book pref), read once here
let REGION = kinRegionPref();
const T = (k) => tx(k, PREF.lang);
let PREF = { ...PREF_DEF };
try {
  const raw = JSON.parse(localStorage.getItem('bookPrefs') || '{}');
  for (const k of Object.keys(PREF_OK)) if (PREF_OK[k].includes(raw[k])) PREF[k] = raw[k];
  PREF.hideLiving = raw.hideLiving === true;
} catch {}
const savePref = (patch) => { PREF = { ...PREF, ...patch }; try { localStorage.setItem('bookPrefs', JSON.stringify(PREF)); } catch {} };
const applyPrefs = () => {
  const d = document.documentElement.dataset; d.bkTheme = PREF.theme; d.bkFont = PREF.font; d.bkSize = PREF.size; d.bkOrient = PREF.orient; document.documentElement.lang = PREF.lang;
  // print uses the same paper: the @page size follows Khổ (the stylesheet has the landscape default)
  let st = document.getElementById('bkpage');
  if (PREF.orient === 'port') { if (!st) { st = document.createElement('style'); st.id = 'bkpage'; document.head.append(st); } st.textContent = '@page{size:A4 portrait;margin:0}'; } else st?.remove();
};
applyPrefs();
const scopeQs = () => {
  const p = new URLSearchParams({ family: FAM });
  if (Q.root) p.set('root', Q.root);
  if (Q.dir !== 'down') p.set('dir', Q.dir);
  if (Q.gen) p.set('gen', String(Q.gen));
  if (!Q.spouses) p.set('spouses', '0');
  if (Q.daughters === 'name') p.set('daughters', 'name');
  if (Q.status !== 'all') p.set('status', Q.status);
  if (PREF.layout !== 'branch') p.set('layout', PREF.layout);
  if (PREF.orient === 'port') p.set('orient', 'port');
  return p.toString();
};
// Opened directly (not embedded, not inside the app): show it inside the app shell.
if (qs.get('inapp') === '1') document.documentElement.classList.add('inapp');
if (!EMBED && qs.get('inapp') !== '1' && window.top === window && !matchMedia('print').matches) location.replace('/#book' + (CHI ? '/' + encodeURIComponent(CHI) : ''));
// Embedded (?embed=1): no toolbar is rendered at all.
if (EMBED) document.getElementById('tbar').remove();

const host = document.getElementById('pages');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const relOf = (q, childSex) => childOf(q, childSex, PREF.lang, REGION);
const PERSON_BATCH = 250; // ids per request (the server accepts up to 500)

let plan = null;
let EMBLEM = false; // the family has an emblem (the cover shows it instead of the colored surname crest)
let FAM_NAME = '', FAM_HAN = ''; // from the outline: the crest's surname and Hán name
const secs = [];                  // page sections, index n-1
const persons = new Map();        // id -> person data (null: not in this family any more)
const pending = new Map();        // id -> request promise, while it is in flight
const loaded = new Set();         // page numbers with content on screen
const busy = new Map();           // page number -> fill promise
let printing = false;

// ---- data ----
// Hide living: a living person is printed as a name-less placeholder (structure and page layout stay the same).
const P = (id) => { const d = persons.get(id) || null; return d && PREF.hideLiving && !isDead(d) ? { sex: d.sex, gen: d.gen, name: T('living2'), living: 'living' } : d; };
// Persons not yet known are requested in batches; ids already in flight are awaited, not asked again.
async function loadPersons(ids) {
  const need = [...new Set(ids)].filter((id) => !persons.has(id) && !pending.has(id));
  for (let i = 0; i < need.length; i += PERSON_BATCH) {
    const chunk = need.slice(i, i + PERSON_BATCH);
    const req = fetch(`/api/persons?family=${enc(FAM)}&ids=${chunk.map(enc).join(',')}`, { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status }); return r.json(); })
      .then((res) => {
        const got = new Set();
        for (const it of res.items) { got.add(it.id); persons.set(it.id, it.deleted ? null : it.data); }
        for (const id of chunk) if (!got.has(id)) persons.set(id, null);
      })
      .finally(() => { for (const id of chunk) pending.delete(id); });
    for (const id of chunk) pending.set(id, req);
  }
  await Promise.all(ids.map((id) => pending.get(id)).filter(Boolean));
}

// ---- page content (from the plan + loaded persons) ----
const F = (k, v) => (v ? `<span class="f"><i>${k}</i> ${v}</span>` : '');
// Real anchors: every entry is #p-<person id>; ID boxes (children, parents, names in stories) link to it. In print the PDF keeps them.
const anc = (id) => 'p-' + esc(id);
let PREG = {}; // id -> the parent's entry number (Register numbering), from the outline
// A story paragraph with its linked mentions: a grey ID box right after each linked name (never for a hidden living person).
function mentionHtml(t, m) {
  let out = ''; let pos = 0;
  for (const x of (m || []).slice().sort((u, v) => u.a - v.a)) {
    if (x.a < pos || P(x.id) !== persons.get(x.id)) continue;
    out += esc(t.slice(pos, x.b)) + ` <a class="xr" href="#${anc(x.id)}">${x.reg}</a>`; pos = x.b;
  }
  return out + esc(t.slice(pos));
}
// One entry item. A long entry continues in more items: those carry no head (number, name, facts) and no rule unless last.
function entryHtml(id, reg, kids, txt) {
  const head = !txt || txt.head !== false; const tail = !txt || txt.tail !== false;
  const d = P(id) || { name: '' };
  const died = [esc(d.died), d.death_lunar ? esc(d.death_lunar) + ' ' + T('lunar') : ''].filter(Boolean).join(' · ');
  const facts = F(T('born'), esc(d.born)) + F(T('died'), died) + F(T('anniv'), d.gio_lunar && d.gio_lunar !== d.death_lunar ? esc(d.gio_lunar) + ' ' + T('lunar') : '') + F(T('lives'), esc(d.place)) + F(T('alias'), esc(d.alias)) + F(T('job'), esc(d.job)) + F(T('religion'), esc(d.religion)) + F(T('burial'), esc(d.burial));
  const contact = [d.phone, d.email, d.zalo && 'Zalo ' + d.zalo, d.facebook].filter(Boolean).map(esc).join(' · ');
  const shown = kids.filter(([kid]) => P(kid));
  const kidsHtml = shown.length ? '<ol class="kids">' + shown.map(([kid, xr]) => { const c = P(kid); return `<li>${esc(rank(c))} <b>${esc(c.name)}</b>${years(c) ? ' (' + years(c) + ')' : ''}${xr != null ? ` <a class="xr" href="#${anc(kid)}">${xr}</a>` : ''}</li>`; }).join('') + '</ol>' : '';
  // story paragraphs: plain text, after the facts and the note (hidden for a hidden living person)
  const stories = txt?.st?.length && P(id) === persons.get(id) ? txt.st.map((x) => `<p class="stp">${mentionHtml(x.t, x.m)}</p>`).join('') : '';
  // a spouse with their own data: one summary line under the partner's Vợ/Chồng line (name, years, place)
  const spLines = head ? (txt?.sp || []).filter((id) => P(id)).map((id) => { const q = P(id); return `<div class="ln sp" data-sp="${esc(id)}"><i>${d.sex === 'f' ? T('husband') : T('wife')}</i> ${esc(q.name)}${years(q) ? ' (' + years(q) + ')' : ''}${q.place ? ' · ' + esc(q.place) : ''}</div>`; }).join('') : '';
  const headHtml = head ? `<div class="eh"><span class="reg">${reg ?? ''}</span><div><span class="rank">${esc(rank(d))}</span> <span class="nm">${esc(d.name)}</span>${PREG[id] && d.parent ? ` <span class="pcode">· ${T('childOfReg')} <a class="xr" href="#${anc(d.parent)}">${PREG[id]}</a></span>` : ''}</div></div>${d.photo ? `<img class="ph" src="${esc(d.photo)}" alt="">` : ''}` : '';
  return `<div class="entry${head ? '' : ' cont'}${txt?.more ? ' more' : ''}"${head ? ` id="${anc(id)}"` : ''} data-id="${esc(id)}">${headHtml}
   ${head ? `${facts ? `<div class="ln">${facts}</div>` : ''}${d.spouse ? `<div class="ln"><i>${d.sex === 'f' ? T('husband') : T('wife')}</i> ${esc(d.spouse)}${d.married ? ', ' + T('married') + ' ' + esc(d.married) : ''}</div>` : ''}${spLines}${d.note ? `<div class="ln mut">${esc(d.note)}</div>` : ''}` : ''}
   ${stories}${kidsHtml}${tail && contact ? `<div class="ln ct">${contact}</div>` : ''}${tail && d.verify ? `<div class="flag">${T('toVerify')}: ${esc(d.verify)}</div>` : ''}</div>`;
}
function itemHtml(it) {
  switch (it[0]) {
    case 1: return entryHtml(it[1], it[2], it[3], it[4]);
    case 2: return `<div class="genh">${T('genLabel')} ${it[1]}</div>`;
    case 3: { const d = P(it[1]); const pa = P(it[2]); if (!d) return ''; return `<div class="ie"><span>${esc(rank(d))} ${esc(d.name)} <span class="mut">· ${T('gensWord')} ${d.gen} · ${esc(relOf(pa, d.sex))}</span></span><i></i><b>${esc(it[3])}</b></div>`; }
    case 4: return `<div class="il">${esc(it[1])}</div>`;
    case 5: { const d = P(it[1]); if (!d) return ''; return `<div class="ie"><span>${esc(d.name)}</span><i></i><b>${it[2] != null ? `<a class="xr" href="#${anc(it[3] || it[1])}">${it[2]}</a>` : '–'}</b></div>`; }
    case 6: { const d = P(it[1]); if (!d) return ''; return `<div class="ie"><span><b>${esc(rank(d))} ${esc(d.name)}</b>: ${esc(d.verify)}</span><i></i><b>${it[2] ?? ''}</b></div>`; }
    default: return '';
  }
}
const HEADS = {
  early: `<h2 class="ch">${T('gen13')}</h2>`,
  gio: (c) => `<h2 class="ch">${T('giotitle')}</h2><p class="note">${c} ${T('days')}</p>`,
  index: `<h2 class="ch">${T('indexTitle')}</h2><p class="note">${T('indexNote')}</p>`,
  verify: (c) => `<h2 class="ch">${T('verifyTitle')}</h2><p class="note">${c} ${T('places').replace('{site}', esc(location.host))}</p>`,
};
function bodyHtml(pg) {
  if (pg.kind === 'cover') {
    const root = P(plan.root?.id); const scope = plan.scope ? P(plan.scope) : null;
    return `<div class="cover"><div class="seal">${familyCrest({ id: FAM, name: FAM_NAME, han: FAM_HAN, has_emblem: EMBLEM }, 'lg')}</div><div class="kick">${T('cover')}</div><h1>HỌ DƯƠNG</h1><div class="rule"></div>
    <p class="cs">${scope ? `${T('branch')} ${esc(rank(scope))} <b>${esc(scope.name)}</b><br>` : ''}${T('fromAncestor')} <b>${esc(root?.name || '')}</b>${root?.place ? '<br>' + esc(root.place) : ''}</p>
    <div class="stats"><div><b>${pg.gen}</b><span>${T('gensCount')}</span></div><div><b>${pg.people}</b><span>${T('people')}</span></div></div>
    <div class="ed">${T('printedOn')} ${new Date().toLocaleDateString(PREF.lang === 'en' ? 'en-GB' : 'vi-VN')} · ${esc(location.host)}</div></div>`;
  }
  if (pg.kind === 'lead') {
    const root = P(plan.root?.id);
    return `<h2 class="ch">${T('foreword')}</h2>${root?.note ? `<p class="lead">${esc(root.name)}: ${esc(root.note)}.</p>` : ''}
    <p>Sách chép gia phả theo từng tông chi và từng đời. Mỗi người có một số mục; danh sách con chỉ tới số mục của người con có gia đình riêng. Nguồn: các bản gia phả của dòng họ, cùng các bổ sung của bà con trên ${esc(location.host)}.</p>
    <p>Chỗ còn thiếu hoặc bản cũ ghi chưa khớp được đánh dấu <span class="flagi">Cần xác minh</span>. Bà con biết thông tin xin bổ sung để bản sau đầy đủ hơn.</p>
    <h3 class="sub">${T('contents')}</h3><div class="toc">${plan.toc.map(([l, p]) => `<div><a href="#p${p}"><span>${esc(l)}</span><i></i><b>${p}</b></a></div>`).join('')}</div>`;
  }
  if (pg.kind === 'opener') {
    const b = P(pg.branch); const par = P(pg.parent); if (!b) return '';
    return `<div class="opener"><div class="kick">${T('branch')} ${esc(rank(b))}</div><h2>${esc(b.name.toUpperCase())}</h2><div class="rule"></div><p class="cs">${par ? `<a href="#${anc(pg.parent)}">${esc(relOf(par, b.sex))}</a>` : esc(relOf(par, b.sex))}.${b.spouse ? ` Vợ: ${esc(b.spouse)}.` : ''}${b.place ? ` ${T('livesAt')} ${esc(b.place)}.` : ''}</p>
      <div class="stats"><div><b>${pg.kids}</b><span>${T('childrenCount')}</span></div><div><b>${pg.desc}</b><span>${T('descCount')}</span></div></div></div>`;
  }
  if (pg.kind === 'chart') {
    const figs = pg.shelf
      ? `<div class="shelf">${pg.figs.map((f) => (f.br ? '<hr class="rowbr">' : `<figure class="cfig"><figcaption>${esc(f.title)}</figcaption>${figSvg(f, P)}</figure>`)).join('')}</div>`
      : figSvg(pg.figs[0], P);
    return `<h2 class="ch">${esc(pg.title)}</h2>${pg.note ? `<p class="note">${esc(pg.note)}</p>` : ''}<div class="chartbox">${figs}</div>`;
  }
  // flow: heading (first page of a flow) and equal columns
  const head = pg.head ? (pg.head.type === 'early' ? HEADS.early : typeof HEADS[pg.head.type] === 'function' ? HEADS[pg.head.type](pg.head.count) : HEADS[pg.head.type]) : '';
  const cols = pg.cols.map((col) => `<div class="col">${col.map(itemHtml).join('')}</div>`).join('');
  return `${head}<div class="cols ${pg.cls || ''}" style="grid-template-columns:repeat(${pg.ncols},minmax(0,1fr))">${cols}</div>`;
}

// ---- pages ----
function buildShells() {
  host.innerHTML = '';
  for (const pg of plan.pages) {
    const sec = document.createElement('section');
    sec.className = 'pg ' + (pg.cls || '');
    sec.id = 'p' + pg.n; sec.dataset.n = pg.n;
    if (pg.kind !== 'cover' && pg.kind !== 'lead' && pg.kind !== 'opener') {
      const foot = document.createElement('div'); foot.className = 'foot';
      foot.innerHTML = `<span>${esc(pg.run || '')}</span><span>${pg.n}</span>`;
      sec.append(foot);
    }
    const box = document.createElement('div'); box.className = 'pgw';
    box.append(sec); host.append(box); secs.push(sec);
  }
}
const footOf = (sec) => sec.querySelector(':scope > .foot');
function show(n) {
  const sec = secs[n - 1]; if (loaded.has(n)) return;
  const pg = plan.pages[n - 1]; const html = bodyHtml(pg);
  const foot = footOf(sec);
  if (foot) foot.insertAdjacentHTML('beforebegin', html); else sec.insertAdjacentHTML('beforeend', html);
  loaded.add(n);
}
function hide(n) {
  if (!loaded.has(n)) return;
  const sec = secs[n - 1]; const foot = footOf(sec);
  for (const node of [...sec.childNodes]) if (node !== foot) node.remove();
  loaded.delete(n);
}
// Pages that come near the viewport in the same tick are filled together: one persons request for all of them.
const queue = new Set(); let flushing = null;
function want(n) {
  if (loaded.has(n) || busy.has(n)) return;
  queue.add(n); if (!flushing) flushing = setTimeout(flush, 0);
}
function flush() {
  flushing = null; const ns = [...queue]; queue.clear(); if (!ns.length) return;
  const p = loadPersons(ns.flatMap((n) => plan.pages[n - 1].ids || []))
    .then(() => { for (const n of ns) if (!loaded.has(n)) show(n); })
    .catch((e) => { if (e.status === 403) host.innerHTML = '<p class="loading">Dòng họ này là riêng tư.</p>'; else console.warn('book pages', ns, e); })
    .finally(() => { for (const n of ns) busy.delete(n); });
  for (const n of ns) busy.set(n, p);
}
const nearIO = () => new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) want(+e.target.dataset.n); }, { rootMargin: '100% 0px 100% 0px' });
const farIO = () => new IntersectionObserver((es) => { for (const e of es) if (!e.isIntersecting && !printing) hide(+e.target.dataset.n); }, { rootMargin: '500% 0px 500% 0px' });

// ---- print: every page loaded first, with progress ----
const prog = document.getElementById('prog');
const progTxt = document.getElementById('progtxt');
const progBar = document.getElementById('progbar');
function progress(done, total) {
  prog.hidden = false; progTxt.textContent = `Đang chuẩn bị ${done}/${total} trang`; progBar.max = total; progBar.value = done;
}
// Pages stay filled until the print dialog closes (afterprint): far pages are not emptied while the browser prints.
async function prepareAll() {
  printing = true;
  const total = plan.pages.length; let done = 0;
  // batches of pages: one persons request per batch, then the pages of the batch are filled in order
  for (let i = 0; i < total; i += 8) {
    const batch = plan.pages.slice(i, i + 8);
    await loadPersons(batch.flatMap((pg) => pg.ids || []));
    for (const pg of batch) { show(pg.n); done++; progress(done, total); }
  }
  prog.hidden = true;
}

// ---- toolbar: search (accent-insensitive, jumps to the person's entry), Filters sheet, Share sheet ----
const fold = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd');
let allIds = null; // every person id listed in the plan (fetched once, on the first search or the root picker)
const pageOf = (id) => plan.pages.find((pg) => (pg.cols || []).some((col) => col.some((it) => it[0] === 1 && it[1] === id)))?.n || 0;
async function allPersons() { if (!allIds) allIds = [...new Set(plan.pages.flatMap((pg) => pg.ids || []))]; await loadPersons(allIds); }
// Filters change the address; the page reloads with the new outline (lazy pages start again from the top).
function go(params) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(params)) v ? u.searchParams.set(k, v) : u.searchParams.delete(k);
  location.href = u;
}
const DIRS = () => [['down', T('down')], ['up', T('up')], ['both', T('both')]];
const DAUGHTERS = () => [['full', T('full')], ['name', T('nameOnly')]];
const STATUS = () => [['all', T('all')], ['living', T('living')], ['dead', T('dead')]];
const radios = (name, opts, cur) => opts.map(([v, l]) => `<label class="radio"><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''}> ${l}</label>`).join('');
let peopleByLabel = new Map(); // "Tên · Đời n" -> id (the root picker)
const personLabel = (d) => `${d.name} · Đời ${d.gen || '?'}`;
async function fillPeople() {
  await allPersons();
  peopleByLabel = new Map();
  const opts = allIds.map((id) => [id, P(id)]).filter(([, d]) => d && d.name).map(([id, d]) => { const l = personLabel(d); peopleByLabel.set(l, id); return `<option value="${esc(l)}"></option>`; });
  document.getElementById('bpeople').innerHTML = opts.join('');
}
function filterForm(rootName) {
  return `<label>${T('start')}<input id="broot" type="text" list="bpeople" autocomplete="off" placeholder="${T('wholeFamily')}" value="${esc(rootName)}"></label><datalist id="bpeople"></datalist>
    <fieldset class="fset"><legend>${T('direction')}</legend>${radios('bdir', DIRS(), Q.dir)}</fieldset>
    <label>${T('gens')}<select id="bgen"><option value="0">${T('all')}</option>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${Q.gen === n ? 'selected' : ''}>${n} ${T('genWord')}</option>`).join('')}</select></label>
    <label class="fp-switch"><input type="checkbox" id="bsp" ${Q.spouses ? 'checked' : ''}> ${T('spouses')}</label>
    <fieldset class="fset"><legend>${T('daughters')}</legend>${radios('bdau', DAUGHTERS(), Q.daughters)}</fieldset>
    <fieldset class="fset"><legend>${T('status')}</legend>${radios('bst', STATUS(), Q.status)}</fieldset>
    `;
}
function settingsForm() {
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  const reg = REGION === 'nam' ? 'nam' : 'chuan';
  return `<label>${T('colour')}<select id="pt">${opt('classic', T('themeClassic'), PREF.theme)}${opt('calm', T('themeCalm'), PREF.theme)}${opt('modern', T('themeModern'), PREF.theme)}</select></label>
    <label>${T('font')}<select id="pf">${opt('serif', T('fontSerif'), PREF.font)}${opt('sans', T('fontSans'), PREF.font)}</select></label>
    <label>${T('size')}<select id="ps">${opt('s', T('sizeS'), PREF.size)}${opt('m', T('sizeM'), PREF.size)}${opt('l', T('sizeL'), PREF.size)}</select></label>
    <label>${T('layout')}<select id="pl">${opt('gen', T('layoutGen'), PREF.layout)}${opt('branch', T('layoutBranch'), PREF.layout)}${opt('summary', T('layoutSummary'), PREF.layout)}</select></label>
    <label>${T('paper')}<select id="ppap">${opt('land', T('landscape'), PREF.orient)}${opt('port', T('portrait'), PREF.orient)}</select></label>
    <label>${T('language')}<select id="plang">${opt('vi', T('langVi'), PREF.lang)}${opt('en', T('langEn'), PREF.lang)}</select></label>
    <label>${T('terms')}<select id="preg">${opt('chuan', T('termsStd'), reg)}${opt('nam', T('termsSouth'), reg)}</select></label>
    <label class="fp-switch"><input type="checkbox" id="phide" ${PREF.hideLiving ? 'checked' : ''}> ${T('hideLiving')}</label>`;
}
function renderBar() {
  const tbar = document.getElementById('tbar');
  if (!tbar) return; // embedded: no toolbar
  const share = `<button type="button" class="fbtn" id="bset" aria-label="${T('settings')}" title="${T('settings')}">${cic('gear', 20)}</button><button type="button" class="fbtn" id="bshare" aria-label="${T('share')}" title="${T('share')}">${cic('share', 20)}</button>`;
  const active = [Q.root, Q.dir !== 'down', Q.gen, !Q.spouses, Q.daughters === 'name', Q.status !== 'all'].filter(Boolean).length;
  const filtered = active > 0;
  const rootName = Q.root ? (P(Q.root)?.name || '') : '';
  const tags = [];
  if (Q.root) tags.push(['root', T('from') + ': ' + (rootName || T('chosen'))]);
  if (Q.dir !== 'down') tags.push(['dir', DIRS().find(([v]) => v === Q.dir)[1]]);
  if (Q.gen) tags.push(['gen', T('gens') + ' ' + Q.gen]);
  if (!Q.spouses) tags.push(['spouses', T('noSpouses')]);
  if (Q.daughters === 'name') tags.push(['daughters', T('daughtersTag')]);
  if (Q.status !== 'all') tags.push(['status', STATUS().find(([v]) => v === Q.status)[1]]);
  tbar.innerHTML = lbar('bq', T('search'), '', active).replace(/<\/div>$/, share + '</div>')
    + '<div class="bhits" id="bhits" hidden></div>'
    + ltags(tags)
    + `<p class="sub lcount">${filtered ? `${plan.totals.scopePeople} / ${plan.totals.people}` : plan.totals.people} ${T('people')}</p>`
    + fpanel(filterForm(rootName), `<button type="button" class="btn" id="bapply">${T('apply')}</button>`)
    // share sheet comes after the filter sheet: ui.js opens the first dialog.fpanel for the Filters button
    + `<dialog class="fpanel" id="shdlg" aria-labelledby="sh-h"><div class="fp-hd"><h2 id="sh-h">${T('share')}</h2><button type="button" class="csw-x" data-fpx aria-label="${T('close')}">${cic('close', 20)}</button></div><div class="fp-body">`
    + `<button type="button" class="bact" id="bcopy">${T('copy')}</button><button type="button" class="bact" id="bprint">${T('print')}</button><button type="button" class="bact" id="bembed">${T('embed')}</button><code id="embedcode" hidden></code></div></dialog>`
    + `<dialog class="fpanel" id="setdlg" aria-labelledby="set-h"><div class="fp-hd"><h2 id="set-h">${T('settingsTitle')}</h2><button type="button" class="csw-x" data-fpx aria-label="${T('close')}">${cic('close', 20)}</button></div><div class="fp-body" id="setbody">${settingsForm()}</div></dialog>`;
  const PARAM = { root: ['root', 'chi'], dir: ['dir'], gen: ['gen'], spouses: ['spouses'], daughters: ['daughters'], status: ['status'] };
  setUntag((k) => {
    if (k === '*') return go({ root: '', chi: '', dir: '', gen: '', spouses: '', daughters: '', status: '' });
    const o = {}; for (const n of PARAM[k] || []) o[n] = ''; go(o);
  });
  // Filters sheet: apply reads the form; the root picker fills its list when first used
  const broot = document.getElementById('broot');
  broot.addEventListener('focus', fillPeople, { once: true });
  document.getElementById('bapply').onclick = () => {
    const root = broot.value.trim() ? (peopleByLabel.get(broot.value.trim()) || '') : '';
    const pick = (n) => document.querySelector(`input[name="${n}"]:checked`)?.value || '';
    go({
      root, chi: '',
      dir: pick('bdir') === 'down' ? '' : pick('bdir'),
      gen: document.getElementById('bgen').value === '0' ? '' : document.getElementById('bgen').value,
      spouses: document.getElementById('bsp').checked ? '' : '0',
      daughters: pick('bdau') === 'name' ? 'name' : '',
      status: pick('bst') === 'all' ? '' : pick('bst'),
    });
  };
  const bq = document.getElementById('bq'); const box = document.getElementById('bhits');
  let t = 0;
  bq.addEventListener('input', () => { clearTimeout(t); t = setTimeout(hits, 150); });
  async function hits() {
    const q = fold(bq.value).trim();
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    await allPersons();
    const found = allIds.map((id) => [id, P(id)]).filter(([, d]) => d && fold(d.name + ' ' + (d.alias || '')).includes(q)).slice(0, 8);
    box.hidden = false;
    box.innerHTML = found.length
      ? found.map(([id, d]) => `<button type="button" class="bhit" data-goto="${esc(id)}">${esc(rank(d))} <b>${esc(d.name)}</b><span class="sub">${years(d) ? esc(years(d)) : ''}</span></button>`).join('')
      : `<p class="sub bhit-none">${T('notFound')}</p>`;
  }
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-goto]'); if (!b) return;
    const id = b.dataset.goto; const sp = P(id)?.spouse_of || '';
    // a spouse is printed in the partner's entry: that entry is the place to go, the spouse line is highlighted
    const target = sp && pageOf(sp) ? sp : id; const n = pageOf(target); if (!n) return;
    await loadPersons(plan.pages[n - 1].ids || []);
    show(n);
    const el = document.querySelector(`#p${n} .entry[data-id="${CSS.escape(target)}"]`);
    const line = target !== id ? document.querySelector(`#p${n} .ln.sp[data-sp="${CSS.escape(id)}"]`) : null;
    (line || el)?.scrollIntoView({ block: 'center' }); el?.classList.add('hit'); line?.classList.add('hit');
    setTimeout(() => { el?.classList.remove('hit'); line?.classList.remove('hit'); }, 2000);
    box.hidden = true; bq.value = '';
  });
  // share: print/PDF and the iframe code of the same scope (Web Share comes next)
  const sh = document.getElementById('shdlg');
  // Share: the platform sheet when Web Share exists (link; PDF via In / Lưu PDF from there), else the menu below
  const shareUrl = () => { const u = new URL('/book', location.origin); for (const [k, v] of new URLSearchParams(location.search)) if (k !== 'inapp' && k !== 'embed') u.searchParams.set(k, v); return u.toString(); };
  document.getElementById('bshare').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: document.title, url: shareUrl() }); } catch (e) { if (e?.name !== 'AbortError') sh.showModal(); } return; }
    sh.showModal();
  };
  document.getElementById('bcopy').onclick = async (e) => {
    try { await navigator.clipboard.writeText(shareUrl()); e.target.textContent = T('copied'); }
    catch { e.target.textContent = shareUrl(); }
  };
  // Settings: colour, font and size apply at once; the layout and hide-living change the page, so the page reloads
  document.getElementById('bset').onclick = () => document.getElementById('setdlg').showModal();
  document.getElementById('pt').onchange = (e) => { savePref({ theme: e.target.value }); applyPrefs(); };
  document.getElementById('pf').onchange = (e) => { savePref({ font: e.target.value }); applyPrefs(); };
  document.getElementById('ps').onchange = (e) => { savePref({ size: e.target.value }); applyPrefs(); };
  document.getElementById('pl').onchange = (e) => { savePref({ layout: e.target.value }); go({}); };
  document.getElementById('ppap').onchange = (e) => { savePref({ orient: e.target.value }); go({}); };
  document.getElementById('plang').onchange = (e) => { savePref({ lang: e.target.value }); go({}); };
  document.getElementById('preg').onchange = (e) => { setKinRegion(e.target.value === 'nam' ? 'nam' : 'chuan'); go({}); };
  document.getElementById('phide').onchange = (e) => { savePref({ hideLiving: e.target.checked }); go({}); };
  document.getElementById('bprint').onclick = async () => { sh.close(); await prepareAll(); window.print(); };
  document.getElementById('bembed').onclick = () => {
    const u = new URL('/book', location.origin);
    for (const [k, v] of new URLSearchParams(location.search)) if (k !== 'inapp' && k !== 'embed') u.searchParams.set(k, v);
    u.searchParams.set('embed', '1');
    const out = document.getElementById('embedcode');
    out.textContent = `<iframe src="${u}" style="width:100%;height:900px;border:0" title="Gia phả họ Dương" loading="lazy"></iframe>`; out.hidden = false;
  };
  if (Q.root && !rootName) loadPersons([Q.root]).then(() => renderBar()); // the root's name for its tag and picker
}
function setup() {
  renderBar();
  // Ctrl+P / the browser's print: pages whose persons are already known are filled now. The browser does not wait for
  // requests, so the rest only prints after the button (In / Lưu PDF) has loaded them.
  addEventListener('afterprint', () => { printing = false; });
  addEventListener('beforeprint', () => { for (let n = 1; n <= plan.pages.length; n++) if (!loaded.has(n) && (plan.pages[n - 1].ids || []).every((id) => persons.has(id))) show(n); });
}

// --s: the scale of every page (1 on a desktop, the container width / 842 on a phone). Pages are laid out at the 842 px
// reference and scaled with transform by css (.pgw / .pg), so the layout is the same in every engine. Hidden (width 0): kept.
const fit = () => {
  const w = host.clientWidth; if (!w) return;
  host.style.setProperty('--s', Math.min(1, Math.max(0.1, (w - 32) / (PREF.orient === 'port' ? 595 : 842))).toFixed(4));
};
// Re-measured when the container changes size (iframe resize, orientation, the app's side nav), and when the fonts are
// in: text metrics change then, and the scale is taken from the final layout.
let fitRaf = 0;
const fitSoon = () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(() => { if (plan) fit(); }); };
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitSoon).observe(host);
else addEventListener('resize', fitSoon);
addEventListener('orientationchange', () => setTimeout(fitSoon, 300));
document.fonts?.ready.then(fitSoon);

function gotoAnchor() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!plan || !id.startsWith('p-')) return;
  const n = pageOf(id.slice(2)); if (!n) return;
  loadPersons(plan.pages[n - 1].ids || []).then(() => { show(n); document.getElementById(id)?.scrollIntoView(); });
}
addEventListener('hashchange', gotoAnchor);

async function start() {
  host.innerHTML = `<p class="loading">${T('loading')}</p>`;
  let out;
  try {
    const r = await fetch(`/api/book/outline?${scopeQs()}`, { cache: 'no-store' });
    if (r.status === 403) return (host.innerHTML = '<p class="loading">Dòng họ này là riêng tư.</p>');
    if (r.status === 404) return (host.innerHTML = '<p class="loading">Không tìm thấy dòng họ.</p>');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    out = await r.json();
  } catch {
    return (host.innerHTML = '<p class="loading">Chưa tải được sách. Kiểm tra mạng rồi tải lại trang.</p>');
  }
  plan = out.plan; EMBLEM = !!out.emblem; FAM_NAME = out.name || ''; FAM_HAN = out.han || ''; PREG = plan.preg || {};
  if (!plan.pages.length) return (host.innerHTML = '<p class="loading">Chưa có dữ liệu để in sách.</p>');
  buildShells(); fit(); setup(); gotoAnchor();
  const near = nearIO(); const far = farIO();
  for (const sec of secs) { near.observe(sec); far.observe(sec); }
}
start();
