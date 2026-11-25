// E2E: the tree list (#tree, mobile) shows a family's roots in root order (web/js/model.js buildFrom):
// manual order, then data.ext.order (one value per group, so a group stays together), then the earliest known year,
// undated last. Family GROUP: two groups and a plain root. Family PLAIN: no groups, years only.
// Invented names only. Needs a database (GP_TEST_DATABASE_URL, own schema) + playwright + Chrome.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const FG = 'ho-thu-thu-tu-nhom'; const FP = 'ho-thu-thu-tu-nam';
// the group family: group 1 = Sớm (1850) then Muộn (1900); group 2 = Hai Mươi (1500) then Không Năm (undated); plain root Cổ (1700, no group)
const GROUP_NAMES = ['Thử Văn Sớm', 'Thử Văn Muộn', 'Thử Văn Hai Mươi', 'Thử Văn Không Năm', 'Thử Văn Cổ'];
const PLAIN_NAMES = ['Thử Bá Bảy', 'Thử Bá Chín', 'Thử Bá Không'];
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'rootorder');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [id, name] of [[FG, 'Họ Thử Thứ Tự Nhóm'], [FP, 'Họ Thử Thứ Tự Năm']]) {
    await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,$2,'試','public') on conflict do nothing", [id, name]);
  }
  const ins = (id, fam, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, fam, data, 'e2e']);
  await ins('RG1', FG, { living: 'dead', name: 'Thử Văn Muộn', sex: 'm', gen: 1, born: '1900', ext: { order: 1, group: 'Q1' } });
  await ins('RG2', FG, { living: 'dead', name: 'Thử Văn Sớm', sex: 'm', gen: 1, born: '1850', ext: { order: 1, group: 'Q1' } });
  await ins('RG3', FG, { living: 'dead', name: 'Thử Văn Không Năm', sex: 'f', gen: 1, ext: { order: 2, group: 'Q2' } });
  await ins('RG4', FG, { living: 'dead', name: 'Thử Văn Hai Mươi', sex: 'm', gen: 1, born: '1500', ext: { order: 2, group: 'Q2' } });
  await ins('RG5', FG, { living: 'dead', name: 'Thử Văn Cổ', sex: 'm', gen: 1, born: '1700' });
  await ins('RP1', FP, { living: 'dead', name: 'Thử Bá Chín', sex: 'm', gen: 1, born: '1900' });
  await ins('RP2', FP, { living: 'dead', name: 'Thử Bá Không', sex: 'f', gen: 1 });
  await ins('RP3', FP, { living: 'dead', name: 'Thử Bá Bảy', sex: 'm', gen: 1, born: '1700' });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close(); srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function rootOrder(fam, names) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(`${base}/#/${fam}/tree`);
    await page.waitForFunction((ns) => { const t = document.querySelector('#tr')?.textContent || ''; return ns.every((n) => t.includes(n)); }, names, { timeout: 15000 });
    const text = await page.textContent('#tr');
    assert.deepStrictEqual(errs, []);
    return names.map((n) => text.indexOf(n));
  } finally { await ctx.close(); }
}

test('group family: groups stay together, then years; undated last inside a group', { skip }, async () => {
  const pos = await rootOrder(FG, GROUP_NAMES);
  assert.ok(pos.every((x) => x >= 0), `all roots shown: ${pos}`);
  assert.deepStrictEqual(pos, [...pos].sort((a, b) => a - b), 'Sớm, Muộn, Hai Mươi, Không Năm, Cổ');
});

test('plain family: roots by known year, undated last', { skip }, async () => {
  const pos = await rootOrder(FP, PLAIN_NAMES);
  assert.ok(pos.every((x) => x >= 0), `all roots shown: ${pos}`);
  assert.deepStrictEqual(pos, [...pos].sort((a, b) => a - b), 'Bá Bảy (1700), Bá Chín (1900), Bá Không (undated)');
});
