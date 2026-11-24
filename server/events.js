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

const EV_COLS = 'id, family_id, person_id, type, date_text, date_kind, date_from, date_to, lunar, place, place_new, description, people, sources, is_preferred, alt_of, created_by, created_at, updated_at';
const ST_COLS = 'id, family_id, person_id, kind, title, body, photos, created_by, created_at, updated_at';
const iso = (d) => (d instanceof Date ? d.toISOString() : d);

function eventOut(r) {
  return { id: r.id, person_id: r.person_id, type: r.type, date_text: r.date_text || '', date_kind: r.date_kind || null, date_from: r.date_from || null,
    date_to: r.date_to || null, lunar: r.lunar || '', place: r.place || '', place_new: r.place_new || '', description: r.description || '',
    people: r.people || [], sources: r.sources || [], is_preferred: r.is_preferred !== false, alt_of: r.alt_of || null,
    created_by: r.created_by || '', created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
}
function storyOut(r) {
  return { id: r.id, person_id: r.person_id, kind: r.kind, title: r.title || '', body: r.body || '', photos: r.photos || [],
    created_by: r.created_by || '', created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
}

// The fields a client may set, cleaned (never trust the body's extra keys).
function cleanEvent(e) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '');
  const kind = e.date_kind || null;
  return {
    type: e.type, date_text: s(e.date_text).slice(0, 200), date_kind: kind,
    date_from: kind ? s(e.date_from) : null, date_to: kind === 'between' ? s(e.date_to) : null,
    lunar: s(e.lunar).slice(0, 200), place: s(e.place).slice(0, 2000), place_new: s(e.place_new).slice(0, 2000),
    description: s(e.description).slice(0, 2000),
    people: Array.isArray(e.people) ? e.people.slice(0, 20) : [],
    sources: Array.isArray(e.sources) ? e.sources.slice(0, 20).map((x) => ({ title: s(x.title).slice(0, 300), url: s(x.url).slice(0, 2000), quality: x.quality || null })) : [],
    is_preferred: e.is_preferred !== false,
  };
}
function cleanStory(s) {
  return { kind: s.kind === 'tom_tat' ? 'tom_tat' : 'chuyen', title: String(s.title || '').trim().slice(0, 300), body: String(s.body || '').trim(),
    photos: Array.isArray(s.photos) ? s.photos.slice(0, 30) : [] };
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
const evSummary = (r) => (r ? { type: r.type, date_text: r.date_text || '', place: r.place || '', description: (r.description || '').slice(0, 200) } : null);
const storySummary = (r) => (r ? { kind: r.kind, title: r.title || '' } : null);

// Person in this family, not deleted (events and stories hang off a person).
async function personIn(client, famId, personId) {
  const { rows } = await client.query('select id, data, deleted from persons where id=$1 and family_id=$2', [personId, famId]);
  return rows[0] && !rows[0].deleted ? rows[0] : null;
}

async function listEvents(pool, famId, personId) {
  const { rows } = await pool.query(`select ${EV_COLS} from events where family_id=$1 and person_id=$2`, [famId, personId]);
  return rows.map(eventOut);
}
async function listStories(pool, famId, personId) {
  const { rows } = await pool.query(`select ${ST_COLS} from stories where family_id=$1 and person_id=$2 order by created_at`, [famId, personId]);
  return rows.map(storyOut);
}

// Create / update / delete, each in the caller's transaction, each with one history row. byUser = author shown in history.
async function insertEvent(client, famId, personId, input, byUser) {
  const c = cleanEvent(input);
  const id = 'E' + crypto.randomBytes(6).toString('hex');
  const { rows } = await client.query(
    `insert into events (id, family_id, person_id, type, date_text, date_kind, date_from, date_to, lunar, place, place_new, description, people, sources, is_preferred, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning ${EV_COLS}`,
    [id, famId, personId, c.type, c.date_text, c.date_kind, c.date_from, c.date_to, c.lunar, c.place, c.place_new, c.description,
      JSON.stringify(c.people), JSON.stringify(c.sources), c.is_preferred, byUser]);
  await writeHistory(client, personId, 'su_kien', null, evSummary(rows[0]), byUser);
  return eventOut(rows[0]);
}
async function updateEvent(client, famId, eventId, input, byUser) {
  const cur = await client.query(`select ${EV_COLS} from events where id=$1 and family_id=$2 for update`, [eventId, famId]);
  if (!cur.rows[0]) return null;
  const c = cleanEvent(input);
  const { rows } = await client.query(
    `update events set type=$2, date_text=$3, date_kind=$4, date_from=$5, date_to=$6, lunar=$7, place=$8, place_new=$9, description=$10,
       people=$11, sources=$12, is_preferred=$13, updated_at=now() where id=$1 returning ${EV_COLS}`,
    [eventId, c.type, c.date_text, c.date_kind, c.date_from, c.date_to, c.lunar, c.place, c.place_new, c.description,
      JSON.stringify(c.people), JSON.stringify(c.sources), c.is_preferred]);
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
async function upsertStory(client, famId, personId, input, byUser) {
  const c = cleanStory(input);
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
    `insert into stories (id, family_id, person_id, kind, title, body, photos, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${ST_COLS}`,
    [id, famId, personId, c.kind, c.title, c.body, JSON.stringify(c.photos), byUser]);
  await writeHistory(client, personId, 'cau_chuyen', null, storySummary(rows[0]), byUser);
  return storyOut(rows[0]);
}
async function updateStory(client, famId, storyId, input, byUser) {
  const cur = await client.query(`select ${ST_COLS} from stories where id=$1 and family_id=$2 for update`, [storyId, famId]);
  if (!cur.rows[0]) return null;
  const c = cleanStory(input);
  const { rows } = await client.query('update stories set kind=$2, title=$3, body=$4, photos=$5, updated_at=now(), created_by=$6 where id=$1 returning ' + ST_COLS,
    [storyId, c.kind, c.title, c.body, JSON.stringify(c.photos), byUser]);
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
  const t = ev.kind === 'event' && ev.item ? typeLabel(ev.item.type) : (ev.item && ev.item.title) || '';
  return `${verb} ${what}${t ? ': ' + t : ''}`;
}

// Approved suggestion (or an editor's own): applies one _ev change for the person, with history under `author`.
class EvError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function applyEvSuggestion(client, famId, s, author) {
  const ev = s.changes._ev; const pid = s.person_id;
  if (!pid || !(await personIn(client, famId, pid))) throw new EvError(409, 'Người này không còn trong dữ liệu.');
  const R = await rules();
  const table = ev.kind === 'event' ? 'events' : 'stories';
  const owned = async () => {
    const r = await client.query(`select 1 from ${table} where id=$1 and family_id=$2 and person_id=$3`, [ev.id, famId, pid]);
    if (!r.rowCount) throw new EvError(409, 'Mục này không còn để sửa hoặc xóa.');
  };
  if (ev.action === 'add') {
    const err = ev.kind === 'event' ? R.validateEvent(ev.item) : R.validateStory(ev.item);
    if (err) throw new EvError(422, err);
    return ev.kind === 'event' ? { event: await insertEvent(client, famId, pid, ev.item, author) } : { story: await upsertStory(client, famId, pid, ev.item, author) };
  }
  await owned();
  if (ev.action === 'delete') return ev.kind === 'event' ? deleteEvent(client, famId, ev.id, author) : deleteStory(client, famId, ev.id, author);
  const err = ev.kind === 'event' ? R.validateEvent(ev.item) : R.validateStory(ev.item);
  if (err) throw new EvError(422, err);
  return ev.kind === 'event' ? { event: await updateEvent(client, famId, ev.id, ev.item, author) } : { story: await updateStory(client, famId, ev.id, ev.item, author) };
}

module.exports = {
  EvError, applyEvSuggestion, rules, eventOut, storyOut, claimOp, personIn, listEvents, listStories, insertEvent, updateEvent, deleteEvent,
  upsertStory, updateStory, deleteStory, checkEvSuggest, evLabel, evSummary,
};
