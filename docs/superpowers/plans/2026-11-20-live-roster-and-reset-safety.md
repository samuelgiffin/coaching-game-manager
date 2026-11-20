# Live Roster Management, Prorated Late Arrivals & Match Reset Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe, undoable live roster and attendance management (late arrivals with pure prorated fairness, absent/left-early tracking, shorthanded open-slot entry) and eliminate accidental match resets across both Soccer and Basketball modes.

**Architecture:** All pure state transitions and fairness math live in the embedded `Engine` module inside `soccer_sub_manager_v4.html`, keeping every operation deterministic and unit-testable via `node --test`. The UI separates everyday live roster actions (`👥 Roster` modal + inline `Not Here Yet` strip + open-slot `+ Field`/`+ Court` buttons) from match configuration and destructive resets (`⚙️ Setup` + Danger Zone), using safe `document.createElement` / `textContent` DOM manipulation (no `innerHTML` with user-controlled strings, no native `confirm()`/`alert()`).

**Tech Stack:** Single-file vanilla HTML/CSS/JS (`soccer_sub_manager_v4.html`), Node.js native test runner (`/home/samue/.nvm/versions/node/v24.14.1/bin/node --test`), Playwright E2E (`playwright_v4.test.js`).

**Spec:** `docs/superpowers/specs/2026-11-19-live-roster-and-reset-safety-design.md`

## Global Constraints

- Target app file: `soccer_sub_manager_v4.html` (must remain a self-contained offline-first single HTML file with zero external runtime dependencies).
- Full parity required for both **Soccer** (`subMode: 'rolling'`, `surfaceNoun: 'Field'`) and **Basketball** (`subMode: 'batch'`, `surfaceNoun: 'Court'`).
- Late arrivals MUST follow **pure prorated fairness from arrival time** (`fairDeltaMs = 0:00` on arrival; ranked behind teammates who waited on the bench).
- Missing players use a two-tier model: game-day **Absent / Not Here Yet / Left Early** toggle (preserves team roster week to week) + permanent **Remove from Team** (blocked when player has logged playtime, goals/points, or badges in the current match).
- Security (from `mandatory-secure-web-skills`): All new/refactored UI rendering MUST build DOM nodes using `document.createElement`, `textContent`, `setAttribute`, and `replaceChildren()` — NEVER inject user-controlled strings (such as player names) via `innerHTML`. NEVER use native `alert()`, `confirm()`, or `prompt()`.
- Preserve backward compatibility with existing v3/v4 `localStorage` data and existing passing tests in `v4_engine.test.js` and `playwright_v4.test.js` (keeping Starter/Bench button as the first `<button>` in `#draftRosterList .player-card`).
- Node binary path in this environment: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH"`.

---

## File Structure

- `soccer_sub_manager_v4.html`:
  - CSS: add `.bg-red-700`, `.danger-zone`, `.roster-modal`, `.not-here-strip` styles.
  - HTML: add `👥` header button, `#rosterModal`, `#notHereSection` below `#benchList`, remove bare `Reset` button from main footer, add Setup live-match notice & Danger Zone.
  - `<script id="engine">`: schema additions, presence helpers, prorated `times()`/`recommend()`/`recommendBatch()`, safe roster actions (`addPlayerLive`, `markPlayerArrived`, `markPlayerAbsent`, `enterField`, `removePlayerFromRoster`), non-destructive `applySetup()`, roster-aware `undo()`, prorated `recapMetrics()`.
  - `<script id="app">`: safe DOM builder helpers (`el`, `showActionModal`), `#rosterModal` rendering & handlers, inline `Not Here Yet` strip, `+ Field`/`+ Court` open-slot buttons, live sport-switch guard, Danger Zone `Reset Match`, updated `renderMatchLog` & `generateParentSummaryText`.
- `v4_engine.test.js`: unit test suites covering every Engine method and edge case across Soccer & Basketball.
- `playwright_v4.test.js`: update TEST 11c for Danger Zone and add E2E tests for Soccer live roster, Basketball live roster, Reset/sport-switch guardrails, Match Report prorating, and XSS safety.

---

### Task 1: Engine Attendance Schema, `completedPeriodsMs`, Presence Helpers & Roster-Aware Undo

**Files:**
- Modify: `soccer_sub_manager_v4.html:913-1055` (`SPORTS`, `createState`, `normalize`), `soccer_sub_manager_v4.html:1439-1488` (`advancePeriod`, `resetMatch`), `soccer_sub_manager_v4.html:1526-1542` (`undo`)
- Test: `v4_engine.test.js`

**Interfaces:**
- Produces:
  - `Engine.SPORTS.soccer.surfaceNoun === 'Field'`, `Engine.SPORTS.basketball.surfaceNoun === 'Court'`
  - `state.match.completedPeriodsMs: number`
  - `state.match.players[id]` fields: `absent: boolean`, `arrivedAtMs: number | null`, `firstArrivedAtMs: number | null`, `departedAtMs: number | null`, `presentMs: number`
  - `Engine.hasMatchActivity(state): boolean`
  - `Engine.isMatchComplete(state, now): boolean`
  - `Engine.matchElapsedMs(state, now): number`
  - `Engine.playerPresentMs(state, id, now): number`
  - `Engine.playerHasMatchData(state, id, now): boolean`
  - `Engine.undo(state, now)` restores optional `undo.roster` and `undo.starterIds` alongside `undo.match`

- [ ] **Step 1: Write the failing unit tests in `v4_engine.test.js`**

Append this test suite to the end of `v4_engine.test.js`:

```javascript
test('Live Roster Schema, Presence Helpers & Roster-Aware Undo', async (t) => {
  await t.test('SPORTS defines surfaceNoun for soccer (Field) and basketball (Court)', () => {
    assert.strictEqual(Engine.SPORTS.soccer.surfaceNoun, 'Field');
    assert.strictEqual(Engine.SPORTS.basketball.surfaceNoun, 'Court');
  });

  await t.test('normalize backfills attendance fields and completedPeriodsMs on legacy saves', () => {
    const legacy = {
      v: 4,
      sport: 'soccer',
      settings: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
      roster: [{ id: 'p1', name: 'Mason' }],
      starterIds: ['p1'],
      match: {
        period: 2,
        clock: { running: false, startedAt: null, elapsedMs: 60000 },
        players: {
          p1: { onField: true, stintStartMs: 0, periodMs: [480000, 0, 0, 0], resting: false, badges: [] }
        }
      }
    };
    const s = Engine.normalize(legacy);
    assert.strictEqual(s.match.completedPeriodsMs, 480000);
    assert.strictEqual(s.match.players.p1.absent, false);
    assert.strictEqual(s.match.players.p1.arrivedAtMs, 0);
    assert.strictEqual(s.match.players.p1.firstArrivedAtMs, 0);
    assert.strictEqual(s.match.players.p1.departedAtMs, null);
    assert.strictEqual(s.match.players.p1.presentMs, 0);
  });

  await t.test('advancePeriod accumulates exact completedPeriodsMs even when advancing early', () => {
    let s = Engine.createState('soccer');
    s.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    s.roster = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);
    // Advance period early at 5:00 (300,000 ms instead of 480,000 ms)
    s = Engine.advancePeriod(s, 300000);
    assert.strictEqual(s.match.period, 2);
    assert.strictEqual(s.match.completedPeriodsMs, 300000);
    assert.strictEqual(Engine.matchElapsedMs(s, 300000), 300000);
    assert.strictEqual(Engine.playerPresentMs(s, 'p1', 300000), 300000);
  });

  await t.test('hasMatchActivity detects clock, period, score, events, badges, and played time', () => {
    let s = Engine.createState('soccer');
    s.roster = [{ id: 'p1', name: 'A' }];
    s.starterIds = ['p1'];
    s = Engine.resetMatch(s, 0);
    assert.strictEqual(Engine.hasMatchActivity(s), false);

    const withGoal = Engine.recordScore(s, 'us', 'p1', 1, 0);
    assert.strictEqual(Engine.hasMatchActivity(withGoal), true);

    const withBadge = Engine.awardBadge(s, 'p1', 'hustle', 0);
    assert.strictEqual(Engine.hasMatchActivity(withBadge), true);

    const withClock = Engine.start(s, 1000);
    assert.strictEqual(Engine.hasMatchActivity(withClock), true);
  });

  await t.test('undo restores optional roster and starterIds while keeping clock running', () => {
    let s = Engine.createState('soccer');
    s.roster = [{ id: 'p1', name: 'A' }];
    s.starterIds = ['p1'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);
    const snapRoster = JSON.parse(JSON.stringify(s.roster));
    const snapStarters = JSON.parse(JSON.stringify(s.starterIds));
    const snapMatch = JSON.parse(JSON.stringify(s.match));

    s.roster.push({ id: 'p2', name: 'Late' });
    s.starterIds.push('p2');
    s.match.undo = { label: 'Added Late', keepClock: true, roster: snapRoster, starterIds: snapStarters, match: snapMatch };

    const undone = Engine.undo(s, 30000);
    assert.strictEqual(undone.roster.length, 1);
    assert.deepStrictEqual(undone.starterIds, ['p1']);
    assert.strictEqual(undone.match.clock.running, true);
    assert.strictEqual(Engine.clockMs(undone, 30000), 30000);
  });
});
```

- [ ] **Step 2: Run unit tests to verify they fail**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: FAIL (missing `surfaceNoun`, `completedPeriodsMs`, `hasMatchActivity`, `matchElapsedMs`, `playerPresentMs`, roster restore in `undo`).

- [ ] **Step 3: Implement schema additions, helpers, and roster-aware Undo in `soccer_sub_manager_v4.html`**

1. In `Engine.SPORTS.soccer`, add `surfaceNoun: 'Field',`. In `Engine.SPORTS.basketball`, add `surfaceNoun: 'Court',`.
2. In `Engine.createState`, add `completedPeriodsMs: 0` inside `match`.
3. In `Engine.normalize`, ensure `state.match.completedPeriodsMs` defaults to `(Math.max(1, state.match.period || 1) - 1) * (state.settings.periodMinutes || 8) * 60 * 1000` when not a number, and for each player `p` in `state.match.players`:
   ```javascript
   p.absent = Boolean(p.absent);
   if (p.arrivedAtMs === undefined) p.arrivedAtMs = p.absent ? null : 0;
   if (p.firstArrivedAtMs === undefined) p.firstArrivedAtMs = p.absent ? null : p.arrivedAtMs;
   if (p.departedAtMs === undefined) p.departedAtMs = null;
   if (typeof p.presentMs !== 'number') p.presentMs = 0;
   ```
4. Add helper methods right after `clockMs`:
   ```javascript
   hasMatchActivity: function (state) {
     if (!state || !state.match) return false;
     const m = state.match;
     if (m.period > 1) return true;
     if (m.clock && (m.clock.elapsedMs > 0 || m.clock.running)) return true;
     if (m.score && (m.score.us > 0 || m.score.them > 0)) return true;
     if (Array.isArray(m.events) && m.events.length > 0) return true;
     if (m.players) {
       for (const pid in m.players) {
         const p = m.players[pid];
         if (!p) continue;
         if (Array.isArray(p.badges) && p.badges.length > 0) return true;
         if (Array.isArray(p.periodMs) && p.periodMs.some(ms => ms > 0)) return true;
       }
     }
     return false;
   },
   isMatchComplete: function (state, now) {
     if (!state || !state.match || !state.settings) return false;
     const pMs = state.settings.periodMinutes * 60 * 1000;
     return state.match.period >= state.settings.periodCount && this.clockMs(state, now) >= pMs;
   },
   matchElapsedMs: function (state, now) {
     const completed = typeof state.match.completedPeriodsMs === 'number'
       ? state.match.completedPeriodsMs
       : (Math.max(1, state.match.period || 1) - 1) * state.settings.periodMinutes * 60 * 1000;
     return completed + this.clockMs(state, now);
   },
   playerPresentMs: function (state, id, now) {
     const p = state.match.players[id];
     if (!p) return 0;
     const mMs = this.matchElapsedMs(state, now);
     const arrivedAt = p.arrivedAtMs === undefined ? (p.absent ? null : 0) : p.arrivedAtMs;
     const activeStint = (!p.absent && arrivedAt !== null) ? Math.max(0, mMs - arrivedAt) : 0;
     return (p.presentMs || 0) + activeStint;
   },
   playerHasMatchData: function (state, id, now) {
     const p = state.match.players[id];
     if (!p) return false;
     const cMs = this.clockMs(state, now);
     if (this._rawTimes(state, id, cMs).totalMs > 0) return true;
     if (Array.isArray(p.badges) && p.badges.length > 0) return true;
     if (Array.isArray(state.match.events) && state.match.events.some(e => e.playerId === id)) return true;
     return false;
   },
   ```
5. In `Engine.advancePeriod`: update `newState.match.completedPeriodsMs = (typeof newState.match.completedPeriodsMs === 'number' ? newState.match.completedPeriodsMs : (Math.max(1, newState.match.period - 1) * newState.settings.periodMinutes * 60 * 1000)) + cMs;`.
6. In `Engine.resetMatch`: set `newState.match.completedPeriodsMs = 0;` and initialize each player with `absent: false, arrivedAtMs: 0, firstArrivedAtMs: 0, departedAtMs: null, presentMs: 0`. Also rebuild `newState.match.players = {};` before looping `newState.roster` so removed players don't linger in `match.players`.
7. In `Engine.undo`:
   ```javascript
   const undoData = newState.match.undo;
   const oldMatch = undoData.match;
   const keepClock = undoData.keepClock;
   if (Array.isArray(undoData.roster)) newState.roster = undoData.roster;
   if (Array.isArray(undoData.starterIds)) newState.starterIds = undoData.starterIds;
   newState.match = oldMatch;
   ```

- [ ] **Step 4: Run unit tests to verify all tests pass**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: ALL PASS (including all 28 baseline tests + 5 new tests).

- [ ] **Step 5: Commit**

```bash
git add soccer_sub_manager_v4.html v4_engine.test.js
git commit -m "feat(engine): add attendance presence schema, helpers, and roster-aware undo"
```

---

### Task 2: Pure Prorated Fairness Math & Soccer/Basketball Recommendation Ranking

**Files:**
- Modify: `soccer_sub_manager_v4.html` (`Engine.times`, `Engine.recommend`, `Engine.recommendBatch`)
- Test: `v4_engine.test.js`

**Interfaces:**
- Consumes: `Engine.playerPresentMs(state, id, now)`, `p.absent`
- Produces:
  - `Engine.times(state, id, now)` returns `{ periodMs, totalMs, shiftMs, satMs, presentMs, targetMs, fairDeltaMs }` using pure prorated fairness among `!absent && !resting && !fouledOut` players.
  - `Engine.recommend(state, now)` and `Engine.recommendBatch(state, now)` exclude `p.absent` players and sort `IN` by `fairDeltaMs` asc (then `periodMs` asc, `satMs` desc, `totalMs` asc, `index` asc) and `OUT` by `fairDeltaMs` desc (then `shiftMs` desc, `totalMs` desc, `index` asc).

- [ ] **Step 1: Write the failing unit tests in `v4_engine.test.js`**

Append this test suite to `v4_engine.test.js`:

```javascript
test('Pure Prorated Fairness & Late-Arrival Recommendation Ranking (Soccer + Basketball)', async (t) => {
  await t.test('late arrival enters with 0:00 fairDeltaMs and queues behind waiting bench player in Soccer', () => {
    let s = Engine.createState('soccer');
    s.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    s.roster = [
      { id: 'p1', name: 'Starter1' },
      { id: 'p2', name: 'Starter2' },
      { id: 'p3', name: 'BenchWaiter' },
      { id: 'p4', name: 'LateKid' }
    ];
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    // p4 starts absent
    s.match.players.p4.absent = true;
    s.match.players.p4.arrivedAtMs = null;
    s.match.players.p4.firstArrivedAtMs = null;

    s = Engine.start(s, 0);
    // At 3:00 (180,000 ms): p1 & p2 played 180s, p3 waited 180s (totalMs = 0), then p3 subs in for 60s so p3 has 60s played
    s = Engine.substitute(s, 'p1', 'p3', 180000);
    // At 4:00 (240,000 ms): p1=180s, p2=240s, p3=60s; now sub p1 back in so p3 is on bench with 60s played (underplayed vs 160s avg)
    s = Engine.substitute(s, 'p3', 'p1', 240000);
    // At 4:00 (240,000 ms): p4 arrives late with 0s played, 0s present
    s.match.players.p4.absent = false;
    s.match.players.p4.arrivedAtMs = 240000;
    s.match.players.p4.firstArrivedAtMs = 240000;
    s.match.players.p4.stintStartMs = 240000;

    const tLate = Engine.times(s, 'p4', 240000);
    const tWaiter = Engine.times(s, 'p3', 240000);
    assert.strictEqual(tLate.presentMs, 0);
    assert.strictEqual(tLate.targetMs, 0);
    assert.strictEqual(tLate.fairDeltaMs, 0, 'Late arrival must start at 0:00 fairDeltaMs');
    assert.strictEqual(tLate.satMs, 0, 'Late arrival satMs must start at 0:00');
    assert.ok(tWaiter.fairDeltaMs < 0, `BenchWaiter should be negative fairDeltaMs, got ${tWaiter.fairDeltaMs}`);

    // Even though p4 has totalMs=0 and p3 has totalMs=60s, p3 has negative fairDeltaMs (-100s) vs p4 (0s).
    // Clear lastSubOutId so we purely test prorated fairness ranking.
    s.match.lastSubOutId = null;
    const rec = Engine.recommend(s, 240000);
    assert.strictEqual(rec.inId, 'p3', 'Soccer recommend must pick underplayed BenchWaiter ahead of just-arrived LateKid');
  });

  await t.test('Basketball recommendBatch excludes absent players and ranks late arrival by prorated fairDeltaMs', () => {
    let s = Engine.createState('basketball');
    s.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    s.roster = [
      { id: 'p1', name: 'Steph' },
      { id: 'p2', name: 'Klay' },
      { id: 'p3', name: 'Poole' },
      { id: 'p4', name: 'LateArrival' },
      { id: 'p5', name: 'StillAbsent' }
    ];
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    s.match.players.p4.absent = true;
    s.match.players.p4.arrivedAtMs = null;
    s.match.players.p4.firstArrivedAtMs = null;
    s.match.players.p5.absent = true;
    s.match.players.p5.arrivedAtMs = null;
    s.match.players.p5.firstArrivedAtMs = null;

    s = Engine.start(s, 0);
    // Only p3 is on bench at 2:00 (p4 & p5 absent) -> batch should swap 1 pair (only p3)
    const batchBefore = Engine.recommendBatch(s, 120000);
    assert.deepStrictEqual(batchBefore.inIds, ['p3']);

    // Give p3 30s of play then put back on bench at 3:00 so p3 has 30s played (still strongly underplayed)
    s = Engine.substitute(s, 'p1', 'p3', 120000);
    s = Engine.substitute(s, 'p3', 'p1', 150000);

    // At 3:00 (180,000 ms), p4 arrives late (0s played, 0:00 fairDeltaMs), p5 remains absent
    s.match.players.p4.absent = false;
    s.match.players.p4.arrivedAtMs = 180000;
    s.match.players.p4.firstArrivedAtMs = 180000;
    s.match.players.p4.stintStartMs = 180000;

    const batchAfter = Engine.recommendBatch(s, 180000);
    assert.deepStrictEqual(batchAfter.inIds, ['p3', 'p4'], 'Poole (underplayed) must rank first ahead of LateArrival, and StillAbsent excluded');
  });

  await t.test('shorthanded start (4 of 5) keeps all 4 active players at 0:00 fairDeltaMs', () => {
    let s = Engine.createState('soccer');
    s.settings = { fieldSize: 5, periodMinutes: 8, periodCount: 4 };
    s.roster = ['p1', 'p2', 'p3', 'p4'].map(id => ({ id, name: id }));
    s.starterIds = ['p1', 'p2', 'p3', 'p4'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);

    const t1 = Engine.times(s, 'p1', 180000);
    assert.strictEqual(t1.totalMs, 180000);
    assert.strictEqual(t1.targetMs, 180000);
    assert.strictEqual(t1.fairDeltaMs, 0);
  });
});
```

- [ ] **Step 2: Run unit tests to verify they fail**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: FAIL (`fairDeltaMs` not prorated, `recommend` and `recommendBatch` pick `p4` ahead of `p3` and include absent players).

- [ ] **Step 3: Implement prorated `times()`, `recommend()`, and `recommendBatch()` in `soccer_sub_manager_v4.html`**

1. Replace `Engine.times`:
   ```javascript
   times: function (state, id, now) {
     const p = state.match.players[id];
     if (!p) return { periodMs: 0, totalMs: 0, shiftMs: 0, satMs: 0, presentMs: 0, targetMs: 0, fairDeltaMs: 0 };
     const cMs = this.clockMs(state, now);
     const own = this._rawTimes(state, id, cMs);
     const ownPresentMs = this.playerPresentMs(state, id, now);

     let totalActivePlayedMs = 0;
     let totalActivePresentMs = 0;
     let activeCount = 0;
     if (Array.isArray(state.roster)) {
       for (let i = 0; i < state.roster.length; i++) {
         const rId = state.roster[i].id;
         const rp = state.match.players[rId];
         if (!rp || rp.absent || rp.resting || rp.fouledOut) continue;
         totalActivePlayedMs += this._rawTimes(state, rId, cMs).totalMs;
         totalActivePresentMs += this.playerPresentMs(state, rId, now);
         activeCount++;
       }
     }
     let targetMs = own.totalMs;
     if (totalActivePresentMs > 0) {
       targetMs = Math.round(totalActivePlayedMs * (ownPresentMs / totalActivePresentMs));
     } else if (activeCount > 0) {
       targetMs = Math.round(totalActivePlayedMs / activeCount);
     }
     const fairDeltaMs = own.totalMs - targetMs;

     return {
       periodMs: own.periodMs,
       totalMs: own.totalMs,
       shiftMs: own.shiftMs,
       satMs: own.satMs,
       presentMs: ownPresentMs,
       targetMs,
       fairDeltaMs
     };
   },
   ```
2. Update `Engine.recommend`:
   - Remove the stale `sumTotal`/`avgTotal` loop so `t.fairDeltaMs` comes directly from `this.times(state, r.id, now)`.
   - Skip `p.absent` when collecting `inCandidates`, `nonRestingBenchCount`, and `anyBench`.
   - Sort `inCandidates`:
     ```javascript
     inCandidates.sort((a, b) => {
       if (a.id === state.match.pinnedId && b.id !== state.match.pinnedId) return -1;
       if (b.id === state.match.pinnedId && a.id !== state.match.pinnedId) return 1;
       if (a.id === state.match.lastSubOutId && b.id !== state.match.lastSubOutId) return 1;
       if (b.id === state.match.lastSubOutId && a.id !== state.match.lastSubOutId) return -1;
       const dFair = Math.round(a.t.fairDeltaMs) - Math.round(b.t.fairDeltaMs);
       if (dFair !== 0) return dFair;
       if (a.t.periodMs !== b.t.periodMs) return a.t.periodMs - b.t.periodMs;
       if (a.t.satMs !== b.t.satMs) return b.t.satMs - a.t.satMs;
       if (a.t.totalMs !== b.t.totalMs) return a.t.totalMs - b.t.totalMs;
       return a.index - b.index;
     });
     ```
   - Sort `outCandidates`:
     ```javascript
     outCandidates.sort((a, b) => {
       const aShort = a.t.shiftMs < MIN_SHIFT_MS;
       const bShort = b.t.shiftMs < MIN_SHIFT_MS;
       if (aShort && !bShort) return 1;
       if (!aShort && bShort) return -1;
       const dFair = Math.round(b.t.fairDeltaMs) - Math.round(a.t.fairDeltaMs);
       if (dFair !== 0) return dFair;
       if (a.t.shiftMs !== b.t.shiftMs) return b.t.shiftMs - a.t.shiftMs;
       if (a.t.totalMs !== b.t.totalMs) return b.t.totalMs - a.t.totalMs;
       return a.index - b.index;
     });
     ```
3. Update `Engine.recommendBatch` identically:
   - Exclude `p.absent` from `inCandidates`, `eligibleBenchCount`, and `anyBench`.
   - Sort `inCandidates` by `pinnedId`, `Math.round(a.t.fairDeltaMs) - Math.round(b.t.fairDeltaMs)`, `a.t.periodMs - b.t.periodMs`, `b.t.satMs - a.t.satMs`, `a.t.totalMs - b.t.totalMs`, `a.index - b.index`.
   - Sort `outCandidates` by `Math.round(b.t.fairDeltaMs) - Math.round(a.t.fairDeltaMs)`, `b.t.shiftMs - a.t.shiftMs`, `b.t.totalMs - a.t.totalMs`, `a.index - b.index`.

- [ ] **Step 4: Run unit tests to verify all pass**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add soccer_sub_manager_v4.html v4_engine.test.js
git commit -m "feat(engine): implement pure prorated fairness math for soccer and basketball recommendations"
```

---

### Task 3: Safe Live Roster Actions & Non-Destructive `applySetup`

**Files:**
- Modify: `soccer_sub_manager_v4.html` (`Engine.addPlayerLive`, `Engine.markPlayerArrived`, `Engine.markPlayerAbsent`, `Engine.enterField`, `Engine.removePlayerFromRoster`, `Engine.applySetup`)
- Test: `v4_engine.test.js`

**Interfaces:**
- Consumes: `hasMatchActivity`, `matchElapsedMs`, `playerHasMatchData`, roster-aware `undo`
- Produces:
  - `Engine.addPlayerLive(state, name, opts = {}, now) -> { ok, state, playerId?, errors }`
  - `Engine.markPlayerArrived(state, playerId, opts = {}, now) -> newState`
  - `Engine.markPlayerAbsent(state, playerId, subInId = null, now) -> newState`
  - `Engine.enterField(state, playerId, now) -> newState`
  - `Engine.removePlayerFromRoster(state, playerId, now) -> { ok, state, reason?, errors }`
  - `Engine.applySetup(state, draft, now) -> { ok, state, errors }` (accepts optional `draft.absentIds: string[]`, never calls `resetMatch()` or fails `starterIds` validation mid-game)

- [ ] **Step 1: Write the failing unit tests in `v4_engine.test.js`**

Append this test suite to `v4_engine.test.js`:

```javascript
test('Safe Live Roster Actions & Non-Destructive Setup', async (t) => {
  await t.test('addPlayerLive adds late player to bench or open field/court slot without resetting match', () => {
    let s = Engine.createState('soccer');
    s.settings = { fieldSize: 5, periodMinutes: 8, periodCount: 4 };
    s.roster = ['p1', 'p2', 'p3', 'p4'].map(id => ({ id, name: id.toUpperCase() }));
    s.starterIds = ['p1', 'p2', 'p3', 'p4'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);
    s = Engine.recordScore(s, 'us', 'p1', 1, 60000);

    // Duplicate rejected
    const dup = Engine.addPlayerLive(s, 'p1', {}, 120000);
    assert.strictEqual(dup.ok, false);

    // Add 5th player straight onto open Field slot at 2:00 (120,000 ms)
    const res = Engine.addPlayerLive(s, 'Sam', { putOnField: true }, 120000);
    assert.strictEqual(res.ok, true);
    s = res.state;
    const pSam = s.match.players[res.playerId];
    assert.strictEqual(pSam.onField, true);
    assert.strictEqual(pSam.arrivedAtMs, 120000);
    assert.strictEqual(pSam.firstArrivedAtMs, 120000);
    assert.strictEqual(pSam.stintStartMs, 120000);
    assert.strictEqual(s.match.score.us, 1, 'Score must remain intact');
    assert.strictEqual(s.match.clock.running, true, 'Clock must keep running');

    // Adding 6th player with putOnField=true while already 5/5 puts them on bench safely
    const res6 = Engine.addPlayerLive(s, 'Alex', { putOnField: true }, 130000);
    assert.strictEqual(res6.ok, true);
    assert.strictEqual(res6.state.match.players[res6.playerId].onField, false);

    // Undo restores roster without stopping clock
    const undone = Engine.undo(res6.state, 140000);
    assert.strictEqual(undone.roster.length, 5);
    assert.strictEqual(undone.match.clock.running, true);
  });

  await t.test('markPlayerArrived, markPlayerAbsent (bench / swap / leave-open) and enterField work cleanly', () => {
    let s = Engine.createState('basketball');
    s.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    s.roster = [
      { id: 'p1', name: 'Steph' },
      { id: 'p2', name: 'Klay' },
      { id: 'p3', name: 'Poole' }
    ];
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    // Mark p3 absent pre-game
    s = Engine.markPlayerAbsent(s, 'p3', null, 0);
    assert.strictEqual(s.match.players.p3.absent, true);
    assert.strictEqual(s.match.players.p3.departedAtMs, null);

    s = Engine.start(s, 0);
    // At 2:00, p2 leaves early with no replacement -> leaves court slot open (1/2)
    s = Engine.markPlayerAbsent(s, 'p2', null, 120000);
    assert.strictEqual(s.match.players.p2.absent, true);
    assert.strictEqual(s.match.players.p2.onField, false);
    assert.strictEqual(s.match.players.p2.periodMs[0], 120000);
    assert.strictEqual(s.match.players.p2.presentMs, 120000);
    assert.strictEqual(s.match.players.p2.departedAtMs, 120000);

    // At 3:00, p3 arrives late onto Bench, then enters open Court slot via enterField
    s = Engine.markPlayerArrived(s, 'p3', { putOnField: false }, 180000);
    assert.strictEqual(s.match.players.p3.absent, false);
    assert.strictEqual(s.match.players.p3.onField, false);
    assert.strictEqual(s.match.players.p3.arrivedAtMs, 180000);

    s = Engine.enterField(s, 'p3', 190000);
    assert.strictEqual(s.match.players.p3.onField, true);
    assert.strictEqual(s.match.players.p3.stintStartMs, 190000);

    // p2 returns later at 4:00 (240,000 ms) -> presentMs preserved + new stint begins
    s = Engine.markPlayerArrived(s, 'p2', { putOnField: false }, 240000);
    assert.strictEqual(s.match.players.p2.absent, false);
    assert.strictEqual(s.match.players.p2.departedAtMs, null);
    assert.strictEqual(Engine.playerPresentMs(s, 'p2', 300000), 180000, '120s initial + 60s after return');

    // p1 leaves early with p2 atomically subbed in at 5:00
    s = Engine.markPlayerAbsent(s, 'p1', 'p2', 300000);
    assert.strictEqual(s.match.players.p1.absent, true);
    assert.strictEqual(s.match.players.p1.onField, false);
    assert.strictEqual(s.match.players.p2.onField, true);
  });

  await t.test('removePlayerFromRoster blocks players with match stats and supports undo when removable', () => {
    let s = Engine.createState('soccer');
    s.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    s.roster = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }];
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);

    // p1 has playtime at 60s -> blocked
    const blocked = Engine.removePlayerFromRoster(s, 'p1', 60000);
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.reason, 'has-match-data');

    // p3 sat on bench with 0 playtime/goals/badges -> removable & undoable
    const removed = Engine.removePlayerFromRoster(s, 'p3', 60000);
    assert.strictEqual(removed.ok, true);
    assert.strictEqual(removed.state.roster.length, 2);

    const restored = Engine.undo(removed.state, 65000);
    assert.strictEqual(restored.roster.length, 3);
    assert.ok(restored.match.players.p3);
  });

  await t.test('applySetup mid-game never fails starterIds validation and never resets match', () => {
    let s = Engine.createState('soccer');
    s.settings = { fieldSize: 5, periodMinutes: 8, periodCount: 4 };
    s.roster = ['p1', 'p2', 'p3', 'p4'].map(id => ({ id, name: id.toUpperCase() }));
    s.starterIds = ['p1', 'p2', 'p3', 'p4'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);
    s = Engine.recordScore(s, 'us', 'p1', 1, 60000);

    // Adding a 5th player via applySetup mid-game with starterIds still length 4 MUST succeed without resetting!
    const draft = {
      sport: 'soccer',
      fieldSize: 5,
      periodMinutes: 8,
      periodCount: 4,
      roster: [...s.roster, { id: 'p5', name: 'Late5' }],
      starterIds: ['p1', 'p2', 'p3', 'p4']
    };
    const res = Engine.applySetup(s, draft, 120000);
    assert.strictEqual(res.ok, true, `Expected applySetup mid-game to succeed, errors: ${JSON.stringify(res.errors)}`);
    assert.strictEqual(res.state.roster.length, 5);
    assert.strictEqual(res.state.match.score.us, 1);
    assert.strictEqual(res.state.match.players.p5.arrivedAtMs, 120000);
    assert.strictEqual(res.state.match.players.p5.onField, false);
  });

  await t.test('applySetup pre-kickoff respects absentIds without requiring absent players as starters', () => {
    let s = Engine.createState('soccer');
    const draft = {
      sport: 'soccer',
      fieldSize: 5,
      periodMinutes: 8,
      periodCount: 4,
      roster: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
        { id: 'p3', name: 'C' },
        { id: 'p4', name: 'D' },
        { id: 'p5', name: 'AbsentKid' }
      ],
      starterIds: ['p1', 'p2', 'p3', 'p4'],
      absentIds: ['p5']
    };
    const res = Engine.applySetup(s, draft, 0);
    assert.strictEqual(res.ok, true, `Expected pre-kickoff Setup with 1 absent to pass, errors: ${JSON.stringify(res.errors)}`);
    assert.strictEqual(res.state.match.players.p5.absent, true);
    assert.strictEqual(res.state.match.players.p5.arrivedAtMs, null);
    assert.strictEqual(res.state.match.players.p1.onField, true);
  });
});
```

- [ ] **Step 2: Run unit tests to verify they fail**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: FAIL (`addPlayerLive`, `markPlayerArrived`, `markPlayerAbsent`, `enterField`, `removePlayerFromRoster` not defined; `applySetup` fails starter check).

- [ ] **Step 3: Implement the 5 safe Engine actions and non-destructive `applySetup` in `soccer_sub_manager_v4.html`**

Add these methods to `Engine` right before `applySetup`:

```javascript
_countOnField: function (state) {
  let c = 0;
  for (const r of state.roster) {
    const p = state.match.players[r.id];
    if (p && p.onField && !p.absent) c++;
  }
  return c;
},
addPlayerLive: function (state, name, opts = {}, now) {
  const trimmed = String(name || '').trim();
  const errors = [];
  if (state.roster.length >= 18) errors.push('Roster limit reached (max 18 players)');
  if (trimmed.length < 1 || trimmed.length > 20) errors.push('Player name must be 1–20 characters');
  if (state.roster.some(r => r.name.trim().toLowerCase() === trimmed.toLowerCase())) {
    errors.push(`Duplicate name: ${trimmed}`);
  }
  if (errors.length > 0) return { ok: false, state, errors };

  const newState = JSON.parse(JSON.stringify(state));
  const cMs = this.clockMs(state, now);
  const mMs = this.matchElapsedMs(state, now);
  const absent = Boolean(opts && opts.absent);
  const onFieldCount = this._countOnField(state);
  const putOnField = !absent && Boolean(opts && opts.putOnField) && onFieldCount < state.settings.fieldSize;
  const id = this.generateId();
  const sportCfg = this.getSportConfig(state);

  newState.match.undo = {
    label: `Added ${trimmed}${putOnField ? ` → ${sportCfg.surfaceNoun}` : ''}`,
    keepClock: true,
    roster: JSON.parse(JSON.stringify(state.roster)),
    starterIds: JSON.parse(JSON.stringify(state.starterIds || [])),
    match: JSON.parse(JSON.stringify(state.match))
  };

  newState.roster.push({ id, name: trimmed });
  if (!this.hasMatchActivity(state) && putOnField && !newState.starterIds.includes(id)) {
    newState.starterIds.push(id);
  }
  newState.match.players[id] = {
    onField: putOnField,
    stintStartMs: cMs,
    periodMs: Array(newState.settings.periodCount).fill(0),
    resting: false,
    fouledOut: false,
    absent,
    arrivedAtMs: absent ? null : mMs,
    firstArrivedAtMs: absent ? null : mMs,
    departedAtMs: null,
    presentMs: 0,
    badges: []
  };
  return { ok: true, state: newState, playerId: id, errors: [] };
},
markPlayerArrived: function (state, playerId, opts = {}, now) {
  const p = state.match.players[playerId];
  const r = state.roster.find(x => x.id === playerId);
  if (!p || !r || !p.absent) return state;

  const newState = JSON.parse(JSON.stringify(state));
  const cMs = this.clockMs(state, now);
  const mMs = this.matchElapsedMs(state, now);
  const onFieldCount = this._countOnField(state);
  const putOnField = Boolean(opts && opts.putOnField) && onFieldCount < state.settings.fieldSize;
  const sportCfg = this.getSportConfig(state);

  newState.match.undo = {
    label: `${r.name} Arrived${putOnField ? ` → ${sportCfg.surfaceNoun}` : ''}`,
    keepClock: true,
    starterIds: JSON.parse(JSON.stringify(state.starterIds || [])),
    match: JSON.parse(JSON.stringify(state.match))
  };

  const target = newState.match.players[playerId];
  target.absent = false;
  target.arrivedAtMs = mMs;
  if (target.firstArrivedAtMs === null || target.firstArrivedAtMs === undefined) {
    target.firstArrivedAtMs = mMs;
  }
  target.departedAtMs = null;
  target.resting = false;
  target.stintStartMs = cMs;
  target.onField = putOnField;

  if (!this.hasMatchActivity(state) && putOnField && !newState.starterIds.includes(playerId)) {
    newState.starterIds.push(playerId);
  }
  return newState;
},
markPlayerAbsent: function (state, playerId, subInId = null, now) {
  const p = state.match.players[playerId];
  const r = state.roster.find(x => x.id === playerId);
  if (!p || !r || p.absent) return state;

  const newState = JSON.parse(JSON.stringify(state));
  const cMs = this.clockMs(state, now);
  const mMs = this.matchElapsedMs(state, now);
  const activeMatch = this.hasMatchActivity(state);
  const subR = subInId ? state.roster.find(x => x.id === subInId) : null;

  newState.match.undo = {
    label: activeMatch
      ? `${r.name} Left Early${subR ? ` (⇄ ${subR.name})` : ''}`
      : `${r.name} Marked Absent`,
    keepClock: true,
    starterIds: JSON.parse(JSON.stringify(state.starterIds || [])),
    match: JSON.parse(JSON.stringify(state.match))
  };

  const target = newState.match.players[playerId];
  const arrivedAt = target.arrivedAtMs === undefined ? 0 : target.arrivedAtMs;
  if (arrivedAt !== null) {
    target.presentMs = (target.presentMs || 0) + Math.max(0, mMs - arrivedAt);
  }
  target.absent = true;
  target.arrivedAtMs = null;
  target.resting = false;
  target.departedAtMs = activeMatch ? mMs : null;

  if (target.onField) {
    target.periodMs[newState.match.period - 1] =
      (target.periodMs[newState.match.period - 1] || 0) + (cMs - target.stintStartMs);
    target.onField = false;
    target.stintStartMs = cMs;
    if (!activeMatch) {
      newState.starterIds = (newState.starterIds || []).filter(id => id !== playerId);
    }
    if (subInId) {
      const inP = newState.match.players[subInId];
      if (inP && !inP.onField && !inP.absent && !inP.fouledOut) {
        inP.onField = true;
        inP.stintStartMs = cMs;
        inP.resting = false;
        if (!activeMatch && !newState.starterIds.includes(subInId)) {
          newState.starterIds.push(subInId);
        }
        if (newState.match.pinnedId === subInId) newState.match.pinnedId = null;
        newState.match.skipIds = [];
      }
    }
  }
  if (newState.match.pinnedId === playerId) newState.match.pinnedId = null;
  newState.match.skipIds = (newState.match.skipIds || []).filter(id => id !== playerId);
  return newState;
},
enterField: function (state, playerId, now) {
  const p = state.match.players[playerId];
  const r = state.roster.find(x => x.id === playerId);
  if (!p || !r || p.onField || p.absent || p.fouledOut) return state;
  if (this._countOnField(state) >= state.settings.fieldSize) return state;

  const newState = JSON.parse(JSON.stringify(state));
  const cMs = this.clockMs(state, now);
  const sportCfg = this.getSportConfig(state);

  newState.match.undo = {
    label: `${r.name} → ${sportCfg.surfaceNoun}`,
    keepClock: true,
    starterIds: JSON.parse(JSON.stringify(state.starterIds || [])),
    match: JSON.parse(JSON.stringify(state.match))
  };

  const target = newState.match.players[playerId];
  target.onField = true;
  target.stintStartMs = cMs;
  target.resting = false;
  if (!this.hasMatchActivity(state) && !newState.starterIds.includes(playerId)) {
    newState.starterIds.push(playerId);
  }
  if (newState.match.pinnedId === playerId) newState.match.pinnedId = null;
  return newState;
},
removePlayerFromRoster: function (state, playerId, now) {
  const r = state.roster.find(x => x.id === playerId);
  if (!r) return { ok: false, state, reason: 'not-found', errors: ['Player not found'] };
  if (state.roster.length <= 1) {
    return { ok: false, state, reason: 'last-player', errors: ['Roster must have at least 1 player.'] };
  }
  if (this.playerHasMatchData(state, playerId, now)) {
    return {
      ok: false,
      state,
      reason: 'has-match-data',
      errors: [`${r.name} has recorded playtime or stats in this match. Mark them Left Early instead to keep the Match Report intact.`]
    };
  }

  const newState = JSON.parse(JSON.stringify(state));
  newState.match.undo = {
    label: `Removed ${r.name}`,
    keepClock: true,
    roster: JSON.parse(JSON.stringify(state.roster)),
    starterIds: JSON.parse(JSON.stringify(state.starterIds || [])),
    match: JSON.parse(JSON.stringify(state.match))
  };
  newState.roster = newState.roster.filter(x => x.id !== playerId);
  newState.starterIds = (newState.starterIds || []).filter(id => id !== playerId);
  delete newState.match.players[playerId];
  if (newState.match.pinnedId === playerId) newState.match.pinnedId = null;
  if (newState.match.lastSubOutId === playerId) newState.match.lastSubOutId = null;
  newState.match.skipIds = (newState.match.skipIds || []).filter(id => id !== playerId);
  return { ok: true, state: newState, errors: [] };
},
```

And update `Engine.applySetup`:

```javascript
applySetup: function (state, draft, now) {
  let errors = [];
  if (draft.fieldSize < 2 || draft.fieldSize > 11) errors.push("Field size must be 2-11");
  if (draft.periodMinutes < 1 || draft.periodMinutes > 45) errors.push("Period minutes must be 1-45");
  if (draft.periodCount !== 2 && draft.periodCount !== 4) errors.push("Period count must be 2 or 4");
  if (draft.roster.length < 1 || draft.roster.length > 18) errors.push("Roster must have 1-18 players");
  let names = new Set();
  const cleanRoster = draft.roster.map(r => ({ id: r.id, name: String(r.name || '').trim() }));
  cleanRoster.forEach(r => {
    if (r.name.length < 1 || r.name.length > 20) errors.push(`Name "${r.name}" must be 1-20 chars`);
    if (names.has(r.name.toLowerCase())) errors.push(`Duplicate name: ${r.name}`);
    names.add(r.name.toLowerCase());
  });

  const matchActive = this.hasMatchActivity(state);
  const absentSet = new Set(Array.isArray(draft.absentIds) ? draft.absentIds : []);

  if (!matchActive) {
    const presentRoster = cleanRoster.filter(r => !absentSet.has(r.id));
    const reqStarters = Math.min(draft.fieldSize, presentRoster.length);
    const validStarters = (draft.starterIds || []).filter(id => presentRoster.some(r => r.id === id));
    if (validStarters.length !== reqStarters) {
      errors.push(`Must select exactly ${reqStarters} starters`);
    }
  }

  if (errors.length > 0) return { ok: false, state, errors };
  let newState = JSON.parse(JSON.stringify(state));
  newState.sport = draft.sport || state.sport || 'soccer';

  if (!matchActive) {
    const prevUndo = state.match.undo;
    newState.settings.fieldSize = draft.fieldSize;
    newState.settings.periodMinutes = draft.periodMinutes;
    newState.settings.periodCount = draft.periodCount;
    newState.roster = cleanRoster;
    const presentIds = new Set(cleanRoster.filter(r => !absentSet.has(r.id)).map(r => r.id));
    newState.starterIds = (draft.starterIds || []).filter(id => presentIds.has(id));

    const nextPlayers = {};
    for (const r of cleanRoster) {
      const isAbsent = absentSet.has(r.id);
      const isStarter = !isAbsent && newState.starterIds.includes(r.id);
      nextPlayers[r.id] = {
        onField: isStarter,
        stintStartMs: 0,
        periodMs: Array(newState.settings.periodCount).fill(0),
        resting: false,
        fouledOut: false,
        absent: isAbsent,
        arrivedAtMs: isAbsent ? null : 0,
        firstArrivedAtMs: isAbsent ? null : 0,
        departedAtMs: null,
        presentMs: 0,
        badges: []
      };
    }
    newState.match.players = nextPlayers;
    newState.match.completedPeriodsMs = 0;
    newState.match.skipIds = [];
    newState.match.pinnedId = null;
    newState.match.lastSubOutId = null;
    // Preserve Reset Match undo if present, otherwise avoid creating stale undo on first-time setup
    newState.match.undo = (prevUndo && prevUndo.label === 'Reset Match') ? prevUndo : null;
  } else {
    const cMs = this.clockMs(newState, now);
    const mMs = this.matchElapsedMs(newState, now);
    for (const r of cleanRoster) {
      if (!newState.roster.find(ex => ex.id === r.id)) {
        newState.roster.push(r);
        newState.match.players[r.id] = {
          onField: false,
          stintStartMs: cMs,
          periodMs: Array(newState.settings.periodCount).fill(0),
          resting: false,
          fouledOut: false,
          absent: false,
          arrivedAtMs: mMs,
          firstArrivedAtMs: mMs,
          departedAtMs: null,
          presentMs: 0,
          badges: []
        };
      }
    }
  }
  return { ok: true, state: newState, errors: [] };
},
```

- [ ] **Step 4: Run unit tests to verify all pass**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add soccer_sub_manager_v4.html v4_engine.test.js
git commit -m "feat(engine): add safe undoable live roster actions and non-destructive applySetup"
```

---

### Task 4: Prorated Match Report Metrics & Full-Game Absentee Handling

**Files:**
- Modify: `soccer_sub_manager_v4.html` (`Engine.recapMetrics`)
- Test: `v4_engine.test.js`

**Interfaces:**
- Consumes: `Engine.playerPresentMs`, `Engine.matchElapsedMs`, `p.absent`, `p.firstArrivedAtMs`, `p.departedAtMs`
- Produces:
  - Each item in `recapMetrics(state, now).players` includes:
    `targetMs`, `targetDeltaMs`, `fairnessStatus` (`'equal' | 'over' | 'under' | 'absent'`), `presentMs`, `absentAllGame`, `arrivedLate`, `leftEarly`
  - Top-level `metrics.targetMs` equals the full-match equal share reference (exact parity with existing tests when everyone arrives at kickoff).

- [ ] **Step 1: Write the failing unit tests in `v4_engine.test.js`**

Append this test suite to `v4_engine.test.js`:

```javascript
test('Match Report Prorated Targets & Absentee Handling', async (t) => {
  await t.test('recapMetrics gives late arrival an individual prorated target and marks full-game absentee cleanly', () => {
    let s = Engine.createState('soccer');
    s.settings = { fieldSize: 2, periodMinutes: 10, periodCount: 2 };
    s.roster = [
      { id: 'p1', name: 'Full1' },
      { id: 'p2', name: 'Full2' },
      { id: 'p3', name: 'LateKid' },
      { id: 'p4', name: 'NoShow' }
    ];
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    s = Engine.markPlayerAbsent(s, 'p3', null, 0);
    s = Engine.markPlayerAbsent(s, 'p4', null, 0);

    s = Engine.start(s, 0);
    // p3 arrives at 5:00 (300,000 ms), plays 2:30 (150,000 ms) from 5:00 to 7:30, sits 7:30 to 10:00
    s = Engine.markPlayerArrived(s, 'p3', { putOnField: false }, 300000);
    s = Engine.substitute(s, 'p1', 'p3', 300000);
    s = Engine.substitute(s, 'p3', 'p1', 450000);

    // Evaluate at 10:00 (600,000 ms)
    const metrics = Engine.recapMetrics(s, 600000);
    const m1 = metrics.players.find(p => p.id === 'p1');
    const m3 = metrics.players.find(p => p.id === 'p3');
    const m4 = metrics.players.find(p => p.id === 'p4');

    // Present times: p1=600s, p2=600s, p3=300s (total 1500s). Total played = 1200s.
    // Prorated targets: p1=480s, p2=480s, p3=240s.
    assert.strictEqual(m1.targetMs, 480000);
    assert.strictEqual(m3.targetMs, 240000);
    assert.strictEqual(m3.arrivedLate, true);
    assert.strictEqual(m3.absentAllGame, false);
    assert.strictEqual(m3.fairnessStatus, 'equal', '150s vs 240s target is within 90s tolerance -> equal');

    assert.strictEqual(m4.absentAllGame, true);
    assert.strictEqual(m4.targetMs, 0);
    assert.strictEqual(m4.fairnessStatus, 'absent');
  });
});
```

- [ ] **Step 2: Run unit tests to verify it fails**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: FAIL (`m3.targetMs` undefined, `m4.absentAllGame` undefined).

- [ ] **Step 3: Update `Engine.recapMetrics` in `soccer_sub_manager_v4.html`**

In `Engine.recapMetrics`:
- Compute `matchElapsed = this.matchElapsedMs(state, now)`.
- Compute per-player raw `totalMs` and `presentMs = this.playerPresentMs(state, r.id, now)`.
- Define attending pool for prorating: players where `!p.resting && !p.fouledOut && (presentMs > 0 || totalMs > 0)`.
- Sum `totalPlayedMs` and `totalPresentMs` across attending players (note: for players present all game with `totalPresentMs === activeCount * matchElapsed`, this matches `totalFieldMs / activeCount`; and when everyone is full-game at `elapsed > 0`, `Math.round(totalPlayedMs * (matchElapsed / totalPresentMs))` matches `targetMs` identically, including Test 6's `480000` cap because `clockMs` caps at `periodMs`).
  - Handle `matchElapsed === 0` safely (`targetMs = 0`).
  - Handle players who were `resting` or `fouledOut`: compute their own `presentMs` and `playerTargetMs` using the same rate (`totalPlayedMs * (presentMs / totalPresentMs)` if `totalPresentMs > 0` else `0`), keeping `fouledOut` boolean as before.
- For each player metric object:
  ```javascript
  const absentAllGame = presentMs === 0 && totalMs === 0 && Boolean(p.absent);
  const firstArr = p.firstArrivedAtMs === undefined ? (p.absent ? null : 0) : p.firstArrivedAtMs;
  const arrivedLate = !absentAllGame && firstArr !== null && firstArr > 0;
  const leftEarly = !absentAllGame && Boolean(p.absent) && p.departedAtMs !== null;
  const playerTargetMs = absentAllGame
    ? 0
    : (totalPresentMs > 0 ? Math.round(totalPlayedMs * (presentMs / totalPresentMs)) : 0);
  const diff = absentAllGame ? 0 : (totalMs - playerTargetMs);
  let fairnessStatus = absentAllGame ? 'absent' : 'equal';
  if (!absentAllGame) {
    if (diff > 90000) fairnessStatus = 'over';
    else if (diff < -90000) fairnessStatus = 'under';
  }
  ```
- Set top-level `targetMs`:
  ```javascript
  const targetMs = totalPresentMs > 0 && matchElapsed > 0
    ? Math.round(totalPlayedMs * (matchElapsed / totalPresentMs))
    : 0;
  ```
  Wait: verify Test 6 (`v4_engine.test.js:490`) & Badge Test (`v4_engine.test.js:68`):
  - Badge test: `fieldSize = 2`, 3 players (`p1,p2` onField, `p3` bench), `elapsed = 600000`. `totalPlayedMs = 1200000`, `totalPresentMs = 1800000`, `matchElapsed = 600000` -> `Math.round(1200000 * 600000 / 1800000) = 400000`! Exact match!
  - Test 6: `fieldSize = 5`, 5 players all on court, `elapsed` capped at `480000`. `totalPlayedMs = 2400000`, `totalPresentMs = 2400000`, `matchElapsed = 480000` -> `480000`! Exact match!

- [ ] **Step 4: Run unit tests to verify all pass**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add soccer_sub_manager_v4.html v4_engine.test.js
git commit -m "feat(engine): compute per-player prorated targets and absentee flags in recapMetrics"
```

---

### Task 5: Safe DOM Helpers, `👥 Roster` Sheet, Inline `Not Here Yet`, Open-Slot Entry & Match Report UI

**Files:**
- Modify: `soccer_sub_manager_v4.html` (CSS styles, Header HTML, Main HTML, `#rosterModal` HTML, `<script id="app">` DOM builders, `renderRosterModal`, `renderAll`, `renderMatchLog`, `generateParentSummaryText`, click & keydown handlers)

**Interfaces:**
- Consumes: `Engine.addPlayerLive`, `Engine.markPlayerArrived`, `Engine.markPlayerAbsent`, `Engine.enterField`, `Engine.removePlayerFromRoster`, `Engine.playerHasMatchData`, `Engine.recapMetrics`, `Engine.SPORTS[sport].surfaceNoun`
- Produces:
  - Header button `button[data-action="openRoster"]`
  - Modal `#rosterModal` with `#livePlayerName`, `button[data-action="liveAddBench"]`, `button[data-action="liveAddField"]`, `#rosterErrors`, `#rosterPresentList`, `#rosterAbsentList`
  - Inline `#notHereSection` below `#benchList` with `button[data-action="toggleNotHere"]` and 1-tap `data-action="quickArrivedBench"` / `data-action="quickArrivedField"`
  - Bench open-slot button `button[data-action="enterFieldBtn"]` rendered whenever `onFieldCount < fieldSize`
  - Safe DOM helper `createEl(tag, attrs, children)` & `showActionModal(title, message, actions)` using `document.createElement` + `textContent` + `replaceChildren` (zero `innerHTML` for new UI!)

- [ ] **Step 1: Add CSS rules for `.bg-red-700`, `#rosterModal`, `.danger-zone`, `.not-here-toggle` in `soccer_sub_manager_v4.html`**

Add right after `.bg-slate-900` / `#setupModal`:

```css
.bg-red-700 {
  background-color: #b91c1c;
  color: #ffffff;
}

#rosterModal {
  position: fixed;
  inset: 0;
  background: #ffffff;
  z-index: 60;
  overflow-y: auto;
  padding: 1rem;
}

.danger-zone {
  margin-top: 1.5rem;
  padding: 0.875rem;
  border: 2px solid #b91c1c;
  border-radius: 0.75rem;
  background: #fff1f2;
}
```

- [ ] **Step 2: Update Header, Main Dashboard, and add `#rosterModal` HTML in `soccer_sub_manager_v4.html`**

1. In `<header>` (around line 715), add the `👥` Roster button next to `⚙️`:
   ```html
   <button data-action="toggleClock" id="clockBtn" class="sun-btn bg-emerald-600">START</button>
   <button data-action="openRoster" id="openRosterBtn" class="sun-btn" aria-label="Roster">👥</button>
   <button data-action="openSetup" class="sun-btn" aria-label="Setup">⚙️</button>
   ```
2. Right below `#benchList` wrapper (around line 741), add `#notHereSection`:
   ```html
   <div id="notHereSection" class="mt-4 mb-4 hidden">
     <button data-action="toggleNotHere" id="notHereToggleBtn"
       class="sun-btn w-full flex justify-between items-center bg-slate-100"
       style="min-height:42px; font-size:13px;">
       <span id="notHereToggleLabel">Not Here Yet (0)</span>
       <span id="notHereChevron">▸</span>
     </button>
     <div id="notHereList" class="card-list mt-2 hidden"></div>
   </div>
   ```
3. Add `#rosterModal` right after `#setupModal`:
   ```html
   <div id="rosterModal" class="hidden">
     <div class="max-w-md">
       <div class="flex justify-between items-center mb-2">
         <div>
           <h2 class="font-black text-xl" style="margin:0;">Roster &amp; Attendance</h2>
           <div id="rosterSummaryCount" class="text-xs font-bold text-slate-500">0 Present • 0 Absent</div>
         </div>
         <button data-action="closeRoster" class="sun-btn" aria-label="Close Roster">✕</button>
       </div>

       <div class="text-xs font-bold text-slate-500 mb-3">
         Adding, checking in, or marking players absent never resets the clock or score.
       </div>

       <div id="rosterErrors" class="hidden text-sm font-bold mb-3" style="color:#b91c1c;"></div>

       <div class="mb-4">
         <label for="livePlayerName" class="text-xs font-black uppercase block">Quick-Add Player</label>
         <div class="flex gap-2 mt-1">
           <input type="text" id="livePlayerName" class="setup-input" style="margin-top:0;" placeholder="Player name">
         </div>
         <div class="flex gap-2 mt-2">
           <button data-action="liveAddBench" id="liveAddBenchBtn" class="sun-btn bg-emerald-600 w-full" style="min-height:42px;">+ Add to Bench</button>
           <button data-action="liveAddField" id="liveAddFieldBtn" class="sun-btn bg-blue-700 w-full hidden" style="min-height:42px;">+ Add to Field</button>
         </div>
       </div>

       <div class="mb-4">
         <div class="text-xs font-black uppercase mb-2">Present (<span id="rosterPresentCount">0</span>)</div>
         <div id="rosterPresentList" class="card-list"></div>
       </div>

       <div id="rosterAbsentSection" class="mb-4 hidden">
         <div class="text-xs font-black uppercase mb-2">Not Here Yet / Absent (<span id="rosterAbsentCount">0</span>)</div>
         <div id="rosterAbsentList" class="card-list"></div>
       </div>
     </div>
   </div>
   ```

- [ ] **Step 3: Add safe DOM helpers (`createEl`, `showActionModal`), `renderRosterModal`, inline `Not Here Yet`, open-slot `+ Field`/`+ Court` buttons, and Match Report prorated UI in `<script id="app">`**

1. Add state flag `let isNotHereOpen = false;` and safe DOM helpers:
   ```javascript
   function createEl(tag, props = {}, children = []) {
     const node = document.createElement(tag);
     for (const [k, v] of Object.entries(props)) {
       if (k === 'className') node.className = v;
       else if (k === 'textContent') node.textContent = v;
       else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
       else if (k === 'dataset' && typeof v === 'object') {
         for (const [dk, dv] of Object.entries(v)) {
           if (dv !== undefined && dv !== null) node.dataset[dk] = String(dv);
         }
       } else if (v !== undefined && v !== null) {
         node.setAttribute(k, String(v));
       }
     }
     for (const child of children) {
       if (child === null || child === undefined) continue;
       node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
     }
     return node;
   }

   function showActionModal(title, msg, buttons) {
     document.getElementById('modalTitle').textContent = title;
     document.getElementById('modalMessage').textContent = msg;
     const wrap = document.getElementById('modalButtons');
     wrap.replaceChildren(...buttons.map(b => createEl('button', {
       className: `sun-btn ${b.className || ''}`.trim(),
       textContent: b.label,
       dataset: b.dataset || {}
     })));
     document.getElementById('modalOverlay').classList.remove('hidden');
   }
   ```
2. Implement `openRoster()`, `closeRoster()`, `renderRosterModal()` using ONLY `createEl` + `replaceChildren()` + `textContent`:
   - `openRoster()`: clears `#rosterErrors`, clears `#livePlayerName`, calls `renderRosterModal()`, unhides `#rosterModal`.
   - `renderRosterModal()`:
     - Computes `sportCfg`, `hasOpenSlot = Engine._countOnField(state) < state.settings.fieldSize`, `activeMatch = Engine.hasMatchActivity(state)`.
     - Updates `#liveAddFieldBtn` label to `+ Add to ${sportCfg.surfaceNoun}` and toggles `.hidden` based on `hasOpenSlot`.
     - Splits `state.roster` into `present` (`!p.absent`) and `absent` (`p.absent`).
     - Renders `#rosterPresentList` cards with player name (`textContent`), status badge (`On Field`/`On Court`, `Bench`, `Rest`, `Fouled Out`), `Absent` / `Left Early` button (`data-action="rosterMarkAbsent"`), and `🗑` Remove button (`data-action="rosterRemoveBtn"`).
     - Renders `#rosterAbsentList` cards with player name (`textContent`), optional `Left Early` tag if `p.departedAtMs !== null`, green `✓ Arrived` button (`data-action="rosterArrivedBench"`), optional `→ ${sportCfg.surfaceNoun}` button (`data-action="rosterArrivedField"`) when `hasOpenSlot`, and `🗑` Remove button (`data-action="rosterRemoveBtn"`).
3. Update `renderAll()` (and bench post-render block):
   - Skip `p.absent` players when building `fieldHtml` and `benchHtml` so absent players NEVER appear in On Field/On Court or Bench!
   - Render `#notHereSection` safely using `createEl` / `replaceChildren()`:
     - If `absentRoster.length === 0`, add `.hidden` to `#notHereSection`.
     - Otherwise unhide `#notHereSection`, update `#notHereToggleLabel` (`Not Here Yet (${absentRoster.length})`) and `#notHereChevron` (`isNotHereOpen ? '▾' : '▸'`), and render each absent player row with `✓ Arrived` (`data-action="quickArrivedBench"`) and, when `hasOpenSlot`, `→ ${sportCfg.surfaceNoun}` (`data-action="quickArrivedField"`).
   - In the bench card button enhancer (at the bottom of `<script id="app">`):
     - When `Engine._countOnField(state) < state.settings.fieldSize` and `!p.resting && !p.fouledOut`, also append a blue `+ ${sportCfg.surfaceNoun}` button (`data-action="enterFieldBtn"`, `data-id="${id}"`, `e.stopPropagation()` on click).
   - Escape player names in `renderAll()` / `renderMatchLog()` via a tiny `escHtml` helper anywhere legacy template strings remain, and build all new UI elements via `createEl` + `textContent`.
4. Update `renderMatchLog()` Playtime Summary & `generateParentSummaryText(metrics)`:
   - In `renderMatchLog()` Playtime Summary (using `createEl` + `replaceChildren()`):
     - For `p.absentAllGame`: render compact row showing player name + `Absent` pill (no underplayed bar).
     - For attending players: position `.target-line-indicator` at each player's own `playerTargetPct = Math.min(100, Math.max(0, Math.round((p.targetMs / maxMs) * 100)))`, and display subtle tags `(Late Arrival)` / `(Left Early)` / `(Fouled Out)` next to their name.
   - In `generateParentSummaryText(metrics)`:
     - Filter out `p.absentAllGame` players so full-game absentees are omitted from parent SMS text.
5. Wire click + Enter-key handlers for `#rosterModal` and inline actions:
   - `keydown` on `#livePlayerName` when `e.key === 'Enter'` triggers `handleLiveAdd(false)`.
   - `openRoster`, `closeRoster`, `toggleNotHere`, `liveAddBench`, `liveAddField`, `quickArrivedBench`, `quickArrivedField`, `rosterArrivedBench`, `rosterArrivedField`, `enterFieldBtn` (with `e.stopPropagation()`), `rosterMarkAbsent` (immediate if bench; confirmation `showActionModal` with Swap / Leave Open / Cancel if on field/court), `confirmAbsentSwap`, `confirmAbsentLeaveOpen`, `rosterRemoveBtn` (checks `playerHasMatchData` → either confirm permanent remove or prompt Mark Left Early), `confirmRemovePlayer`.
   - Also extend `dispatch()`'s manual-swap reset list to include `'markPlayerAbsent'`, `'markPlayerArrived'`, `'enterField'`, and re-render `#rosterModal` if currently open whenever state changes!

- [ ] **Step 4: Run unit tests and existing Playwright suite to verify zero regressions**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add soccer_sub_manager_v4.html
git commit -m "feat(ui): add live Roster & Attendance modal, inline Not Here Yet check-in, open-slot entry & prorated Match Report"
```

---

### Task 6: Safe `⚙️ Setup` Modal, Live Sport-Switch Guard & Reset Danger Zone

**Files:**
- Modify: `soccer_sub_manager_v4.html` (Main footer HTML, `#setupModal` HTML, `openSetup`, `renderSetup`, `saveSetup`, `switchSport`, `resetMatchConfirm`, event handlers)

**Interfaces:**
- Consumes: `Engine.hasMatchActivity`, `Engine.isMatchComplete`, `Engine.applySetup` (with `absentIds`), `showActionModal`, `openRoster`
- Produces:
  - Main dashboard footer contains ONLY `Next Period →` / `Next Quarter →` (bare `Reset` button removed).
  - `#setupModal` contains `#setupLiveNotice` (with `button[data-action="openRosterFromSetup"]`), pre-kickoff Absent & Remove buttons inside `#draftRosterList` (placed AFTER the Starter/Bench button so `:nth-child(i) button` remains the Starter toggle), and `#setupDangerZone` containing `button[data-action="resetMatchConfirm"]`.
  - Live sport switching (`hasMatchActivity && !isMatchComplete`) prompts confirmation via `showActionModal` and pauses the running clock before switching.

- [ ] **Step 1: Update Main Footer and `#setupModal` HTML in `soccer_sub_manager_v4.html`**

1. In `<main>` footer (around line 779), remove the bare `Reset` button:
   ```html
   <div class="flex gap-2 mt-4 pt-4 border-t-2">
     <button id="advancePeriodConfirmBtn" data-action="advancePeriodConfirm" class="sun-btn w-full">Next Period →</button>
   </div>
   ```
2. Inside `#setupModal`:
   - Add `#setupLiveNotice` right below `#setupErrors`:
     ```html
     <div id="setupLiveNotice" class="sun-card bg-amber-bg hidden mb-4">
       <div class="text-xs font-bold mb-2">
         Match in progress — field size, period minutes, and starters are locked so your game can't be reset. Use Roster &amp; Attendance for late arrivals or absences.
       </div>
       <button data-action="openRosterFromSetup" class="sun-btn bg-slate-900 w-full" style="min-height:40px;">
         👥 Open Roster &amp; Attendance
       </button>
     </div>
     ```
   - Add `#setupDangerZone` at the bottom of `#setupModal` (after the Save/Download row):
     ```html
     <div id="setupDangerZone" class="danger-zone">
       <div class="text-xs font-black uppercase mb-1" style="color:#b91c1c;">Danger Zone</div>
       <div class="text-xs font-bold text-slate-700 mb-2">
         Resets clock, period, score, and playtimes to zero. Your saved team roster is kept.
       </div>
       <button data-action="resetMatchConfirm" class="sun-btn bg-red-700 w-full" style="min-height:42px;">
         Reset Match
       </button>
     </div>
     ```

- [ ] **Step 2: Update `openSetup`, `renderSetup`, `saveSetup`, `switchSport`, and `resetMatchConfirm` in `<script id="app">`**

1. In `openSetup()`:
   - Build `draft.absentIds = state.roster.filter(r => state.match.players[r.id]?.absent).map(r => r.id);`.
2. In `renderSetup()`:
   - Use `const matchActive = Engine.hasMatchActivity(state);`.
   - Toggle `#setupLiveNotice` visibility based on `matchActive`.
   - Disable `#draftFieldSize` and `#draftMinutes` when `matchActive`.
   - Compute `absentSet = new Set(draft.absentIds || [])`, `presentCount = draft.roster.filter(r => !absentSet.has(r.id)).length`, `reqStarters = Math.min(draft.settings.fieldSize, presentCount)`.
   - Hide the `#setupDangerZone` only if `state.roster.length === 0` (first-time setup before any team exists).
   - Render `#draftRosterList` using `createEl` + `replaceChildren()` (no `innerHTML`!):
     - When `!matchActive`: each card shows `r.name`, then Button 1 = **Starter / Bench** (`data-action="draftToggleStarter"`, disabled when absent), Button 2 = **Absent / Present** (`data-action="draftToggleAbsent"`), Button 3 = **`🗑`** (`data-action="draftRemovePlayer"`).
     - When `matchActive`: each card shows `r.name` + read-only status label (`On Field`/`On Court`/`Bench`/`Absent`) with no misleading clickable Starter toggles.
3. Add Enter-key handler on `#draftPlayerName` too, plus click handlers for `draftToggleAbsent` (toggles `id` in `draft.absentIds` and removes `id` from `draft.starterIds` if marked absent), `draftRemovePlayer` (removes `id` from `draft.roster`, `draft.starterIds`, `draft.absentIds`), and `openRosterFromSetup` (closes Setup and opens Roster).
4. In `saveSetup()`: pass `absentIds: draft.absentIds || []` into `draftObj` for `Engine.applySetup()`.
5. In `switchSport(targetSport)`:
   - Ignore if `validTarget === state.sport`.
   - If `Engine.hasMatchActivity(state) && !Engine.isMatchComplete(state, Date.now())`:
     - Show confirmation via `showActionModal`:
       - Title: `Switch to ${targetCfg.icon} ${targetCfg.name}?`
       - Message: `Your live ${currentCfg.name} match will be paused and saved safely so you can switch back anytime.`
       - Buttons: `Cancel` (`closeModal`) and `Pause & Switch` (`confirmSwitchSport`, `data-sport="${validTarget}"`).
   - Implement `executeSwitchSport(targetSport)`: pauses `state` if `state.match.clock.running`, calls `save()`, sets `CGM_ACTIVE_SPORT`, calls `load(validTarget)`, updates `draft` (including `draft.absentIds`), calls `renderSetup()` and `renderAll()`.
6. In `resetMatchConfirm()`:
   - Build clear confirmation message using `showActionModal`:
     - If `Engine.hasMatchActivity(state)`: include live summary (`${sportCfg.periodLabel} ${state.match.period} • ${fmt(cMs)} • Score ${state.match.score.us}–${state.match.score.them} will be cleared. Your team roster is kept and Undo will be available right after.`).
     - Otherwise: `This resets the clock and play times to zero. Your team roster is kept.`
   - Confirm button uses `className: 'bg-red-700'` and `dataset: { action: 'resetMatch' }` (also closes `#setupModal` on confirm so user lands cleanly on the fresh match with the Undo bar visible!).
7. Replace legacy `confirm()` in `resetApp` with `showActionModal` (`confirmResetApp`) so zero native `confirm()` calls remain in production code.

- [ ] **Step 3: Run unit tests to verify all pass**

Run: `export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH" && node --test v4_engine.test.js`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add soccer_sub_manager_v4.html
git commit -m "feat(ui): isolate Reset Match in Setup Danger Zone and guard live sport switches"
```

---

### Task 7: Playwright E2E Tests (Soccer + Basketball) & Full Security/Regression Verification

**Files:**
- Modify: `playwright_v4.test.js`

**Interfaces:**
- Verifies all UI flows end-to-end in headless Chromium (`390x844` mobile viewport) for both Soccer and Basketball.

- [ ] **Step 1: Update TEST 11c and add TESTS 12–15 in `playwright_v4.test.js`**

1. Update **TEST 11c** (`playwright_v4.test.js:344-349`):
   - Assert bare `Reset` button is NOT in the main dashboard footer (`await page.locator('main button[data-action="resetMatchConfirm"]').count() === 0`).
   - Open Setup (`button[data-action="openSetup"]`), click `#setupDangerZone button[data-action="resetMatchConfirm"]`, confirm `#modalButtons button[data-action="resetMatch"]`, assert `#setupModal` closes and scores reset to `0 - 0`.
2. Add **TEST 12: Soccer Shorthanded Start, Live Late Arrival to Open Field Slot, Inline Not Here Yet Check-In, Left Early Swap & Undo**:
   - Clear storage & reload in Soccer mode; set up 4 starters + 1 absent (`AbsentKid`) in Setup (verifying starter count passes at 4/4!).
   - Start clock, record a goal (`Us = 1`), wait 1.1s.
   - Verify `#fieldCount` is `4/5` and `#notHereSection` is visible with `Not Here Yet (1)`.
   - Open `👥 Roster` (`button[data-action="openRoster"]`), verify `+ Add to Field` button is visible, type `LateSam`, click `liveAddField` → verify `#fieldCount` becomes `5/5`, score is still `1`, and clock is still running (`PAUSE`).
   - Close Roster, expand `#notHereToggleBtn`, click `✓ Arrived` on `AbsentKid` → verify `#benchCount` increments, `#notHereSection` hides, and `#undoBar` shows `AbsentKid Arrived`.
   - Open `👥 Roster`, mark an on-field player `Left Early` → verify confirmation modal offers Swap & Leave Open → choose Swap → verify `#fieldCount` stays `5/5`, score still `1`, and `Left Early` player moves to Absent section.
   - Verify clicking `🗑` on a player with playtime shows the stat-preservation modal instead of deleting them.
3. Add **TEST 13: Basketball Live Roster Parity (`Court` labels, `+ Court` open-slot entry, prorated batch line sub & foul-out exclusion)**:
   - Switch to Basketball (verify live Soccer match triggers the sport-switch confirmation modal and pauses Soccer's clock!).
   - Set up 4 starters + 1 bench + 1 absent (`LateBaller`) in Basketball; start clock, verify `On Court (4/5)` and bench card shows `+ Court` button (`button[data-action="enterFieldBtn"]`).
   - Click `+ Court` on the bench player → verify `On Court (5/5)` and `+ Court` disappears.
   - Check in `LateBaller` via `#notHereSection` → verify Basketball `recommendBatch` works cleanly and `👥 Roster` uses `Court` labels.
4. Add **TEST 14: Match Report Prorated Gauges, Absentee Exclusion & XSS Safety**:
   - Add a player named `<img src=x onerror=window.__xss=1>` via `👥 Roster` (`+ Add to Bench`) and verify `window.__xss` is `undefined` and the literal text is rendered safely in both Roster and Match Report.
   - Verify a full-game absent player displays `Absent` in `#logPlaytime` and is omitted from `generateParentSummaryText()`.

- [ ] **Step 2: Run both unit tests and Playwright E2E suite**

Run:
```bash
export PATH="/home/samue/.nvm/versions/node/v24.14.1/bin:$PATH"
node --test v4_engine.test.js && node playwright_v4.test.js
```
Expected: ALL unit tests PASS and ALL Playwright E2E tests (1–14) PASS with zero console/page errors!

- [ ] **Step 3: Security Verification Check**

Verify all `mandatory-secure-web-skills` requirements on our changes:
1. Grep `soccer_sub_manager_v4.html` to confirm zero `confirm(`, `alert(`, or `prompt(` calls remain in production `<script id="app">`.
2. Confirm every new DOM renderer (`renderRosterModal`, `renderNotHere`, `renderSetup`, `showActionModal`, updated Playtime Summary) uses `createEl` / `textContent` / `replaceChildren()` with zero `innerHTML` interpolation of user input.
3. Confirm TEST 14's XSS payload player name (`<img src=x onerror=window.__xss=1>`) executes zero script in Chromium across Roster, Bench, Setup, and Match Report.
4. Confirm existing CSP meta tag remains intact and no external network resources were introduced.

- [ ] **Step 4: Commit**

```bash
git add playwright_v4.test.js soccer_sub_manager_v4.html
git commit -m "test(e2e): add Soccer & Basketball live roster, reset safety, prorating & XSS E2E tests"
```
