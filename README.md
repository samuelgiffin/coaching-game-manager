# coaching-game-manager

A simple offline-first single-file HTML application designed to help volunteer assistant coaches manage kid sports games (Soccer & Basketball).

## Getting Started

Open `soccer_sub_manager_v4.html` directly in any mobile or desktop browser — no server, build step, or internet connection required. All state saves locally in `localStorage` with separate isolated profiles for Soccer and Basketball.

## Key Features

- **Multi-Sport Support (Soccer & Basketball):** Switch cleanly between Soccer (rolling 1-for-1 subs, goals) and Basketball (scheduled batch line swaps, 3:30 scorer's table warning, 4:00 mid-quarter sub alert, +1/+2/+3 scoring, foul-out handling).
- **Live Roster & Late Arrivals (`👥 Roster` + inline `Not Here Yet`):**
  - Mark missing players **Absent / Not Here Yet** while preserving your team roster week to week, and check them in with 1 tap when they arrive.
  - Pure **prorated fairness from arrival time** so late arrivals enter at `0:00` delta and rotate in fairly behind bench teammates who waited.
  - Fill open field/court slots directly (`+ Field` / `+ Court`) when starting shorthanded or after an early departure.
  - Full **roster-aware Undo** without pausing the running match clock.
- **Accidental Reset Protection:** Live roster edits never reset the match; `Reset Match` is isolated inside the Setup **Danger Zone**, and switching sports mid-game prompts confirmation and pauses the clock.
- **Sportsmanship Badges & Match Report:** 1-tap badge drawer, ESPN-style box score, Hustle & Impact awards, per-player prorated fairness gauges, and 1-tap Parent SMS recap text.

## Running Tests

```bash
# Install Playwright (for E2E browser tests)
npm install

# Run Engine unit tests
node --test v4_engine.test.js

# Run Playwright mobile E2E test suite
node playwright_v4.test.js
```
