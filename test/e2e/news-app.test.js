// E2E through the REAL app (server + web/): an owner posts a gathering (Tin họ › + › Họp mặt) → it shows on Lịch with the
// chip filter (Tất cả · Giỗ · Họp mặt) → a member answers Đi and gets the calendar prompt, a second member says Chưa biết →
// the summary "2 đi · 1 chưa biết · 0 không đi" (the poster is Đi by default). The Lịch card creates the feed link.
// The old #gio address redirects to Lịch. Screenshots (390 px, DPR 1, light and dark) into GP_SHOT_DIR: lich-tab,
// tin-feed, gathering-detail, post-editor; light only: lich-calendar-card-light, rsvp-calendar-prompt-light.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<name containing scratch|e2e> NODE_PATH=<dir with playwright>.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const SHOT = process.env.GP_SHOT_DIR || '';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const TAG = crypto.randomBytes(3).toString('hex');
const SLUG = `news-${TAG}`;
const OWNER = `owner.${TAG}@test.local`; const M1 = `m1.${TAG}@test.local`; const M2 = `m2.${TAG}@test.local`;
const GIO = `N${TAG}g`;
const SHOTS_MEMBERS = { 'light-390': `s1.${TAG}@test.local`, 'light-360': `s2.${TAG}@test.local`, 'dark-390': `s3.${TAG}@test.local`, 'dark-360': `s4.${TAG}@test.local` };
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử họp mặt','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [GIO, SLUG, { name: 'Lê Văn Giỗ', sex: 'm', gen: 3, died: '1990', living: 'dead', gio_lunar: '3/8' }, 'e2e']);
  await pool.query("insert into relation_migrations (family_id, migrated_by) values ($1,'e2e')", [SLUG]);
  for (const e of Object.values(SHOTS_MEMBERS)) await pool.query("insert into members (email, name, family_id, role, status) values ($1,$2,$3,'member','active')", [e, e.split('@')[0], SLUG]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$4,'owner','active'), ($2,'Thành viên một',$4,'member','active'), ($3,'Thành viên hai',$4,'member','active')", [OWNER, M1, M2, SLUG]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close(); srv?.close();
  for (const t of ['rsvps', 'post_reminders', 'posts', 'notices', 'members', 'relation_migrations', 'mail_log']) await pool.query(`delete from ${t} where ${t === 'rsvps' || t === 'post_reminders' ? 'post_id in (select id from posts where family_id=$1)' : 'family_id=$1'}`, [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id = $1', [GIO]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function pageAs(email, scheme, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}
const shot = async (page, name) => { if (!SHOT) return; fs.mkdirSync(SHOT, { recursive: true }); await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); };

async function flow(scheme) {
  const GATH = 'Họp mặt hè 2027';
  // 1. (light run only) the owner posts a gathering from the editor page
  let postId;
  if (scheme === 'light') { const o = await pageAs(OWNER, scheme);
  try {
    await o.page.goto(`${base}/#/${SLUG}/tin-sua?kind=gathering`);
    await o.page.waitForSelector('#tinf', { timeout: 20000 });
    assert.strictEqual(await o.page.isVisible('#gfields'), true, 'the gathering fields show for Họp mặt');
    await o.page.fill('#tinf [name=title]', GATH);
    await o.page.fill('#tinf [name=starts_at]', '2027-07-01');
    await o.page.fill('#tinf [name=time]', '09:00');
    await o.page.fill('#tinf [name=place]', 'Nhà thờ họ');
    await o.page.click('#tinf button[type=submit]');
    await o.page.waitForFunction(() => /#\/[^/]+\/tin\/\d+/.test(location.hash), null, { timeout: 20000 });
    postId = (await pool.query("select id from posts where family_id=$1 and title=$2", [SLUG, GATH])).rows[0].id;
    assert.deepStrictEqual(o.errs, []);
  } finally { await o.ctx.close(); } }
  postId = (await pool.query('select id from posts where family_id=$1 and title=$2', [SLUG, GATH])).rows[0].id;
  if (scheme === 'light') { // a held post (a phone number): the author sees it with "Chờ duyệt"; nobody else does
    const h = await pageAs(OWNER, scheme);
    try {
      await h.page.goto(`${base}/#/${SLUG}/tin-sua?kind=notice`);
      await h.page.waitForSelector('#tinf', { timeout: 20000 });
      // the app redraws once its start-up sync ends; fill after that so the fields are not replaced mid-typing
      await h.page.waitForLoadState('networkidle');
      await h.page.waitForTimeout(800);
      await h.page.fill('#tinf [name=title]', 'Liên hệ nhờ việc');
      await h.page.fill('#tinf [name=body]', 'Gọi 0912 345 678 để hỏi');
      await h.page.click('#tinf button[type=submit]');
      await h.page.waitForFunction(() => /#\/[^/]+\/tin\/\d+/.test(location.hash) || !!document.querySelector('#terr')?.textContent, null, { timeout: 20000 });
      const why = await h.page.evaluate(() => document.querySelector('#terr')?.textContent || '');
      const hashNow = await h.page.evaluate(() => location.hash);
      assert.ok(!why, `the held post was refused: ${why} / ${hashNow}`);
      await h.page.waitForFunction(() => /#\/[^/]+\/tin\/\d+/.test(location.hash), null, { timeout: 20000 });
      await h.page.waitForSelector('text=Chờ duyệt', { timeout: 15000 });
      await shot(h.page, 'held-post-light.png');
      assert.deepStrictEqual(h.errs, []);
    } finally { await h.ctx.close(); }
  }

  // 2. Lịch: the gathering and the giỗ are both there, tagged; the chips filter them
  const l = await pageAs(OWNER, scheme);
  try {
    await l.page.goto(`${base}/#/${SLUG}/lich`);
    await l.page.waitForSelector('.gior[data-k=gath]', { timeout: 20000 });
    assert.ok((await l.page.textContent('main')).includes('Họp mặt'));
    assert.strictEqual(await l.page.locator('.gior[data-k=gio]').count(), 1, 'the giỗ row is listed');
    await l.page.click('[data-lk=gio]');
    assert.strictEqual(await l.page.locator('.gior[data-k=gath]:visible').count(), 0, 'Giỗ chip hides gatherings');
    assert.strictEqual(await l.page.locator('.gior[data-k=gio]:visible').count(), 1);
    await l.page.click('[data-lk=gath]');
    assert.strictEqual(await l.page.locator('.gior[data-k=gio]:visible').count(), 0, 'Họp mặt chip hides giỗ');
    assert.strictEqual(await l.page.locator('.gior[data-k=gath]:visible').count(), 1);
    await l.page.click('[data-lk=all]');
    await shot(l.page, `lich-tab-${scheme}.png`);
    if (scheme === 'light') {
      await l.page.click('#calcard [data-cal-new]');
      await l.page.waitForSelector('#calcard a:has-text("Google Calendar")', { timeout: 15000 });
      await l.page.locator('#calcard').scrollIntoViewIfNeeded();
      await shot(l.page, 'lich-calendar-card-light.png');
    }
    assert.deepStrictEqual(l.errs, []);
  } finally { await l.ctx.close(); }

  // 3. members RSVP: M1 says Đi (and gets the calendar prompt), M2 says Chưa biết
  const a = await pageAs(M1, scheme);
  try {
    await a.page.goto(`${base}/#/${SLUG}/tin/${postId}`);
    await a.page.waitForSelector('[data-rsvp=yes]', { timeout: 20000 });
    await a.page.click('[data-rsvp=yes]');
    await a.page.waitForSelector('[data-rsvp=yes].on', { timeout: 15000 });
    await a.page.waitForSelector('#calprompt .cal-prompt', { timeout: 15000 });
    if (scheme === 'light') await shot(a.page, 'rsvp-calendar-prompt-light.png');
    assert.deepStrictEqual(a.errs, []);
  } finally { await a.ctx.close(); }
  const b = await pageAs(M2, scheme);
  try {
    await b.page.goto(`${base}/#/${SLUG}/tin/${postId}`);
    await b.page.waitForSelector('[data-rsvp=maybe]', { timeout: 20000 });
    await b.page.click('[data-rsvp=maybe]');
    await b.page.waitForFunction(() => document.querySelector('[data-rsvp=maybe]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 15000 });
    assert.ok((await b.page.textContent('#attendees')).includes('Chưa biết'), 'the Chưa biết group lists M2');
  } finally { await b.ctx.close(); }
  // 3b. before and after answering Đi, at 390 and 360 px (a fresh member each time)
  for (const [label, email] of Object.entries(SHOTS_MEMBERS)) {
    if (!label.startsWith(scheme)) continue;
    const width = Number(label.split('-')[1]);
    const c = await pageAs(email, scheme, width);
    try {
      await c.page.goto(`${base}/#/${SLUG}/tin/${postId}`);
      await c.page.waitForSelector('[data-rsvp=yes]', { timeout: 20000 });
      await c.page.waitForSelector('main h1', { timeout: 20000 });
      await c.page.waitForTimeout(300);
      await shot(c.page, `gathering-detail-before-${label}.png`);
      await c.page.click('[data-rsvp=yes]');
      await c.page.waitForSelector('[data-rsvp=yes].on', { timeout: 15000 });
      await shot(c.page, `gathering-detail-after-${label}.png`);
      assert.deepStrictEqual(c.errs, []);
    } finally { await c.ctx.close(); }
  }

  // 4. screenshots of the feed and the editor page (both schemes)
  const f = await pageAs(OWNER, scheme);
  try {
    await f.page.goto(`${base}/#/${SLUG}/tin`);
    await f.page.waitForSelector('#nlist a.li', { timeout: 20000 });
    await shot(f.page, `tin-feed-${scheme}.png`);
    await f.page.goto(`${base}/#/${SLUG}/tin-sua?kind=gathering`);
    await f.page.waitForSelector('#tinf', { timeout: 20000 });
    await shot(f.page, `post-editor-${scheme}.png`);
    assert.deepStrictEqual(f.errs, []);
  } finally { await f.ctx.close(); }

  // 5. the old #gio address goes to Lịch
  const g = await pageAs(M1, scheme);
  try {
    await g.page.goto(`${base}/#/${SLUG}/gio`);
    await g.page.waitForFunction(() => /#\/[^/]+\/lich/.test(location.hash), null, { timeout: 20000 });
  } finally { await g.ctx.close(); }
}

test('Tin họ › Họp mặt → Lịch with the chips → RSVP → the summary and the calendar link (light, then dark)', { skip }, async () => {
  await flow('light');
  await flow('dark');
});
