# giapha browser tests

Run from `server` (Playwright and Chrome are not in package.json):

```bash
cd server && npm ci
NODE_PATH=<dir with node_modules/playwright> \
GP_E2E_CHROME=/usr/bin/google-chrome \
GP_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/scratch_db \
npm run test:e2e
```

- `NODE_PATH`: any folder whose `node_modules` has `playwright` (e.g. a temp dir with `npm i playwright@1.63.0`).
- `GP_E2E_CHROME`: Chrome/Chromium binary (default `/usr/bin/google-chrome`).
- `GP_TEST_DATABASE_URL`: a SCRATCH database (migrated and seeded, see `server/scripts`). Only `e2e-signin` needs it.
- `GP_SHOT_DIR=<dir>`: also write the form screenshots.

Tests skip (with a reason) when playwright, Chrome or the database URL is missing.

| file | what it checks | needs DB |
|---|---|---|
| `hidden-controls-guest.test.js`, `-member.test.js`, `-editor.test.js` | no interactive element is in the DOM but invisible (outside closed dialogs and collapsed form sections) on every route, for one role | no |
| `hidden-controls-shell.test.js` | book.html has no hidden element; only the active nav layout is in the DOM at 390 and 1280 px | no |
| `form-fields.test.js` | person form: fields per role, prefills, dates, death fields, suggest mode, saves that keep unopened sections, draft restored into a closed section | no (mocked API) |
| `form-drafts.test.js` | person form drafts (autosave, reopen, expiry, server conflict) and the offline queue; warm start of the list | no (mocked API) |
| `form-nav.test.js` | sign-out confirmation, Thêm groups, back bar and list scroll restore | no (mocked API) |
| `form-screenshots.test.js` | screenshots of the form, drafts, back bar and book (skipped without `GP_SHOT_DIR`) | no (mocked API) |
| `book-pages.test.js` | book page count is the same at 390 px, 1280 px and in print, and equals the plan (mocked API from the real plan) | no |
| `book-lazy.test.js` | book: first page fast on a phone, only near pages ask for persons, far pages emptied, charts and columns not clipped, print loads all pages with progress | no |
| `book-ios.test.js` | book on an iPhone 13 (Chromium; WebKit when it can launch): every page box is the 842x595 reference scaled, content inside its box, cover stats shown, scale follows resize/rotation, print layout and 54-page PDF | no |
| `book-tools.test.js` | book toolbar: one row (search, Filters, Share), old print/embed buttons gone; accent-insensitive search jumps to the person's entry; Share sheet (print, iframe code) and Filters sheet open and close | no (mocked API) |
| `tatca-combined.test.js` | "Tất cả" with two families: combined Duyệt and Thành viên with chips and per-family actions, form Dòng họ field and picker scope, mixed map clusters, Đời filter after sync, book update bar | no (mocked API) |
| `tim-search.test.js` | Tìm: the top-bar search button (Tìm kiếm) and "/" and Ctrl+K open it focused; a giỗ date ("3/8", "3-8", "mồng 3 tháng 8") lists people by giỗ with line 2 "Giỗ 3/8 ÂL"; recent searches are rows with a 44 px remove button and "Xoá tất cả" | no (mocked API) |
| `keep-mounted.test.js` | a sync re-render keeps the book iframe (same element, scroll kept), the map instance (zoom kept) and the tree canvas scroll | no |
| `descendants.test.js` | Hồ sơ lineage rows and ancestor list (own schema `e2e_descendants`) | yes |
| `relations.test.js` | relationships: add spouse, child, relative couple, edit and remove (own schema `e2e_relations`) | yes |
| `e2e-signin.test.js` | signed-in owner leaves the loading state, also when an old tab holds IndexedDB | yes |
| `minimal-ui.test.js` | minimal UI cuts (one primary per screen, sub-pages, ⋯ menus, one-line copy): settings, person header, export, members, verify, form, create-family, emblem, stats, tree, more | no (mocked API) |
| `succession.test.js` | trusted contact invite and accept; inactive owner (time injected): member banner, offer with email code, previous owner reclaims; create a family | yes (+ fake mail) |

Unit tests (no browser): `npm test` in `server`.

Shared helpers (not tests; the glob picks only `*.test.js`): `_e2e-harness.js` (playwright and Chrome lookup, skip reason,
static server for web/), `_form-mock.js` (person form mock API), `_hidden-mock.js` (hidden-controls routes and audit),
`_book-mock.js` (book mock API), `_isolated-db.js` (a per-file Postgres schema).

DB files: a file that writes rows runs in its own schema (`e2e_<name>`, set through the connection options), so no file
reads or deletes another file's rows. Files that share the seeded schema only touch rows of their own family or emails.
