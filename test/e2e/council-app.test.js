// E2E through the REAL app (server + web/): Gỡ khỏi gia phả → Đề nghị gỡ → the banner on the person's page → Thêm › Dòng họ
// › Biểu quyết → the second owner/admin votes Đồng ý → the window closes (the server's own sweep) → the person is in the trash.
// Two active council members (owner and admin): the requester's YES plus one other YES passes it. Screenshots (390 px,
// DPR 1, light and dark) into GP_SHOT_DIR: council-chooser, vote-card, vote-banner-person.
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
const SLUG = `cnap-${TAG}`;
const OWNER = `owner.${TAG}@test.local`; const ADMIN = `admin.${TAG}@test.local`;
const T1 = `C${TAG}a`; const T2 = `C${TAG}b`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser, decisions;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p; decisions = require(MOD('decisions'));
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử biểu quyết','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4), ($5,$2,$6,$4)', [
    T1, SLUG, { name: 'Lê Văn Nhàn', sex: 'm', gen: 3, born: '1960' }, 'e2e', T2, { name: 'Giả Thanh Huệ', sex: 'f', gen: 3, born: '1962' }]);
  await pool.query("insert into relation_migrations (family_id, migrated_by) values ($1,'e2e')", [SLUG]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$3,'owner','active'), ($2,'Quản trị e2e',$3,'admin','active')", [OWNER, ADMIN, SLUG]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close(); srv?.close();
  for (const t of ['trash', 'trash_audit', 'notices', 'decision_votes', 'decisions', 'council_deceased', 'members', 'relation_migrations', 'mail_log']) await pool.query(`delete from ${t} where family_id=$1`, [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id = any($1)', [[T1, T2]]).catch(() => {});
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
const shot = async (page, name) => { if (!SHOT) return; fs.mkdirSync(SHOT, { recursive: true }); await page.screenshot({ path: path.join(SHOT, name) }); };
const isDeleted = async (id) => (await pool.query('select deleted from persons where id=$1', [id])).rows[0].deleted;

// The card as a picture: its page box (the view can repaint, so no element handle is kept), full page.
async function cardShot(page, id, file) {
  if (!SHOT) return;
  fs.mkdirSync(SHOT, { recursive: true });
  let box = null;
  for (let k = 0; k < 30 && !box; k++) {
    box = await page.evaluate((cid) => {
      const el = document.querySelector(`[data-decision="${cid}"]`);
      if (!el) return null;
      el.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -80); // keep the fixed app header off the card
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + window.scrollY, width: r.width, height: r.height };
    }, id);
    if (!box) await page.waitForTimeout(200);
  }
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOT, file), fullPage: true, clip: box });
}

async function flow(scheme, target) {
  // 1. the admin (requester) asks to remove the person from the person menu: Gỡ khỏi gia phả… → Đề nghị gỡ
  const a = await pageAs(ADMIN, scheme);
  try {
    await a.page.goto(`${base}/#/${SLUG}/person/${target}`);
    await a.page.waitForSelector(`[data-menu="${target}"]`, { timeout: 20000 });
    await a.page.locator(`[data-menu="${target}"]`).first().click();
    await a.page.locator('.menu [role=menuitem]', { hasText: 'Gỡ khỏi gia phả' }).click();
    await a.page.waitForSelector('dialog.dcs[open]', { timeout: 15000 });
    const text = await a.page.textContent('dialog.dcs[open]');
    assert.ok(!text.includes('Nhập nhầm'), 'the fast path is not offered for an old record');
    await shot(a.page, `council-chooser-${scheme}.png`);
    await a.page.fill('dialog.dcs[open] [data-dcs-vote] textarea', 'Không thuộc dòng họ');
    await a.page.click('dialog.dcs[open] [data-dcs-vote] button[type=submit]');
    await a.page.waitForFunction(() => !document.querySelector('dialog.dcs[open]'), null, { timeout: 15000 });
    assert.deepEqual(a.errs, []);
  } finally { await a.ctx.close(); }
  const id = (await pool.query("select id from decisions where subject_ref=$1 and state='open'", [target])).rows[0].id;
  // 2. the owner sees the banner on the person's page
  const o = await pageAs(OWNER, scheme);
  try {
    await o.page.goto(`${base}/#/${SLUG}/person/${target}`);
    await o.page.waitForSelector('.council-banner', { timeout: 20000 });
    assert.ok((await o.page.textContent('.council-banner')).includes('Đang biểu quyết · 1/3 đã bỏ phiếu') || (await o.page.textContent('.council-banner')).includes('đã bỏ phiếu'));
    await o.page.waitForTimeout(400); // the page can re-render once more after the banner appears
    assert.equal(await o.page.locator('.council-banner').count(), 1, 'one banner');
    await shot(o.page, `vote-banner-person-${scheme}.png`);
    // 3. Thêm › Dòng họ › Biểu quyết: the owner votes Đồng ý
    await o.page.goto(`${base}/#/${SLUG}/more`);
    await o.page.waitForSelector('[href$="/bieu-quyet"]', { timeout: 20000 });
    await o.page.click('[href$="/bieu-quyet"]');
    await o.page.waitForSelector(`[data-dec-yes="${id}"]`, { timeout: 15000 });
    await o.page.click(`[data-dec-yes="${id}"]`);
    await o.page.waitForFunction(() => document.body.textContent.includes('Đã ghi phiếu đồng ý'), null, { timeout: 15000 });
    // the open ballot: the owner's name moves into the Đồng ý group (the requester's YES is there already)
    await o.page.click('[data-group="voted"] summary'); // the groups are collapsed rows
    await o.page.waitForSelector('[data-group="voted"] .calm-n:has-text("Chủ họ e2e")', { timeout: 15000 });
    assert.ok((await o.page.textContent('[data-group="voted"]')).includes('Quản trị e2e'));
    assert.equal(await o.page.locator(`[data-decision="${id}"] [data-group="yes"]`).count(), 0, 'while open no choice is shown');
    assert.equal(await o.page.locator('[data-group="pending"]').count(), 0, 'nobody is left to vote: the group is hidden');
    await shot(o.page, `vote-card-voted-${scheme}.png`);
    assert.deepEqual(o.errs, []);
  } finally { await o.ctx.close(); }
  // 4. the window closes: the server's own sweep decides it; the person goes to the trash
  await pool.query("update decisions set closes_at = now() - interval '1 hour' where id=$1", [id]);
  await decisions.sweep();
  assert.equal((await pool.query('select state from decisions where id=$1', [id])).rows[0].state, 'passed');
  assert.equal(await isDeleted(target), true);
}

test('Gỡ khỏi gia phả → Đề nghị gỡ → the banner → Biểu quyết → a second council member votes Đồng ý → passed → the trash (light, then dark)', { skip }, async () => {
  await flow('light', T1);
  await flow('dark', T2);
});

test('Thêm › Dòng họ shows Biểu quyết to a member', { skip }, async () => {
  const o = await pageAs(OWNER, 'light');
  try {
    await o.page.goto(`${base}/#/${SLUG}/more`);
    await o.page.waitForSelector('[href$="/bieu-quyet"]', { timeout: 20000 });
    assert.ok((await o.page.textContent('body')).includes('Dòng họ'));
  } finally { await o.ctx.close(); }
});

test('Cài đặt dòng họ › Biểu quyết: the owner changes who may vote (a notice and history); an admin sees it read-only', { skip }, async () => {
  const o = await pageAs(OWNER, 'light');
  try {
    await o.page.goto(`${base}/#/${SLUG}/cai-dat-dong-ho`);
    await o.page.waitForSelector('input[name="vrule"][value="council"]', { timeout: 20000 });
    await o.page.waitForFunction(() => document.querySelector('input[name="vrule"][value="council"]').checked, null, { timeout: 15000 });
    await o.page.evaluate(() => document.getElementById('vrule')?.scrollIntoView({ block: 'center' }));
    await o.page.waitForTimeout(300);
    await shot(o.page, 'settings-vote-light.png');
    await o.page.click('input[name="vrule"][value="members"]');
    await o.page.waitForFunction(() => document.body.textContent.includes('Đã lưu'), null, { timeout: 15000 });
    assert.equal((await pool.query('select vote_rule from families where id=$1', [SLUG])).rows[0].vote_rule, 'members');
    assert.equal((await pool.query("select count(*)::int n from family_history where family_id=$1 and field='vote_rule'", [SLUG])).rows[0].n, 1);
    await o.page.click('input[name="vrule"][value="council"]');
    await o.page.waitForFunction(() => document.body.textContent.includes('Đã lưu'), null, { timeout: 15000 });
    assert.deepEqual(o.errs, []);
  } finally { await o.ctx.close(); }
  const a = await pageAs(ADMIN, 'light');
  try {
    await a.page.goto(`${base}/#/${SLUG}/cai-dat-dong-ho`);
    await a.page.waitForSelector('input[name="vrule"]', { timeout: 20000 });
    assert.equal(await a.page.locator('input[name="vrule"]:disabled').count(), 3, 'an admin cannot change it');
  } finally { await a.ctx.close(); }
});

test('the three choices: one row of three equal buttons, no wrap at 360 and 390 px; before and after voting; light and dark', { skip }, async () => {
  const SH = `cnsh-${TAG}`;
  const OS = `os.${TAG}@test.local`; const AS1 = `as1.${TAG}@test.local`; const AS2 = `as2.${TAG}@test.local`; const AS3 = `as3.${TAG}@test.local`;
  const combos = [['light', 360], ['dark', 360], ['light', 390], ['dark', 390]];
  const PX = combos.map((_, i) => `C${TAG}v${i}`);
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử lựa chọn','public')", [SH]);
  for (const pid of PX) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [pid, SH, { name: 'Võ Văn Đức', sex: 'm', gen: 3, born: '1958' }, 'e2e']);
  await pool.query("insert into relation_migrations (family_id, migrated_by) values ($1,'e2e')", [SH]);
  for (const [e, n] of [[OS, 'Chủ họ thử'], [AS1, 'Quản trị một'], [AS2, 'Quản trị hai'], [AS3, 'Quản trị ba']]) {
    await pool.query("insert into members (email, name, family_id, role, status) values ($1,$2,$3,$4,'active')", [e, n, SH, e === OS ? 'owner' : 'admin']);
  }
  const cookie = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];
  const api = async (method, path, body, email) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie: await cookie(email) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  try {
    const ids = [];
    for (const pid of PX) {
      const open = await api('POST', `/api/persons/${pid}/removal?family=${SH}`, { kind: 'vote', reason: 'Không thuộc dòng họ' }, AS1);
      assert.equal(open.status, 200, JSON.stringify(open.json));
      const id = open.json.decision.id; ids.push(id);
      assert.equal((await api('POST', `/api/decisions/${id}/ballot?family=${SH}`, { choice: 'no', reason: 'Chưa có giấy tờ' }, AS2)).status, 200);
      assert.equal((await api('POST', `/api/decisions/${id}/ballot?family=${SH}`, { choice: 'abstain' }, AS3)).status, 200);
    }
    for (const [i, [scheme, width]] of combos.entries()) {
      const id = ids[i]; const tag = `${scheme}-${width}`;
      const o = await pageAs(OS, scheme, width);
      try {
        await o.page.goto(`${base}/#/${SH}/bieu-quyet`);
        const card = o.page.locator(`.vcard:has([data-dec-yes="${id}"])`);
        await card.waitFor({ timeout: 20000 });
        // one synchronous snapshot per read (the page can repaint between two reads)
        let snap = null;
        for (let k = 0; k < 50; k++) {
          snap = await o.page.evaluate((cid) => {
            const c = document.querySelector(`.vcard:has([data-dec-yes="${cid}"])`);
            if (!c) return null;
            const row = c.querySelector('.vc-row');
            const btns = [...c.querySelectorAll('.vc-row .vc-ch')];
            return {
              groups: [...c.querySelectorAll('[data-group]')].map((x) => x.dataset.group).sort(),
              rowCols: row ? getComputedStyle(row).gridTemplateColumns.split(' ').length : 0,
              btns: btns.map((b) => ({ h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width, words: [...b.querySelectorAll('.vc-w')].map((w) => w.getBoundingClientRect().height), on: b.classList.contains('on') })),
            };
          }, id);
          if (snap && snap.groups.length === 2) break;
          await o.page.waitForTimeout(200);
        }
        assert.ok(snap, 'the card is on the page');
        assert.deepStrictEqual(snap.groups, ['pending', 'voted'], 'while open: who has voted and who has not; no choices');
        assert.equal(snap.rowCols, 3, 'three equal columns');
        assert.equal(snap.btns.length, 3);
        for (const b of snap.btns) {
          assert.ok(b.h >= 48, `button ${b.h}px tall`);
          for (const wh of b.words) assert.ok(wh < 22, `a label wraps (${wh}px tall) at ${width}px`);
        }
        assert.ok(snap.btns.every((b) => !b.on), 'nothing is filled before voting');
        await cardShot(o.page, id, `vote-card-before-${tag}.png`);
        // the owner (pending) votes Đồng ý: the button fills, the others stay outlined
        await o.page.click(`[data-dec-yes="${id}"]`);
        await o.page.waitForFunction((cid) => document.querySelector(`[data-dec-yes="${cid}"]`)?.classList.contains('on'), id, { timeout: 15000 });
        const after = await o.page.evaluate((cid) => [...document.querySelectorAll(`.vcard:has([data-dec-yes="${cid}"]) .vc-row .vc-ch`)].map((b) => b.classList.contains('on')), id);
        assert.deepStrictEqual(after, [true, false, false], 'only the chosen one is filled');
        await cardShot(o.page, id, `vote-card-after-${tag}.png`);
        assert.deepEqual(o.errs, []);
      } finally { await o.ctx.close(); }
    }
    // closed: the full result (the choices, the no reason, the four-part bar), owner's view, 390 px
    for (const [i, scheme] of [[2, 'light'], [3, 'dark']]) {
      await pool.query("update decisions set closes_at = now() - interval '1 hour' where id=$1", [ids[i]]);
    }
    await decisions.sweep();
    for (const [i, scheme] of [[2, 'light'], [3, 'dark']]) {
      const o = await pageAs(OS, scheme, 390);
      try {
        await o.page.goto(`${base}/#/${SH}/bieu-quyet`);
        await o.page.waitForFunction((cid) => document.querySelector(`[data-decision="${cid}"]`), ids[i], { timeout: 20000 });
        await o.page.waitForFunction((cid) => (document.querySelector(`[data-decision="${cid}"]`)?.textContent || '').includes('Không đạt'), ids[i], { timeout: 20000 });
        await o.page.waitForTimeout(300);
        // the Không đồng ý group, expanded: the no-reason shows inside it
        await o.page.click(`[data-decision="${ids[i]}"] [data-group="no"] summary`);
        await o.page.waitForSelector(`[data-decision="${ids[i]}"] [data-group="no"] .calm-s:has-text("Chưa có giấy tờ")`, { state: 'visible', timeout: 15000 });
        await cardShot(o.page, ids[i], `vote-card-closed-${scheme}-390.png`);
      } finally { await o.ctx.close(); }
    }
  } finally {
    for (const t of ['decision_votes', 'decisions', 'notices', 'trash', 'trash_audit', 'history', 'members', 'relation_migrations']) {
      await pool.query(`delete from ${t} where ${t === 'decision_votes' ? 'decision_id in (select id from decisions where family_id=$1)' : 'family_id=$1'}`, [SH]).catch(() => {});
    }
    await pool.query("delete from history where person_id = any($1)", [PX]).catch(() => {});
    await pool.query('delete from persons where family_id=$1', [SH]).catch(() => {});
    await pool.query('delete from families where id=$1', [SH]).catch(() => {});
  }
});
