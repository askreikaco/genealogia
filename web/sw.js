// Offline shell: the app files the install step caches. Same-origin files go network first (a deploy shows on the
// next open) and fall back to this cache when offline. API responses are never cached here (IndexedDB holds the data).
// SHELL must list every file the app loads: a missing path makes install fail (addAll), so tests/sw.test.js checks it.
const V = 'gp-dev'; // = BUILD in js/update.js (server/test/update.test.js)
const SHELL = [
  '/',
  '/index.html',
  '/book.html',
  '/tokens.css',
  '/vendor/reika-ds/tokens.css',
  '/vendor/reika-ds/web.css',
  '/vendor/reika-ds/fonts/fonts.css',
  '/vendor/reika-ds/fonts/IBMPlexSans-Light.woff2',
  '/vendor/reika-ds/fonts/IBMPlexSans-Regular.woff2',
  '/vendor/reika-ds/fonts/IBMPlexSans-Medium.woff2',
  '/vendor/reika-ds/fonts/IBMPlexSans-SemiBold.woff2',
  '/vendor/reika-ds/fonts/IBMPlexMono-Regular.woff2',
  '/vendor/reika-ds/js/index.js',
  '/vendor/reika-ds/js/html.js',
  '/vendor/reika-ds/js/components.js',
  '/vendor/reika-ds/js/menu-controller.js',
  '/vendor/reika-ds/js/confirm.js',
  '/app.css',
  '/listui.css',
  '/book.css',
  '/fields.css',
  '/manifest.webmanifest',
  '/icon.svg',
  '/js/app.js',
  '/js/export-vi.js',
  '/js/book.js',
  '/js/booktext.js',
  '/js/bookchart.js',
  '/js/bookplan.js',
  '/js/elder.js',
  '/js/danger.js', '/js/council.js', '/js/lich-merge.js', '/js/news.js', '/js/ics.js', '/js/choice.js', '/js/groups.js',
  '/js/trash-ui.js',
  '/js/passkey.js',
  '/js/twostep.js',
  '/vendor/simplewebauthn-browser.umd.min.js',
  '/js/events.js',
  '/js/events-ui.js',
  '/js/sources-ui.js',
  '/js/sources-vi.js',
  '/js/stories-vi.js',
  '/js/ev-title-vi.js',
  '/js/disc-rules.js',
  '/js/forms-vi.js',
  '/js/gallery.js',
  '/js/gallery-ui.js',
  '/js/gallery-vi.js',
  '/js/events-life.js',
  '/js/estimate-graph.js',
  '/js/events-history.js',
  '/js/formrules.js',
  '/js/fuzzy.js',
  '/js/oauth-consent.js',
  '/oauth-consent.html',
  '/js/emblem.js',
  '/js/geo.js',
  '/js/kin/engine.js',
  '/js/kin/index.js',
  '/js/kin/packs/direct.js',
  '/js/kin/packs/en.js',
  '/js/kin/packs/ja.js',
  '/js/kin/packs/ko.js',
  '/js/kin/packs/vi.js',
  '/js/kin/packs/zh-Hans.js',
  '/js/kin/packs/zh-Hant.js',
  '/js/lunar.js', '/js/digest-vi.js',
  '/js/model.js',
  '/js/relgraph.js',
  '/js/relui.js',
  '/js/addflow.js',
  '/js/store.js',
  '/js/succession.js',
  '/js/claim.js',
  '/js/treechart.js',
  '/js/ui.js',
  '/js/person-item.js',
  '/js/hidden.js',
  '/js/privacy-copy-vi.js',
  '/js/living-vis.js', '/js/living-vis-vi.js',
  '/js/links.js',
  '/js/ai-recipes.js',
  '/js/branch-trees.js',
  '/js/contacts-import.js',
  '/js/contacts-parse.js',
  '/js/contacts-model.js',
  '/js/places.js',
  '/js/shortid.js',
  '/js/account.js',
  '/js/match.js',
  '/js/dupes.js',
  '/js/consistency.js',
  '/js/consistency-vi.js',
  '/js/needs-vi.js',
  '/js/est-years.js',
  '/js/text-size-vi.js',
  '/js/relpath.js',
  '/js/relpath-vi.js',
  '/js/relpath-path.js',
  '/js/variants.js',
  '/js/clan.js',
  '/js/countries.js',
  '/js/clan-core.js',
  '/js/branches.js',
  '/js/codes.js',
  '/js/famlabel.js',
  '/js/facts.js',
  '/js/prefill.js',
  '/js/surnames-vi.js',
  '/js/surname-rules.js',
  '/js/surnames.js',
  '/js/update.js',
];
// A new version waits while an older one controls open pages: the app shows "Có bản mới · Tải lại" and posts
// 'skip-waiting' when the owner taps it (or the app is idle). A first install has no older worker and activates at once.
self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => { if (!self.registration || !self.registration.active) return self.skipWaiting(); })));
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'skip-waiting') self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (u.origin === location.origin && e.request.mode === 'navigate') {
    const key = u.pathname.startsWith('/book') ? '/book' : '/index.html';
    e.respondWith(fetch(e.request).then((r) => { caches.open(V).then((c) => c.put(key, r.clone())); return r; }).catch(() => caches.match(key)));
    return;
  }
  // same-origin app files: network first (a deploy shows on the next open), cache when offline
  if (u.origin === location.origin) {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) caches.open(V).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  // fonts/CDN: stale-while-revalidate
  e.respondWith(caches.open(V).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then((r) => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
