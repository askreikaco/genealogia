// App update: a new deploy while the app is open. No imports, so server/test/update.test.js can load it in a vm.
// Rules: the server is asked which build is live at start, when the app comes back to the foreground, and at most once
// a day (a manual check always asks). A newer build is applied by itself when the app is idle (no form with unsaved
// input, no dialog open): at once on start, return or a manual check; on the next navigation or when the app is hidden
// if the browser found it while open. Busy: the notice "Có bản mới · Tải lại" shows and nothing reloads. A pending update
// is applied on an idle moment a day after it was found.
const DAY_MS = 24 * 60 * 60 * 1000;
const SINCE_KEY = 'gp-upd-since';   // when the pending update was first seen (localStorage; per device)
const CHECKED_KEY = 'gp-upd-checked'; // when the server was last asked for its build (localStorage; the once-a-day throttle)
// The build this page was shipped with. Placeholder on master ("gp-dev"): the deploy stamps the release version
// (gp-X.Y.Z, from the git tag, see .github/workflows/deploy.yml) into the deployed copy of this file and sw.js.
// /api/version reports sw.js's V, so a different one means a newer build is live.
export const BUILD = 'gp-dev';
export const BUILD_DATE = '2026-11-24'; // the day this build was cut (yyyy-mm-dd)

const SEMVER = /^gp-(\d+)\.(\d+)\.(\d+)$/; // a release: gp-1.80.3
const LEGACY = /(\d+)$/;                      // old builds: gp-v79 (the numbered scheme before semver)

// True when `latest` is a newer build than `cur`. Releases compare by X.Y.Z; a release is newer than any old numbered
// build (gp-v79), so users on the old scheme get the update. Old numbered builds compare as numbers (gp-v37); any other
// strings count as newer when they differ.
export function isNewer(cur, latest) {
  if (!cur || !latest || cur === latest) return false;
  const a = SEMVER.exec(String(cur)), b = SEMVER.exec(String(latest));
  if (a && b) {
    for (let i = 1; i <= 3; i++) { const x = Number(a[i]), y = Number(b[i]); if (x !== y) return y > x; }
    return false;
  }
  if (b) return true;                                  // latest is a release; cur is an old build or dev
  if (a && LEGACY.test(String(latest))) return false;  // cur is a release; latest is an older numbered build
  const na = LEGACY.exec(String(cur)), nb = LEGACY.exec(String(latest));
  if (na && nb) return Number(nb[1]) > Number(na[1]);
  return true;
}

// The version line on the Thêm page: "Phiên bản 1.80.3" (the BUILD without its "gp-" prefix), "Phiên bản dev" on master.
export function buildLabel(build) {
  const v = String(build || '').replace(/^gp-/, '');
  if (!v) return '—';
  return v === 'dev' ? 'Phiên bản dev' : 'Phiên bản ' + v;
}

// deps: build (this page's version), fetchVersion() -> {v, sha} (rejects when offline), isIdle() -> bool, applyNow()
// (activates the waiting worker and reloads), showNotice(bool), store {get(k), set(k, v)} (may throw: a private window),
// now() -> ms.
export function createUpdater(deps) {
  const st = { pending: false, latest: null };
  const num = (k) => { try { return Number(deps.store.get(k)) || 0; } catch { return 0; } };
  const put = (k, v) => { try { deps.store.set(k, v); } catch { /* private window: the daily rules wait for a fresh start */ } };
  const since = () => num(SINCE_KEY);
  const remember = (v) => put(SINCE_KEY, v);

  function apply() { st.pending = false; remember(''); deps.showNotice(false); deps.applyNow(); }

  // why: 'open' (app started), 'visible' (came back), 'hide' (going to the background), 'nav' (another page of the app),
  // 'manual' (Kiểm tra cập nhật), 'detect' (the browser found a new worker while open).
  // Idle: applied at once, except 'detect', which waits silently for nav, hide, open or visible (or a day, see above).
  // Busy: the notice shows.
  function decide(why) {
    if (!st.pending) return;
    const idle = deps.isIdle();
    const daily = since() > 0 && deps.now() - since() >= DAY_MS;
    if (idle && (why !== 'detect' || daily)) return apply();
    deps.showNotice(!idle);
  }

  function markPending(why) {
    if (!st.pending) { st.pending = true; if (!since()) remember(String(deps.now())); }
    decide(why);
  }

  // Asks the server which build is live, at most once a day (a manual check always asks). A newer one than this page's
  // build means a deploy went out. Only a successful answer starts the day, so an offline app asks again later.
  async function check(why) {
    const last = num(CHECKED_KEY);
    if (why !== 'manual' && last && deps.now() - last < DAY_MS) return { ok: true, skipped: true, newer: false };
    let v;
    try { v = await deps.fetchVersion(); } catch { return { ok: false }; }
    if (!v || !v.v) return { ok: false };
    put(CHECKED_KEY, String(deps.now()));
    st.latest = v;
    if (isNewer(deps.build, v.v)) { markPending(why); return { ok: true, newer: true, v }; }
    return { ok: true, newer: false, v };
  }

  return {
    get latest() { return st.latest; },
    get pending() { return st.pending; },
    check,
    markPending,
    decide,
    // Called when the page loads and a new worker is already waiting (or after an updatefound install).
    waitingFound() { markPending('open'); },
  };
}

// The notice itself: one floating row above the bottom nav (the toast slot), tapping Tải lại applies the update.
// Styled by .updnote in app.css; it is not a fixed overlay over content.
export function updateNotice(show, onReload) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('updnote');
  if (!show) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.id = 'updnote'; el.className = 'updnote'; el.setAttribute('role', 'status');
  el.innerHTML = '<span>Có bản mới ·</span> <button type="button" class="updnote-btn" id="updreload">Tải lại</button>';
  el.querySelector('#updreload').addEventListener('click', onReload);
  document.body.append(el);
}
