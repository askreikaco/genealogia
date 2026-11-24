// Unit tests for the entry stories and their mention links (web/js/bookplan.js): story paragraphs in the entry, the
// unique-name rule for ID boxes, and that long stories continue in more items instead of overflowing. No database.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let L = null;
const lib = async () => L || (L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'bookplan.js')).href));
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'demo-persons.json'), 'utf8'));
const LONG = ('Đoạn văn dài để thử nghiệm bố cục trang sách gia phả. ').repeat(40);

test('story paragraphs follow the entry as plain paragraphs (no label, no box); the saved summary comes first', async () => {
  const { bookModel, entryItems, storiesOf } = await lib();
  const M = bookModel([{ id: 'P1', data: { name: 'Dương Văn Thử', sex: 'm', gen: 3 }, st: [
    { kind: 'tom_tat', title: '', body: 'Tóm tắt không in.' },
    { kind: 'chuyen', title: 'Chuyện bếp', body: 'Đoạn A.\n\nĐoạn B.' }] }]);
  M.reg.set('P1', 5);
  assert.deepEqual(storiesOf(M, { id: 'P1', data: M.byId.get('P1').data }), ['Tóm tắt không in.', 'Đoạn A.', 'Đoạn B.'], 'the saved summary first, then the stories');
  const items = entryItems(M, { id: 'P1', data: M.byId.get('P1').data });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].txt.st.map((x) => x.t), ['Tóm tắt không in.', 'Đoạn A.', 'Đoạn B.'], 'the title is not printed; the paragraphs are');
  assert.equal(items[0].txt.more, false, 'a single item carries the rule');
});

test('an entry with no stories has no story paragraphs', async () => {
  const { bookModel, entryItems } = await lib();
  const M = bookModel([{ id: 'P2', data: { name: 'Trần Thị Bé', sex: 'f', gen: 3 } }]);
  M.reg.set('P2', 6);
  const [it] = entryItems(M, { id: 'P2', data: M.byId.get('P2').data });
  assert.deepEqual(it.txt.st, []);
});

test('a long story continues in more items, each within the item cap, and keeps every paragraph once', async () => {
  const { bookModel, entryItems, ITEM_CAP } = await lib();
  const M = bookModel([{ id: 'P3', data: { name: 'Dương Văn Dài', sex: 'm', gen: 3 }, st: [{ kind: 'chuyen', title: '', body: [LONG, LONG, LONG, LONG, LONG, LONG, LONG, LONG].join('\n\n') }] }]);
  M.reg.set('P3', 7);
  const items = entryItems(M, { id: 'P3', data: M.byId.get('P3').data });
  assert.ok(items.length >= 3, 'continues: ' + items.length);
  for (const it of items) assert.ok(it.h <= ITEM_CAP() * 1.1 + 1, `item ${Math.round(it.h)} within cap`);
  assert.equal(items.filter((it) => it.txt.head).length, 1, 'one head');
  assert.equal(items.filter((it) => !it.txt.more).length, 1, 'one last item (the rule)');
  const paras = items.flatMap((it) => it.txt.st.map((x) => x.t)).join(' ');
  assert.equal(paras.replace(/\s+/g, ' ').trim(), [LONG, LONG, LONG, LONG, LONG, LONG, LONG, LONG].join(' ').replace(/\s+/g, ' ').trim(), 'every sentence once, in order');
});

test('a longer story adds height', async () => {
  const { bookModel, entryHeight } = await lib();
  const short = bookModel([{ id: 'P4', data: { name: 'Lê Văn Bốn', sex: 'm', gen: 3 } }]);
  const long = bookModel([{ id: 'P4', data: { name: 'Lê Văn Bốn', sex: 'm', gen: 3 }, st: [{ kind: 'chuyen', title: '', body: LONG }] }]);
  const hS = entryHeight(short, { id: 'P4', data: short.byId.get('P4').data });
  const hL = entryHeight(long, { id: 'P4', data: long.byId.get('P4').data });
  assert.ok(hL > hS + 60, `story adds height: ${hL} vs ${hS}`);
});

// ---- mentions: a full name is linked only when it is unique in the family ----
test('mentions: a unique full name is linked to its entry, in text order', async () => {
  const { bookModel, mentionsIn } = await lib();
  const M = bookModel([
    { id: 'P100', data: { name: 'Dương Văn Thử', sex: 'm', gen: 2 } },
    { id: 'P101', data: { name: 'Trần Thị Bé', sex: 'f', gen: 2 } },
  ]);
  M.reg.set('P100', 7); M.reg.set('P101', 8);
  const got = mentionsIn(M, 'Hôm đó Dương Văn Thử đi chợ cùng Trần Thị Bé.', 'P999');
  assert.deepEqual(got.map((x) => [x.id, x.reg]), [['P100', 7], ['P101', 8]]);
  assert.equal(got[0].a, 'Hôm đó '.length, 'offsets point at the name');
});

test('mentions: an ambiguous name (two people with it) is never linked', async () => {
  const { bookModel, mentionsIn } = await lib();
  const M = bookModel([
    { id: 'P102', data: { name: 'Lê Văn Chung', sex: 'm', gen: 2 } },
    { id: 'P103', data: { name: 'Lê Văn Chung', sex: 'm', gen: 3 } },
  ]);
  M.reg.set('P102', 9); M.reg.set('P103', 10);
  assert.equal(mentionsIn(M, 'Gặp Lê Văn Chung ngoài ngõ.', 'P999').length, 0);
});

test('mentions: no name in the text, a partial name, or the person themselves: no link', async () => {
  const { bookModel, mentionsIn } = await lib();
  const M = bookModel([{ id: 'P100', data: { name: 'Dương Văn Thử', sex: 'm', gen: 2 } }]);
  M.reg.set('P100', 7);
  assert.equal(mentionsIn(M, 'Không ai nhắc đến người này.', 'P999').length, 0, 'none');
  assert.equal(mentionsIn(M, 'Dương Thử đi xa.', 'P999').length, 0, 'partial name');
  assert.equal(mentionsIn(M, 'Dương Văn Thử tự kể.', 'P100').length, 0, 'the person themselves');
});

test('mentions: accents and case do not matter; whole words only; a person without a number is not linked', async () => {
  const { bookModel, mentionsIn } = await lib();
  const M = bookModel([
    { id: 'P100', data: { name: 'Dương Văn Thử', sex: 'm', gen: 2 } },
    { id: 'P104', data: { name: 'Nguyễn Văn Đức', sex: 'm', gen: 2 } },
  ]);
  M.reg.set('P100', 7);
  assert.deepEqual(mentionsIn(M, 'DUONG VAN THU về nhà.', 'P999').map((x) => x.id), ['P100']);
  assert.equal(mentionsIn(M, 'Nguyễn Văn Đức và Nguyễn Văn Đứcx.', 'P999').length, 0, 'P104 has no number; the word "Đứcx" is not a match');
});

test('seed data: the planner runs on the seed with stories and mentions and keeps every person once', async () => {
  const { bookModel, planBook } = await lib();
  const items = SEED.map((p) => ({ id: p.id, data: JSON.parse(JSON.stringify(p.data)), st: [{ kind: 'chuyen', title: '', body: 'Ông ' + SEED[1].data.name + ' có mặt.' }] }));
  const plan = planBook(bookModel(items), '');
  const ids = plan.pages.filter((p) => p.kind === 'flow').flatMap((pg) => pg.cols.flatMap((c) => c.filter((it) => it[0] === 1 && (!it[4] || it[4].head !== false)).map((it) => it[1])));
  assert.equal(new Set(ids).size, ids.length, 'no entry head twice');
});

// ---- spouse records: found by search, listed in the index under the partner's number, own data under the partner ----
const withSpouse = (spouseExtra = {}) => [
  { id: 'P200', data: { name: 'Phan Văn Nam', sex: 'm', gen: 2, born: '1940' } },
  { id: 'P201', data: { name: 'Lê Thị Lan', sex: 'f', gen: 3, born: '1965', parent: 'P200' } },
  { id: 'S200', data: { name: 'Phan Thị Hồng Nhung', sex: 'f', spouse_of: 'P200', ...spouseExtra } },
];
test('spouse records: the index lists the spouse with the partner\'s entry number, linked to the partner', async () => {
  const { bookModel, planBook } = await lib();
  const M = bookModel(withSpouse({ born: '1950' }));
  const plan = planBook(M, '');
  const rows = plan.pages.filter((p) => p.kind === 'flow').flatMap((p) => p.cols.flat()).filter((it) => it[0] === 5);
  const row = rows.find((it) => it[1] === 'S200');
  assert.ok(row, 'the spouse has an index row');
  assert.equal(row[2], M.reg.get('P200'), 'the number is the partner\'s entry number');
  assert.equal(row[3], 'P200', 'linked to the partner\'s entry');
  assert.ok(rows.some((it) => it[1] === 'P200' && it[3] === null), 'the partner keeps a row of their own');
});

test('spouse records are in the page ids (search finds them) even without their own data', async () => {
  const { bookModel, planBook } = await lib();
  const plan = planBook(bookModel(withSpouse({})), '');
  const ids = plan.pages.filter((p) => p.kind === 'flow').flatMap((p) => p.ids || []);
  assert.ok(ids.includes('S200'), 'a spouse with no data of their own is still in the book\'s ids');
});

test('a spouse with their own data is printed under the partner\'s Vợ/Chồng line, and their stories follow', async () => {
  const { bookModel, planBook, entryItems } = await lib();
  const M = bookModel(withSpouse({ born: '1950', place: 'Hóc Môn', }).map((x) => x));
  M.texts.set('S200', { st: [{ kind: 'chuyen', title: '', body: 'Bà giữ bếp cho cả họ.' }] });
  const items = entryItems(M, { id: 'P200', data: M.byId.get('P200').data });
  const head = items.find((it) => it.txt.head);
  assert.deepEqual(head.txt.sp, ['S200'], 'the spouse line is on the partner\'s head');
  assert.ok(items.some((it) => it.txt.st.some((x) => x.t === 'Bà giữ bếp cho cả họ.')), 'the spouse\'s story is printed');
  // a spouse without data prints no extra line
  const M2 = bookModel(withSpouse({}));
  const [h2] = entryItems(M2, { id: 'P200', data: M2.byId.get('P200').data });
  assert.deepEqual(h2.txt.sp, [], 'no extra line without their own data');
  assert.deepEqual(h2.txt.sa ?? [], ['S200'], 'but the spouse is still in the ids');
});

test('the spouse option off: spouses are not in the index and not on the partner\'s entry', async () => {
  const { bookModel, planBook } = await lib();
  const plan = planBook(bookModel(withSpouse({ born: '1950' })), { root: '', spouses: false });
  const rows = plan.pages.filter((p) => p.kind === 'flow').flatMap((p) => p.cols.flat()).filter((it) => it[0] === 5);
  assert.ok(!rows.some((it) => it[1] === 'S200'));
});
