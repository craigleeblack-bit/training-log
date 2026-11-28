# Training Log — house rules

A phone-first training log that installs to the home screen and works offline
(Vite + React + TypeScript, data in IndexedDB through Dexie). What it does is
described in `README.md`.

The owner is a hobbyist, not a professional developer: explain decisions
briefly in plain English, and keep the code simple and well commented.

## This repository is public

- Never commit `dexie-cloud.key` (a secret), `dexie-cloud.json`, `Resources/`,
  `seed/` or `claude-project-setup.md`. They are in `.gitignore` because they
  are secret or personal. Keep them there.
- Keep personal training, health and equipment details out of code, tests,
  sample data, commit messages and this file. Use made-up examples.
- `.env` **is** committed on purpose. It holds only `VITE_SYNC_URL`, the
  address of the sync database, which is not a secret, and the published
  build needs it.

## Rules for every session

- **Language:** British English in all text on screen and in code comments
  (programme, practise (verb), metre, colour).
- **Pushing to `main` publishes.** `.github/workflows/deploy.yml` runs
  `npm test`, then `npm run build`, then publishes to GitHub Pages, and that
  is the copy on the phone. Do feature work on a branch. A failing test stops
  the publish.
- **The database is `src/db/schema.ts`.** People have real logs on their
  devices, so:
  - to change the shape of the data, add a new `this.version(n+1)` with an
    `.upgrade()` that brings old data forward. Never edit an earlier version;
  - a new field that is optional and not indexed needs no new version, since
    old records simply lack it (decided 28 November 2026). Mark it optional
    (`?`) and make the code cope when it is missing;
  - give each new version a test that opens a database at the old version
    and upgrades it, as `src/db/v2.test.ts` and `src/db/v3.test.ts` do;
  - a brand-new database skips upgrades, so anything an upgrade adds as
    starting data also goes in the `populate` handler;
  - add a new table to `TABLES` at the bottom of the file, or backup, restore
    and the tests that clear the database will miss it.
- **Offline first.** Everything works with no connection. Nothing leaves the
  device except the three cases listed under "Where your data lives" in the
  README (optional sync, map pictures, links the user taps). Adding a fourth
  needs the owner's say-so and a line in that README section.
- **Sync is optional and off by default.** It turns on only when the build has
  a valid `VITE_SYNC_URL` (`src/sync.ts`) and the user signs in. Tests always
  run against a plain local database, whatever `.env` says.
- **The app never calls Claude.** "Ask Claude" copies the relevant context and
  opens the user's own Claude Project (`src/lib/claude.ts`), so it costs
  nothing to run. Only `claude.ai` addresses are accepted there. Keep both.
- **Logic goes in `src/lib` with a test beside it.** Those files are pure
  (dates, timers, set logging, route maths, planning, statistics); screens
  call them and do not repeat the sums.
- **After each feature:** run `npm test` and `npm run build`, fix any type
  errors, then give the owner a short checklist to try on the phone.

## Layout

- `src/db` — schema, history queries, backup import and export
- `src/lib` — pure logic with tests
- `src/screens` — one file per screen
- `src/data` — suggested exercise videos
- `src/ui.tsx`, `src/charts.tsx`, `src/icons.tsx` — shared components
- `src/timerContext.tsx`, `src/trackContext.tsx` — the running timer and the
  GPS recording
- `src/sync.ts`, `src/actions.ts` — sync configuration and data actions

## Useful commands

- `npm run dev` — dev server at http://localhost:5173
- `npm test` — all tests, once
- `npm run build` — type-check and build to `dist/`
- `npm run icons` — regenerate the PNG icons from `public/icon.svg`

`.claude/launch.json` has the same servers for the Claude app's preview:
`training-log` (5173), `training-log-alt` (5174) and `training-log-built`
(the built app, 4173).
