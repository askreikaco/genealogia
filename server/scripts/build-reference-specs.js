// Build seed-reference spec files from the sourced datasets (duong-vn, japan-imperial, hwasan-ly) and the cached
// Wikipedia / Wikidata responses.
// Usage (from server/): node scripts/build-reference-specs.js <datasetDir> <outDir> [--raw <cacheDir>] [--vi <viCacheDir>]
// --raw: cached Wikidata responses of the datasets (P27, P21, P39, viwiki sitelinks).
// --vi:  cached vi.wikipedia pageprops (pp-*.json: title -> QID) and Wikidata claims (wb-*.json) for the surname widening.
// Without the caches every claim rule fails closed (no Vietnamese person, sex blank).
// Living or unknown people are excluded (no death date and born after 1926, or no birth date). The owner-approved
// undated Dương Tự Minh (Q10757626) is kept with the note "Không rõ năm."; other undated people need a cached era before 1926.
// Dương (Việt Nam): one family. Each dataset group (linked people) and each wiki person is a root group. Links only
// inside a group. Groups are ordered by the earliest known year (or era), undated last; the order is stored per person.
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const RAW_DIR = flag('--raw');
const VI_DIR = flag('--vi');
const positional = args.filter((a, i) => !a.startsWith('--') && !['--raw', '--vi'].includes(args[i - 1]));
const [dir, outDir] = positional;
if (!dir || !outDir) { console.error('usage: node scripts/build-reference-specs.js <datasetDir> <outDir> [--raw <cacheDir>] [--vi <viCacheDir>]'); process.exit(2); }

const EXCLUDE = new Map([['Q16181054', 'clan item (Hwasan Lee clan), not a person']]);
const OWNER_UNDATED = new Set(['Q10757626']); // Dương Tự Minh: owner asked for him with "không rõ năm"
const KINMEI_ACCESSION = 539; const KINMEI_ORDINAL = 29;
const VN = 'Q881'; const HUMAN = 'Q5';
// Owner decisions (life tied to Vietnam, even with a foreign P27): Q10841085 is a historical Vietnamese state.
const VN_P27 = new Set([VN, 'Q10841085']);
// Owner-kept people with a foreign P27 and a Vietnam life tie, with their note.
const OWNER_KEEP = new Map([['Q6772049', 'gốc Trung Hoa, định cư Đàng Trong 1679.']]); const MALE = 'Q6581097'; const FEMALE = 'Q6581072';
const SOURCE = 'Wikidata (CC0), lấy 2026-11-24 từ bộ dữ liệu duong-world. Người còn sống hoặc không rõ năm sinh/mất đã loại trừ.';
const SOURCE_VN = `${SOURCE} Tên và liên kết bài viết theo vi.wikipedia.`;
const TAGS = ['tham-khao', 'chua-xac-minh'];
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

// ---- caches ------------------------------------------------------------------------------------------------------
const EMPTY = { claims: {}, labels: {}, sitelinks: {} };
const RAW = new Map();
const PP = new Map(); // QID -> vi.wikipedia page title
function mergeEntities(entities) {
  for (const [qid, e] of Object.entries(entities || {})) {
    if (!e || !e.claims) continue;
    const cur = RAW.get(qid) || { claims: {}, labels: {}, sitelinks: {} };
    for (const [p, list] of Object.entries(e.claims)) if (!cur.claims[p]) cur.claims[p] = list;
    Object.assign(cur.labels, e.labels || {}); Object.assign(cur.sitelinks, e.sitelinks || {});
    RAW.set(qid, cur);
  }
}
const jsonFiles = (d, re) => fs.readdirSync(d).filter((x) => re.test(x)).sort();
if (RAW_DIR) for (const f of jsonFiles(RAW_DIR, /\.json$/)) mergeEntities(JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8')).entities);
if (VI_DIR) {
  for (const f of jsonFiles(VI_DIR, /^pp-.*\.json$/)) {
    for (const p of JSON.parse(fs.readFileSync(path.join(VI_DIR, f), 'utf8')).query?.pages || []) {
      if (p.pageprops?.wikibase_item) PP.set(p.pageprops.wikibase_item, p.title);
    }
  }
  for (const f of jsonFiles(VI_DIR, /^wb-.*\.json$/)) mergeEntities(JSON.parse(fs.readFileSync(path.join(VI_DIR, f), 'utf8')).entities);
}
// Where a Wikipedia title comes from. The surname article lists Chinese 楊 people too, so only its "Người Việt Nam"
// section and the "Người họ Dương" category count as Vietnamese sources; the broader "Họ Dương" category needs an
// explicit P27 Vietnam (checked below).
const SRC = { section: new Set(), cat1: new Set(), cat2: new Set() };
if (VI_DIR && fs.existsSync(path.join(VI_DIR, 'surname.json'))) {
  const wt = JSON.parse(fs.readFileSync(path.join(VI_DIR, 'surname.json'), 'utf8')).parse.wikitext;
  let inVn = false;
  for (const line of wt.split('\n')) {
    if (/^==[^=]/.test(line)) { inVn = /^== *Người Việt Nam *==/.test(line); continue; }
    if (!inVn) continue;
    for (const m of line.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) SRC.section.add(m[1].trim());
  }
  for (const [file, key] of [['cat1.json', 'cat1'], ['cat2.json', 'cat2']]) {
    const p = path.join(VI_DIR, file);
    if (fs.existsSync(p)) for (const m of JSON.parse(fs.readFileSync(p, 'utf8')).query?.categorymembers || []) if (m.ns === 0) SRC[key].add(m.title);
  }
}
const ent = (qid) => RAW.get(qid) || EMPTY;
const claimIds = (e, prop) => (e.claims[prop] || []).map((s) => s.mainsnak?.datavalue?.value?.id).filter(Boolean);
const claimTimes = (e, prop) => (e.claims[prop] || []).map((s) => s.mainsnak?.datavalue?.value).filter((v) => v && v.time);
const sexOf = (qid) => { const ids = claimIds(ent(qid), 'P21'); return ids.includes(MALE) ? 'm' : ids.includes(FEMALE) ? 'f' : ''; };

// ---- dates -------------------------------------------------------------------------------------------------------
const first = (x) => (Array.isArray(x) ? (x.find((v) => v && v.rank === 'preferred') || x.find(Boolean) || null) : (x || null));
function yearOf(ev) {
  const m = /^([+-])(\d+)-/.exec(ev?.time || '');
  if (!m) return null;
  const y = parseInt(m[2], 10);
  return m[1] === '-' ? -y : y;
}
// Year text for the app: "874", "trước CN 711", or "khoảng 901" when the precision is coarser than a year.
function dateText(ev) {
  const y = yearOf(ev);
  if (y === null) return '';
  const s = y > 0 ? String(y) : `trước CN ${-y}`;
  return ev.precision && ev.precision < 9 ? `khoảng ${s}` : s;
}
// Earliest reign start (P39 Q208233 qualifier P580) in the cache, as a year, or null.
function reignStart(qid) {
  const years = [];
  for (const s of ent(qid).claims.P39 || []) {
    if (s.mainsnak?.datavalue?.value?.id !== 'Q208233') continue;
    for (const q of s.qualifiers?.P580 || []) { const y = yearOf(q.datavalue?.value); if (y !== null) years.push(y); }
  }
  return years.length ? Math.min(...years) : null;
}
// Era of a person from cached claims: the earliest dated event (P39 start, P571 inception, P580 start), or null.
function eraYear(qid) {
  const e = ent(qid); const ys = [];
  for (const s of e.claims.P39 || []) for (const q of s.qualifiers?.P580 || []) { const y = yearOf(q.datavalue?.value); if (y !== null) ys.push(y); }
  for (const prop of ['P571', 'P580']) for (const v of claimTimes(e, prop)) { const y = yearOf(v); if (y !== null) ys.push(y); }
  return ys.length ? Math.min(...ys) : null;
}
const yearText = (s) => { // from the app's text form: "874", "khoảng 901", "trước CN 711"
  if (!s) return null;
  if (/^trước CN/.test(s)) return -Infinity;
  const m = /(\d+)/.exec(s);
  return m ? parseInt(m[1], 10) : null;
};

function keep(p) {
  if (EXCLUDE.has(p.qid) || p.living_or_post_hirohito_excluded) return false;
  if (first(p.death)) return true;
  const by = yearOf(first(p.birth));
  return by !== null && by <= 1926; // dataset rule: born before 1926 with no death date
}

function personSpec(p, { legendary = false, sex = '', group, order, undated = false, viwiki = false, extra = '' } = {}) {
  const vi = p.label?.vi || p.label?.en || p.qid;
  const alt = [];
  for (const k of ['en', 'zh', 'ja', 'ko']) {
    const v = p.label?.[k];
    if (v && v !== vi && !alt.includes(v)) alt.push(v);
  }
  const desc = p.description?.vi || p.description?.en || '';
  const out = {
    ref: p.qid, name: vi, alt_names: alt, sex,
    note: [legendary ? 'Truyền thuyết.' : '', undated ? 'Không rõ năm.' : '', desc, extra].filter(Boolean).join(' '),
    source_url: (viwiki && p.wikipedia?.vi) || p.wikidata_url || `https://www.wikidata.org/wiki/${p.qid}`,
  };
  if (group !== undefined) out.group = group;
  if (order !== undefined) out.order = order;
  if (!legendary) { // legendary: no exact dates
    const b = dateText(first(p.birth)); const d = dateText(first(p.death));
    if (b) out.born = b;
    if (d) out.died = d;
  }
  return out;
}

// Edges between kept people only. parent-child from rel children (from = parent) and father/mother (from = child).
function linksOf(edges, kept) {
  const pc = new Map(); const cp = new Map(); let dropped = 0;
  for (const e of edges) {
    if (!kept.has(e.from) || !kept.has(e.to)) { dropped++; continue; }
    if (e.rel === 'children') pc.set(`${e.from}>${e.to}`, { parent: e.from, child: e.to });
    else if (e.rel === 'father' || e.rel === 'mother') pc.set(`${e.to}>${e.from}`, { parent: e.to, child: e.from });
    else if (e.rel === 'spouses') { const [a, b] = [e.from, e.to].sort(); cp.set(`${a}|${b}`, { a, b, kind: 'couple' }); }
    else dropped++;
  }
  return { links: [...pc.values(), ...cp.values()], dropped };
}

function assertNoLiving(tree) {
  for (const p of tree.persons) {
    if (/^Truyền thuyết\./.test(p.note || '')) continue; // legendary: no exact dates, ancient by definition
    if (/Không rõ năm\./.test(p.note || '')) continue; // owner-approved undated, or an era before 1926 (checked when built)
    const by = yearText(p.born);
    if (!p.died && !(by !== null && by <= 1926)) throw new Error(`living or unknown person in ${tree.slug}: ${p.ref}`);
  }
}

const report = [];
function writeTree(tree) {
  assertNoLiving(tree);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${tree.slug}.json`), JSON.stringify({ trees: [tree] }, null, 2) + '\n');
  report.push(`${tree.slug}  persons ${tree.persons.length}  parent_child ${tree.links.filter((l) => l.parent).length}  couple ${tree.links.filter((l) => l.kind).length}`);
}

// ---- Vietnam (Họ Dương): one family --------------------------------------------------------------------------------
// Vietnamese life: P27 Vietnam (or the historical state); else, with no P27 at all, a viwiki sitelink (owner rule);
// with only a foreign P27, a life tie is needed: the owner's keep list, or membership of the article's Vietnamese section.
// A foreign P27 with no life tie is excluded (fail closed); the place claims (P19/P20) need labels to be read, not cached.
const isVN = (qid, dsByQ) => {
  const p27 = claimIds(ent(qid), 'P27');
  if (p27.some((x) => VN_P27.has(x))) return true;
  if (OWNER_KEEP.has(qid)) return true;
  if (p27.length) return SRC.section.has(dsByQ.get(qid)?.label?.vi || '');
  return !!ent(qid).sitelinks?.viwiki || !!dsByQ.get(qid)?.wikipedia?.vi;
};
const isDuongName = (title) => /^Dương /.test(title || '');
{
  const ds = read('duong-vn.json');
  const dsByQ = new Map(ds.people.map((p) => [p.qid, p]));
  const dsKept = ds.people.filter(keep);
  const notVN = []; const vnDs = [];
  for (const p of dsKept) (isVN(p.qid, dsByQ) ? vnDs : notVN).push(p);
  const label = (q) => dsByQ.get(q)?.label?.vi || ent(q).labels?.vi?.value || q;
  const vnSet = new Set(vnDs.map((p) => p.qid));

  // wiki people: from pageprops (vi.wikipedia links and category), claims from Wikidata
  const wiki = { candidates: 0, added: [], noEntity: [], notHuman: [], notDuong: [], notSource: [], notVN: [], living: [], dup: [], undatedIn: [] };
  for (const [qid, title] of PP) {
    if (dsByQ.has(qid)) { wiki.dup.push(qid); continue; }
    wiki.candidates++;
    const e = ent(qid);
    if (!e.claims || !Object.keys(e.claims).length) { wiki.noEntity.push(`${title} (${qid})`); continue; }
    if (!claimIds(e, 'P31').includes(HUMAN)) { wiki.notHuman.push(`${title} (${qid})`); continue; }
    if (!isDuongName(title)) { wiki.notDuong.push(`${title} (${qid})`); continue; }
    const fromVn = SRC.section.has(title) || SRC.cat1.has(title);
    if (!fromVn && !(SRC.cat2.has(title) && claimIds(e, 'P27').includes(VN))) { wiki.notSource.push(`${title} (${qid})`); continue; }
    // viwiki sitelink (owner rule), but an explicit P27 of another country (the article also lists Chinese 楊 people) excludes
    const p27 = claimIds(e, 'P27');
    if (p27.length && !p27.some((x) => VN_P27.has(x))) { wiki.notVN.push(`${title} (${qid}) P27 ${p27.join(',')}`); continue; }
    const death = first(claimTimes(e, 'P570')); const birth = first(claimTimes(e, 'P569'));
    const by = yearOf(birth);
    const era = eraYear(qid);
    let undated = false;
    if (!death && !(by !== null && by <= 1926)) {
      // undated: only with a cached era before 1926, or the owner-approved exception
      if (OWNER_UNDATED.has(qid) || (era !== null && era < 1926)) undated = true;
      else { wiki.living.push(`${title} (${qid}) no death; birth ${by ?? 'none'}`); continue; }
    }
    if (undated) wiki.undatedIn.push(`${title} (${qid})${OWNER_UNDATED.has(qid) ? ' owner-approved' : ' era ' + era}`);
    wiki.added.push({ qid, title, birth, death, undated, era });
  }

  // groups: connected components of the Vietnamese dataset people (dataset links only)
  const edges = ds.edges.filter((e) => vnSet.has(e.from) && vnSet.has(e.to));
  const parent = new Map([...vnSet].map((q) => [q, q]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const e of edges) parent.set(find(e.from), find(e.to));
  const comps = new Map();
  for (const q of vnSet) { const r = find(q); comps.set(r, [...(comps.get(r) || []), q]); }

  const knownYear = (q) => {
    const d = dsByQ.get(q);
    const ys = d ? [yearOf(first(d.birth)), yearOf(first(d.death))] : [];
    const w = wiki.added.find((x) => x.qid === q);
    if (w) ys.push(yearOf(w.birth), yearOf(w.death));
    const v = ys.filter((y) => y !== null);
    return v.length ? Math.min(...v) : null;
  };
  const eventYear = (q) => (reignStart(q) ?? eraYear(q));
  const groups = [];
  for (const members of comps.values()) {
    const sorted = [...members].sort((a, b) => (knownYear(a) ?? Infinity) - (knownYear(b) ?? Infinity) || a.localeCompare(b));
    const anchor = sorted.find((q) => isDuongName(label(q))) || sorted[0];
    const yrs = sorted.map(knownYear).filter((y) => y !== null);
    const evs = sorted.map(eventYear).filter((y) => y !== null);
    groups.push({ anchor, members: sorted, key: yrs.length ? Math.min(...yrs) : (evs.length ? Math.min(...evs) : Infinity), kind: 'dataset' });
  }
  for (const w of wiki.added) {
    const yrs = [yearOf(w.birth), yearOf(w.death)].filter((y) => y !== null);
    const k = yrs.length ? Math.min(...yrs) : (w.era !== null ? w.era : Infinity);
    groups.push({ anchor: w.qid, members: [w.qid], key: k, kind: 'wiki' });
  }
  groups.sort((a, b) => (a.key === b.key ? a.anchor.localeCompare(b.anchor) : a.key - b.key));

  // one family, one root group per entry, order stored on every person of the group
  const persons = []; const links = []; let droppedEdges = 0;
  groups.forEach((g, i) => {
    const order = i + 1;
    const set = new Set(g.members);
    const glinks = linksOf(ds.edges.filter((e) => set.has(e.from) || set.has(e.to)), set);
    droppedEdges += glinks.dropped;
    links.push(...glinks.links);
    for (const q of g.members) {
      const w = wiki.added.find((x) => x.qid === q);
      if (w) {
        const e = ent(q);
        const obj = { qid: q, label: { vi: e.labels?.vi?.value || w.title, en: e.labels?.en?.value }, description: {},
          wikidata_url: `https://www.wikidata.org/wiki/${q}`, wikipedia: { vi: `https://vi.wikipedia.org/wiki/${encodeURI(w.title.replace(/ /g, '_'))}` },
          birth: w.birth ? [w.birth] : null, death: w.death ? [w.death] : null };
        persons.push(personSpec(obj, { sex: sexOf(q), group: g.anchor, order, undated: w.undated, viwiki: true }));
      } else {
        const d = dsByQ.get(q);
        const undated = !first(d.birth) && !first(d.death);
        persons.push(personSpec(d, { sex: sexOf(q), group: g.anchor, order, undated, viwiki: true, extra: OWNER_KEEP.get(q) || '' }));
      }
    }
  });
  // no invented links: every link must stay inside one group
  const grp = new Map(); for (const g of groups) for (const q of g.members) grp.set(q, g.anchor);
  for (const l of links) { const a = l.parent || l.a; const b = l.child || l.b; if (grp.get(a) !== grp.get(b)) throw new Error(`cross-group link ${a} ${b}`); }

  const tree = {
    slug: 'ref-duong-vn', name: 'Họ Dương · Việt Nam (tham khảo)', surname: 'Dương', han: '楊', country: 'VN',
    visibility: 'public', tags: TAGS, source: SOURCE_VN, persons, links,
  };
  writeTree(tree);
  const dates = persons.flatMap((p) => [yearText(p.born), yearText(p.died)]).filter((y) => y !== null);
  const undatedNames = persons.filter((p) => /Không rõ năm\./.test(p.note)).map((p) => `${p.name} (${p.ref})`);
  report.push(`vn: groups ${groups.length} (dataset ${groups.filter((g) => g.kind === 'dataset').length}, wiki ${groups.filter((g) => g.kind === 'wiki').length}), dropped edges ${droppedEdges}`);
  report.push(`vn counts: dataset kept ${dsKept.length}, Vietnamese ${vnDs.length}, not Vietnamese ${notVN.length}`);
  report.push(`vn wiki: pageprops QIDs ${PP.size} (new ${wiki.candidates}), added ${wiki.added.length}, excluded: no Wikidata entity ${wiki.noEntity.length}, not human ${wiki.notHuman.length}, not Dương-named ${wiki.notDuong.length}, not in a Vietnamese source ${wiki.notSource.length}, P27 of another country ${wiki.notVN.length}, living/unknown ${wiki.living.length}, already in dataset ${wiki.dup.length}`);
  report.push(`vn undated (${undatedNames.length}): ${undatedNames.join('; ') || '-'}`);
  report.push(`vn years: ${dates.length ? Math.min(...dates) : '-'} – ${dates.length ? Math.max(...dates) : '-'}`);
  report.push(`vn not Vietnamese (dataset): ${notVN.map((p) => `${label(p.qid)} (${p.qid})`).join('; ') || '-'}`);
  report.push(`vn excluded (wiki): ${[...wiki.notHuman.map((x) => 'not human ' + x), ...wiki.notDuong.map((x) => 'not Dương ' + x), ...wiki.notVN.map((x) => 'not VN ' + x), ...wiki.living.map((x) => 'living/unknown ' + x)].join('; ') || '-'}`);
}

// ---- Japan: imperial line ------------------------------------------------------------------------------------------
{
  const ds = read('japan-imperial.json');
  const kept = ds.emperors.filter(keep);
  const ids = new Set(kept.map((p) => p.qid));
  const { links, dropped } = linksOf(ds.edges, ids);
  const start = (p) => reignStart(p.qid);
  const ord = (p) => (p.ordinal == null ? Infinity : p.ordinal);
  kept.sort((a, b) => (start(a) ?? Infinity) - (start(b) ?? Infinity) || ord(a) - ord(b) || a.qid.localeCompare(b.qid));
  let legendary = 0; let unknown = 0;
  const persons = kept.map((p) => {
    const by = yearOf(first(p.birth));
    const noDated = !first(p.birth) && !first(p.death);
    const s = start(p);
    const isLegend = (by !== null && by < KINMEI_ACCESSION) || (s !== null && s < KINMEI_ACCESSION)
      || (noDated && p.ordinal != null && p.ordinal < KINMEI_ORDINAL);
    if (isLegend) legendary++;
    if (s === null && p.ordinal == null && noDated) unknown++;
    // sex from the cache's P21 only; with no P21 and no empress label, default male; empress without P21: blank
    const p21 = claimIds(ent(p.qid), 'P21');
    const en = `${ent(p.qid).labels?.en?.value || ''} ${p.label?.en || ''}`;
    const sex = p21.includes(MALE) ? 'm' : p21.includes(FEMALE) ? 'f' : (/Empress/i.test(en) ? '' : 'm');
    return personSpec(p, { legendary: isLegend, sex });
  });
  const tree = {
    slug: 'ref-jp-imperial', name: 'Hoàng tộc Nhật Bản (tham khảo)', surname: '', han: null, country: 'JP',
    visibility: 'public', tags: TAGS,
    source: `${SOURCE} Trước năm 539 (lên ngôi của Thiên hoàng Kinmei) đánh dấu truyền thuyết: không có ngày chính xác. Cha/mẹ thiếu giữa các đời được để trống.`,
    persons, links,
  };
  writeTree(tree);
  report.push(`japan: kept ${kept.length} of ${ds.emperors.length}, legendary ${legendary}, undated and unordered ${unknown}, dropped edges ${dropped}`);
}

// ---- Hwasan Lý -----------------------------------------------------------------------------------------------------
{
  const ds = read('hwasan-ly.json');
  const kept = ds.people.filter(keep);
  const ids = new Set(kept.map((p) => p.qid));
  const { links, dropped } = linksOf(ds.edges, ids);
  const tree = {
    slug: 'ref-ly-hoa-son', name: 'Họ Lý · Hoa Sơn (tham khảo)', surname: 'Lý', han: '李', country: 'VN',
    visibility: 'public', tags: TAGS,
    source: `${SOURCE} Nhánh Hàn Quốc (Hwasan Lee, KR): chưa có cột quốc gia riêng, ghi tại đây.`,
    persons: kept.map((p) => personSpec(p, { legendary: p.legendary === true })), links,
  };
  writeTree(tree);
  report.push(`hwasan-ly: kept ${kept.length} of ${ds.people.length}, dropped edges ${dropped}`);
}

console.log(report.join('\n'));
