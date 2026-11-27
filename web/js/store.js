import { familyLabelOf } from './famlabel.js';
import { SURNAME_HAN } from './surnames-vi.js';
// Client-first data: everything lives in IndexedDB; edits go to an outbox and sync when online.
// Multi-family: every person is tagged with its family (p.fam). The current family (curFam) decides what the
// app shows; sync pulls every family the device follows (plus the ones this account belongs to), each with its own cursor.
// Device data (store "device"): receipts for the contributions this device sent, and preferences
// (follows, followed families, theme, filters). Signing in syncs preferences and claims receipts.
// Accounts: every signed-in account has its own database ('giapha-<key>'), so drafts, unsent changes, receipts,
// preferences and cached people never mix between accounts. Signed out, the device uses 'giapha'.
const DB = 'giapha', VER = 2;
const acctDb = (key = me.acct) => (key ? DB + '-' + key : DB);
const lsKey = (k) => 'gp_dev_' + (me.acct || 'guest') + '_' + k;
const DEFAULT_FAM = 'duong';
let db, people = new Map(), rejectedMsg = null;
let curFam = DEFAULT_FAM;          // the family on screen (set by the router from the hash)
let cursors = {};                  // family id -> sync cursor (server version)
let pulled = new Set();            // families pulled at least once in this page load
let denied = new Set();            // families the server refuses to this account (private, or gone)
let famMeta = new Map();           // family id -> {id, slug, name, han, place, visibility, my_role, people, generations}
// Who is signed in, from /api/me. roles = { family id: role } for the active memberships of this account.
let me = { editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {}, acct: null, accounts: 0 };
let accountList = { max: 5, active: null, items: [] }; // accounts on this device (GET /api/accounts), each with its own memberships
const subs = new Set();
export const status = { state: 'idle', pending: 0, lastSync: null, error: null };

// Rejects the wait (not the open) after `ms`: a page must never sit on "Loading" because storage cannot be opened.
const within = (p, ms, what) => Promise.race([p, new Promise((_, bad) => setTimeout(() => bad(new Error(what + ' timed out')), ms))]);

function idb(name = acctDb()) {
  return new Promise((ok, bad) => {
    const r = indexedDB.open(name, VER);
    let settled = false;
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('persons')) d.createObjectStore('persons', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'op_id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      if (!d.objectStoreNames.contains('device')) d.createObjectStore('device'); // out-of-line keys: prefs, receipts, syncedEmail
    };
    // An older tab holding this DB at a lower version blocks the upgrade until it closes: say so, do not wait silently.
    r.onblocked = () => console.warn('IndexedDB upgrade blocked by another open tab');
    r.onsuccess = () => {
      const d = r.result;
      if (!settled) {
        settled = true;
        // A newer tab may upgrade later: release this connection instead of blocking it, and go online-only.
        d.onversionchange = () => { d.close(); if (db === d) { db = null; emit(); } };
        ok(d);
      } else d.close(); // opened after init gave up on it: release it so the upgrade is not held open
    };
    r.onerror = () => { if (!settled) { settled = true; bad(r.error); } };
  });
}
const tx = (store, mode, fn) => new Promise((ok, bad) => {
  const t = db.transaction(store, mode); const s = t.objectStore(store); const res = fn(s);
  // A request resolves to its stored value (undefined when absent); a write resolves to what fn returned.
  t.oncomplete = () => ok(res instanceof IDBRequest ? res.result : res); t.onerror = () => bad(t.error);
});
const all = (store) => new Promise((ok, bad) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });

// Device store with a localStorage fallback for browsers without IndexedDB (private windows, blocked storage).
const devGet = (k) => {
  if (!db) { try { return Promise.resolve(JSON.parse(localStorage.getItem(lsKey(k)))); } catch { return Promise.resolve(undefined); } }
  return new Promise((ok, bad) => { const r = db.transaction('device').objectStore('device').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
};
const devPut = (k, v) => {
  if (!db) { try { localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch {} return Promise.resolve(); }
  return tx('device', 'readwrite', (s) => s.put(v, k));
};

function emit() { for (const f of subs) f(); }
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

// ---------- roles: per family (editor-code sessions are admin everywhere) ----------
const codeSession = () => !!me.editor && !me.email;
// "Tất cả" has no role of its own: editing happens inside one family (its page), so every role reads as guest there.
export const roleIn = (f) => (f === 'tat-ca' ? 'guest' : codeSession() ? 'admin' : (me.roles?.[f] || 'guest'));
// One permission table for the UI (the server checks again). can(role, action) is the only place that lists roles.
const ADMIN = ['owner', 'admin'];
// edit: may change people directly; admin: invites and admin-only views; review: the suggestions inbox; members: members and join requests
const PERM = { edit: ['owner', 'admin', 'editor'], admin: ADMIN, review: ADMIN, members: ADMIN };
export const can = (role, action) => (PERM[action] || []).includes(role);
export const isEditor = () => can(roleIn(curFam), 'edit');
export const isAdmin = () => can(roleIn(curFam), 'admin');
export const isMember = () => ['owner', 'admin', 'editor', 'member'].includes(roleIn(curFam)); // sees private fields
export const isOwner = () => roleIn(curFam) === 'owner';
export const myRole = () => roleIn(curFam);
export const signedIn = () => !!(me.email || me.editor);
export const myAccount = () => ({ ...me });
export const myPersonId = () => (me.status === 'active' ? me.person_id : null);
export const editorName = () => me.name || me.editor;
export async function refreshMe() {
  try {
    me = { ...me, ...(await (await fetch('/api/me', { cache: 'no-store' })).json()) };
    try { if (me.acct) localStorage.setItem('gp_acct', me.acct); else localStorage.removeItem('gp_acct'); localStorage.setItem('gp_me', JSON.stringify(me)); } catch {}
  } catch {}
  return me;
}

// ---------- families on this device ----------
// 'tat-ca' = all families in scope (read-only pages over every family; see scopeFams).
export const ALL_FAMS = 'tat-ca';
export const curFamily = () => curFam;
export const isAll = () => curFam === ALL_FAMS;
// The family on screen. Pulls its people the first time it is opened (a link family opened by slug).
export function setFamily(f) {
  if (f === curFam) return;
  curFam = f;
  if (f !== ALL_FAMS && !pulled.has(f) && !denied.has(f)) sync();
}
// Followed families: the device's list (default: duong) plus every family this account is a member of.
export const followedFams = () => [...new Set([...(prefs.follows_families || [DEFAULT_FAM]), ...Object.keys(me.roles || {})])];
export const isFollowing = (f) => followedFams().includes(f);
// Scope of "Tất cả": followed families (deduped, followed or member) minus the ones the server refused and private
// families where this account holds no role. Pure: scopeOf() takes the inputs, scopeFams() reads the live state.
export function scopeOf(followed, roles, metas, refused = new Set()) {
  return [...new Set([...followed, ...Object.keys(roles)])].filter((f) => f !== ALL_FAMS && !refused.has(f) && !((metas.get(f)?.visibility === 'private') && !roles[f]));
}
export const scopeFams = () => scopeOf(prefs.follows_families || [DEFAULT_FAM], me.roles || {}, famMeta, denied);
export const familyName = (f) => famMeta.get(f)?.name || (f === DEFAULT_FAM ? 'Họ Dương' : f);
// The family's Hán name: its own, else the Hán of its clan surname ("Họ Dương" -> 楊), else ''. Nothing is hard-coded.
export const familyHan = (f) => famMeta.get(f)?.han || SURNAME_HAN[String(familyName(f)).replace(/^Họ\s+/, '').trim()] || '';
// Chips and filter tags: the short name; else the name + quê gốc when another family in view has the same name.
export const familyLabel = (f) => familyLabelOf(famMeta.get(f) || { id: f, name: familyName(f) }, scopeFams().map((x) => famMeta.get(x)).filter(Boolean));
export function followFamily(f) {
  const list = [...(prefs.follows_families || [DEFAULT_FAM])];
  if (!list.includes(f)) list.push(f);
  setPrefs({ follows_families: list });
  sync(); // pull it now: a family the server refuses drops out of "Tất cả" at once
}
export function unfollowFamily(f) { setPrefs({ follows_families: (prefs.follows_families || [DEFAULT_FAM]).filter((x) => x !== f) }); }
export const defaultFamily = () => prefs.default_family || DEFAULT_FAM;
// Family details by id or slug (any family the account may open). Cached for this page load.
export async function fetchFamily(ref, { fresh = false } = {}) {
  if (!fresh && famMeta.has(ref)) return famMeta.get(ref);
  const r = await fetch('/api/families/' + encodeURIComponent(ref), { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Không mở được dòng họ.'); e.status = r.status; throw e; }
  famMeta.set(j.id, j); famMeta.set(j.slug, j); saveFams();
  return j;
}
// Families the account may see, for search and the switcher (no link families unless a member).
export async function searchFamilies(q = '') {
  const r = await fetch('/api/families?q=' + encodeURIComponent(q), { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không tải được danh sách dòng họ.');
  for (const f of j.items) { famMeta.set(f.id, f); }
  return j.items;
}
export const familyMeta = (f) => famMeta.get(f) || null;
// Change a family's details (owner or admin). Returns the family as the server now has it.
export async function patchFamily(ref, body) {
  const r = await fetch('/api/families/' + encodeURIComponent(ref), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không lưu được.');
  if (j.family) { famMeta.set(j.family.id, j.family); famMeta.set(j.family.slug, j.family); }
  return j.family;
}
export async function leaveFamily(ref) {
  const r = await fetch('/api/families/' + encodeURIComponent(ref) + '/leave', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không rời được dòng họ.');
  await refreshMe();
  return j;
}

// ---------- device preferences (IndexedDB; theme is mirrored to localStorage for the boot script in index.html) ----------
const PREFS0 = { follows: [], follows_families: [DEFAULT_FAM], default_family: '', theme: '', filters: {} };
let prefs = { ...PREFS0 };
let receiptList = [];
let cloudT = null;
export const getPrefs = () => prefs;
// Keys set while the stored preferences are still loading: they are newer than the stored copy and win when it arrives.
let prefTouched = {};
export function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  prefTouched = { ...prefTouched, ...patch };
  devPut('prefs', prefs).catch(() => {});
  try { if (prefs.theme) localStorage.setItem('gp_theme', prefs.theme); else localStorage.removeItem('gp_theme'); } catch {}
  // signed in with Google: the same preferences follow the account to other devices (debounced)
  if (me.email) { clearTimeout(cloudT); cloudT = setTimeout(() => putCloudPrefs(prefs).catch(() => {}), 800); }
  return prefs;
}
const putCloudPrefs = (p) => fetch('/api/me/prefs', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
// First run on IndexedDB: copy what the older localStorage keys held, then drop them (theme stays as a boot mirror).
function migrateLocal() {
  const ls = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  let follows = []; try { follows = JSON.parse(ls('gp_follow') || '[]'); } catch {}
  const filters = {}; if (ls('gp_chi')) filters.chi = ls('gp_chi'); if (ls('gp_gio_all')) filters.gio_all = ls('gp_gio_all');
  return { follows: Array.isArray(follows) ? follows : [], theme: ls('gp_theme') || '', filters };
}
async function loadDevice() {
  let p = await devGet('prefs').catch(() => undefined);
  const fresh = !p;
  if (fresh) p = migrateLocal();
  prefs = { ...PREFS0, ...p, ...prefTouched }; // not a lost update: a render may have set fam_used while the read was pending
  if (!Array.isArray(prefs.follows_families) || !prefs.follows_families.length) prefs.follows_families = [DEFAULT_FAM];
  receiptList = (await devGet('receipts').catch(() => undefined)) || [];
  await devPut('prefs', prefs).catch(() => {});
  if (fresh && db) for (const k of ['gp_follow', 'gp_chi', 'gp_gio_all']) { try { localStorage.removeItem(k); } catch {} }
  try { if (prefs.theme) localStorage.setItem('gp_theme', prefs.theme); } catch {}
}

// ---------- receipts: proof of a contribution this device sent (only the server's hash is stored) ----------
const RECEIPT_RE = /^[A-Za-z0-9_-]{32}$/;
const okReceipt = (r) => r && Number.isInteger(r.id) && r.id > 0 && typeof r.receipt === 'string' && RECEIPT_RE.test(r.receipt);
export const receipts = () => receiptList.slice();
export const receiptFor = (id) => receiptList.find((r) => r.id === id)?.receipt || null;
export function addReceipt(id, receipt) {
  if (!okReceipt({ id, receipt }) || receiptList.some((r) => r.id === id)) return;
  receiptList = [...receiptList, { id, receipt }].slice(-200);
  devPut('receipts', receiptList).catch(() => {});
}
// Recovery link: #mine?r=<base64url of the receipts JSON>. Returns how many were new on this device.
export async function importReceipts(list) {
  let n = 0;
  for (const r of list || []) if (okReceipt(r) && !receiptList.some((x) => x.id === r.id)) { receiptList = [...receiptList, { id: r.id, receipt: r.receipt }]; n++; }
  if (n) await devPut('receipts', receiptList).catch(() => {});
  return n;
}
const b64u = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '='));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
export const encodeRecovery = (list) => b64u(JSON.stringify(list.map(({ id, receipt }) => ({ id, receipt }))));
export function decodeRecovery(s) { try { const v = JSON.parse(unb64u(s)); return Array.isArray(v) ? v : []; } catch { return []; } }

// ---------- account sync (runs once per page load when signed in with Google; cheap and idempotent) ----------
let lastAcc = null;
export const lastAccountSync = () => lastAcc;
async function accountSync() {
  lastAcc = null;
  if (!me.email) return;
  try {
    const claim = await (await fetch('/api/me/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receipts: receiptList }) })).json();
    let server = {};
    try { server = (await (await fetch('/api/me/prefs', { cache: 'no-store' })).json()).prefs || {}; } catch {}
    const local = prefs;
    prefs = {
      ...local,                                                                    // keys not merged below (fam_used, ...) are kept
      follows: [...new Set([...(local.follows || []), ...(server.follows || [])])], // union
      follows_families: [...new Set([...(local.follows_families || []), ...(server.follows_families || [])])],
      default_family: server.default_family || local.default_family || '',           // server wins when it has one
      theme: server.theme || local.theme || '',                                    // server wins when it has one
      filters: { ...(local.filters || {}), ...(server.filters || {}) },
      recent: [], // recent searches removed (owner 2026-11-24): clear what an older version stored
    };
    await devPut('prefs', prefs).catch(() => {});
    try { if (prefs.theme) localStorage.setItem('gp_theme', prefs.theme); else localStorage.removeItem('gp_theme'); } catch {}
    await putCloudPrefs(prefs).catch(() => {});
    const first = (await devGet('syncedEmail').catch(() => undefined)) !== me.email;
    await devPut('syncedEmail', me.email).catch(() => {});
    lastAcc = { matched: Number(claim.matched) || 0, first };
  } catch (e) { console.warn('account sync failed', e); }
}

// Contributions this device sent, read by the receipts it holds (and by the account when signed in).
export async function listMine() {
  const r = await fetch('/api/suggestions/mine', { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ receipts: receiptList }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không tải được góp ý.');
  return j;
}
const reviewCall = async (url, method, body) => {
  const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không xử lý được.');
  return j;
};
export const withdrawSuggestion = (id) => reviewCall(`/api/suggestions/${id}/withdraw`, 'POST', { receipt: receiptFor(id) || undefined });
export const updateSuggestion = (id, { changes, note }) => reviewCall(`/api/suggestions/${id}`, 'PATCH', { receipt: receiptFor(id) || undefined, changes, note });

// ---------- people: one map for every family, each row tagged with its family ----------
// A branch tree (branch-trees.js) shows the home tree's people: the same ids. They are kept apart from `people` (one row
// per id), so a branch pull never overwrites or retags a home row. Branch rows are not kept on the device.
const branchRows = new Map(); // branch family -> Map(id -> row)
const branchFams = new Set();
export const get = (id, fam) => (fam && branchRows.has(fam) ? branchRows.get(fam).get(id) : undefined) || people.get(id);
// Relations of a family as the server gave them to this viewer: { source: 'table' | 'legacy', parent_child, couple }.
const relMap = new Map();
export const relOf = (fam) => relMap.get(fam || DEFAULT_FAM) || { source: 'legacy', parent_child: [], couple: [] };
// People of the family on screen; in "Tất cả", people of every family in scope (each row keeps its p.fam).
export const list = () => {
  if (branchFams.has(curFam)) return [...(branchRows.get(curFam)?.values() || [])].filter((p) => !p.deleted && p.data);
  const sc = isAll() ? new Set(scopeFams()) : null;
  return [...people.values()].filter((p) => !p.deleted && p.data && (sc ? sc.has(p.fam || DEFAULT_FAM) : (p.fam || DEFAULT_FAM) === curFam));
};

let running = null;
// Reads this device's data for the open account: IndexedDB (people, cursors, family details, unsent changes) and the
// device preferences. Local only; every step is bounded, and a failure leaves the page online-only.
async function openLocal() {
  try { db?.close(); } catch {}
  db = null; people = new Map(); branchRows.clear(); branchFams.clear(); relMap.clear(); pulled = new Set(); denied = new Set(); famMeta = new Map(); cursors = {};
  try {
    db = await within(idb(), 3000, 'IndexedDB');
    await within(adoptLegacy(), 3000, 'device adopt').catch((e) => console.warn('device data not moved', e));
    for (const p of await within(all('persons'), 3000, 'IndexedDB read')) people.set(p.id, { ...p, fam: p.fam || DEFAULT_FAM });
    cursors = (await within(tx('meta', 'readonly', (s) => s.get('cursors')), 3000, 'IndexedDB read')) || {};
    // branch trees (branch-trees.js): their last rows, so a branch opens offline too
    for (const f of (await within(tx('meta', 'readonly', (s) => s.get('branchFams')), 3000, 'IndexedDB read')) || []) {
      const rows = (await within(tx('meta', 'readonly', (s) => s.get('branch:' + f)), 3000, 'IndexedDB read')) || [];
      branchRows.set(f, new Map(rows.map((r) => [r.id, r]))); branchFams.add(f);
    }
    if (cursors[DEFAULT_FAM] === undefined) cursors[DEFAULT_FAM] = Number(await within(tx('meta', 'readonly', (s) => s.get('since')), 3000, 'IndexedDB read')) || 0; // older devices
    for (const f of Object.values((await within(tx('meta', 'readonly', (s) => s.get('fams')), 3000, 'IndexedDB read')) || {})) { famMeta.set(f.id, f); famMeta.set(f.slug, f); }
    status.pending = (await within(all('outbox'), 3000, 'IndexedDB read')).length;
    await within(refreshEvMirror(), 3000, 'IndexedDB read');
  } catch (e) { console.warn('IndexedDB unavailable, online only', e); db = null; }
  await within(loadDevice(), 3000, 'device data').catch((e) => console.warn('device data unavailable', e));
}
// Family details are kept on the device too, so a warm page can open a family without waiting for the server.
function saveFams() {
  if (!db) return;
  const o = {}; for (const f of famMeta.values()) o[f.id] = f;
  tx('meta', 'readwrite', (s) => s.put(o, 'fams')).catch(() => {});
}
// True when this device has people of the family (its cache, or a partial fetch).
export const hasData = (fam = curFam) => { if (branchFams.has(fam)) return (branchRows.get(fam)?.size || 0) > 0; for (const p of people.values()) if (!p.deleted && p.data && (p.fam || DEFAULT_FAM) === fam) return true; return false; };
// Waiting for the family's first full pull, with no failure yet: the shell draws a loading skeleton.
export const loading = (fam = curFam) => !pulled.has(fam) && !denied.has(fam) && status.state !== 'error' && status.state !== 'offline';
// Cold start on a person page: that person first, then the people linked to them (parents, spouses, children).
async function fetchFocus(fam, id) {
  const get = async (ids) => {
    const r = await fetch(`/api/persons?family=${encodeURIComponent(fam)}&ids=${ids.map(encodeURIComponent).join(',')}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };
  const take = async (res) => {
    if (res.rel) relMap.set(fam, { ...res.rel, parent_child: res.rel.parent_child.map((x) => ({ ...x, fam })), couple: res.rel.couple.map((x) => ({ ...x, fam })) });
    const rows = res.items.filter((it) => !it.deleted).map((it) => ({ ...it, fam }));
    for (const row of rows) people.set(row.id, row);
    if (db && rows.length) await tx('persons', 'readwrite', (s) => { for (const row of rows) s.put(row); });
  };
  await take(await get([id]));
  const data = people.get(id)?.data || {}; const rel = relOf(fam);
  const near = new Set([data.parent, data.other_parent, data.spouse_of]);
  for (const r of rel.parent_child) { if (r.child_id === id) near.add(r.parent_id); if (r.parent_id === id) near.add(r.child_id); }
  for (const c of rel.couple) { if (c.a_id === id) near.add(c.b_id); if (c.b_id === id) near.add(c.a_id); }
  const more = [...near].filter((x) => x && !people.has(x));
  if (more.length) await take(await get(more.slice(0, 200)));
}
// Work that waits for the first paint: the browser's idle time (setTimeout where requestIdleCallback is missing).
const whenIdle = (f) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 0));
// Never rejects, and never waits on the network before the first render. Order: this device's data is read and drawn at
// once (the account's cached /api/me, then IndexedDB); /api/me then settles which account's device data is open (a
// different one redraws); after the first paint the account list, the account sync and the full pull run.
// focus() (optional) names the person page on screen: on a cold device it is fetched before the full pull.
// Resolves once the account sync is done.
export async function init({ focus } = {}) {
  // The account picks the device database: the one this device used last (gp_acct), and its cached /api/me (gp_me).
  let cached = null;
  try { me.acct = localStorage.getItem('gp_acct') || null; cached = JSON.parse(localStorage.getItem('gp_me') || 'null'); } catch { me.acct = null; }
  if (cached && (cached.acct || null) === me.acct) me = { ...me, ...cached }; else cached = null;
  const meP = within(refreshMe(), 8000, '/api/me').catch(() => {});
  if (!cached) await meP; // first visit on this device: the account is not known yet, so no database is opened before it is
  let opened = me.acct;
  await openLocal();
  emit(); // first paint
  const want = focus?.();
  if (want && !hasData(want.fam)) fetchFocus(want.fam, want.id).catch((e) => console.warn('person not loaded yet', e)).then(emit);
  addEventListener('online', () => { sync(); flushQueue(); });
  setInterval(() => document.visibilityState === 'visible' && sync(), 60_000);
  await meP;
  if (me.acct !== opened) { opened = me.acct; await openLocal(); } // another account on this device: its data opens now
  emit();
  return new Promise((done) => whenIdle(async () => {
    loadAccounts().then(emit);
    await within(accountSync(), 8000, 'account sync').catch((e) => console.warn('account sync failed', e));
    sync(); // not awaited: pulls and pushes re-render when they finish
    flushQueue(); // queued suggestions from an earlier offline visit
    done();
  }));
}

// Families this device pulls: the one on screen, every followed family, and the account's own families.
const syncFams = () => [...new Set([...(curFam === ALL_FAMS ? [] : [curFam]), ...followedFams()])];
// A sync asked for while one runs is run again afterwards: the first one may start before /api/me has told us
// which families this account belongs to, and those must still be pulled.
let rerun = false;
// A call during a running sync resolves only after a run that starts after the call (its changes are pushed
// and pulled), not with the run already in flight.
export function sync() {
  if (running) { rerun = true; return running.then(sync); }
  running = (async () => { do { rerun = false; await run(); } while (rerun); })().finally(() => { running = null; });
  return running;
}
async function run() {
  status.state = 'syncing'; emit();
  try {
    // push first: our edits, oldest first, in batches; one request per family
    if (db) for (;;) {
      const queued = (await all('outbox')).sort((a, b) => a.ts - b.ts);
      if (!queued.length) break;
      if (queued[0].ev) { await pushEv(queued[0]); continue; } // life-event writes: one at a time, in order
      const ops = []; for (const o of queued) { if (o.ev || ops.length >= 200) break; ops.push(o); } // a run of person ops
      const byFam = new Map();
      for (const o of ops) { const f = o.family || DEFAULT_FAM; if (!byFam.has(f)) byFam.set(f, []); byFam.get(f).push(o); }
      for (const [fam, batch] of byFam) {
        const r = await fetch('/api/ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: fam, ops: batch }) });
        if (r.status === 401) { me = { ...me, role: 'guest', editor: null }; throw new Error('Phiên đăng nhập hết hạn. Đăng nhập lại để gửi các chỗ đã sửa.'); }
        if (r.status === 403) { throw new Error('Tài khoản này không còn quyền sửa. Các chỗ đã sửa chưa được gửi.'); }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const res = await r.json();
        const done = new Set([...res.applied, ...res.rejected.map((x) => x.op_id)]);
        if (res.rejected.length) { rejectedMsg = `${res.rejected.length} thay đổi bị máy chủ từ chối (${res.rejected[0].reason}). Đã tải lại dữ liệu.`; cursors[fam] = 0; }
        await tx('outbox', 'readwrite', (s) => { for (const id of done) s.delete(id); });
        if (!batch.some((o) => done.has(o.op_id))) throw new Error('Không gửi được thay đổi.');
      }
    }
    // then pull everything newer than each family's cursor
    for (const fam of syncFams()) {
      if (denied.has(fam)) continue;
      await pullFamily(fam);
    }
    status.state = rejectedMsg ? 'error' : 'idle'; status.error = rejectedMsg; rejectedMsg = null; status.lastSync = Date.now();
  } catch (e) {
    status.state = navigator.onLine === false || /fetch|network/i.test(e.message) ? 'offline' : 'error';
    status.error = e.message;
  }
  status.pending = db ? (await all('outbox')).length : 0;
  await refreshEvMirror();
  emit();
}
// Per family: a counter that moves when a pull brings changes after the family was first pulled (the book asks for a reload).
const famVer = new Map();
export const famVersion = (f) => famVer.get(f) || 0;
async function pullFamily(fam) {
  const wasPulled = pulled.has(fam); let changed = false;
  for (;;) {
    const since = cursors[fam] || 0;
    const r = await fetch(`/api/persons?since=${since}&family=${encodeURIComponent(fam)}`, { cache: 'no-store' });
    if (r.status === 403 || r.status === 404) { denied.add(fam); await dropFamily(fam); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const res = await r.json();
    if (res.rel) relMap.set(fam, { ...res.rel, parent_child: res.rel.parent_child.map((x) => ({ ...x, fam })), couple: res.rel.couple.map((x) => ({ ...x, fam })) });
    if (res.branch) { // a branch: the server sends its whole scope each time (since is ignored); kept apart from `people`
      branchFams.add(fam);
      const sig = (m) => [...(m?.values() || [])].map((x) => x.id + ':' + x.v).sort().join(',');
      const prev = branchRows.get(fam);
      const next = new Map(res.items.map((it) => [it.id, { ...it, fam }]));
      branchRows.set(fam, next);
      if (db) await tx('meta', 'readwrite', (s) => { s.put([...next.values()], 'branch:' + fam); s.put([...branchFams], 'branchFams'); });
      if (wasPulled && sig(prev) !== sig(next)) famVer.set(fam, famVersion(fam) + 1);
      pulled.add(fam);
      return;
    }
    const pend = db ? new Set((await all('outbox')).map((o) => o.id)) : new Set();
    if (since === 0) { // full pull: people removed from the family on the server go too
      const keep = new Set(res.items.map((i) => i.id));
      for (const [id, p] of [...people]) if (p.fam === fam && !keep.has(id) && !pend.has(id)) { people.delete(id); changed = true; if (db) await tx('persons', 'readwrite', (s) => s.delete(id)); }
    }
    const rows = [];
    for (const it of res.items) { if (pend.has(it.id)) continue; const row = { ...it, fam }; people.set(it.id, row); rows.push(row); }
    if (wasPulled && rows.length) changed = true;
    if (db) await tx('persons', 'readwrite', (s) => { for (const row of rows) s.put(row); });
    cursors[fam] = res.next_since;
    if (db) await tx('meta', 'readwrite', (s) => { s.put(cursors, 'cursors'); s.put(cursors[DEFAULT_FAM] || 0, 'since'); });
    if (res.items.length < 5000) break;
  }
  pulled.add(fam);
  if (changed && wasPulled) famVer.set(fam, famVersion(fam) + 1);
}
async function dropFamily(fam) {
  branchRows.delete(fam); branchFams.delete(fam);
  if (db) await tx('meta', 'readwrite', (s) => { s.delete('branch:' + fam); s.put([...branchFams], 'branchFams'); });
  for (const [id, p] of [...people]) if (p.fam === fam) { people.delete(id); if (db) await tx('persons', 'readwrite', (s) => s.delete(id)); }
}

// Local edit: visible at once, queued for upload to the person's family.
export async function edit(id, fields, fam) {
  const f = fam || curFam; const onBranch = branchFams.has(f); // a branch edit is shown in the branch and sent to its home tree
  const p = (onBranch ? branchRows.get(f)?.get(id) : people.get(id)) || { id, v: 0, deleted: false, data: {}, fam: f };
  const data = { ...p.data };
  for (const [k, v] of Object.entries(fields)) { if (k === '_deleted') continue; if (v === '' || v == null) delete data[k]; else data[k] = v; }
  const next = { ...p, data, deleted: fields._deleted ?? p.deleted };
  if (onBranch) branchRows.get(f)?.set(id, next); else people.set(id, next);
  const op = { op_id: crypto.randomUUID(), id, fields, ts: Date.now(), family: next.fam || DEFAULT_FAM };
  if (db && !onBranch) await tx('persons', 'readwrite', (s) => s.put(next));
  if (db) await tx('outbox', 'readwrite', (s) => s.put(op));
  status.pending++; emit();
  sync();
  return next;
}
export function newId() { return 'N' + crypto.randomUUID().slice(0, 13); }

export async function login(code) {
  const before = me.acct;
  const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const b = await r.json(); if (!r.ok) throw new Error(b.error || 'Chưa đăng nhập được');
  await refreshMe();
  if (me.acct !== before) { forgetAccount(); location.reload(); return b.name; } // another account's device data opens after a reload
  cursors = {}; pulled = new Set(); denied = new Set(); await sync(); await loadAccounts(); emit(); return b.name;   // re-pull: members and editors also get private fields
}

// ---------- accounts on this device ----------
// A switch or a sign-out changes which device database is open, so the caller reloads the page afterwards.
// The cached account goes first: the reload then opens no other account's data before /api/me answers.
function forgetAccount() { try { localStorage.removeItem('gp_acct'); localStorage.removeItem('gp_me'); } catch {} }
export const myAccounts = () => accountList;
export async function loadAccounts() {
  try { const r = await fetch('/api/accounts', { cache: 'no-store' }); if (r.ok) accountList = await r.json(); } catch {}
  return accountList;
}
// which: {email} for a Google account, {code: true} for the editor-code account. family: the family on screen.
// Returns { active, family }: the family the account lands on (kept when it can see it).
export async function switchAccount(which, family) {
  const r = await fetch('/api/accounts/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...which, family }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không chuyển được tài khoản.');
  forgetAccount();
  return j;
}
// which: {email} | {code: true} | {all: true}. The other accounts stay signed in.
export async function signOutAccounts(which) {
  const r = await fetch('/api/accounts/signout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(which) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không đăng xuất được.');
  forgetAccount();
  return j;
}
// Unsent changes, queued suggestions and drafts kept for one account (key), read from its own database.
export async function pendingFor(key) {
  const out = { outbox: 0, queued: 0, drafts: 0 };
  const name = acctDb(key);
  try {
    if (indexedDB.databases && !(await indexedDB.databases()).some((x) => x.name === name)) return out;
    const d = await within(idb(name), 3000, 'pending read');
    try {
      out.outbox = await reqP(d.transaction('outbox').objectStore('outbox').count());
      const keys = await reqP(d.transaction('device').objectStore('device').getAllKeys());
      out.drafts = keys.filter((k) => typeof k === 'string' && k.startsWith(DRAFT_PREFIX)).length;
      const q = await reqP(d.transaction('device').objectStore('device').get(QKEY));
      out.queued = Array.isArray(q) ? q.length : 0;
    } finally { d.close(); }
  } catch {}
  return out;
}
const reqP = (r) => new Promise((ok, bad) => { r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
function entries(d, store) {
  return new Promise((ok, bad) => {
    const out = []; const r = d.transaction(store).objectStore(store).openCursor();
    r.onsuccess = () => { const c = r.result; if (c) { out.push({ key: c.key, value: c.value }); c.continue(); } else ok(out); };
    r.onerror = () => bad(r.error);
  });
}
// Device data from before accounts (one shared database) goes to the first account that opens the app here, once:
// unsent changes and queued suggestions move (so they are sent once, by that account); drafts and preferences are copied.
async function adoptLegacy() {
  if (!me.acct || !db) return;
  const legacy = await within(idb(DB), 3000, 'legacy open');
  try {
    if (await reqP(legacy.transaction('device').objectStore('device').get('adopted'))) return;
    const dev = await entries(legacy, 'device');
    const ob = await reqP(legacy.transaction('outbox').objectStore('outbox').getAll());
    await tx('device', 'readwrite', (s) => { for (const e of dev) if (e.key !== 'adopted') s.put(e.value, e.key); });
    await tx('outbox', 'readwrite', (s) => { for (const o of ob) s.put(o); });
    await new Promise((ok, bad) => {
      const t = legacy.transaction(['outbox', 'device'], 'readwrite');
      t.objectStore('outbox').clear();
      t.objectStore('device').delete(QKEY);
      t.objectStore('device').put(me.acct, 'adopted');
      t.oncomplete = ok; t.onerror = () => bad(t.error);
    });
  } finally { legacy.close(); }
}

// Members, join requests and invites (admin+ endpoints; the join request is for a signed-in Google user).
const jfetch = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, cache: 'no-store', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Chưa làm được: ' + r.status);
  return j;
};
// Admin calls take the family they are about (default: the family on screen), so "Tất cả" can act on each family's rows.
const famQ = (f = curFam) => 'family=' + encodeURIComponent(f);
export const listMembers = (f = curFam) => jfetch('/api/members?' + famQ(f));
export const joinRequest = (body) => jfetch('/api/join?' + famQ(), 'POST', { ...body, family: curFam });
export const cancelJoin = () => jfetch('/api/join/cancel?' + famQ(), 'POST', {});
export const approveMember = (id, body, f = curFam) => jfetch(`/api/members/${id}/approve?${famQ(f)}`, 'POST', body);
export const rejectMember = (id, f = curFam) => jfetch(`/api/members/${id}/reject?${famQ(f)}`, 'POST', {});
export const setMemberRole = (id, role, f = curFam) => jfetch(`/api/members/${id}/role?${famQ(f)}`, 'POST', { role });
export const removeMember = (id, f = curFam) => jfetch(`/api/members/${id}/remove?${famQ(f)}`, 'POST', {});
export const inviteMember = (email, role, f = curFam) => jfetch('/api/members/invite?' + famQ(f), 'POST', { email, role });

// Anonymous suggestions (no sign-in). Editors review them on the "Duyệt đóng góp" page.
// Returns {ok, id, receipt}: the caller keeps the receipt on this device (addReceipt).
export async function suggest(body) {
  const r = await fetch('/api/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: curFam, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không gửi được. Thử lại sau.');
  return j;
}
export async function listSuggestions(status = 'pending', f = curFam) {
  const r = await fetch('/api/suggestions?status=' + encodeURIComponent(status) + '&' + famQ(f), { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không tải được danh sách.');
  return j;
}
export async function reviewSuggestion(id, action, reason = '') {
  const r = await fetch(`/api/suggestions/${id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không xử lý được.');
  return j;
}
// Approve with per-field decisions: { <field>: 'proposed' | 'current' | { custom: value } }.
export async function approveSuggestion(id, fields) {
  const r = await fetch(`/api/suggestions/${id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không duyệt được.');
  return j;
}

// ---------- drafts (this device only; bounded, never block the page) and queued suggestions (sent when online) ----------
const DRAFT_TTL = 30 * 24 * 3600 * 1000; // a draft expires 30 days after its last save
const DRAFT_PREFIX = 'draft:';
const QKEY = 'sugq';
const soft = (p, what) => within(p, 3000, what).catch((e) => { console.warn(what + ' failed', e); return undefined; });
function devDel(k) {
  if (!db) { try { localStorage.removeItem(lsKey(k)); } catch {} return Promise.resolve(); }
  return tx('device', 'readwrite', (s) => s.delete(k));
}
function devKeys() {
  if (!db) { try { const p = lsKey(''); return Promise.resolve(Object.keys(localStorage).filter((k) => k.startsWith(p)).map((k) => k.slice(p.length))); } catch { return Promise.resolve([]); } }
  return new Promise((ok, bad) => { const r = db.transaction('device').objectStore('device').getAllKeys(); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
}
// key = family|mode|person (or new) ; value = {mode, personId, patchId, changed, base, over, saved}
export async function draftSave(key, obj) { await soft(devPut(DRAFT_PREFIX + key, { ...obj, saved: Date.now() }), 'draft save'); }
export async function draftDelete(key) { await soft(devDel(DRAFT_PREFIX + key), 'draft delete'); }
export async function draftGet(key) {
  const v = await soft(devGet(DRAFT_PREFIX + key), 'draft read');
  if (!v) return null;
  if (!(Date.now() - v.saved <= DRAFT_TTL)) { await draftDelete(key); return null; }
  return v;
}
// Drafts of one family, newest first. Expired drafts are removed on the way.
export async function draftList(fam) {
  const keys = (await soft(devKeys(), 'draft list')) || [];
  const out = [];
  for (const k of keys) {
    if (typeof k !== 'string' || !k.startsWith(DRAFT_PREFIX + fam + '|')) continue;
    const key = k.slice(DRAFT_PREFIX.length); const v = await draftGet(key);
    if (v) out.push({ key, ...v });
  }
  return out.sort((a, b) => b.saved - a.saved);
}

let queueCache = null;
async function queueLoad() { if (!queueCache) queueCache = (await soft(devGet(QKEY), 'queue read')) || []; return queueCache; }
export const queueItems = async () => (await queueLoad()).slice();
// item: {type: 'suggest' | 'update', fam, body | id + changes + note, label}. Kept on the device until the server takes it.
export async function queueAdd(item) {
  await queueLoad();
  queueCache = [...queueCache, { ...item, qid: crypto.randomUUID(), created: Date.now() }];
  await soft(devPut(QKEY, queueCache), 'queue save');
  emit();
}
let flushing = null;
// Sends the queue in order. A network failure stops the run (kept for next time); a server refusal drops that item.
// A suggestion's receipt is stored before its item leaves the queue. Returns {sent, refused}.
export function flushQueue() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}
async function doFlush() {
  const out = { sent: 0, refused: 0 };
  if (navigator.onLine === false) return out;
  await queueLoad();
  for (const it of [...queueCache]) {
    try {
      if (it.type === 'suggest') {
        const r = await fetch('/api/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: it.fam, ...it.body }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'refused');
        addReceipt(j.id, j.receipt);
      } else {
        await updateSuggestion(it.id, { changes: it.changes, note: it.note });
      }
      out.sent++;
    } catch (e) {
      if (e instanceof TypeError) break; // still offline: keep the rest
      out.refused++;
    }
    queueCache = queueCache.filter((x) => x.qid !== it.qid);
    await soft(devPut(QKEY, queueCache), 'queue save');
    emit();
  }
  if (out.sent || out.refused) hooks.queueFlushed?.(out);
  return out;
}
// App hook: told how many queued items were sent (for a toast).
export const hooks = { queueFlushed: null, evSynced: null };

// Life events written offline: outbox ops with `ev` ({method, url, body} sent as is; body.op_id makes a retry safe)
// and `show` ({kind, act, id, item}: what the timeline draws until the server has it). Mirrored in memory for drawing.
let evMirror = [];
async function refreshEvMirror() { evMirror = db ? (await all('outbox')).filter((o) => o.ev).sort((a, b) => a.ts - b.ts) : []; }
export const pendingEvs = (fam, personId) => evMirror.filter((o) => (o.family || DEFAULT_FAM) === fam && o.person_id === personId);
export const hasOutbox = () => !!db;
// A person's life events as last read online (per family and person): the timeline draws from it when offline.
export const evCacheSet = (fam, pid, v) => soft(devPut(`evc:${fam}|${pid}`, { items: v.items || [], stories: v.stories || [], hidden: !!v.hidden, role: v.role, at: Date.now() }), 'events cache save');
export const evCacheGet = (fam, pid) => soft(devGet(`evc:${fam}|${pid}`), 'events cache read');
// Keeps one life-event write on the device until the server takes it (the caller has seen a network failure).
export async function queueEv(op) {
  if (!db) throw new Error('Không lưu được trên máy này.');
  await tx('outbox', 'readwrite', (s) => s.put({ ...op, ts: op.ts || Date.now() }));
  status.pending++; await refreshEvMirror(); emit();
  sync();
}
// One queued life-event write: sent as is. Refusals drop it (with a message); network failures keep it for later.
async function pushEv(o) {
  const r = await fetch(o.ev.url, { method: o.ev.method, headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify(o.ev.body) });
  if (r.status === 401) { me = { ...me, role: 'guest', editor: null }; throw new Error('Phiên đăng nhập hết hạn. Đăng nhập lại để gửi các sự kiện đã lưu trên máy.'); }
  if (r.status >= 500 || r.status === 429) throw new Error('HTTP ' + r.status);
  if (!r.ok) { const j = await r.json().catch(() => ({})); rejectedMsg = `Một sự kiện đã lưu trên máy bị máy chủ từ chối (${j.error || r.status}).`; }
  await tx('outbox', 'readwrite', (s) => s.delete(o.op_id));
  await refreshEvMirror(); emit();
  hooks.evSynced?.(o.family || DEFAULT_FAM, o.person_id);
}
