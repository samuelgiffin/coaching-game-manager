# Live Roster Management, Prorated Late Arrivals & Match Reset Safety — Design Specification

**Date:** 2026-11-19  
**Target File:** `soccer_sub_manager_v4.html` (and test suites `v4_engine.test.js`, `playwright_v4.test.js`)  
**Status:** Ready for User Review

---

## 1. Overview & Goals

Address two high-friction real-world coaching issues discovered during live soccer matches, while ensuring full parity across both **Soccer** (rolling 1-for-1 subs) and **Basketball** (batch line subs, mid-quarter alerts, foul-out) modes:

1. **Late Arrivals & Attendance Management:** Coaches need a fast, live workflow to handle players who arrive after kickoff, start a match shorthanded and fill open field/court slots when players arrive, mark missing players as "Not Here Yet / Absent" (while preserving the saved team roster week to week), mark players as "Left Early" without losing their match stats, and rank late arrivals using **pure prorated fairness from arrival time**.
2. **Eliminating Accidental Match Resets:** Roster edits (adding, removing, or marking players absent) must **never** reset a match, destroy Undo history, or fail with starter-count errors mid-game. Destructive match resets and live sport switches must be isolated from everyday roster controls with explicit guardrails.

---

## 2. Architecture & Data Model (`Engine`)

### 2.1 `Engine.SPORTS` Addition

Add a declarative `surfaceNoun` field to each sport config so all new UI controls adapt automatically:

- `soccer.surfaceNoun = 'Field'`
- `basketball.surfaceNoun = 'Court'`

### 2.2 State Schema Additions (`createState` & `normalize`)

1. **Match-level cumulative clock (`state.match.completedPeriodsMs`)**:
   - Initialized to `0` in `createState()` and `resetMatch()`.
   - In `advancePeriod()`, adds exact period clock `cMs` to `completedPeriodsMs` before resetting `clock.elapsedMs = 0`, ensuring total match elapsed time stays accurate even when a period advances early.
   - In `normalize()`, if `typeof state.match.completedPeriodsMs !== 'number'`, backfills `(Math.max(1, state.match.period) - 1) * (state.settings.periodMinutes || 8) * 60 * 1000`.

2. **Player attendance & presence fields (`state.match.players[id]`)**:
   ```javascript
   {
     onField: boolean,
     stintStartMs: number,
     periodMs: number[],
     resting: boolean,
     fouledOut: boolean,
     absent: boolean,                // true = "Not Here Yet" or "Left Early"
     arrivedAtMs: number | null,     // matchElapsedMs when current presence stint began (0 at kickoff; null while absent)
     firstArrivedAtMs: number | null,// matchElapsedMs when player first arrived (0 at kickoff; null until first arrival)
     departedAtMs: number | null,    // matchElapsedMs when player left early (null if not departed or if returned)
     presentMs: number,              // accumulated present ms from prior stints before departure (0 normally)
     badges: Array<{ id, type, timestampMs }>
   }
   ```
   - In `normalize()`, backfill missing fields cleanly for v3/v4 saves:
     - `p.absent = Boolean(p.absent)`
     - `if (p.arrivedAtMs === undefined) p.arrivedAtMs = p.absent ? null : 0`
     - `if (p.firstArrivedAtMs === undefined) p.firstArrivedAtMs = p.absent ? null : p.arrivedAtMs`
     - `if (p.departedAtMs === undefined) p.departedAtMs = null`
     - `if (typeof p.presentMs !== 'number') p.presentMs = 0`

3. **Roster-aware Undo (`state.match.undo`)**:
   - Extend `undo` snapshots with optional `roster` and `starterIds` fields:
     `{ label, keepClock, match, roster?, starterIds? }`
   - In `Engine.undo(state, now)`: when `Array.isArray(undoObj.roster)` or `Array.isArray(undoObj.starterIds)` are present, restore `newState.roster` and `newState.starterIds` alongside `newState.match`, preserving the existing `keepClock` running-clock behavior.

### 2.3 Core Helper Methods

- **`Engine.hasMatchActivity(state)`**: Returns `true` if `period > 1`, `clock.elapsedMs > 0`, `clock.running`, `score.us > 0`, `score.them > 0`, `events.length > 0`, or any player has `badges.length > 0` or any `periodMs[i] > 0`.
- **`Engine.matchElapsedMs(state, now)`**: Returns `completedPeriodsMs + clockMs(state, now)`.
- **`Engine.playerPresentMs(state, id, now)`**: Treats undefined `arrivedAtMs` on non-absent legacy objects as `0`. Returns `(p.presentMs || 0) + (!p.absent && arrivedAt !== null ? Math.max(0, matchElapsedMs - arrivedAt) : 0)`.
- **`Engine.playerHasMatchData(state, id, now)`**: Returns `true` if `_rawTimes(state, id, clockMs).totalMs > 0`, `(p.badges && p.badges.length > 0)`, or `match.events.some(e => e.playerId === id)`.

---

## 3. Pure Prorated Fairness Math & Recommendations

### 3.1 `Engine.times(state, id, now)`

Active fairness pool consists of roster players where `rp && !rp.absent && !rp.resting && !rp.fouledOut`.

1. Sum `totalActivePlayedMs` (sum of `_rawTimes(state, rId, cMs).totalMs`) and `totalActivePresentMs` (sum of `playerPresentMs(state, rId, now)`) across active pool members.
2. Compute `ownPresentMs = playerPresentMs(state, id, now)`.
3. Compute prorated target:
   - If `totalActivePresentMs > 0`:
     `targetMs = Math.round(totalActivePlayedMs * (ownPresentMs / totalActivePresentMs))`
   - Else (pre-kickoff `00:00`):
     `targetMs = activeCount > 0 ? Math.round(totalActivePlayedMs / activeCount) : own.totalMs`
4. Compute `fairDeltaMs = own.totalMs - targetMs`.
5. Return `{ periodMs, totalMs, shiftMs, satMs, presentMs: ownPresentMs, targetMs, fairDeltaMs }`.

**Invariants:**
- **Kickoff parity:** When all active players arrived at `0:00`, `ownPresentMs / totalActivePresentMs === 1 / N`, reducing identically to the existing average formula.
- **Zero arrival spike:** At the instant a late player checks in (`ownPresentMs = 0`), `targetMs = 0` and `fairDeltaMs = 0` (`0:00`), and `stintStartMs = cMs` so `Sat:` starts at `00:00`.
- **Shorthanded accuracy:** Because `totalActivePlayedMs` reflects actual field/court minutes played, starting 4 of 5 does not penalize players with phantom 5th-slot minutes.

### 3.2 `Engine.recommend()` (Soccer) & `Engine.recommendBatch()` (Basketball)

- Exclude `p.absent` from `inCandidates`, `eligibleBenchCount`, and `anyBench` (absent players are never treated as bench players or foul-out replacements).
- Remove the stale manual `avgTotal` override inside `recommend()`; use `t.fairDeltaMs` directly from `Engine.times()`.
- **IN candidate sort order** (both Soccer and Basketball):
  1. `pinnedId` first
  2. (Soccer only) `lastSubOutId` last
  3. `Math.round(a.t.fairDeltaMs) - Math.round(b.t.fairDeltaMs)` (most underplayed relative to time present first)
  4. `a.t.periodMs - b.t.periodMs`
  5. `b.t.satMs - a.t.satMs` (waiting longer on bench first)
  6. `a.t.totalMs - b.t.totalMs`
  7. `a.index - b.index`
- **OUT candidate sort order**:
  1. (Soccer only) `shiftMs < MIN_SHIFT_MS` (60s) last
  2. `Math.round(b.t.fairDeltaMs) - Math.round(a.t.fairDeltaMs)` (most overplayed relative to time present first)
  3. `b.t.shiftMs - a.t.shiftMs`
  4. `b.t.totalMs - a.t.totalMs`
  5. `a.index - b.index`

Result: A late arrival (`0:00` delta) naturally queues behind teammates who have been sitting since kickoff (negative delta) and moves up into the rotation fairly as their bench time accumulates — in both Soccer rolling subs and Basketball batch line swaps.

---

## 4. Safe, Undoable Roster Engine Actions

Every action preserves running clock state (`keepClock: true`), never resets match state, and records a full Undo snapshot (including `roster` and `starterIds` when modified).

1. **`Engine.addPlayerLive(state, name, opts = {}, now)`**
   - Validates `state.roster.length < 18`, trimmed `name` length `1–20`, case-insensitive uniqueness across `state.roster`.
   - `absent = Boolean(opts.absent)`.
   - `putOnField = !absent && Boolean(opts.putOnField) && currentOnFieldCount < state.settings.fieldSize`.
   - Appends `{ id, name }` to `roster`; creates `match.players[id]` with `onField: putOnField`, `stintStartMs: cMs`, `arrivedAtMs: absent ? null : mMs`, `firstArrivedAtMs: absent ? null : mMs`, `absent`, `departedAtMs: null`, `presentMs: 0`, `resting: false`, `fouledOut: false`, `badges: []`.
   - If `!hasMatchActivity(state)` and `putOnField`, also adds `id` to `starterIds`.
   - Returns `{ ok: true, state: newState, playerId: id, errors: [] }` (or `{ ok: false, state, errors }`).

2. **`Engine.markPlayerArrived(state, playerId, opts = {}, now)`**
   - Requires `p && p.absent`.
   - `putOnField = Boolean(opts.putOnField) && currentOnFieldCount < state.settings.fieldSize`.
   - Sets `p.absent = false`, `p.arrivedAtMs = mMs`, `if (p.firstArrivedAtMs === null || p.firstArrivedAtMs === undefined) p.firstArrivedAtMs = mMs`, `p.departedAtMs = null`, `p.resting = false`, `p.stintStartMs = cMs`, `p.onField = putOnField`.
   - If `!hasMatchActivity(state)` and `putOnField` and not in `starterIds`, appends to `starterIds`.
   - Returns `newState`.

3. **`Engine.markPlayerAbsent(state, playerId, subInId = null, now)`**
   - Requires `p && !p.absent`.
   - Accumulates presence: if `p.arrivedAtMs !== null`, `p.presentMs += Math.max(0, mMs - p.arrivedAtMs)`.
   - Sets `p.absent = true`, `p.arrivedAtMs = null`, `p.resting = false`, `p.departedAtMs = hasMatchActivity(state) ? mMs : null`.
   - If `p.onField`:
     - Closes shift: `p.periodMs[period - 1] += (cMs - p.stintStartMs)`, `p.onField = false`, `p.stintStartMs = cMs`.
     - If `!hasMatchActivity(state)`, removes `playerId` from `starterIds`.
     - If `subInId` references an eligible bench player (`!onField && !absent && !fouledOut`), moves `subInId` onto the field/court (`onField = true`, `stintStartMs = cMs`, `resting = false`), clears `pinnedId` if matching, clears `skipIds`, and updates `starterIds` if pre-kickoff.
   - Clears `pinnedId` if `pinnedId === playerId` and removes `playerId` from `skipIds`.
   - Returns `newState`.

4. **`Engine.enterField(state, playerId, now)`**
   - Requires `p && !p.onField && !p.absent && !p.fouledOut && currentOnFieldCount < state.settings.fieldSize`.
   - Moves player onto an open field/court slot (`p.onField = true`, `p.stintStartMs = cMs`, `p.resting = false`).
   - Updates `starterIds` if `!hasMatchActivity(state)`; clears `pinnedId` if matching.
   - Returns `newState`.

5. **`Engine.removePlayerFromRoster(state, playerId, now)`**
   - Validates player exists; blocks removal if `state.roster.length <= 1` (`reason: 'last-player'`).
   - Blocks destructive deletion if `playerHasMatchData(state, playerId, now)` is `true`, returning `{ ok: false, state, reason: 'has-match-data', errors: [...] }`.
   - Otherwise removes player from `roster`, `starterIds`, `match.players`, `skipIds`, and clears `pinnedId`/`lastSubOutId` if matching, with full Undo snapshot.
   - Returns `{ ok: true, state: newState, errors: [] }`.

6. **Non-Destructive `Engine.applySetup(state, draft, now)`**:
   - Validates `fieldSize` (2–11), `periodMinutes` (1–45), `periodCount` (2 or 4), `roster` (1–18, valid unique names).
   - **When `hasMatchActivity(state)` is `true`:**
     - Does **not** validate `starterIds` count.
     - Does **not** overwrite `settings` or call `resetMatch()`.
     - Only appends any newly added players (`onField: false`, `arrivedAtMs: mMs`, `absent: false`) without disturbing existing match state.
   - **When `hasMatchActivity(state)` is `false`:**
     - Computes `absentSet = new Set(draft.absentIds || [])` and `presentRoster = draft.roster.filter(r => !absentSet.has(r.id))`.
     - Validates `reqStarters = Math.min(draft.fieldSize, presentRoster.length)` and checks `draft.starterIds` only contains present players with `length === reqStarters`.
     - Updates `settings`, `roster`, `starterIds`, and reconciles `match.players` **in-place** (preserving `absent` flags and setting `arrivedAtMs: absent ? null : 0`) without calling `resetMatch()` and without wiping an existing `Reset Match` undo snapshot.

7. **`Engine.resetMatch(state, now)`**:
   - Preserves `state.roster`, clears clock/score/events/badges/skips/pins, sets `completedPeriodsMs = 0`, resets all players to fresh pre-game presence (`absent: false`, `arrivedAtMs: 0`, `firstArrivedAtMs: 0`, `departedAtMs: null`, `presentMs: 0`), and retains `state.match.undo` so an accidental reset remains one-tap reversible.

---

## 5. UI & Interaction Design (Soccer + Basketball)

### 5.1 Header & Dashboard Layout

- **Header controls:** `[START/PAUSE]` `[👥]` `[⚙️]`
  - `👥` (`data-action="openRoster"`, `aria-label="Roster"`) opens the safe **Roster & Attendance** modal (`#rosterModal`).
  - `⚙️` (`data-action="openSetup"`, `aria-label="Setup"`) opens **Match Setup & Settings** (`#setupModal`).
- **Footer cleanup:** Remove the bare `Reset` button from the main dashboard footer, leaving only `Next Period →` / `Next Quarter →`. (`New Match` remains inside the post-game Full Time / Final completion modal.)
- **Inline `Not Here Yet (N)` strip (below Bench):**
  - Rendered only when at least one roster player has `p.absent === true`.
  - Collapsed by default as a clean toggle bar (`Not Here Yet (N) ▸`); expanding shows each absent player with a 1-tap **`✓ Arrived`** button (checks into Bench) and, whenever `onFieldCount < fieldSize`, a **`→ Field`** / **`→ Court`** button.
- **Open-Slot Bench Button (`+ Field` / `+ Court`):**
  - Whenever `onFieldCount < state.settings.fieldSize`, eligible Bench cards (`!resting && !fouledOut`) display a **`+ Field`** (Soccer) or **`+ Court`** (Basketball) button calling `enterField`. Automatically hidden when at full strength.

### 5.2 Dedicated `👥 Roster & Attendance` Sheet (`#rosterModal`)

- Always safe to use before or during a match; contains **no** sport switcher, match settings, or Reset controls.
- **Header:** `"Roster & Attendance"`, summary count (`X Present • Y Absent`), `✕` close button.
- **Quick-Add Bar:** Input (`id="livePlayerName"`) with **Enter-key submit** (`keydown` listener) + **`+ Bench`** button, plus **`+ Field`** / **`+ Court`** button when `onFieldCount < fieldSize`. Displays inline validation errors (`#rosterErrors`).
- **Present Players section:** Shows each present player with status tag (`On Field`/`On Court`, `Bench`, `Rest`, `Fouled Out`):
  - **`Absent`** (pre-kickoff) / **`Left Early`** (in-game):
    - Bench player → immediate 1-tap transition to Absent (undoable).
    - On-field/court player → confirmation modal: **Swap in `<Top Recommended>` & Mark Left Early** (when an eligible bench player exists), **Leave Slot Open & Mark Left Early**, or **Cancel**.
  - **`🗑` Remove from Team:**
    - If `!playerHasMatchData` → confirmation modal to remove permanently from team roster (undoable).
    - If `playerHasMatchData` → informative modal explaining match stats are preserved and offering **Mark Left Early** instead.
- **Not Here Yet / Absent section:** Shows each absent player with **`✓ Arrived`**, optional **`→ Field`** / **`→ Court`** (when shorthanded), and **`🗑`** (with the same stat-protection check).

### 5.3 Safe `⚙️ Setup` Modal & Reset Danger Zone

- **Live Match Banner:** When `hasMatchActivity(state)` is `true`, display an amber notice at the top of Setup: *"Match in progress — settings are locked. Use Roster & Attendance to manage late arrivals or absences safely."* with an **`Open 👥 Roster`** shortcut button.
- **Pre-Kickoff Roster Controls:** In Setup when `!hasMatchActivity(state)`, each player row supports toggling **Starter / Bench**, toggling **Absent**, and **`🗑`** permanent delete (auto-pruning `starterIds` when marking a starter absent or removing them so validation never deadlocks).
- **Sport Switch Guard:** Clicking Soccer/Basketball while `hasMatchActivity(state)` is `true` opens a confirmation modal (*"Pause & switch to `<Target Sport>`? Your live `<Current Sport>` match is saved and you can switch back anytime."*) and pauses the running clock before switching.
- **Danger Zone (`Reset Match`):** Placed at the bottom of `#setupModal` inside a red-bordered box. Fixes the missing `.bg-red-700` CSS rule (`background-color: #b91c1c; color: #ffffff;`). When `hasMatchActivity(state)` is `true`, the confirmation modal explicitly displays the active period, clock, and score before resetting.

### 5.4 Match Report & Parent SMS Recap (`recapMetrics` & `renderMatchLog`)

- **Per-player prorated target in `recapMetrics()`:**
  - Compute `totalReportPlayedMs` and `totalReportPresentMs` across all players who attended (`presentMs > 0 || totalMs > 0`).
  - For each attending player, compute individual `targetMs = totalReportPresentMs > 0 ? Math.round(totalReportPlayedMs * (presentMs / totalReportPresentMs)) : 0`, `targetDeltaMs = totalMs - targetMs`, and `fairnessStatus` (`over` > +90s, `under` < -90s, else `equal`).
  - Set top-level `metrics.targetMs` to the full-match equal share reference (for players present the whole match, matching existing recap behavior when everyone arrives on time).
  - Include `absentAllGame: boolean` (`presentMs === 0 && totalMs === 0`), `arrivedLate: boolean` (`firstArrivedAtMs > 0`), `leftEarly: boolean` (`departedAtMs !== null && p.absent`), and `presentMs` on each player metric object.
- **Playtime Summary Gauge UI:**
  - Each attending player's dashed target marker sits at their own `playerTargetPct = Math.round((p.targetMs / maxMs) * 100)`.
  - Late arrivals / early departures display subtle tags (`Late Arrival`, `Left Early`).
  - Full-game absentees appear cleanly as `Absent` without an underplayed bar and are omitted from `generateParentSummaryText()`.

---

## 6. Verification & Testing Plan

### 6.1 Unit Tests (`v4_engine.test.js`)
1. `normalize()` backfills `absent`, `arrivedAtMs`, `departedAtMs`, `presentMs`, and `completedPeriodsMs` for legacy v3/v4 saves.
2. Prorated fairness math:
   - Matches existing average formula identically when all players start at `0:00`.
   - Late arrival enters with `fairDeltaMs === 0` and `satMs === 0`.
   - Soccer `recommend()` and Basketball `recommendBatch()` both place waiting bench players ahead of a just-arrived late player, then rotate the late player in as their bench time grows.
   - Shorthanded start (`4/5`) produces `0:00` fair delta for the 4 active players.
   - Early departure freezes `presentMs`; returning resumes accumulation cleanly.
3. Safe live roster actions:
   - `addPlayerLive()` validates duplicates/limits and supports `putOnField` only when `onFieldCount < fieldSize`.
   - `markPlayerArrived()` checks in an absent player to bench or open field/court slot.
   - `markPlayerAbsent()` handles bench, on-field with swap, and on-field leave-slot-open.
   - `enterField()` fills an open slot without a 1-for-1 swap and rejects when already full.
   - `removePlayerFromRoster()` succeeds when no match stats exist, blocks with `reason: 'has-match-data'` when player has playtime/goals/badges, and restores `roster + starterIds + match` on `Engine.undo()` while keeping clock running.
4. `applySetup()` never calls `resetMatch()` or fails `starterIds` validation during a live match, and preserves absent flags pre-kickoff.
5. `recapMetrics()` assigns per-player prorated targets and flags full-game absentees cleanly.

### 6.2 End-to-End Tests (`playwright_v4.test.js`)
1. **Soccer live late-arrival & shorthanded flow:** Start 4/5 with 1 player marked Absent, run clock, add a brand-new late arrival straight to the open Field slot (`+ Field`), check in the absent player via inline `Not Here Yet` strip, mark an on-field player Left Early with swap, verify clock/score intact and Undo works.
2. **Basketball live roster parity:** Switch to Basketball, verify `Court` / `On Court` labels in `👥 Roster`, `+ Court` open-slot entry, prorated ranking in batch line subs, and foul-out excludes absent players.
3. **Reset safety & guardrails:** Verify bare `Reset` is absent from main footer, `Reset Match` lives inside Setup Danger Zone with live match summary confirmation, and switching sports during a live match prompts confirmation and pauses the clock.
4. **Match Report prorating:** Verify late-arrival tag, individual target marker, and omission of full-game absentees from parent summary text.
