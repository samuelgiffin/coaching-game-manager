# Multi-Sport Support (Soccer & Basketball) — Design Specification

**Date:** 2026-11-05  
**Target File:** `soccer_sub_manager_v4.html` (and test suites `v4_engine.test.js`, `playwright_v4.test.js`)  
**Status:** Draft for User Review

---

## 1. Overview & Goals

Adapt the single-file Coaching Game Manager (`soccer_sub_manager_v4.html`) so a coach can use it interchangeably for **Soccer** and **Basketball** (specifically tailored to 9–10 Boys Metro Basketball League rules while remaining general enough for standard youth basketball).

### Key Requirements
1. **Separate Per-Sport Profiles:** Switching between Soccer and Basketball in Setup loads/saves independent rosters, starter selections, settings, and match states in `localStorage` without overwriting the other sport's team.
2. **Basketball Scheduled Line Swaps & Mid-Quarter Alerts:**
   - Support the league's mandatory **4-minute mid-quarter substitution** and **50/50 equal-time rule** via a multi-player **Line Swap** (`Engine.recommendBatch` / `Engine.substituteBatch`) using pure equal-time rotation.
   - Alert the coach at **3:30 elapsed** (30 seconds before the 4:00 mark) to send incoming players to the scorer's table.
   - Alert the coach at **4:00 elapsed** to execute the mid-quarter Line Swap, automatically pausing the clock on execution per league rules.
3. **Individual Emergency Swaps & Fouled-Out Flag:**
   - Retain manual 1-for-1 player swaps at any time (for injuries or tactical changes).
   - Provide a simple **`🚫 Foul Out`** toggle on player cards in Basketball mode (`fouledOut: true`). If an active on-court player fouls out, immediately prompt a 1-tap swap with the top recommended bench player.
4. **Multi-Point Scoring (`+1`, `+2`, `+3`):**
   - Support 1-, 2-, and 3-point scoring buttons for on-court players and opponent (`Them`) in Basketball mode while preserving single-goal (`⚽ Goal`) tracking in Soccer mode.
5. **Sport-Specific Badges, Terminology & Match Report:**
   - Dynamically adapt UI labels ("On Field" vs. "On Court", "Period" vs. "Quarter", "Full Time" vs. "Final"), sportsmanship badges, scoring timelines, top scorer summaries, and parent SMS recap text to the active sport.

---

## 2. Architecture & Data Model (`Engine`)

### 2.1 `Engine.SPORTS` Configuration Registry

`Engine.SPORTS` defines declarative rules and UI metadata per sport:

```javascript
SPORTS: {
  soccer: {
    id: 'soccer',
    name: 'Soccer',
    icon: '⚽',
    storageKey: 'SSM_V3',
    appTitle: 'Soccer Sub Manager',
    surfaceLabel: 'On Field',
    sizeLabel: 'Field Size',
    periodLabel: 'Period',
    periodShort: 'P',
    gameOverLabel: 'Full Time',
    subMode: 'rolling', // 1-for-1 continuous recommendation
    defaults: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
    scoreIncrements: [1],
    scoreTerm: 'Goal',
    badges: {
      hustle:   { icon: '⚡', title: 'Great Hustle' },
      save:     { icon: '🛡️', title: 'Big Save' },
      pass:     { icon: '🤝', title: 'Great Pass' },
      kick:     { icon: '🚀', title: 'Super Kick' },
      teammate: { icon: '🌟', title: 'Star Teammate' }
    }
  },
  basketball: {
    id: 'basketball',
    name: 'Basketball',
    icon: '🏀',
    storageKey: 'CGM_BASKETBALL_V1',
    appTitle: 'Basketball Sub Manager',
    surfaceLabel: 'On Court',
    sizeLabel: 'Court Size',
    periodLabel: 'Quarter',
    periodShort: 'Q',
    gameOverLabel: 'Final',
    subMode: 'batch', // Multi-player wave swap + mid-quarter alert
    midSubWarningLeadMs: 30000, // 30s before midpoint (3:30 in an 8-min quarter)
    defaults: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
    scoreIncrements: [1, 2, 3],
    scoreTerm: 'Pts',
    badges: {
      hustle:   { icon: '⚡', title: 'Great Hustle' },
      defense:  { icon: '🛡️', title: 'Big Stop' },
      pass:     { icon: '🤝', title: 'Great Pass' },
      rebound:  { icon: '🏀', title: 'Big Rebound' },
      shot:     { icon: '🎯', title: 'Clutch Shot' },
      teammate: { icon: '🌟', title: 'Star Teammate' }
    }
  }
}
```

`Engine.BADGE_MAP` remains available as a combined lookup of all badge keys across both sports so existing v4 tests and badge rendering helpers can resolve any badge type cleanly.

### 2.2 State Schema Additions

`Engine.createState(sport = 'soccer')` produces:

```javascript
{
  v: 4,
  sport: 'soccer' | 'basketball',
  settings: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
  roster: [],
  starterIds: [],
  match: {
    period: 1,
    clock: { running: false, startedAt: null, elapsedMs: 0 },
    players: {
      [playerId]: {
        onField: Boolean,
        stintStartMs: Number,
        periodMs: [0, 0, 0, 0],
        resting: Boolean,
        fouledOut: Boolean, // NEW: true when player fouls out (Basketball)
        badges: []
      }
    },
    pinnedId: null,
    skipIds: [],
    undo: null,
    score: { us: 0, them: 0 },
    events: [
      // { id, type: 'goal_us' | 'goal_them', playerId, points: 1|2|3, period, clockMs }
    ],
    lastSubOutId: null,
    midSubDoneForPeriod: 0 // NEW: tracks highest period where mid-quarter sub was completed/dismissed
  }
}
```

### 2.3 Storage Isolation

- `localStorage.getItem('CGM_ACTIVE_SPORT')`: `'soccer'` (default) or `'basketball'`.
- Soccer profile saves to `SSM_V3` (preserving backward compatibility with existing user data and Playwright tests).
- Basketball profile saves to `CGM_BASKETBALL_V1`.
- When the user clicks `⚽ Soccer` or `🏀 Basketball` in the Setup modal, the app saves the current state to its sport key, updates `CGM_ACTIVE_SPORT`, loads the target sport's state from its storage key (or initializes `Engine.createState(targetSport)` if none exists), and refreshes the Setup draft and UI.

---

## 3. Core Engine Operations

### 3.1 Pure Equal-Time Batch Recommendation (`Engine.recommendBatch(state, now)`)

Used in Basketball mode (`subMode === 'batch'`) and also available programmatically:
1. Identify **eligible bench players**: `!p.onField && !p.resting && !p.fouledOut && !state.match.skipIds.includes(id)`.
2. Identify **on-court players**: `p.onField`.
3. Handle edge cases identically to `Engine.recommend`:
   - If no bench players exist at all → `{ outIds: [], inIds: [], pairs: [], status: 'no-bench' }`.
   - If bench players exist but all are `resting` or `fouledOut` → `{ outIds: [], inIds: [], pairs: [], status: 'none-eligible' }`.
   - If eligible bench players exist only when ignoring `skipIds` → `{ outIds: [], inIds: [], pairs: [], status: 'all-skipped' }`.
4. Sort `inCandidates` (eligible bench) by:
   1. Pinned player first (`pinnedId`)
   2. Lowest `totalMs`
   3. Lowest `periodMs`
   4. Longest `satMs`
   5. Roster index
5. Sort `outCandidates` (on-court) by:
   1. Highest `totalMs`
   2. Longest current `shiftMs`
   3. Roster index
6. Let `swapCount = Math.min(inCandidates.length, outCandidates.length)`.
7. Take the top `swapCount` of `outCandidates` (`outIds`) and `inCandidates` (`inIds`), returning `{ outIds, inIds, pairs: outIds.map((outId, i) => ({ outId, inId: inIds[i] })), status: 'ok' }`.

### 3.2 Batch Substitution (`Engine.substituteBatch(state, outIds, inIds, now)`)

1. Validates that `outIds.length === inIds.length && outIds.length > 0`, every `outId` is currently `onField: true`, and every `inId` is currently `onField: false`.
2. **Pauses the clock** (`this.pause(state, now)`) and leaves it paused after the swap (per Basketball rule: *"Clock stops for substitutions just long enough to get players on the court"*).
3. Records an undo snapshot with label `"Line Sub (${outIds.length} ⇄ ${inIds.length})"` (`keepClock: false` so undoing restores the pre-sub state cleanly).
4. Updates `periodMs`, `onField`, `stintStartMs = cMs`, and `resting = false` for all swapped players.
5. Clears `skipIds` and `pinnedId` (if pinned player entered), and sets `state.match.midSubDoneForPeriod = state.match.period` if `cMs >= (state.settings.periodMinutes * 60 * 1000) / 2 - 30000` (so performing the mid-quarter line swap clears the mid-quarter alert for the current quarter).

### 3.3 Mid-Quarter Sub Window Status (`Engine.midQuarterSubStatus(state, now)`)

For sports with `subMode === 'batch'`:
- Let `periodMs = state.settings.periodMinutes * 60 * 1000`, `midMs = periodMs / 2`, `warnMs = Math.max(0, midMs - 30000)`.
- Let `cMs = this.clockMs(state, now)`.
- If `state.match.midSubDoneForPeriod === state.match.period` or `cMs >= periodMs`, returns `'done'`.
- If `cMs >= midMs`, returns `'due'` (at or past 4:00 mark).
- If `cMs >= warnMs`, returns `'warning'` (between 3:30 and 4:00 mark).
- Otherwise returns `'upcoming'`.
- `Engine.dismissMidSub(state)` sets `state.match.midSubDoneForPeriod = state.match.period`.

### 3.4 Fouled-Out Flag (`Engine.toggleFoulOut(state, playerId, now)`)

- If `playerId` is on the **bench**: toggles `p.fouledOut = !p.fouledOut`. If `p.fouledOut` becomes `true`, clears `pinnedId` if it was `playerId`. Records undo snapshot.
- If `playerId` is **on the court**:
  - In the UI, tapping `🚫 Foul Out` on an on-court player checks `Engine.recommend(state, now)` for the #1 eligible bench player (`inId`).
  - If an eligible bench replacement exists, the UI modal prompts: **`[Name] Fouled Out — Sub in [Replacement Name] now?`** with primary action `Swap & Mark Fouled Out` (which calls `Engine.foulOutAndSub(state, outId, inId, now)` to pause the clock, swap `outId` and `inId`, and mark `outId` as `fouledOut: true` in a single atomic undoable step) or `Mark Fouled Out Only`.
  - If no eligible bench replacement exists, `Engine.toggleFoulOut` marks `p.fouledOut = true`.

### 3.5 Multi-Point Scoring (`Engine.recordScore(state, team, playerId, points, now)`)

- Increments `state.match.score[team]` by `numPoints = Number(points) || 1`.
- Pushes event `{ id: this.generateId(), type: team === 'us' ? 'goal_us' : 'goal_them', playerId, points: numPoints, period: state.match.period, clockMs: this.clockMs(state, now) }`.
- `Engine.recordGoal(state, team, playerId, now)` delegates to `this.recordScore(state, team, playerId, 1, now)` for full backward compatibility.
- `Engine.deleteEvent(state, eventId)` subtracts `evt.points || 1` from `state.match.score.us` or `state.match.score.them`.

### 3.6 Fairness & Recap Metrics (`Engine.recapMetrics(state, now)`)

- `activePlayers` filters out players who are currently `resting` OR `fouledOut` when computing `targetMs`.
- Returns `fouledOut: Boolean(p.fouledOut)` and `pointsScored` per player in `metrics.players`.

---

## 4. UI & Interaction Changes

1. **Setup Modal:**
   - Top segmented control: `⚽ Soccer` | `🏀 Basketball`.
   - Dynamic field/court size label (`Field Size` vs. `Court Size`).
2. **Header:**
   - Period badge displays `Period 1 / 4` (Soccer) or `Quarter 1 / 4` (Basketball).
   - Opponent score control displays `+ Them` (Soccer) or `+1` `+2` `+3 Them` buttons (Basketball).
3. **Mid-Quarter Alert Banner & Recommend Card (Basketball Mode):**
   - At `3:30` (`status === 'warning'`), displays an amber banner: `🔔 30s to Mid-Quarter Sub! Send [IN Names] to Scorer's Table`.
   - At `4:00` (`status === 'due'`), displays a prominent alert banner: `⏱ 4:00 Mid-Quarter Sub Window!`.
   - Recommend card renders **Recommended Line Sub** listing all `OUT` players (with current shift time) and all `IN` players (with sit time), plus `Make Line Sub (N ⇄ N)` button.
4. **Player Cards:**
   - **On-Field / On-Court:**
     - Soccer: `⚽ Goal` button + `+ 🌟 Badge`.
     - Basketball: `🏀 +1`, `🏀 +2`, `🏀 +3` buttons, `+ 🌟 Badge`, and `🚫 Foul Out`.
   - **Bench:**
     - Soccer: `REST` button + `+ 🌟 Badge`.
     - Basketball: `REST` button, `🚫 Foul Out` button, and `+ 🌟 Badge`. Players with `fouledOut: true` show a red `FOULED OUT` pill and muted card styling.
5. **Match Report & Parent Recap:**
   - Timeline entries show `P1 02:10 - Name ⚽` (Soccer) or `Q1 02:10 - Name 🏀 +2` (Basketball).
   - Top Scorers shows `Name ⚽⚽` (Soccer) or `Name 🏀 6 pts` (Basketball).
   - Parent Summary copies sport-appropriate text (`"Great basketball game today! 🏀..."` vs. `"Great soccer match today! 🐅..."`).

---

## 5. Testing Plan

1. **Unit Tests (`v4_engine.test.js`):**
   - Verify all existing v4 Soccer unit tests pass unmodified.
   - Add unit tests for `Engine.SPORTS`, `recommendBatch`, `substituteBatch` (including clock pause and `midSubDoneForPeriod`), `midQuarterSubStatus` (at 0:00, 3:30, 4:00, and after sub), `toggleFoulOut` / `foulOutAndSub`, `recordScore` (+1, +2, +3), `deleteEvent` with multi-point events, and `recapMetrics` with `fouledOut` players.
2. **End-to-End Browser Tests (`playwright_v4.test.js`):**
   - Verify all existing v4 Playwright tests pass unmodified.
   - Add Playwright E2E tests covering:
     - Switching between Soccer and Basketball in Setup with isolated `localStorage` rosters.
     - Basketball 3:30 warning banner, 4:00 mid-quarter alert, and 1-tap `Make Line Sub (N ⇄ N)`.
     - On-court `+1`, `+2`, `+3` scoring and Match Report Top Scorers / Timeline verification.
     - Marking an on-court player `🚫 Foul Out` and confirming the immediate 1-for-1 replacement modal.
