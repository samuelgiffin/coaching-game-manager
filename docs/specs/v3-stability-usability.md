# Spec: Soccer Sub Manager v3 (Stability & Usability)

| | |
|---|---|
| **Status** | Approved 2026-10-03 (assumptions A1–A4 in §12 accepted as stated) |
| **Source** | Review of `soccer_sub_manager_v2.html` (issue IDs C1–C5, H1–H7, M, S below) |
| **Output** | `soccer_sub_manager_v3.html` (v2 kept unchanged for reference) |
| **Out of scope** | Score/goal tracking, game reports, season history (next spec) |

## 1. Goal

A coach can run a full match from one phone, with no signal, and trust the minutes shown. Specifically:

- Play time is never counted twice or lost.
- Taps always register.
- No single tap can erase match data.

## 2. Constraints

1. **One self-contained HTML file.** No CDN, fonts, network requests, build step, or runtime dependencies. A CSP `<meta>` tag enforces this.
2. **Modern mobile browsers.** iOS Safari 16+ and Chrome Android. Features such as Wake Lock and vibration are used only where the browser supports them.
3. **No bloat.** v3 should not be much bigger than v2's ~1,050 lines. Removing the Tailwind class names should roughly cover the cost of the new CSS.
4. **Tests run without packages.** Use Node ≥ 18's built-in `node:test` and `node:vm`. No `package.json` is needed. Tests live outside the shipped file.

## 3. Key design decisions

### D1. Derive time from the clock instead of adding it up each tick (fixes C1, H1, H3)

v2 adds seconds to every player on every tick, which causes drift and double counting. v3 stores only **when** things happened, measured on the game clock. Every displayed time is calculated from that.

```
clockMs(now) = min(periodMs, clock.elapsedMs + (clock.running ? max(0, now - clock.startedAt) : 0))
```

- When a player changes status (sub, period start), save `stintStartMs = clockMs`.
- Live values:
  - **Shift** (on field) or **Sat** (on bench) = `clockMs - stintStartMs`
  - **Period time** = stored `periodMs[p]` + the live shift, if on the field
  - **Total** = sum of all periods
- The tick **only redraws the screen**. It never changes state or saves.

**Why this fixes the bugs:**

- After a reload or phone sleep, the time is simply recalculated. Nothing is added again (C1).
- No rounding builds up over time (H1).
- Times can't run past the end of a period, even if the phone was asleep.
- Undoing a sub just restores the earlier stint data (H3).

### D2. Separate the engine from the screen code (Testability)

The file has two scripts:

- `<script id="engine">`: pure functions with no access to the page or system time. `now` is passed in as a parameter. Each action returns a **new** state and never changes its input. It exposes `globalThis.Engine`.
- `<script id="app">`: storage, drawing the screen, and handling events. It gets `Date.now()` and passes it to the engine.

Tests load the engine by pulling the `#engine` script out of the HTML and running it in a `vm` sandbox.

### D3. Rebuild the screen only when something happens (fixes H2)

- `renderAll()` rebuilds the lists. It runs only after a user action.
- `renderTimes()` runs every 500 ms and updates only the `textContent` of `[data-t]` elements.
- One click listener per container, using `data-action` and `data-id`. There are no inline handlers containing data.
- Lists never reorder during a tick:
  - The field list stays in roster order.
  - The bench list is ranked by recommendation, and that order is recalculated only after a user action.

## 4. State model (`localStorage` key `SSM_V3`)

```js
{
  v: 3,
  settings:   { fieldSize: 5, periodMinutes: 8, periodCount: 4 }, // periodCount ∈ {2, 4}
  roster:     [{ id, name }],         // display order; kept across matches
  starterIds: [id],                   // lineup used when a match starts or is reset
  match: {
    period: 1,                        // 1..periodCount
    clock:  { running: false, startedAt: null, elapsedMs: 0 }, // current period only
    players: { [id]: { onField, stintStartMs, periodMs: [..periodCount], resting } },
    pinnedId: null,                   // at most ONE "next up" player
    skipIds:  [],                     // skipped for the current sub; cleared after each sub
    undo: null | { label, keepClock, match }   // one level; snapshot excludes its own undo
  }
}
```

**Values calculated on demand, never stored:**

| Value | Rule |
|---|---|
| `matchStarted` | `period > 1 \|\| elapsedMs > 0 \|\| running` |
| `periodOver` | `clockMs ≥ periodMs` |
| `matchOver` | last period **and** `periodOver` |
| `fairDeltaMs` | the player's total minus the average total of all match players |

**Temporary screen state, never saved:** manual selection (`outId`, `inId`) and the Setup draft. (Fixes H4: no leftover selections after a reload.)

## 5. Engine API

Every function is `(state, ...args, now) → newState` unless noted. Invalid actions return the state unchanged.

| Function | Behaviour |
|---|---|
| `createState()` | Default state with an empty roster. |
| `normalize(raw) → state` | **Never throws.** Validates fields and fixes or replaces anything wrong with defaults. Removes player entries that don't match the roster. Migrates v2 data (keeps names, `playersOnField` → `fieldSize`, and `periodMinutes`, then starts a fresh match). Returns defaults for anything it can't read. |
| `clockMs(state, now) → ms` | As defined in D1. |
| `times(state, id, now) → { periodMs, totalMs, shiftMs, satMs, fairDeltaMs }` | Live values for one player. |
| `start(state, now)` | Does nothing if `periodOver`. Otherwise `running = true`, `startedAt = now`. |
| `pause(state, now)` | Saves `clockMs` into `elapsedMs` (capped at the period length) and stops the clock. |
| `recommend(state, now) → { outId, inId, status }` | See §6. `status ∈ ok \| no-bench \| none-eligible \| all-skipped`. |
| `substitute(state, outId, inId, now)` | Credits the outgoing player with `clockMs - stintStartMs` in `periodMs[p]`. Sets `stintStartMs = clockMs` for both players. Clears `resting` on the incoming player, and clears `pinnedId` if they were pinned. Empties `skipIds`. Saves an undo entry (`keepClock: true`). |
| `skip(state, now)` | Adds the recommended IN player to `skipIds`. Sets `pinnedId` only if no one is pinned yet. |
| `clearSkips(state)` / `clearPin(state)` | Removes all skips / removes the pin. |
| `toggleRest(state, id)` | Bench players only. Resting a player also unpins them. |
| `advancePeriod(state, now)` | Pauses the clock and saves an undo entry (`keepClock: false`). Credits all field players with their current shift and resets every `stintStartMs` to 0. Moves to the next period, sets the clock to 0, and empties `skipIds`. Does nothing in the last period. |
| `resetMatch(state, now)` | Pauses the clock, saves an undo entry (`keepClock: false`), and starts a fresh match using `starterIds`. |
| `undo(state, now)` | Restores `undo.match`. If `keepClock` is set, the current clock is kept. Any later action replaces the undo entry, and `advancePeriod` discards an undo entry left from a sub. |
| `applySetup(state, draft, now) → { ok, state, errors[] }` | See §7. |

## 6. Recommendation rules (fixes H5, M-fairness)

**Fairness rule (assumption A1): equal total match time.**

- **IN candidates** are bench players who aren't resting and aren't in `skipIds`. They are ranked by:
  1. The pinned player first
  2. Lowest total time
  3. Lowest time in the current period
  4. Longest time sitting
  5. Roster order
- **OUT candidates** are field players, ranked by:
  1. Players whose shift is at least `MIN_SHIFT_MS` (60 s) come before those whose shift is shorter. This stops a child from being subbed straight back off.
  2. Highest total time
  3. Longest shift
  4. Roster order

**What the recommendation card shows for each `status`:**

| Status | Card shows |
|---|---|
| `ok` | The suggested OUT ⇄ IN pair, with **Make sub** and **Skip** buttons. |
| `all-skipped` | "Everyone on the bench was skipped" and a **Clear skips** button. |
| `none-eligible` | "All bench players are resting." |
| `no-bench` | The card is hidden. |

The pin notice reads "**{name}** is next up". The word "resting" is no longer used for this.

## 7. Setup rules (fixes C2, C3, M-validation)

- Setup edits a **draft copy**. **Save** applies it through `applySetup`. **Cancel** or ✕ throws the draft away.
- Opening Setup **never** affects the clock.
- **Before the match starts (`!matchStarted`):** everything can be edited. Saving rebuilds the match from the draft.
- **During the match:** settings are read-only and show "Reset match to change". Players can only be **added**. A new player joins the bench with `stintStartMs = clockMs` and all periods set to 0. A child who leaves mid-match is marked **Rest**.

**Validation.** `applySetup` returns these errors and the screen shows them inline. The draft is never changed silently.

| Field | Rule |
|---|---|
| `fieldSize` | Whole number from 2 to 11 |
| `periodMinutes` | Whole number from 1 to 45 |
| `periodCount` | 2 or 4 |
| Roster | 1 to 18 players |
| Name | Trimmed, 1 to 20 characters, unique (case-insensitive) |
| Starters | Exactly `min(fieldSize, roster.length)`, shown as a live "Starters 4/5" counter. Save is disabled until it's met. |

## 8. Destructive actions (fixes C4)

- Every action that wipes data (Reset match, New match) asks for confirmation. The dialog names exactly what will be lost.
- Reset can be **undone** (see §5), so one wrong tap can be recovered.
- When the match ends, the dialog's main button is **Keep reviewing**. **New match** goes through the same confirm-and-undo path.
- Advancing early warns: "2:13 left in this period. Advance anyway?"

## 9. Reliability (fixes C5, H6, H7, M)

| Area | Requirement |
|---|---|
| Offline | Replace Tailwind and Google Fonts with a hand-written `<style>` block that keeps v2's high-contrast "sunlight" colours, using `system-ui` and `font-variant-numeric: tabular-nums`. Add CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`. |
| Save app file | Take a snapshot of `<!DOCTYPE html>` plus `outerHTML` **before the first render** and download that. Move the button into Setup. |
| Persistence | Save only after a user action or when a period ends, never on every tick. If `setItem` fails, show a lasting banner: "⚠ Not saving: storage unavailable." |
| Corrupt data | When loading, data goes through `normalize()`. If it can't be read, copy the raw text to `SSM_V3_corrupt`, start fresh, and show a banner. |
| Crash recovery | A global `error` handler shows a banner with **Reload** and **Reset app data** (which asks for confirmation). |
| Period end | The tick notices `running && periodOver`, then pauses, saves, vibrates (`navigator.vibrate(300)` where supported), and shows the banner. The banner is based on `periodOver`, so it comes back after a reload. |
| Screen lock | Request a `navigator.wakeLock` screen lock when the clock starts. Release it on pause. Request it again on `visibilitychange` if the clock is still running. If the browser doesn't support it, nothing happens. |
| Time sanity | A negative wall-clock gap (the device clock went backwards) counts as 0 (built into `clockMs`). |

## 10. Usability & accessibility

- An **Undo** bar appears after a sub, period advance, or reset ("↶ Undo: Ava ⇄ Liam"). It stays until the next action. No timers.
- Each card shows a fairness badge built from `fairDeltaMs`, e.g. amber "−2:10" when behind and neutral "+0:45" when ahead.
- Fix tracking that is hard-coded to 4 periods: arrays and dialog text use `periodCount`.
- Shift and Sat **both** reset at each period start. The break counts as rest for everyone.
- Remove `maximum-scale` and `user-scalable=no`.
- Icon-only buttons get an `aria-label`. Dialogs get `role="dialog"` and `aria-modal`.
- Tap targets are at least 48 px.
- Names are inserted only through `textContent` (fixes S, the XSS issue).
- IDs come from `crypto.randomUUID()`, with a fallback where it's unavailable.

## 11. Acceptance criteria

**Engine.** Each item gets a `node:test` case, and each fix starts as a failing test that reproduces the bug.

1. **Reload:** Save while running at T. Load at T+60 s. The clock and every field player are exactly 60 s further on, counted once. (C1)
2. **Drift:** Start→pause cycles of 1.5 s × 4 total exactly 6,000 ms. (H1)
3. **Cap:** Running for 2× the period length credits exactly `periodMs`, and `periodOver` is true.
4. **Sub and undo:** A sub at 3:00, then undo at 4:00, gives the outgoing player 4:00 of play and no credit for the incoming player.
5. **Recommend:**
   - The fairness order follows §6.
   - Only one player is pinned at a time.
   - Skipping everyone gives `all-skipped`.
   - Resting players are excluded.
   - The `MIN_SHIFT_MS` guard applies.
6. **Setup:**
   - Each validation error in §7 is returned.
   - Settings are locked during the match.
   - Adding a player mid-match gives them zero time and a correct Sat value.
7. **Reset and undo:** The previous match is restored, with its clock paused.
8. **Normalize:**
   - Garbage, `null`, or missing fields produce a valid default state.
   - A v2 save keeps names and settings.

**Manual browser checks** (`browser-testing-with-devtools`):

- Loads with full styling in airplane mode, with no failed network requests in DevTools.
- Taps on cards register while the clock is running.
- A name like `<b>x</b>` shows as plain text.
- Screen lock: lock for 2 minutes and unlock. The clock is right and no time is counted twice.
- With full storage (simulated), the warning banner appears.

## 12. Assumptions & open questions

| # | Item | Default if not answered |
|---|---|---|
| A1 | Fairness is based on **total match time**, with time in the current period as a tie-breaker. | As stated |
| A2 | Settings are locked during a match. Players can be added mid-match but not removed. | As stated |
| A3 | The roster limit goes up from 11 to 18. | 18 |
| A4 | The project isn't a git repo yet. Initialize git before implementing (`git-workflow-and-versioning`). | Initialize git |

## 13. Suggested delivery slices

Each slice gets its own tests first, then its code (`incremental-implementation`).

1. Test setup plus engine skeleton: `createState`, `normalize`, and the clock (D1). Criteria 1–3 and 8.
2. Subs, undo, and recommendations. Criteria 4, 5, and 7.
3. Setup draft and validation. Criterion 6.
4. Screen layer: vanilla CSS, CSP, event-based rendering, and event delegation (D3). Manual checks.
5. Reliability: storage errors, crash banner, wake lock, period-end alert, and the save-app-file fix.
