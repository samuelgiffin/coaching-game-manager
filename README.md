# Coaching Game Manager

A simple, offline-first single-file HTML application designed to help volunteer coaches manage youth **Soccer** and **Basketball** games right from the sideline.

All rosters, clocks, scores, and badges stay **100% private on your own phone/browser** (`localStorage`) — no account, no server, and no internet required on game day.

## How to Use

### Option 1: Open via GitHub Pages (Easiest on iPhone & Android)
Once GitHub Pages is enabled on this repository (**Settings → Pages → Deploy from branch `main` / `/ (root)`**):
1. Open **https://samuelgiffin.github.io/coaching-game-manager/** on your phone.
2. Tap **Share → Add to Home Screen** (iOS Safari) or **Menu → Add to Home screen** (Android Chrome) for an app-like experience on the sideline.

### Option 2: Download & Run Offline
Download [`index.html`](./index.html) and open it directly in any mobile or desktop browser — zero dependencies or build steps required. You can also save an offline copy anytime from the `💾` button inside **Setup (`⚙️`)**.

## Key Features

- **Multi-Sport Support (Soccer & Basketball):** Switch cleanly between Soccer (rolling 1-for-1 subs, goals) and Basketball (scheduled batch line swaps, 3:30 scorer's table warning, 4:00 mid-quarter sub alert, `+1`/`+2`/`+3` scoring, foul-out handling), each with isolated team storage.
- **Live Roster & Late Arrivals (`👥 Roster` + inline `Not Here Yet`):**
  - Mark missing players **Absent / Not Here Yet** while preserving your team roster week to week, and check them in with 1 tap when they arrive.
  - **Pure prorated fairness from arrival time** so late arrivals start at `0:00` fair delta and rotate in fairly behind bench teammates who waited.
  - Fill open field/court slots directly (`+ Field` / `+ Court`) when starting shorthanded or after an early departure.
  - Full **roster-aware Undo** without pausing a running match clock.
- **Accidental Reset Protection:** Live roster edits never reset a match; `Reset Match` is isolated inside the Setup **Danger Zone**, and switching sports mid-game prompts confirmation and pauses the clock.
- **Sportsmanship Badges & Match Report:** 1-tap badge drawer, box score, Hustle & Impact awards, per-player prorated fairness gauges, and 1-tap Parent SMS recap text.

## Running Tests (Developers)

```bash
# Install Playwright (for headless browser E2E tests)
npm install

# Run Engine unit tests
node --test v4_engine.test.js

# Run Playwright mobile E2E test suite
node playwright_v4.test.js
```

## License

[MIT](./LICENSE)
