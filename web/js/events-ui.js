// Life events and stories: browser markup (timeline "Dòng đời", the event editor, the summary). Rules in events.js.
// Plain ES module, no build step. Imported by app.js. Styles: app.css ("Dòng đời").
import { esc } from './model.js';
import { searchPeople } from './fuzzy.js';
import { toolbar, ltags, fpanel, cic, addBtn, tag } from './ui.js';
import { EVENT_TYPES, EVENT_TYPE_KEYS, SOURCE_QUALITY, parseEventDate, formatEventDate, sortEvents, eventDays, yearOfDays,
  birthIso, ageAt, stageOf, STAGES, autoSummary } from './events.js';

const P = (d) => `<path d="${d}"/>`;
// 24-unit stroke icons for the event types (one per type icon key in events.js).
const EVI = {
  sprout: P('M12 21v-9') + P('M12 13c0-4 3-6 7-6 0 4-3 6-7 6z') + P('M12 15c0-3-2-5-6-5 0 3 2 5 6 5z'),
  rings: '<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/>',
  split: P('M6 3v7a6 6 0 0 0 12 0V3') + P('M12 16v5'),
  house: P('M3 11l9-7 9 7') + P('M5 10v10h14V10'),
  cap: P('M2 9l10-5 10 5-10 5z') + P('M6 11v4c0 1 3 3 6 3s6-2 6-3v-4'),
  case: '<rect x="3" y="7" width="18" height="13" rx="2"/>' + P('M9 7V4h6v3'),
  shield: P('M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z'),
  star: P('M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z'),
  lotus: P('M12 19c-4 0-6-3-6-6 3 0 6 2 6 6z') + P('M12 19c4 0 6-3 6-6-3 0-6 2-6 6z') + P('M12 13c-2-3-2-7 0-9 2 2 2 6 0 9z'),
  candle: '<rect x="8.5" y="11" width="7" height="10" rx="1"/>' + P('M12 8.9v2.1') + P('M12 2c-1.6 2.1-2.4 3.4-2.4 4.5a2.4 2.4 0 0 0 4.8 0C14.4 5.4 13.6 4.1 12 2z'),
  grave: P('M7 21V10a5 5 0 0 1 10 0v11') + P('M4 21h16'),
  dot: '<circle cx="12" cy="12" r="3"/>',
  pin: P('M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z') + '<circle cx="12" cy="10" r="2"/>',
  doc: P('M7 3h8l4 4v14H7z') + P('M15 3v4h4'),
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/>' + P('M21 17l-5-5-9 9'),
  fam: P('M4 20v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2') + '<circle cx="10" cy="8" r="3"/>' + P('M16 11a3 3 0 1 0 0-6'),
};
export const evIcon = (key, size = 16) => `<svg class="evi" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${EVI[key] || EVI.dot}</svg>`;
export const typeIcon = (type, size) => evIcon(EVENT_TYPES[type]?.icon || 'dot', size);
export const typeLabel = (type) => EVENT_TYPES[type]?.label || type;

// Headline of a card: the type and the place ("Sinh ở Củ Chi"). Derived family events use their own label.
const HEAD = {
  sinh: (e) => (e.place ? `Sinh ở ${e.place}` : 'Sinh'), cuoi: (e) => (e.place ? `Kết hôn ở ${e.place}` : 'Kết hôn'),
  ly_hon: () => 'Ly hôn', chuyen_nha: (e) => (e.place ? `Chuyển đến ${e.place}` : 'Chuyển nhà'),
  hoc: (e) => (e.place ? `Học tại ${e.place}` : 'Học hành'), nghe: (e) => (e.place ? `Làm việc tại ${e.place}` : 'Nghề nghiệp'),
  quan_ngu: (e) => (e.place ? `Nhập ngũ tại ${e.place}` : 'Quân ngũ'), thanh_tich: () => 'Thành tích',
  ton_giao: () => 'Tôn giáo', mat: (e) => (e.place ? `Mất ở ${e.place}` : 'Mất'), an_tang: (e) => (e.place ? `An táng ở ${e.place}` : 'An táng'),
  khac: (e) => (e.description ? e.description.split('\n')[0].slice(0, 80) : 'Sự kiện'),
};
export const headline = (e) => (e.derived ? e.label : (HEAD[e.type] ? HEAD[e.type](e) : typeLabel(e.type)));
const firstLine = (s) => String(s || '').split('\n')[0];

// ---- timeline: filters (per device), rows, markup ----
// Automatic rows by group: self (birth, death, marriage), fam (parents, spouse, younger siblings), desc (children,
// grandchildren), hist (eras, reigns, wars); all on by default, each switch remembered per device).
export const TL_DEFAULT = { q: '', types: [], self: true, fam: true, desc: true, hist: true, stages: [], photo: false, source: false };
const GROUP = { self: ['self', 'Bản thân'], family: ['fam', 'Gia đình'], desc: ['desc', 'Con cháu'], hist: ['hist', 'Lịch sử'] };
const TL_KEY = 'gp_tl';
export function tlLoad() { try { return { ...TL_DEFAULT, ...JSON.parse(localStorage.getItem(TL_KEY) || '{}') }; } catch { return { ...TL_DEFAULT }; } }
export function tlSave(f) { try { localStorage.setItem(TL_KEY, JSON.stringify(f)); } catch {} }
const fold = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd');

// Entries of the timeline before filtering: stored events, plus derived family events when the family switch is on.
// Each entry: { id, e (event), derived, days, age (object|null), stage (string|null) }.
export function tlEntries({ events, derived, birth }) {
  const all = [...events.map((e) => ({ e, derived: false })), ...derived.map((e) => ({ e, derived: true }))];
  const rows = all.map(({ e, derived: isD }) => {
    const days = eventDays(e);
    const age = birth ? ageAt(birth, e) : null;
    return { id: e.id, e: { ...e, derived: isD }, derived: isD, days, age, stage: age ? stageOf(age.years) : null };
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return sortEvents(rows.map((r) => r.e)).map((e) => byId.get(e.id));
}

// The filter of one entry. nameOf(id) gives a person's name (for search).
export function tlMatch(row, f, nameOf = () => '') {
  if (row.derived && !f[(GROUP[row.e.group] || GROUP.family)[0]]) return false;
  if (f.types.length && !f.types.includes(row.e.type)) return false;
  if (f.stages.length && (!row.stage || !f.stages.includes(row.stage))) return false;
  if (f.source && !(row.e.sources || []).length) return false;
  if (f.photo && !(row.e.photos || []).length) return false; // derived rows carry no photos
  const q = fold(f.q).trim();
  if (q) {
    const hay = fold([headline(row.e), row.e.description, row.e.place, row.e.place_new, ...(row.e.people || []).map(nameOf)].join(' '));
    if (!hay.includes(q)) return false;
  }
  return true;
}

// Chips for the active filters (removable). Keys are what the untag handler understands.
export function tlTags(f) {
  const tags = [];
  if (f.q.trim()) tags.push(['q', `“${f.q.trim()}”`]);
  for (const t of f.types) tags.push([`type:${t}`, typeLabel(t)]);
  for (const s of f.stages) tags.push([`stage:${s}`, s]);
  if (!f.self) tags.push(['self', 'Ẩn bản thân']);
  if (!f.fam) tags.push(['fam', 'Ẩn gia đình']);
  if (!f.desc) tags.push(['desc', 'Ẩn con cháu']);
  if (!f.hist) tags.push(['hist', 'Ẩn lịch sử']);
  if (f.source) tags.push(['source', 'Có nguồn']);
  if (f.photo) tags.push(['photo', 'Có ảnh']);
  return tags;
}
export function tlApplyUntag(f, key) {
  const g = { ...f, types: [...f.types], stages: [...f.stages] };
  if (key === '*') return { ...TL_DEFAULT };
  if (key === 'q') g.q = '';
  else if (key === 'fam' || key === 'self' || key === 'desc') g[key] = true;
  else if (key === 'hist') g.hist = true;
  else if (key === 'source') g.source = false;
  else if (key === 'photo') g.photo = false;
  else if (key.startsWith('type:')) g.types = g.types.filter((x) => x !== key.slice(5));
  else if (key.startsWith('stage:')) g.stages = g.stages.filter((x) => x !== key.slice(6));
  return g;
}

// The ListToolbar of the timeline: search, the filter button, the primary switches inline on desktop (tags and count follow the bar).
export function tlToolbar(f, wide) {
  const active = tlTags(f).length;
  const quick = `<button type="button" class="chipb${f.fam ? ' on' : ''}" data-tl-f="fam" aria-pressed="${f.fam}">${evIcon('fam', 16)}Gia đình</button>`
    + `<button type="button" class="chipb${f.desc ? ' on' : ''}" data-tl-f="desc" aria-pressed="${f.desc}">Con cháu</button>`
    + `<button type="button" class="chipb${f.hist ? ' on' : ''}" data-tl-f="hist" aria-pressed="${f.hist}">Lịch sử</button>`
    + `<button type="button" class="chipb${f.source ? ' on' : ''}" data-tl-f="source" aria-pressed="${f.source}">Có nguồn</button>`;
  return toolbar({ id: 'tlq', ph: 'Tìm trong dòng đời', val: f.q, active: active, quick: wide ? quick : '', add: addBtn('data-ev-add', 'Thêm sự kiện') });
}
// The one compact approximate value: "~" on screen, "khoảng …" for screen readers (role img + aria-label).
export const approxHtml = (text, aria) => `<span role="img" aria-label="${esc(aria)}">~${esc(text)}</span>`;
export const tlCount = (n, hist = 0, est = '') => `<p class="tl-count" role="status" aria-live="polite">${n} sự kiện${hist ? ` · ${hist} mốc lịch sử` : ''}${est ? ` · theo năm ước tính ${approxHtml(est, `khoảng ${est}`)}` : ''}</p>`;

// Filter sheet body: event types, life stages, the automatic groups (all on by default), photo and source.
export function tlSheet(f) {
  const types = EVENT_TYPE_KEYS.map((k) => `<label class="chk"><input type="checkbox" data-tl-type="${k}" ${f.types.includes(k) ? 'checked' : ''}> ${esc(typeLabel(k))}</label>`).join('');
  const stages = STAGES.map(([, , s]) => `<label class="chk"><input type="checkbox" data-tl-stage="${esc(s)}" ${f.stages.includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join('');
  return `<fieldset class="fp-field"><legend>Loại sự kiện</legend><div class="chkg">${types}</div></fieldset>`
    + `<fieldset class="fp-field"><legend>Giai đoạn</legend><div class="chkg">${stages}</div></fieldset>`
    + `<fieldset class="fp-field"><legend>Tự động từ cây</legend>`
    + `<label class="swt"><input type="checkbox" data-tl-f="self" ${f.self ? 'checked' : ''}> <span>Bản thân <span class="sub">(sinh, mất, kết hôn)</span></span></label>`
    + `<label class="swt"><input type="checkbox" data-tl-f="fam" ${f.fam ? 'checked' : ''}> <span>Gia đình <span class="sub">(cha mẹ, vợ chồng, em ra đời)</span></span></label>`
    + `<label class="swt"><input type="checkbox" data-tl-f="desc" ${f.desc ? 'checked' : ''}> <span>Con cháu <span class="sub">(con, cháu ra đời; con kết hôn, mất)</span></span></label>`
    + `<label class="swt"><input type="checkbox" data-tl-f="hist" ${f.hist ? 'checked' : ''}> <span>Lịch sử <span class="sub">(triều đại, đời vua, chiến tranh, sự kiện)</span></span></label></fieldset>`
    + `<label class="swt"><input type="checkbox" data-tl-f="photo" ${f.photo ? 'checked' : ''}> <span>Có ảnh</span></label>`
    + `<label class="swt"><input type="checkbox" data-tl-f="source" ${f.source ? 'checked' : ''}> <span>Có nguồn</span></label>`;
}
export const tlSheetDialog = (f) => fpanel(tlSheet(f));

// One card (or a calm derived row). canEdit: show the edit button (members suggest, editors edit).
const HIST_TAG = '<span class="tag gray sm">Lịch sử</span> ';
// A person's name inside an event label, as a link to their profile (first occurrence only).
const linkName = (text, id, name, href) => {
  const t = esc(text); const n = esc(name || '');
  return href && id && n && t.includes(n) ? t.replace(n, `<a class="tl-pp" href="${esc(href(id))}">${n}</a>`) : t;
};
// An estimated life row (estimate-graph.js): a dashed card, the range, "Cách tính" (tap to open the basis) and, for
// editors, "Lưu thành sự kiện" (the timeline asks for confirmation and stores it as an event of range 'between').
function estCardHtml(row, { estSave }) {
  const e = row.e;
  // plain lines, not <li>: .tl2 li is the timeline's grid and would squeeze them into a narrow column
  const basis = (e.basis || []).map((b) => `<span class="est-line">${esc(b)}</span>`).join('') || '<span class="est-line">Chưa có căn cứ.</span>';
  return `<li class="rel est"><div class="dt"><b class="tl-approx">~${esc(e.mid)}</b></div>`
    + `<div class="rail"><span class="dot"></span></div>`
    + `<div class="card"><span class="kind">${typeIcon(e.type, 16)}${esc(e.label)} ${tag(`tự động`, { tone: 'gray', sm: true })} ${tag(`ước tính`, { tone: 'gray', sm: true })}</span>`
    + `<p class="est-range">khoảng ${esc(e.range)}</p>`
    + `<details class="est-basis"><summary>Cách tính</summary><div class="est-lines">${basis}</div></details>`
    + (estSave ? `<button type="button" class="btn sm gh" data-est-save="${esc(row.id)}">Lưu thành sự kiện</button>` : '')
    + `</div></li>`;
}
function cardHtml(row, { ageLabel, canEdit, nameOf, editLbl, personHref = null, selfId = null }) {
  const e = row.e; const d = row.derived;
  const yr = yearOfLabel(row); const when = formatEventDate(e) || 'chưa rõ năm';
  const yrCell = e.date_kind === 'about' && yr ? approxHtml(yr, `khoảng ${yr}`) : esc(yr);
  const age = ageLabel ? `<span class="tl-age">${ageLabel}</span>` : '';
  const reign = e.date_text && /[^\d\s/~–-]/.test(e.date_text) && !/^(khoảng|khoang|trước|truoc|sau|chừng)\b/i.test(e.date_text) ? e.date_text : '';
  const whenLine = reign ? `<span class="sub">≈${esc(yr)} · ${esc(reign)}</span>` : when !== yr && when !== 'chưa rõ năm' ? `<span class="sub">${esc(when)}</span>` : '';
  const people = (e.people || []).map(nameOf).filter(Boolean);
  const nsrc = (e.sources || []).length; const photos = e.photos ? e.photos.length : 0;
  const cnt = !d && (nsrc || photos) ? `<span class="cnt">${nsrc ? `<span>${evIcon('doc', 14)}${nsrc}</span>` : ''}${photos ? `<span>${evIcon('photo', 14)}${photos}</span>` : ''}</span>` : '';
  const grp = GROUP[e.group] || GROUP.family;
  const kind = d ? `<span class="kind">${e.group === 'hist' ? '' : evIcon('fam', 16)}${esc(grp[1])}${e.group === 'hist' ? '' : ' <span class="tag gray sm">tự động</span>'}</span>`
    : `<span class="kind">${typeIcon(e.type, 16)}${esc(typeLabel(e.type))}</span>`;
  const src = e.group === 'hist' && e.source ? `<a class="sub" href="${esc(e.source)}" target="_blank" rel="noopener">Nguồn ›</a>` : '';
  const peopleHtml = (e.people || []).filter((pid) => nameOf(pid)).map((pid) => (personHref ? `<a class="tl-pp" href="${esc(personHref(pid))}">${esc(nameOf(pid))}</a>` : esc(nameOf(pid)))).join(' · ');
  const meta = e.place_new ? `Nay: ${e.place_new}` : '';
  const title = d && e.person_id && e.person_id !== selfId ? linkName(headline(e), e.person_id, nameOf(e.person_id), personHref) : esc(headline(e));
  const edit = canEdit && !d && !e.pending ? `<button type="button" class="ib tl-edit" data-ev-edit="${esc(row.id)}" aria-label="${esc(editLbl)}" title="${esc(editLbl)}">${cic('pencil', 16)}</button>` : '';
  // reign bands and every other history row share one quiet style (grey strip), below personal and family cards
  if (e.band || e.group === 'hist') return `<li class="band${e.group === 'hist' && !e.band ? ' hist' : ''}"><div class="dt"><b>${yrCell}</b>${e.band ? '' : age}</div><div class="rail"></div>`
    + (e.source ? `<a class="tl-band" href="${esc(e.source)}" target="_blank" rel="noopener" aria-label="${esc(e.label)} (mở nguồn trong thẻ mới)">${HIST_TAG}${esc(e.label)}</a>` : `<p class="tl-band">${HIST_TAG}${esc(e.label)}</p>`) + '</li>';
  const pend = e.pending ? ` ${tag('Chưa gửi', { tone: 'gray', sm: true })}` : '';
  return `<li class="${d ? (e.group === 'hist' ? 'rel hist' : 'rel') : ''}"><div class="dt"><b>${yrCell}</b>${age}</div>`
    + `<div class="rail"><span class="dot"></span></div>`
    + `<div class="card">${kind}${pend}<h3>${title}</h3>`
    + (e.description && !d ? `<p>${esc(firstLine(e.description))}${e.description.includes('\n') || e.description.length > 90 ? '…' : ''}</p>` : '')
    + whenLine + (meta || peopleHtml ? `<span class="pl">${[meta ? esc(meta) : '', peopleHtml].filter(Boolean).join(' · ')}</span>` : '')
    + (e.grouped && e.names && e.names.length ? `<details class="tl-why"><summary>Xem tên ›</summary><p class="sub tl-why-body">${esc(e.names.join(', '))}</p></details>` : '')
    + (!d && (e.photos || []).length ? `<div class="ev-ph">${e.photos.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>` : '')
    + `<div class="ft">${cnt}${src}${edit}</div></div></li>`;
}
const yearOfLabel = (row) => (row.days === null ? '' : String(yearOfDays(row.days)));

// The list: rows with a year, an age and a card; life-stage headers when the life spans 70 years of age.
export function tlList(rows, { nameOf, canEdit, editLbl = 'Sửa', span = false, personHref = null, selfId = null, estSave = false }) {
  let out = ''; let last = null;
  for (const row of rows) {
    if (span && row.stage && row.stage !== last) {
      out += `<li class="stg"><p class="tl-lbl">${esc(row.stage)}</p></li>`; last = row.stage;
    }
    const ageLabel = row.age && !row.e.band && !(row.e.group === 'self' && row.e.type === 'sinh') ? (row.age.approx ? approxHtml(`${row.age.years} tuổi`, `khoảng ${row.age.years} tuổi`) : esc(`lúc ${row.age.years} tuổi`)) : '';
    out += row.e.estimated ? estCardHtml(row, { estSave: estSave && row.e.person_id === selfId }) : cardHtml(row, { ageLabel, canEdit, nameOf, editLbl, personHref, selfId });
  }
  return `<ol class="tl2">${out}</ol>`;
}

// Câu chuyện đời at the top of Dòng đời: the summary (saved, or auto from the events), then the stories (title, body, photos).
// Each body clamps to 3 lines with "Đọc tiếp" (inline, a tap). More than 2 stories: 2 show, then "Xem tất cả N câu chuyện".
// Viewers get nothing when there is no summary and no story; editors (canAdd) always get "+ Thêm câu chuyện".
const STORY_SHOW = 2; const STORY_LONG = 150;
export function lifeStoriesHtml({ name, events, summary, stories, canEdit, canAdd, photosOnly = false }) {
  const list = stories.filter((s) => s.kind !== 'tom_tat' && (!photosOnly || (s.photos || []).length));
  const body = summary ? summary.body : autoSummary(name, events);
  const more = (text) => (text.length > STORY_LONG ? '<button type="button" class="btn gh sm" data-st-more>Đọc tiếp</button>' : '');
  const clamp = (text) => `<p${text.length > STORY_LONG ? ' class="rv-clamp"' : ''}>${esc(text)}</p>`;
  const sumCard = body ? `<section class="cd lifestory" aria-label="Câu chuyện đời"><div class="lshead"><h3 class="lsh">Câu chuyện đời${summary ? '' : ' <span class="tag gray">tự tạo</span>'}</h3>`
    + (canEdit ? `<button type="button" class="ib" data-sum-edit aria-label="Sửa" title="Sửa">${cic('pencil', 16)}</button>` : '') + `</div>`
    + `${clamp(body)}${more(body)}</section>` : '';
  const card = (s) => {
    const photos = (s.photos || []).length ? `<div class="stry-ph">${s.photos.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>` : '';
    return `<article class="cd stry"><h3>${esc(s.title || 'Câu chuyện')}</h3>${photos}${clamp(s.body || '')}${more(s.body || '')}</article>`;
  };
  const add = canAdd ? '<button type="button" class="btn ter sm" data-st-add>+ Thêm câu chuyện</button>' : '';
  if (!add && !sumCard && !list.length) return '';
  const folded = list.length > STORY_SHOW;
  const cards = list.slice(0, STORY_SHOW).map(card).join('');
  const rest = folded ? `<button type="button" class="btn ter sm" data-st-all>Xem tất cả ${list.length} câu chuyện</button><div class="stry-more" hidden>${list.slice(STORY_SHOW).map(card).join('')}</div>` : '';
  return `<div class="stories lifeblock">${add}${sumCard}${cards}${rest}</div>`;
}

// ---- event editor (dialog on the timeline, and inline in the person form). Values live in data-f attributes. ----
export function evEditorHtml(item = {}, { people = [], persons = [], id = '', page = false } = {}) {
  const v = { type: 'sinh', date_text: '', place: '', place_new: '', description: '', lunar: '', ...item };
  if (item.date_kind && !v.date_text) v.date_text = formatEventDate(item);
  const chips = people.map((pid) => personChip(pid, persons)).join('');
  const srcs = (item.sources || []).map((s) => sourceRow(s)).join('');
  const photos = (item.photos || []).map((u) => photoRow(u)).join('');
  return `<div class="evx" data-evx data-id="${esc(id)}">
    <label class="fld">Loại sự kiện<select data-f="type">${EVENT_TYPE_KEYS.map((k) => `<option value="${k}" ${k === v.type ? 'selected' : ''}>${esc(typeLabel(k))}</option>`).join('')}</select></label>
    <label class="fld">Thời gian<input data-f="date_text" value="${esc(v.date_text)}" autocomplete="off" placeholder="vd 1981, 3/1981, 1980–1981"></label>
    <p class="sub">Nhập năm, tháng/năm, hoặc “khoảng 1980”, “trước 1975”, “sau 1990”, “1980–1985”.</p>
    <label class="fld">Âm lịch (tuỳ chọn)<input data-f="lunar" value="${esc(v.lunar)}" autocomplete="off"></label>
    <label class="fld">Địa điểm<input data-f="place" value="${esc(v.place)}" autocomplete="off"></label>
    <label class="fld">Tên mới (sau 2025), nếu khác<input data-f="place_new" value="${esc(v.place_new)}" autocomplete="off"></label>
    <label class="fld">Mô tả<textarea data-f="description" rows="3" maxlength="2000">${esc(v.description)}</textarea></label>
    <div class="evx-people"><span class="sub">Người liên quan</span><div class="chips" data-chips>${chips}</div>
      <input class="pk-q" type="search" placeholder="Tìm người…" autocomplete="off" aria-label="Tìm người liên quan" data-pk-q>
      <div class="pk-res" data-pk-res></div></div>
    <div class="evx-ph"><span class="sub">Ảnh (tối đa 10)</span><div class="evx-phs" data-phs>${photos}</div>
      <label class="btn ter sm">+ Thêm ảnh<input type="file" accept="image/*" hidden data-evx-photo></label><span class="sub" data-evx-photomsg aria-live="polite"></span></div>
    <div class="evx-src"><span class="sub">Nguồn</span><div data-srcs>${srcs}</div><button type="button" class="btn ter sm src-add" data-src-add>+ Thêm nguồn</button></div>
    <p class="err" data-evx-err role="alert" hidden></p>
    <div class="row end evx-acts${page ? ' fp-bar' : ''}"><button type="button" class="btn gh" data-evx-cancel>Hủy</button><button type="button" class="btn" data-evx-save>Lưu sự kiện</button></div>
  </div>`;
}
const personChip = (pid, persons) => { const p = persons.find((x) => x.id === pid); return `<span class="pchip" data-pid="${esc(pid)}">${esc(p ? p.name : pid)}<button type="button" class="pchip-x" data-pchip-x aria-label="Bỏ người này">×</button></span>`; };
// One source as a card: name, link and quality, each full width on a phone, side by side when there is room.
const sourceRow = (s = {}) => `<div class="srow" data-src><div class="srow-h"><span class="sub">Nguồn</span><button type="button" class="linkbtn" data-src-del aria-label="Bỏ nguồn">×</button></div>`
  + `<label class="fld">Tên nguồn<input data-sf="title" value="${esc(s.title || '')}" placeholder="vd Gia phả viết tay 1950" maxlength="300" aria-label="Tên nguồn" autocomplete="off"></label>`
  + `<label class="fld">Link (tuỳ chọn)<input data-sf="url" value="${esc(s.url || '')}" placeholder="https://…" maxlength="2000" aria-label="Link nguồn" autocomplete="off"></label>`
  + `<label class="fld">Chất lượng<select data-sf="quality" aria-label="Chất lượng nguồn"><option value="">Chưa rõ</option>${Object.entries(SOURCE_QUALITY).map(([k, l]) => `<option value="${k}" ${s.quality === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>`;

// One photo of an event: a thumbnail and a remove button (the link is kept on the element).
// Uploaded photos not saved yet are shown from the device (the server serves a photo only with its record).
export const PHOTO_PREVIEW = new Map();
const photoRow = (u, preview = '') => `<div class="evx-ph1" data-ph="${esc(u)}"><img src="${esc(preview || PHOTO_PREVIEW.get(u) || u)}" alt="" loading="lazy"><button type="button" class="linkbtn" data-ph-del aria-label="Ảnh này: gỡ khỏi sự kiện">×</button></div>`;
export { photoRow };

// Reads the editor's values: { item, error }. Dates are parsed here (the server checks them again).
export function readEvx(root) {
  const g = (k) => (root.querySelector(`[data-f="${k}"]`)?.value ?? '').trim();
  const dp = parseEventDate(g('date_text'));
  if (dp.error) return { error: dp.error, field: 'date_text' };
  const people = [...root.querySelectorAll('[data-chips] [data-pid]')].map((el) => el.dataset.pid);
  const sources = [...root.querySelectorAll('[data-src]')].map((row) => ({
    title: row.querySelector('[data-sf="title"]').value.trim(), url: row.querySelector('[data-sf="url"]').value.trim(),
    quality: row.querySelector('[data-sf="quality"]').value || null,
  })).filter((s) => s.title || s.url);
  const item = { type: g('type'), date_text: g('date_text'), date_kind: dp.kind || null, date_from: dp.from || null, date_to: dp.to || null,
    lunar: g('lunar'), place: g('place'), place_new: g('place_new'), description: root.querySelector('[data-f="description"]').value.trim(),
    people, sources, photos: [...root.querySelectorAll('[data-ph]')].map((el) => el.dataset.ph), is_preferred: true };
  return { item };
}

// Wires a rendered editor: chips, people picker, sources. persons: [{id, name, years}]
export function wireEvx(root, persons) {
  const res = root.querySelector('[data-pk-res]'); const q = root.querySelector('[data-pk-q]');
  const chips = root.querySelector('[data-chips]');
  const paint = () => {
    const term = q.value.trim(); const have = new Set([...chips.querySelectorAll('[data-pid]')].map((x) => x.dataset.pid));
    const hits = term ? searchPeople(persons.filter((p) => !have.has(p.id)), term, { limit: 8 }) : [];
    res.innerHTML = hits.map((p) => `<button type="button" class="pk-opt" data-pick="${esc(p.id)}">${esc(p.name)}${p.years ? ` <span class="sub">${esc(p.years)}</span>` : ''}</button>`).join('')
      + (term && !hits.length ? '<p class="sub">Không thấy người nào khớp.</p>' : '');
  };
  q.addEventListener('input', paint);
  root.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { chips.insertAdjacentHTML('beforeend', personChip(pick.dataset.pick, persons)); q.value = ''; paint(); q.focus(); return; }
    const x = e.target.closest('[data-pchip-x]'); if (x) { x.closest('[data-pid]').remove(); paint(); return; }
    if (e.target.closest('[data-src-add]')) {
      root.querySelector('[data-srcs]').insertAdjacentHTML('beforeend', sourceRow({}));
      const titles = root.querySelectorAll('[data-srcs] [data-sf="title"]'); titles[titles.length - 1]?.focus(); return;
    }
    const del = e.target.closest('[data-src-del]'); if (del) { del.closest('[data-src]').remove(); }
    const pdel = e.target.closest('[data-ph-del]'); if (pdel) { pdel.closest('[data-ph]').remove(); }
  });
}

// Story editor (title, body, photo links one per line). The summary edit uses the same markup with body only.
export function storyEditorHtml(s = {}, { summary = false } = {}) {
  return `<div class="evx" data-stx data-kind="${summary ? 'tom_tat' : 'chuyen'}">`
    + (summary ? '' : `<label class="fld">Tiêu đề<input data-s="title" value="${esc(s.title || '')}" maxlength="300" autocomplete="off"></label>`)
    + `<label class="fld">Nội dung<textarea data-s="body" rows="${summary ? 8 : 6}" maxlength="20000">${esc(s.body || '')}</textarea></label>`
    + (summary ? '' : `<label class="fld">Link ảnh (mỗi dòng một link)<textarea data-s="photos" rows="2">${esc((s.photos || []).join('\n'))}</textarea></label>`)
    + `<p class="err" data-evx-err role="alert" hidden></p><div class="row end evx-acts"><button type="button" class="btn gh" data-evx-cancel>Hủy</button><button type="button" class="btn" data-stx-save>Lưu</button></div></div>`;
}
export function readStx(root) {
  const body = root.querySelector('[data-s="body"]').value.trim();
  const titleEl = root.querySelector('[data-s="title"]'); const photosEl = root.querySelector('[data-s="photos"]');
  return { kind: root.dataset.kind === 'tom_tat' ? 'tom_tat' : 'chuyen', title: titleEl ? titleEl.value.trim() : 'Câu chuyện đời', body,
    photos: photosEl ? photosEl.value.split('\n').map((x) => x.trim()).filter(Boolean) : [] };
}

