# Contributing to genealogia

Thanks for helping. genealogia is a family-tree app built on two pillars:
1. **Security and privacy first.** Living people are private by default; nothing personal leaves a family's tree without consent.
2. **Performance, client-first, offline.** Data lives on the device and syncs; every page works on a mid-range phone on slow networks.

## Before you start
- Sign the **Contributor License Agreement**: the CLA Assistant bot asks on your first pull request. We cannot merge without it.
- For anything bigger than a small fix, open an issue first and describe the change.
- **Never put real personal data** (names, dates, places, photos, contacts of real people) in issues, tests, fixtures or screenshots. Use the demo family (`scripts/demo-family.mjs`) or invented data.

## Pull requests
- One topic per PR, small commits, a clear title in English.
- **Small change, small test:** add or update tests next to what you change. CI runs only the browser tests your change affects (`scripts/test-map.json`); a new e2e file must be listed there.
- Keep to the design system: tokens only (no raw colours or pixel values), one shared component per pattern, no hard-coded UI text outside the language files.
- Delete what your change replaces (unused code, CSS, files) in the same PR.
- CI must be green: leak check, syntax, unit + database tests, affected e2e.
- Do not commit secrets, `.env` files or server addresses.

## Local setup
- Node 22, Postgres 16 (or Docker): `bash scripts/ci-db.sh start`, then `cd server && npm ci && npm test`.
- Browser tests need Playwright and Chrome: see `test/e2e/README.md`.

## Licence
By contributing you agree your contribution is licensed under the AGPL-3.0 (see `LICENSE`) and covered by the CLA.
