// Places gazetteer in the app (server: places-routes.js). A person's place field keeps the text exactly as written;
// an editor may link it to a shared place, and the text then opens that place's page (#place/<id>): names over time,
// the provinces / districts it belonged to, and the people of this family linked to it. Links are fetched per person
// when a profile is drawn (small request, cached for a minute) and are not part of the offline store.
import { esc } from './model.js';
import { toast, calmRow, tag, section } from './ui.js';

// Person fields that can point to a place. Address stays free text (it is contact data).
export const PLACE_FIELDS = { place: 'Nơi sống', birth_place: 'Nơi sinh', burial: 'An táng' };
const cache = new Map(); // person id -> { at, byField: Map(field -> item) }
const loading = new Set();
let onChange = () => {};
export const setOnChange = (fn) => { onChange = fn; };

async function getJson(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không tải được địa danh.');
  return j;
}
// Load (or refresh after 60 s) a person's place links; calls onChange when they differ from what was shown.
export function ensure(fam, personId, force = false) {
  if (!fam || fam === 'tat-ca' || !personId) return;
  const c = cache.get(personId);
  if (!force && c && Date.now() - c.at < 60e3) return;
  if (loading.has(personId)) return;
  loading.add(personId);
  getJson(`/api/persons/${encodeURIComponent(personId)}/places?family=${encodeURIComponent(fam)}`).then((j) => {
    const before = JSON.stringify(c ? [...c.byField.values()] : []);
    cache.set(personId, { at: Date.now(), byField: new Map((j.items || []).map((x) => [x.field, x])) });
    if (before !== JSON.stringify(j.items || [])) onChange();
  }).catch(() => cache.set(personId, { at: Date.now(), byField: new Map() })).finally(() => loading.delete(personId));
}
export const linkOf = (personId, field) => cache.get(personId)?.byField.get(field) || null;

// One place field on the profile: the text as written; linked -> a link to the place page plus today's name when it
// differs; editors get a quiet "Gắn địa danh" / "Đổi" button that opens the picker.
export function fieldHtml(personId, field, text, { editable = false, extra = '', placeHref = (id) => '#place/' + id } = {}) {
  if (!text) return '';
  const l = linkOf(personId, field);
  const shown = l ? `<a class="pl-link" href="${esc(placeHref(l.place_id))}">${esc(text)}</a>${l.name && fold(l.name) !== fold(text) ? ` <span class="sub">· nay ${esc(l.label || l.name)}</span>` : ''}` : esc(text);
  const pick = editable ? ` <button type="button" class="btn gh sm pl-pick" data-place-pick="${esc(field)}" data-pid="${esc(personId)}">${l ? 'Đổi địa danh' : 'Gắn địa danh'}</button>` : '';
  return shown + extra + pick;
}
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const span = (a, b) => (a || b ? `${a ? String(a).slice(0, 4) : '…'}–${b ? String(b).slice(0, 4) : 'nay'}` : '');

// One result row of the picker: today's name, its parents, and the old name that matched.
const optHtml = (x) => calmRow({ attrs: `role="option" data-place="${x.id}"`, dense: true, trailing: 'none', title: x.name,
  subtitle: esc([x.label !== x.name ? x.label.split(', ').slice(1).join(', ') : '', x.matched_era ? `trước đây: ${x.matched}${span(...x.matched_era) ? ` (${span(...x.matched_era)})` : ''}` : '', x.status === 'pending' ? 'chưa xác minh' : ''].filter(Boolean).join(' · ')) });

// The last row of the results: add what was typed as a new place (pending; open data is looked up in the background).
const newRow = (q) => calmRow({ attrs: 'data-new-place', dense: true, trailing: 'none', title: `Thêm “${q}” làm địa danh mới`,
  subtitle: 'Chờ Chủ họ hoặc Quản trị xác minh. Thông tin thêm được tìm từ dữ liệu mở.' });
function newForm(res, q) {
  res.innerHTML = `<div class="pl-new form-stack"><label>Tên địa danh<input data-new-name value="${esc(q)}" maxlength="120"></label>
    <label>Loại<select data-new-kind>${Object.entries(KIND).filter(([k]) => k !== 'country').map(([k, l]) => `<option value="${k}" ${k === 'commune' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <div class="row end"><button type="button" class="btn" data-new-save>Thêm và gắn</button></div></div>`;
  res.querySelector('[data-new-name]').focus();
}

// The picker: search the shared list (prefilled with the text as written), pick one to link; "Không có trong danh
// sách" keeps the text only (and removes a link there was).
export function openPicker({ fam, personId, field, text, done }) {
  const cur = linkOf(personId, field);
  const d = document.createElement('dialog'); d.className = 'dlg pl-sheet';
  d.innerHTML = `<form method="dialog" class="form-stack">
    <h2>${esc(PLACE_FIELDS[field] || 'Địa danh')}: gắn địa danh</h2>
    <p class="sub">Chữ đã ghi “${esc(text)}” giữ nguyên. Gắn với một địa danh để thấy tên xưa và nay, và những người cùng nơi.</p>
    <label>Tìm địa danh<input name="q" type="search" autocomplete="off" placeholder="Gõ tên, cả tên cũ (ít nhất 2 chữ)" value="${esc(text)}"></label>
    <div class="pl-res calm-list" role="listbox" aria-label="Địa danh"></div>
    <p class="err" hidden></p>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Huỷ</button><button type="button" class="btn ter" data-none>Không có trong danh sách</button></div>
  </form>`;
  document.body.append(d); d.showModal();
  const f = d.querySelector('form'); const res = d.querySelector('.pl-res'); const err = d.querySelector('.err');
  const close = () => { d.close(); d.remove(); };
  const fail = (e) => { err.textContent = e.message; err.hidden = false; };
  let t = 0; let seq = 0;
  const search = async () => {
    const q = f.q.value.trim(); const my = ++seq;
    if (q.length < 2) { res.innerHTML = ''; return; }
    try {
      const j = await getJson(`/api/places?q=${encodeURIComponent(q)}&limit=12`);
      if (my !== seq) return;
      res.innerHTML = (j.items.map(optHtml).join('') || '<p class="sub">Chưa có địa danh này trong danh sách.</p>') + newRow(q);
      if (cur) res.querySelector(`[data-place="${cur.place_id}"]`)?.setAttribute('aria-selected', 'true');
    } catch (e) { res.innerHTML = ''; fail(e); }
  };
  f.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
  search();
  d.querySelector('[data-cancel]').onclick = close;
  const saved = (msg) => { close(); toast(msg); ensure(fam, personId, true); done?.(); };
  res.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new-place]')) { newForm(res, f.q.value.trim()); return; }
    if (e.target.closest('[data-new-save]')) {
      const name = res.querySelector('[data-new-name]').value.trim(); const kind = res.querySelector('[data-new-kind]').value;
      try {
        const pl = await getJson('/api/places', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: fam, name, kind }) });
        await getJson(`/api/persons/${encodeURIComponent(personId)}/places`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ family: fam, field, place_id: pl.id }) });
        saved(pl.existing ? 'Đã gắn địa danh có sẵn.' : 'Đã thêm địa danh mới (chờ xác minh) và gắn.');
      } catch (x) { fail(x); }
      return;
    }
    const b = e.target.closest('[data-place]'); if (!b) return;
    try {
      await getJson(`/api/persons/${encodeURIComponent(personId)}/places`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ family: fam, field, place_id: Number(b.dataset.place) }) });
      saved('Đã gắn địa danh.');
    } catch (x) { fail(x); }
  });
  d.querySelector('[data-none]').onclick = async () => {
    if (!cur) { close(); return; }
    try { await getJson(`/api/persons/${encodeURIComponent(personId)}/places/${field}?family=${encodeURIComponent(fam)}`, { method: 'DELETE' }); saved('Đã bỏ gắn địa danh; chữ đã ghi vẫn giữ.'); } catch (x) { fail(x); }
  };
}
// Delegated: the profile's "Gắn địa danh" buttons.
export function wire(root, { fam, textOf, done }) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-place-pick]'); if (!b || !root.contains(b)) return;
    const field = b.dataset.placePick; const pid = b.dataset.pid;
    openPicker({ fam: fam(), personId: pid, field, text: textOf(pid, field), done });
  });
}

// ---------- the place page ----------
const KIND = { country: 'Quốc gia', province: 'Tỉnh / thành', district: 'Huyện / quận', commune: 'Xã / phường', village: 'Làng', hamlet: 'Ấp / thôn', cemetery: 'Nghĩa trang', temple: 'Đình / chùa / nhà thờ họ', other: 'Địa danh' };
const EVENT = { renamed: 'Đổi tên', merged_into: 'Sáp nhập vào', split_from: 'Tách từ', upgraded: 'Nâng cấp', abolished: 'Giải thể', created: 'Thành lập' };
// One "over time" row, in the timeline's band style (year on the left, a quiet strip on the right).
const bandRow = (yr, html) => `<li class="band"><div class="dt"><b>${esc(yr)}</b></div><div class="rail"></div><p class="tl-band">${html}</p></li>`;
const yr = (v) => (v ? String(v).slice(0, 4) : '');

// people: [{ id, field }] from the server, shown only when the viewer's own data has the person (visibility).
export async function placePage(main, id, { fam, personOf, personHref, nameOf }) {
  main.innerHTML = '<h1>Địa danh</h1><p class="sub">Đang tải…</p>';
  let p; let people = [];
  try {
    p = await getJson(`/api/places/${encodeURIComponent(id)}`);
    if (fam && fam !== 'tat-ca') people = (await getJson(`/api/places/${encodeURIComponent(id)}/people?family=${encodeURIComponent(fam)}`).catch(() => ({ items: [] }))).items || [];
  } catch (e) { main.innerHTML = `<h1>Địa danh</h1><p class="err">${esc(e.message)}</p>`; return; }
  if (!main.isConnected) return;
  const names = p.names.map((n) => ({ ...n, at: n.valid_from || n.valid_to || '' }));
  const nameRows = names.map((n) => bandRow(yr(n.valid_from) || '…', `${esc(n.name)}${n.lang !== 'vi' ? ` <span class="sub">(${esc(n.lang)})</span>` : ''} <span class="sub">${esc(span(n.valid_from, n.valid_to))}</span>`)).join('');
  const parentRows = p.parents.map((r) => bandRow(yr(r.valid_from) || '…', `Thuộc ${esc(r.name)} <span class="sub">${esc(span(r.valid_from, r.valid_to))}</span>`)).join('');
  const eventRows = p.events.map((ev) => bandRow(yr(ev.date), `${esc(EVENT[ev.kind] || ev.kind)}${ev.other_name ? ' ' + esc(ev.other_name) : ''}`)).join('');
  const seen = new Set(); const rows = [];
  for (const x of people) {
    const per = personOf(x.person_id); if (!per || seen.has(x.person_id)) continue; seen.add(x.person_id);
    rows.push(calmRow({ href: personHref(x.person_id), sex: per.data?.sex, title: nameOf(per), subtitle: esc(people.filter((y) => y.person_id === x.person_id).map((y) => PLACE_FIELDS[y.field] || y.field).join(' · ')) }));
  }
  main.innerHTML = `<div class="row wrap">${tag(`${esc(KIND[p.kind] || 'Địa danh')}`, { tone: 'gray' })}${p.status === 'pending' ? '<span class="tag gray">chưa xác minh</span>' : ''}</div>
    <h1 class="big keep">${esc(p.name || '')}</h1>${p.label && p.label !== p.name ? `<p class="sub">${esc(p.label.split(', ').slice(1).join(', '))}</p>` : ''}
    ${section(`Tên qua các thời kỳ`, `<ol class="tl2">${nameRows}</ol>`, { variant: 'card', label: 'Tên qua các thời kỳ', cls: 'pl-sec sec-card', level: 2 })}
    ${parentRows ? `${section(`Thuộc đơn vị`, `<ol class="tl2">${parentRows}</ol>`, { variant: 'card', label: 'Thuộc đơn vị', cls: 'pl-sec sec-card', level: 2 })}` : ''}
    ${eventRows ? `${section(`Thay đổi`, `<ol class="tl2">${eventRows}</ol>`, { variant: 'card', label: 'Thay đổi', cls: 'pl-sec sec-card', level: 2 })}` : ''}
    ${section(`Người trong họ${rows.length ? ` · ${rows.length}` : ''}`, `${rows.length ? `<div class="calm-list">${rows.join('')}</div>` : '<p class="sub">Chưa có ai trong họ gắn với địa danh này.</p>'}`, { variant: 'card', label: 'Người trong họ', cls: 'pl-sec sec-card', level: 2 })}
    ${p.wikidata_id ? `<p class="sub pl-ext"><a href="https://www.wikidata.org/wiki/${esc(p.wikidata_id)}" target="_blank" rel="noopener">Wikidata ${esc(p.wikidata_id)}</a></p>` : ''}
    ${(p.attribution || []).map((a) => `<p class="sub pl-attr">Một phần dữ liệu: <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.text)}</a></p>`).join('')}`;
}

// ---------- review page: "Địa danh chờ duyệt" (curators: owner or admin of a family) ----------
const SRC = { wikidata: 'Wikidata', geonames: 'GeoNames' };
const JOB = { queued: 'đang chờ tra dữ liệu mở', running: 'đang tra dữ liệu mở', failed: 'tra dữ liệu mở không được' };
function suggText(s) {
  const v = s.value || {};
  if (s.field === 'wikidata_id' || s.field === 'geonames_id') return `${SRC[s.source]} ${esc(String(v.id))}${v.label ? ` · ${esc(v.label)}` : ''}${v.url ? ` <a href="${esc(v.url)}" target="_blank" rel="noopener">Xem ›</a>` : ''}`;
  if (s.field === 'coords') return `Toạ độ ${Number(v.lat).toFixed(4)}, ${Number(v.lon).toFixed(4)}`;
  if (s.field === 'name') return `Tên: ${esc(v.name)}${v.lang && v.lang !== 'vi' ? ` <span class="sub">(${esc(v.lang)})</span>` : ''}${span(v.valid_from, v.valid_to) ? ` <span class="sub">${esc(span(v.valid_from, v.valid_to))}</span>` : ''}`;
  return esc(s.field);
}
function pendingPlacesHtml(items) {
  if (!items.length) return '';
  return section('Địa danh chờ duyệt', `${items.map((p) => `<div class="rv pl-pend-place">
    <div class="row wrap"><a class="pl-link" href="#place/${p.id}"><b>${esc(p.name || '(chưa có tên)')}</b></a>${tag(`${esc(KIND[p.kind] || 'Địa danh')}`, { tone: 'gray', sm: true })}${p.status === 'pending' ? '<span class="tag gray sm">chưa xác minh</span>' : ''}${JOB[p.job] ? `<span class="sub">${JOB[p.job]}</span>` : ''}</div>
    ${p.suggestions.map((s) => `<div class="pl-sug"><p>${suggText(s)}<br><span class="sub">${SRC[s.source]} · độ khớp ${Math.round(s.confidence * 100)}%</span></p><div class="row end"><button type="button" class="btn ter sm" data-psug="reject" data-id="${s.id}">Không nhận</button><button type="button" class="btn sm" data-psug="accept" data-id="${s.id}">Nhận</button></div></div>`).join('')}
    ${p.status === 'pending' ? `<div class="row end"><button type="button" class="btn gh sm" data-pverify="${p.id}">Xác minh địa danh</button></div>` : ''}</div>`).join('')}`, { variant: 'card', cls: 'pl-pend', level: 2 });
}
// Draws the section before `before` (nothing when the viewer is no curator or nothing waits); redraws after a decision.
export async function reviewSection(main, before) {
  let j; try { j = await getJson('/api/places/pending'); } catch { return; }
  if (!before.isConnected) return;
  let box = main.querySelector('#plpend');
  if (!box) { box = document.createElement('div'); box.id = 'plpend'; before.parentNode.insertBefore(box, before); }
  box.innerHTML = pendingPlacesHtml(j.items || []);
  box.onclick = async (e) => {
    const b = e.target.closest('[data-psug],[data-pverify]'); if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.pverify) { await getJson(`/api/places/${b.dataset.pverify}/verify`, { method: 'POST' }); toast('Đã xác minh địa danh.'); }
      else { const r = await getJson(`/api/place-suggestions/${b.dataset.id}/${b.dataset.psug}`, { method: 'POST' }); toast(b.dataset.psug === 'reject' ? 'Đã bỏ đề xuất.' : r.applied ? 'Đã nhận; bản của mình được bổ sung.' : 'Trường này đã có giá trị; giữ bản của mình.'); }
      reviewSection(main, before);
    } catch (x) { b.disabled = false; toast(x.message); }
  };
}
