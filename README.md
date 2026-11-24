# Training Log

A phone-first training log that installs to the home screen and works offline.

- **Spaces** keep each kind of training apart (home, gym, outdoors, swim, mobility — or your own).
- **Routines** are logged either set by set (weight × reps, with last time shown) or as a tick-off session (minutes, effort, back response, notes).
- **Programmes** lay sessions out week by week and put the next one on the Today screen.
- **Timer** for rest, EMOM and work/rest intervals, with the screen kept awake.
- **Library** for your own notes, plus "Ask Claude" buttons that copy the relevant context and open your Claude Project.

All data stays in the browser's storage on the device. Nothing is sent anywhere. Use Settings → Export backup to keep a copy or move to another device.

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
- `src/lib` — dates, timer phases, Claude context builders
- `src/screens` — one file per screen
- `src/ui.tsx`, `src/timerContext.tsx`, `src/actions.ts` — shared components, the running timer, and data actions
