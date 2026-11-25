# Training Log

A phone-first training log that installs to the home screen and works offline.

- **Spaces** keep each kind of training apart (home, gym, outdoors, swim, mobility — or your own).
- **Routines** are logged either set by set (weight × reps, with last time shown) or as a tick-off session (minutes, effort, back response, notes). Sets can be added or removed as you go, exercises reordered, swapped or dropped, and the bar across the top jumps between exercises. Routines handle ladders, left/right sets, supersets and complexes.
- **Programmes** lay sessions out week by week and put the next one on the Today screen. Weeks can be copied or repeated, days moved, and whole programmes duplicated.
- **Timer** with saved, editable timers: intervals (rounds, sets of rounds, warm-up, cool-down), EMOM, AMRAP, countdown and a stopwatch, with the screen kept awake.
- **GPS tracking** for runs, walks and rides: a live map (Leaflet and OpenStreetMap), time, distance, pace and splits, with GPX import and export.
- **Passes**: keep a gym entry code one tap from Today, with a scanner for QR codes and barcodes.
- **Progress** and a **calendar** under Plan: weekly volume, records, personal bests and consistency.
- **Library** for your own notes, exercises grouped into sections with technique videos, plus "Ask Claude" buttons that copy the relevant context and open your Claude Project.

## Where your data lives

Everything is kept in the browser's storage on the device. Use Settings → Export backup to keep a copy of your own.

Nothing leaves the device unless you use one of these:

- **Sync** (optional, off until set up and signed in to): your log is stored on [Dexie Cloud](https://dexie.org/cloud/) so your devices can share it.
- **GPS tracking**: the map pictures are fetched from OpenStreetMap's servers for the area you are looking at. Your route itself is not sent anywhere.
- **Video and code links** open the site they point to, when you tap them.

## Sync between a phone and a computer

Sync is built in but dormant until the app is given a database to use. One-off setup, from this folder:

1. Create the database. This emails a code to the address you give, and writes `dexie-cloud.json` and `dexie-cloud.key` (both ignored by git; the key is a secret):
   ```
   npx dexie-cloud create
   ```
2. Allow the app's addresses to use it:
   ```
   npx dexie-cloud whitelist https://<your-github-name>.github.io
   npx dexie-cloud whitelist http://localhost:5173
   ```
3. Copy `.env.example` to `.env` and set `VITE_SYNC_URL` to the database address from `dexie-cloud.json`. Commit `.env` and push, so the published app is built with it.

Then, on each device: Settings → Sync → Sign in to sync, with the same email. The first device uploads what it has; the others receive it. The free plan covers three users.

Things to know:

- A recording in progress stays on the device until you finish it.
- Signing out clears the synced log from that device (it stays in your account).
- Starter data uses fixed ids, so two different people should not both load the same starter file into one database.

## Limits worth knowing

- **GPS needs the screen on.** A web app is only given positions while it is open and in front, so the screen is held awake during a recording. For a run with the phone locked in a pocket, record on a watch or another app and import the GPX file.
- **Changing codes cannot be stored.** A pass that a gym's app redraws every few seconds will not work from a saved copy; a fixed code or card number will.
- **Suggested videos** were checked when added, but videos get taken down. Save your own link on an exercise to replace one.

## Develop

```
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # output in dist/
```

`npm run icons` regenerates the PNG icons from `public/icon.svg`.

## Deploy

Pushing to `main` builds and publishes to GitHub Pages through `.github/workflows/deploy.yml`. The build uses relative paths and hash routing, so it works under any repository name.

## Layout

- `src/db` — database schema, history queries, backup import/export
- `src/lib` — pure logic with tests: dates, timer recipes, set logging, route maths, planning, statistics, scanning
- `src/screens` — one file per screen
- `src/data` — suggested exercise videos
- `src/ui.tsx`, `src/charts.tsx` — shared components and charts
- `src/timerContext.tsx`, `src/trackContext.tsx` — the running timer and the GPS recording
- `src/sync.ts`, `src/actions.ts` — sync configuration and data actions
