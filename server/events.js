// Life events and stories: database side (CRUD inside the caller's transaction, history, row shape).
// Rules (dates, validation, privacy, derivation) live in web/js/events.js and are loaded from there.
// History: one row per change, field 'su_kien' (event) or 'cau_chuyen' (story); old_value/new_value are short summaries.
'use strict';
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');

let rulesMod = null;
// The shared rules module (ESM in web/js), loaded once.
const rules = () => rulesMod || (rulesMod = import(pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'events.js')).href));

const SRC = require('./sources'); // reusable sources: a citation's source_id is checked and its title/url copied here

const EV_COLS = 'id, family_id, person_id, type, title, date_text, date_kind, date_from, date_to, lunar, date_cal, place, place_new, description, people, sources, photos, is_preferred, alt_of, created_by, created_at, updated_at';
const ST_COLS = 'id, family_id, person_id, kind, title, body, photos, people, created_by, created_at, updated_at';
const iso = (d) => (d instanceof Date ? d.toISOString() : d);

function eventOut(r) {
  return { id: r.id, person_id: r.person_id, type: r.type, title: r.title || '', date_text: r.date_text || '', date_kind: r.date_kind || null, date_from: r.date_from || null,
    date_to: r.date_to || null, lunar: r.lunar || '', date_cal: r.date_cal || '', place: r.place || '', place_new: r.place_new || '', description: r.description || '',
    people: r.people || [], sources: r.sources || [], photos: r.photos || [], is_preferred: r.is_preferred !== false, alt_of: r.alt_of || null,
    created_by: r.created_by || '', created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
}
function storyOut(r) {
  return { id: r.id, person_id: r.person_id, kind: r.kind, title: r.title || '', body: r.body || '', photos: r.photos || [], people: r.people || [],
    created_by: r.created_by || '', created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
}

// Lịch (the calendar Thời gian was typed in): the converted calendars and 'text' (kept as typed). null or '' = Dương lịch.
const DATE_CALS = ['vn-lunar', 'cn-lunar', 'japanese', 'hebrew', 'islamic-umalqura', 'text'];
// The fields a client may set, cleaned (never trust the body's extra keys).
function cleanEvent(e) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const kind = e.date_kind || null;
  return {
    type: e.type, title: s(e.title).slice(0, 80) || null, date_text: s(e.date_text).slice(0, 200), date_kind: kind,
    date_from: kind ? s(e.date_from) : null, date_to: kind === 'between' ? s(e.date_to) : null,
    lunar: s(e.lunar).slice(0, 200), date_cal: DATE_CALS.includes(e.date_cal) ? e.date_cal : null, place: s(e.place).slice(0, 2000), place_new: s(e.place_new).slice(0, 2000),
    description: s(e.description).slice(0, 2000),
    people: Array.isArray(e.people) ? e.people.slice(0, 20) : [],
    // a citation: title and url (copied from the source when source_id is set), quality, and the page of the source
    sources: Array.isArray(e.sources) ? e.sources.slice(0, 20).map((x) => ({ title: s(x.title).slice(0, 300), url: s(x.url).slice(0, 2000), quality: x.quality || null,
      ...(typeof x.source_id === 'string' && x.source_id ? { source_id: x.source_id.slice(0, 20) } : {}), ...(s(x.page) ? { page: s(x.page).slice(0, 200) } : {}) })) : [],
    photos: Array.isArray(e.photos) ? e.photos.slice(0, 10).filter((u) => typeof u === 'string') : [],
    is_preferred: e.is_preferred !== false,
  };
}
// personId: the owner. The owner is not repeated in people; a summary (tom_tat) tags nobody.
function cleanStory(s, personId) {
  const kind = s.kind === 'tom_tat' ? 'tom_tat' : 'chuyen';
  const people = Array.isArray(s.people) ? [...new Set(s.people.filter((x) => typeof x === 'string' && x && x !== personId))].slice(0, 20) : [];
  return { kind, title: String(s.title || '').trim().slice(0, 300), body: String(s.body || '').trim(),
    photos: Array.isArray(s.photos) ? s.photos.slice(0, 30) : [], people: kind === 'tom_tat' ? [] : people };
}
// Tagged people must be living records of this family (not deleted): a tag never reaches another family. 422 otherwise.
async function checkStoryPeople(client, famId, input, personId) {
  const ids = cleanStory(input || {}, personId).people;
  if (!ids.length) return;
  const { rows } = await client.query('select id from persons where family_id=$1 and deleted=false and id = any($2)', [famId, ids]);
  if (rows.length !== ids.length) throw new EvError(422, 'Người liên quan không có trong dòng họ này.');
}
// A guest's view of stories: a living person's name is not shown, neither as a tagged person nor as the teller
// (created_by becomes '' with created_by_hidden, and the client shows the private label). Members see everything.
async function forViewer(pool, famId, stories, member) {
  if (member || !stories.length) return stories.map((s) => ({ ...s, created_by_hidden: false }));
  const ids = [...new Set(stories.flatMap((s) => s.people))];
  const names = [...new Set(stories.map((s) => s.created_by).filter(Boolean))];
  const { rows } = await pool.query('select id, data from persons where family_id=$1 and deleted=false and (id = any($2) or data->>\'name\' = any($3))', [famId, ids, names]);
  const R = await rules();
  const livingIds = new Set(); const livingNames = new Set();
  for (const r of rows) if (R.isLiving(r.data)) { livingIds.add(r.id); if (r.data.name) livingNames.add(r.data.name); }
  return stories.map((s) => {
    const hide = !!s.created_by && livingNames.has(s.created_by);
    return { ...s, people: s.people.filter((x) => !livingIds.has(x)), created_by: hide ? '' : s.created_by, created_by_hidden: hide };
  });
}

// Idempotency: a retried op is applied once (same table as person ops). Returns false when already applied.
async function claimOp(client, opId, personId) {
  const r = await client.query('insert into ops (op_id, person_id) values ($1,$2) on conflict do nothing returning op_id', [opId, personId]);
  return r.rowCount > 0;
}
async function writeHistory(client, personId, field, oldV, newV, byUser) {
  await client.query('insert into history (person_id, field, old_value, new_value, by_user) values ($1,$2,$3,$4,$5)',
    [personId, field, oldV == null ? null : JSON.stringify(oldV), newV == null ? null : JSON.stringify(newV), byUser]);
}
const evSummary = (r) => (r ? { type: r.type, title: r.title || '', date_text: r.date_text || '', place: r.place || '', description: (r.description || '').slice(0, 200) } : null);
const storySummary = (r) => (r ? { kind: r.kind, title: r.title || '' } : null);

// Person in this family, not deleted (events and stories hang off a person).
async function personIn(client, famId, personId) {
  const { rows } = await client.query('select id, data, deleted from persons where id=$1 and family_id=$2', [personId, famId]);
  return rows[0] && !rows[0].deleted ? rows[0] : null;
}

// Custom names (Khác) of the family's events that the viewer may see: canSee(personId, personData) filters the rows before
// they are counted (privacy by person, branch scope), so a hidden person's name never comes back. Another family is never read.
async function titleSuggestions(pool, famId, canSee) {
  const R = await rules();
  const { rows } = await pool.query("select e.type, e.title, p.id as pid, p.data from events e join persons p on p.id = e.person_id and p.family_id = e.family_id where e.family_id=$1 and e.type='khac' and e.title is not null and not p.deleted", [famId]);
  return R.usedTitles(rows.filter((r) => canSee(r.pid, r.data)).map((r) => ({ type: r.type, title: r.title }))).slice(0, 100);
}
async function listEvents(pool, famId, personId) {
  const { rows } = await pool.query(`select ${EV_COLS} from events where family_id=$1 and person_id=$2`, [famId, personId]);
  return rows.map(eventOut);
}
// The stories of a person: the ones about them and the ones that tag them (people).
async function listStories(pool, famId, personId) {
  const { rows } = await pool.query(`select ${ST_COLS} from stories where family_id=$1 and (person_id=$2 or people ? $2) order by created_at`, [famId, personId]);
  return rows.map(storyOut);
}

// Create / update / delete, each in the caller's transaction, each with one history row. byUser = author shown in history.
async function insertEvent(client, famId, personId, input, byUser) {
  const c = cleanEvent(input);
  const id = 'E' + crypto.randomBytes(6).toString('hex');
  const { rows } = await client.query(
    `insert into events (id, family_id, person_id, type, title, date_text, date_kind, date_from, date_to, lunar, place, place_new, description, people, sources, is_preferred, created_by, photos, date_cal)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning ${EV_COLS}`,
    [id, famId, personId, c.type, c.title, c.date_text, c.date_kind, c.date_from, c.date_to, c.lunar, c.place, c.place_new, c.description,
      JSON.stringify(c.people), JSON.stringify(c.sources), c.is_preferred, byUser, JSON.stringify(c.photos), c.date_cal]);
  await writeHistory(client, personId, 'su_kien', null, evSummary(rows[0]), byUser);
  return eventOut(rows[0]);
}
async function updateEvent(client, famId, eventId, input, byUser) {
  const cur = await client.query(`select ${EV_COLS} from events where id=$1 and family_id=$2 for update`, [eventId, famId]);
  if (!cur.rows[0]) return null;
  const c = cleanEvent(input);
  const { rows } = await client.query(
    `update events set type=$2, title=$15, date_text=$3, date_kind=$4, date_from=$5, date_to=$6, lunar=$7, place=$8, place_new=$9, description=$10,
       people=$11, sources=$12, photos=$14, is_preferred=$13, date_cal=$16, updated_at=now() where id=$1 returning ${EV_COLS}`,
    [eventId, c.type, c.date_text, c.date_kind, c.date_from, c.date_to, c.lunar, c.place, c.place_new, c.description,
      JSON.stringify(c.people), JSON.stringify(c.sources), c.is_preferred, JSON.stringify(c.photos), c.title, c.date_cal]);
  await writeHistory(client, cur.rows[0].person_id, 'su_kien', evSummary(cur.rows[0]), evSummary(rows[0]), byUser);
  return eventOut(rows[0]);
}
async function deleteEvent(client, famId, eventId, byUser) {
  const cur = await client.query(`select ${EV_COLS} from events where id=$1 and family_id=$2 for update`, [eventId, famId]);
  if (!cur.rows[0]) return null;
  await client.query('delete from events where id=$1', [eventId]);
  await writeHistory(client, cur.rows[0].person_id, 'su_kien', evSummary(cur.rows[0]), null, byUser);
  return { id: eventId, person_id: cur.rows[0].person_id };
}

// Stories: kind 'tom_tat' is one row per person; saving it again updates that row.
// createdBy: the teller shown as "Kể bởi" (a suggestion's sender); the editor's name when not given.
async function upsertStory(client, famId, personId, input, byUser, createdBy = byUser) {
  const c = cleanStory(input, personId);
  const cur = await client.query(`select ${ST_COLS} from stories where person_id=$1 and family_id=$2 and kind=$3 order by created_at limit 1 for update`,
    [personId, famId, c.kind]);
  if (c.kind === 'tom_tat' && cur.rows[0]) {
    const { rows } = await client.query('update stories set title=$2, body=$3, photos=$4, updated_at=now(), created_by=$5 where id=$1 returning ' + ST_COLS,
      [cur.rows[0].id, c.title, c.body, JSON.stringify(c.photos), byUser]);
    await writeHistory(client, personId, 'cau_chuyen', storySummary(cur.rows[0]), storySummary(rows[0]), byUser);
    return storyOut(rows[0]);
  }
  const id = 'S' + crypto.randomBytes(6).toString('hex');
  const { rows } = await client.query(
    `insert into stories (id, family_id, person_id, kind, title, body, photos, people, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${ST_COLS}`,
    [id, famId, personId, c.kind, c.title, c.body, JSON.stringify(c.photos), JSON.stringify(c.people), createdBy]);
  await writeHistory(client, personId, 'cau_chuyen', null, storySummary(rows[0]), byUser);
  return storyOut(rows[0]);
}
// An edit keeps the teller (created_by); the history row names the editor.
async function updateStory(client, famId, storyId, input, byUser) {
  const cur = await client.query(`select ${ST_COLS} from stories where id=$1 and family_id=$2 for update`, [storyId, famId]);
  if (!cur.rows[0]) return null;
  const c = cleanStory(input, cur.rows[0].person_id);
  const { rows } = await client.query('update stories set kind=$2, title=$3, body=$4, photos=$5, people=$6, updated_at=now() where id=$1 returning ' + ST_COLS,
    [storyId, c.kind, c.title, c.body, JSON.stringify(c.photos), JSON.stringify(c.people)]);
  await writeHistory(client, cur.rows[0].person_id, 'cau_chuyen', storySummary(cur.rows[0]), storySummary(rows[0]), byUser);
  return storyOut(rows[0]);
}
async function deleteStory(client, famId, storyId, byUser) {
  const cur = await client.query(`select ${ST_COLS} from stories where id=$1 and family_id=$2 for update`, [storyId, famId]);
  if (!cur.rows[0]) return null;
  await client.query('delete from stories where id=$1', [storyId]);
  await writeHistory(client, cur.rows[0].person_id, 'cau_chuyen', storySummary(cur.rows[0]), null, byUser);
  return { id: storyId, person_id: cur.rows[0].person_id };
}

// Suggestion payload: changes = { _ev: { action: 'add'|'edit'|'delete', kind: 'event'|'story', id?, item? } }.
// Checks the shape only; the rules module validates the event or story itself.
async function checkEvSuggest(ev) {
  const R = await rules();
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return 'Thiếu thông tin sự kiện.';
  if (!['add', 'edit', 'delete'].includes(ev.action)) return 'Thao tác không hợp lệ.';
  if (!['event', 'story'].includes(ev.kind)) return 'Loại góp ý không hợp lệ.';
  if (ev.action !== 'add' && !(typeof ev.id === 'string' && /^[ES][0-9a-f]{12}$/.test(ev.id))) return 'Thiếu mã sự kiện.';
  if (ev.action === 'delete') return null;
  return ev.kind === 'event' ? R.validateEvent(ev.item) : R.validateStory(ev.item);
}
function evLabel(ev, typeLabel) {
  const what = ev.kind === 'story' ? 'câu chuyện' : 'sự kiện';
  const verb = { add: 'Thêm', edit: 'Sửa', delete: 'Xóa' }[ev.action];
  const custom = ev.kind === 'event' && ev.item && ev.item.type === 'khac' && typeof ev.item.title === 'string' ? ev.item.title.trim() : '';
  const t = ev.kind === 'event' && ev.item ? (custom || typeLabel(ev.item.type)) : (ev.item && ev.item.title) || '';
  return `${verb} ${what}${t ? ': ' + t : ''}`;
}

// Approved suggestion (or an editor's own): applies one _ev change for the person, with history under `author`.
class EvError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
// The event input with its citations resolved against the family's sources (sources.js resolveCitations).
// A citation's source that is not in this family (or deleted) is a 422, like any bad field.
async function withSources(client, famId, input) {
  try { return await SRC.resolveCitations(client, famId, input); } catch (e) { if (e instanceof SRC.SrcError) throw new EvError(e.status, e.message); throw e; }
}
async function applyEvSuggestion(client, famId, s, author) {
  const ev = s.changes._ev; const pid = s.person_id;
  if (!pid || !(await personIn(client, famId, pid))) throw new EvError(409, 'Người này không còn trong dữ liệu.');
  const R = await rules();
  const table = ev.kind === 'event' ? 'events' : 'stories';
  const owned = async () => {
    const r = await client.query(`select 1 from ${table} where id=$1 and family_id=$2 and person_id=$3`, [ev.id, famId, pid]);
    if (!r.rowCount) throw new EvError(409, 'Mục này không còn để sửa hoặc xóa.');
  };
  // a story sent by a member is shown as told by that member (by_name), the editor who approved it is in history
  const teller = s.by_name || author;
  if (ev.action === 'add') {
    const item = ev.kind === 'event' ? await withSources(client, famId, ev.item) : ev.item;
    const err = ev.kind === 'event' ? R.validateEvent(item) : R.validateStory(item);
    if (err) throw new EvError(422, err);
    if (ev.kind === 'story') await checkStoryPeople(client, famId, item, pid);
    return ev.kind === 'event' ? { event: await insertEvent(client, famId, pid, item, author) } : { story: await upsertStory(client, famId, pid, item, author, teller) };
  }
  await owned();
  if (ev.action === 'delete') return ev.kind === 'event' ? deleteEvent(client, famId, ev.id, author) : deleteStory(client, famId, ev.id, author);
  const item = ev.kind === 'event' ? await withSources(client, famId, ev.item) : ev.item;
  const err = ev.kind === 'event' ? R.validateEvent(item) : R.validateStory(item);
  if (err) throw new EvError(422, err);
  if (ev.kind === 'story') await checkStoryPeople(client, famId, item, pid);
  return ev.kind === 'event' ? { event: await updateEvent(client, famId, ev.id, item, author) } : { story: await updateStory(client, famId, ev.id, item, author) };
}

module.exports = {
  EvError, applyEvSuggestion, rules, withSources, eventOut, cleanEvent, storyOut, claimOp, personIn, listEvents, listStories, titleSuggestions, insertEvent, updateEvent, deleteEvent,
  upsertStory, updateStory, deleteStory, checkEvSuggest, evLabel, evSummary, checkStoryPeople, forViewer,
};
