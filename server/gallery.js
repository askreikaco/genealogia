// Gallery per person (G1): the DB side. Each change runs in the caller's transaction and writes one history row.
// Rules (limit, caption, year, link checks) are in web/js/gallery.js; the routes are in gallery-routes.js.
'use strict';
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');

let rulesMod = null;
const rules = () => rulesMod || (rulesMod = import(pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'gallery.js')).href));
let copyMod = null; // the Vietnamese copy (web/js/gallery-vi.js), the GAL_VI object
const copy = () => copyMod || (copyMod = import(pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'gallery-vi.js')).href).then((m) => m.GAL_VI));

const COLS = 'id, family_id, person_id, url, caption, year, is_profile, position, created_by, created_at, updated_at';
const out = (r) => ({ id: r.id, url: r.url, caption: r.caption || '', year: r.year == null ? null : Number(r.year), is_profile: !!r.is_profile });

async function listPhotos(pool, famId, personId) {
  const { rows } = await pool.query(`select ${COLS} from person_photos where family_id=$1 and person_id=$2 order by position, created_at, id`, [famId, personId]);
  return rows.map(out);
}

// The person row, locked for the transaction. null when it is not in this family or deleted.
async function lockPerson(client, famId, personId) {
  const { rows } = await client.query('select id, data from persons where id=$1 and family_id=$2 and not deleted for update', [personId, famId]);
  return rows[0] || null;
}

// Sets (or clears, url null) persons.data.photo, bumps the version so offline copies sync, and keeps field_ts for merges.
async function setPersonPhoto(client, famId, personId, url, byUser) {
  await client.query(`update persons set data = case when $3::text is null then data - 'photo' else jsonb_set(data, '{photo}', to_jsonb($3::text)) end,
    field_ts = jsonb_set(coalesce(field_ts,'{}'::jsonb), '{photo}', to_jsonb((extract(epoch from now()) * 1000)::bigint)),
    version = nextval('persons_version'), updated_by=$4, updated_at=now() where id=$1 and family_id=$2`, [personId, famId, url, byUser]);
}
async function writeHistory(client, personId, field, oldV, newV, byUser) {
  await client.query('insert into history (person_id, field, old_value, new_value, by_user) values ($1,$2,$3,$4,$5)',
    [personId, field, oldV == null ? null : JSON.stringify(oldV), newV == null ? null : JSON.stringify(newV), byUser]);
}
// An error with an HTTP status (the routes send it as the response).
const fail = (status, message) => Object.assign(new Error(message), { status });
// history shows the field 'photo' (the profile photo field's label): a link for a photo, the caption and year for an edit
const label = (r) => (r ? [r.caption, r.year == null ? null : r.year].filter((x) => x !== '' && x !== null).join(' · ') || '—' : null);

// Adds a photo. The first photo of a person becomes the profile photo. Returns null when the person is not there;
// throws an Error with a status for the limit and the input checks.
async function addPhoto(client, famId, personId, input, byUser) {
  const R = await rules(); const M = await copy();
  if (!R.validGalleryUrl(input?.url)) throw fail(400, M.url_bad);
  const c = R.cleanGalleryInput(input);
  if (c.error) throw fail(400, c.error);
  if (!(await lockPerson(client, famId, personId))) return null;
  const { rows: n } = await client.query('select count(*)::int n, coalesce(max(position), -1)::int top, bool_or(is_profile) has_profile from person_photos where family_id=$1 and person_id=$2', [famId, personId]);
  if (n[0].n >= R.GALLERY_MAX) throw fail(400, M.limit);
  const isProfile = !n[0].has_profile;
  const id = crypto.randomBytes(12).toString('hex');
  const { rows } = await client.query(`insert into person_photos (id, family_id, person_id, url, caption, year, is_profile, position, created_by)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${COLS}`, [id, famId, personId, input.url, c.value.caption, c.value.year, isProfile, n[0].top + 1, byUser]);
  if (isProfile) await setPersonPhoto(client, famId, personId, input.url, byUser);
  await writeHistory(client, personId, 'photo', null, input.url, byUser);
  return out(rows[0]);
}

// Caption and year only (the photo itself does not change here).
async function updatePhoto(client, famId, personId, photoId, input, byUser) {
  const R = await rules();
  const c = R.cleanGalleryInput(input);
  if (c.error) throw fail(400, c.error);
  if (!(await lockPerson(client, famId, personId))) return null;
  const cur = await client.query(`select ${COLS} from person_photos where id=$1 and family_id=$2 and person_id=$3 for update`, [photoId, famId, personId]);
  if (!cur.rows[0]) return null;
  const { rows } = await client.query(`update person_photos set caption=$2, year=$3, updated_at=now() where id=$1 returning ${COLS}`, [photoId, c.value.caption, c.value.year]);
  await writeHistory(client, personId, 'photo', label(cur.rows[0]), label(rows[0]), byUser);
  return out(rows[0]);
}

// Makes one photo the profile photo; the person's data.photo follows.
async function setProfile(client, famId, personId, photoId, byUser) {
  if (!(await lockPerson(client, famId, personId))) return null;
  const cur = await client.query('select id, url, is_profile from person_photos where id=$1 and family_id=$2 and person_id=$3 for update', [photoId, famId, personId]);
  if (!cur.rows[0]) return null;
  const was = (await client.query('select url from person_photos where family_id=$1 and person_id=$2 and is_profile', [famId, personId])).rows[0];
  await client.query('update person_photos set is_profile = (id=$2), updated_at=now() where family_id=$1 and person_id=$3', [famId, photoId, personId]);
  await setPersonPhoto(client, famId, personId, cur.rows[0].url, byUser);
  await writeHistory(client, personId, 'photo', was ? was.url : null, cur.rows[0].url, byUser);
  return { id: photoId, url: cur.rows[0].url };
}

// Removes one photo (the caller puts the returned row into the trash). When it was the profile photo, the first
// remaining photo takes its place, or the person has none.
async function removePhoto(client, famId, personId, photoId, byUser) {
  if (!(await lockPerson(client, famId, personId))) return null;
  const cur = await client.query(`select ${COLS} from person_photos where id=$1 and family_id=$2 and person_id=$3 for update`, [photoId, famId, personId]);
  if (!cur.rows[0]) return null;
  const row = cur.rows[0];
  await client.query('delete from person_photos where id=$1', [photoId]);
  let next = null;
  if (row.is_profile) {
    next = (await client.query('select id, url from person_photos where family_id=$1 and person_id=$2 order by position, created_at, id limit 1', [famId, personId])).rows[0];
    if (next) await client.query('update person_photos set is_profile=true where id=$1', [next.id]);
    await setPersonPhoto(client, famId, personId, next ? next.url : null, byUser);
  }
  await writeHistory(client, personId, 'photo', row.url, null, byUser);
  return { row, profile: row.is_profile ? (next ? next.url : null) : undefined };
}

// The person's photo field (the form, a suggestion or an op) goes through the gallery: a link already in the gallery
// becomes the profile photo; a new link is added (the limit applies) and becomes the profile; an empty field clears the
// profile (the gallery photos stay). data.photo then follows the gallery's profile flag. Other values are left as written.
async function syncPhotoField(client, famId, personId, value, byUser) {
  const R = await rules(); const M = await copy();
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) {
    await client.query('update person_photos set is_profile=false where family_id=$1 and person_id=$2 and is_profile', [famId, personId]);
    await setPersonPhoto(client, famId, personId, null, byUser);
    return;
  }
  if (!R.validGalleryUrl(url)) return;
  const hit = (await client.query('select id, is_profile from person_photos where family_id=$1 and person_id=$2 and url=$3 order by position limit 1', [famId, personId, url])).rows[0];
  if (hit) { if (!hit.is_profile) await setProfile(client, famId, personId, hit.id, byUser); return; }
  const added = await addPhoto(client, famId, personId, { url, caption: '', year: null }, byUser);
  if (!added) throw fail(404, M.not_found);
  if (!added.is_profile) await setProfile(client, famId, personId, added.id, byUser);
}

// Restore from the trash (trash.js restoreRows inserts the row): a restored profile photo takes the profile back.
async function afterRestore(client, famId, row, byUser) {
  if (!row.is_profile) return;
  await client.query('update person_photos set is_profile = (id=$1) where family_id=$2 and person_id=$3', [row.id, famId, row.person_id]);
  await setPersonPhoto(client, famId, row.person_id, row.url, byUser);
}

module.exports = { fail, listPhotos, addPhoto, updatePhoto, setProfile, removePhoto, afterRestore, syncPhotoField, lockPerson, rules, copy, out };
