# Multi-Sport Support (Soccer & Basketball) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `soccer_sub_manager_v4.html` to support both Soccer and Basketball interchangeably with isolated per-sport storage profiles, Basketball multi-player equal-time Line Swaps, 3:30/4:00 mid-quarter sub alerts, a Fouled-Out flag with 1-tap replacement prompts, +1/+2/+3 scoring, and sport-specific badges/terminology.

**Architecture:** Single-file HTML/CSS/JS application (`soccer_sub_manager_v4.html`) with a deterministic pure-function `Engine` (`<script id="engine">`) and DOM controller (`<script id="app">`). `Engine.SPORTS` provides declarative metadata and rules for `'soccer'` and `'basketball'`. Storage is isolated per sport via `SSM_V3` (Soccer) and `CGM_BASKETBALL_V1` (Basketball) plus `CGM_ACTIVE_SPORT`.

**Tech Stack:** Vanilla HTML5, CSS3, ES2022 JavaScript, Node.js built-in test runner (`node --test v4_engine.test.js`), and Playwright (`node playwright_v4.test.js`).

**Spec:** `docs/superpowers/specs/2026-11-05-multi-sport-basketball-design.md`

## Global Constraints

- Zero external runtime dependencies; strict Content-Security-Policy (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`) must remain intact.
- Backward compatibility: All existing Soccer v4 unit tests in `v4_engine.test.js` and Playwright E2E tests in `playwright_v4.test.js` must continue to pass without modification to their assertions.
- Pure engine methods: Every `Engine` method must remain pure (no DOM or `localStorage` access inside `<script id="engine">`).

---

### Task 1: Engine `SPORTS` Registry, State Schema (`sport`, `fouledOut`, `midSubDoneForPeriod`), Multi-Point Scoring & Badges

**Files:**
- Modify: `soccer_sub_manager_v4.html:879-1336`
- Test: `v4_engine.test.js`

**Interfaces:**
- Produces:
  - `Engine.SPORTS` (`{ soccer: {...}, basketball: {...} }`)
  - `Engine.getSportConfig(stateOrSport)`
  - `Engine.createState(sport = 'soccer')` -> initializes `sport`, `match.midSubDoneForPeriod: 0`
  - `Engine.normalize(raw)` -> preserves `sport` (defaults to `'soccer'`), sets `fouledOut: Boolean(p.fouledOut)` on players, sets `midSubDoneForPeriod`, normalizes event `points`
  - `Engine.recordScore(state, team, playerId, points, now)` & `Engine.recordGoal(state, team, playerId, now)`
  - `Engine.deleteEvent(state, eventId)` -> subtracts `evt.points || 1`
  - Expanded `Engine.BADGE_MAP` with Basketball badges (`defense`, `rebound`, `shot`)

- [ ] **Step 1: Write the failing unit tests in `v4_engine.test.js`**

Append a new test block to `v4_engine.test.js`:

```javascript
test('Engine Multi-Sport Config, Schema & Multi-Point Scoring', async (t) => {
  await t.test('SPORTS registry defines soccer and basketball configs', () => {
    assert.ok(Engine.SPORTS.soccer);
    assert.ok(Engine.SPORTS.basketball);
    assert.strictEqual(Engine.SPORTS.soccer.subMode, 'rolling');
    assert.strictEqual(Engine.SPORTS.basketball.subMode, 'batch');
    assert.deepStrictEqual(Engine.SPORTS.basketball.scoreIncrements, [1, 2, 3]);
  });

  await t.test('createState and normalize support sport, fouledOut, and midSubDoneForPeriod', () => {
    const bState = Engine.createState('basketball');
    assert.strictEqual(bState.sport, 'basketball');
    assert.strictEqual(bState.match.midSubDoneForPeriod, 0);

    const normalized = Engine.normalize({
      v: 4,
      sport: 'basketball',
      settings: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
      roster: [{ id: 'p1', name: 'Jordan' }],
      starterIds: ['p1'],
      match: {
        period: 1,
        clock: { running: false, startedAt: null, elapsedMs: 0 },
        players: {
          p1: { onField: true, stintStartMs: 0, periodMs: [0, 0, 0, 0], resting: false }
        }
      }
    });
    assert.strictEqual(normalized.sport, 'basketball');
    assert.strictEqual(normalized.match.players.p1.fouledOut, false);
    assert.strictEqual(normalized.match.midSubDoneForPeriod, 0);
  });

  await t.test('recordScore and deleteEvent handle +1, +2, +3 points and backward-compatible recordGoal', () => {
    let state = Engine.createState('basketball');
    state.roster = [{ id: 'p1', name: 'Steph' }];
    state.starterIds = ['p1'];
    state = Engine.resetMatch(state, 0);

    state = Engine.recordScore(state, 'us', 'p1', 3, 1000);
    state = Engine.recordScore(state, 'us', 'p1', 2, 2000);
    state = Engine.recordScore(state, 'them', null, 1, 3000);
    assert.strictEqual(state.match.score.us, 5);
    assert.strictEqual(state.match.score.them, 1);
    assert.strictEqual(state.match.events.length, 3);
    assert.strictEqual(state.match.events[0].points, 3);

    // Delete the 3-pointer
    const threePtId = state.match.events[0].id;
    state = Engine.deleteEvent(state, threePtId);
    assert.strictEqual(state.match.score.us, 2);
    assert.strictEqual(state.match.events.length, 2);
  });

  await t.test('Basketball badges can be awarded and counted in recapMetrics', () => {
    let state = Engine.createState('basketball');
    state.roster = [{ id: 'p1', name: 'Steph' }];
    state.starterIds = ['p1'];
    state = Engine.resetMatch(state, 0);

    state = Engine.awardBadge(state, 'p1', 'rebound', 1000);
    state = Engine.awardBadge(state, 'p1', 'shot', 2000);
    state = Engine.awardBadge(state, 'p1', 'defense', 3000);

    const metrics = Engine.recapMetrics(state, 3000);
    assert.strictEqual(metrics.totalBadges, 3);
    assert.strictEqual(metrics.players[0].badgeCounts.rebound, 1);
    assert.strictEqual(metrics.players[0].badgeCounts.shot, 1);
    assert.strictEqual(metrics.players[0].badgeCounts.defense, 1);
  });
});
```

- [ ] **Step 2: Run unit tests to verify the new test fails**

Run: `node --test v4_engine.test.js`
Expected: FAIL (`Engine.SPORTS` is undefined)

- [ ] **Step 3: Implement `SPORTS`, updated `createState`/`normalize`, `recordScore`/`deleteEvent`, and expanded `BADGE_MAP` in `soccer_sub_manager_v4.html`**

Update `Engine` in `soccer_sub_manager_v4.html` so that:
- `SPORTS` defines `soccer` and `basketball` per spec Section 2.1.
- `getSportConfig(stateOrSport)` returns `this.SPORTS[sport] || this.SPORTS.soccer`.
- `createState(sport = 'soccer')` initializes `sport: sport === 'basketball' ? 'basketball' : 'soccer'` and `match.midSubDoneForPeriod: 0`.
- `normalize(raw)` preserves `raw.sport === 'basketball' ? 'basketball' : 'soccer'`, ensures `p.fouledOut = Boolean(p.fouledOut)`, ensures `state.match.midSubDoneForPeriod = state.match.midSubDoneForPeriod || 0`, and normalizes `evt.points = evt.points || 1`.
- `resetMatch` initializes `fouledOut: false` on each player and resets `midSubDoneForPeriod: 0`, `score: { us: 0, them: 0 }`, `events: []` if needed (preserving existing resetMatch semantics for players/period/clock).
- `recordScore(state, team, playerId, points = 1, now)` adds `numPoints = Number(points) || 1` to `state.match.score[team]` and records `points: numPoints` on the event; `recordGoal(state, team, playerId, now)` calls `this.recordScore(state, team, playerId, 1, now)`.
- `deleteEvent(state, eventId)` subtracts `evt.points || 1` from `state.match.score.us` or `state.match.score.them`.
- `BADGE_MAP` includes `hustle`, `save`, `pass`, `kick`, `teammate`, `defense`, `rebound`, `shot`, and `recapMetrics` initializes `badgeCounts` with all keys in `BADGE_MAP` plus `pointsScored` and `fouledOut` per player.

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `node --test v4_engine.test.js`
Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add soccer_sub_manager_v4.html v4_engine.test.js
git commit -m "feat(engine): add SPORTS registry, multi-point scoring, and basketball badges"
```

---

### Task 2: Engine Basketball Line Swap (`recommendBatch`, `substituteBatch`), Mid-Quarter Alerts (`midQuarterSubStatus`), and Foul-Out (`toggleFoulOut`, `foulOutAndSub`)

**Files:**
- Modify: `soccer_sub_manager_v4.html:982-1336`
- Test: `v4_engine.test.js`

**Interfaces:**
- Consumes: `Engine.createState`, `Engine.times`, `Engine.clockMs`, `Engine.pause`
- Produces:
  - `Engine.recommendBatch(state, now)` -> `{ outIds, inIds, pairs, status }`
  - `Engine.substituteBatch(state, outIds, inIds, now)` -> swaps all pairs, pauses clock, records undo, updates `midSubDoneForPeriod` if at/after warning window
  - `Engine.midQuarterSubStatus(state, now)` -> `'none' | 'upcoming' | 'warning' | 'due' | 'done'`
  - `Engine.dismissMidSub(state)` -> marks `midSubDoneForPeriod = state.match.period`
  - `Engine.toggleFoulOut(state, playerId, now)` -> toggles `fouledOut`, unpins if needed, records undo
  - `Engine.foulOutAndSub(state, outId, inId, now)` -> marks `outId` fouledOut and substitutes `inId` in one atomic undoable action

- [ ] **Step 1: Write the failing unit tests in `v4_engine.test.js`**

Append a new test block to `v4_engine.test.js`:

```javascript
test('Engine Basketball Line Swap, Mid-Quarter Alert & Foul-Out', async (t) => {
  await t.test('recommendBatch selects pure equal-time wave swap (lowest totalMs IN, highest totalMs OUT)', () => {
    let state = Engine.createState('basketball');
    state.settings = { fieldSize: 5, periodMinutes: 8, periodCount: 4 };
    state.roster = [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
      { id: 'p3', name: 'P3' },
      { id: 'p4', name: 'P4' },
      { id: 'p5', name: 'P5' },
      { id: 'p6', name: 'P6' },
      { id: 'p7', name: 'P7' },
      { id: 'p8', name: 'P8' }
    ];
    state.starterIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    state = Engine.resetMatch(state, 0);

    // Give p1, p2, p3 more prior play time so they are top candidates to come OUT
    state.match.players.p1.periodMs[0] = 120000;
    state.match.players.p2.periodMs[0] = 100000;
    state.match.players.p3.periodMs[0] = 80000;

    const batch = Engine.recommendBatch(state, 240000);
    assert.strictEqual(batch.status, 'ok');
    assert.strictEqual(batch.inIds.length, 3);
    assert.strictEqual(batch.outIds.length, 3);
    assert.deepStrictEqual(batch.inIds, ['p6', 'p7', 'p8']);
    assert.deepStrictEqual(batch.outIds, ['p1', 'p2', 'p3']);
  });

  await t.test('substituteBatch swaps all pairs, pauses clock, sets undo, and marks midSubDoneForPeriod', () => {
    let state = Engine.createState('basketball');
    state.settings = { fieldSize: 5, periodMinutes: 8, periodCount: 4 };
    state.roster = [
      { id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }, { id: 'p3', name: 'P3' },
      { id: 'p4', name: 'P4' }, { id: 'p5', name: 'P5' }, { id: 'p6', name: 'P6' },
      { id: 'p7', name: 'P7' }
    ];
    state.starterIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    state = Engine.resetMatch(state, 0);
    state = Engine.start(state, 0);

    // At 4:00 (240,000 ms), execute line swap of 2 players
    state = Engine.substituteBatch(state, ['p1', 'p2'], ['p6', 'p7'], 240000);
    assert.strictEqual(state.match.clock.running, false, 'Clock must pause on basketball batch sub');
    assert.strictEqual(state.match.players.p1.onField, false);
    assert.strictEqual(state.match.players.p2.onField, false);
    assert.strictEqual(state.match.players.p6.onField, true);
    assert.strictEqual(state.match.players.p7.onField, true);
    assert.strictEqual(state.match.midSubDoneForPeriod, 1);
    assert.ok(state.match.undo.label.includes('Line Sub'));
  });

  await t.test('midQuarterSubStatus transitions from upcoming -> warning (3:30) -> due (4:00) -> done', () => {
    let state = Engine.createState('basketball');
    state.settings = { fieldSize: 5, periodMinutes: 8, periodCount: 4 };
    state.roster = [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }];
    state.starterIds = ['p1'];
    state = Engine.resetMatch(state, 0);
    state = Engine.start(state, 0);

    assert.strictEqual(Engine.midQuarterSubStatus(state, 60000), 'upcoming'); // 1:00
    assert.strictEqual(Engine.midQuarterSubStatus(state, 210000), 'warning'); // 3:30
    assert.strictEqual(Engine.midQuarterSubStatus(state, 240000), 'due');     // 4:00

    state = Engine.dismissMidSub(state);
    assert.strictEqual(Engine.midQuarterSubStatus(state, 250000), 'done');
  });

  await t.test('toggleFoulOut and foulOutAndSub exclude fouled-out players from recommendations and target share', () => {
    let state = Engine.createState('basketball');
    state.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    state.roster = [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
      { id: 'p3', name: 'P3' },
      { id: 'p4', name: 'P4' }
    ];
    state.starterIds = ['p1', 'p2'];
    state = Engine.resetMatch(state, 0);

    // Foul out bench player p3
    state = Engine.toggleFoulOut(state, 'p3', 1000);
    assert.strictEqual(state.match.players.p3.fouledOut, true);

    // Both single recommend and batch recommend should skip p3 and only pick p4
    const rec = Engine.recommend(state, 1000);
    assert.strictEqual(rec.inId, 'p4');
    const batch = Engine.recommendBatch(state, 1000);
    assert.deepStrictEqual(batch.inIds, ['p4']);

    // Foul out active player p1 and sub in p4 atomically
    state = Engine.foulOutAndSub(state, 'p1', 'p4', 2000);
    assert.strictEqual(state.match.players.p1.onField, false);
    assert.strictEqual(state.match.players.p1.fouledOut, true);
    assert.strictEqual(state.match.players.p4.onField, true);
  });
});
```

- [ ] **Step 2: Run unit tests to verify the new test fails**

Run: `node --test v4_engine.test.js`
Expected: FAIL (`Engine.recommendBatch is not a function`)

- [ ] **Step 3: Implement `recommendBatch`, `substituteBatch`, `midQuarterSubStatus`, `dismissMidSub`, `toggleFoulOut`, and `foulOutAndSub` in `soccer_sub_manager_v4.html`**

Also update `Engine.recommend` and `Engine.recapMetrics` to treat `p.fouledOut` identically to `p.resting` (ineligible to sub in, excluded from `activePlayers` denominator in `recapMetrics`).

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `node --test v4_engine.test.js`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add soccer_sub_manager_v4.html v4_engine.test.js
git commit -m "feat(engine): implement basketball batch subs, 3:30/4:00 alerts, and foul-out logic"
```

---

### Task 3: UI & Storage Integration for Multi-Sport Profiles, Basketball Line Swap, Alerts, Foul-Out & Scoring

**Files:**
- Modify: `soccer_sub_manager_v4.html:687-878` (HTML templates & styles)
- Modify: `soccer_sub_manager_v4.html:1337-2050` (App controller, storage, rendering, event delegation)
- Test: `playwright_v4.test.js`

**Interfaces:**
- Consumes: All `Engine` methods from Tasks 1 & 2.
- Produces:
  - Setup sport selector (`[data-action="selectSport"][data-sport="soccer|basketball"]`) with isolated storage (`SSM_V3` for Soccer, `CGM_BASKETBALL_V1` for Basketball, `CGM_ACTIVE_SPORT` for active sport).
  - Mid-quarter alert banner (`#midSubBanner`) showing 3:30 warning and 4:00 due prompt in Basketball mode.
  - Batch recommendation view in `#recommendCard` when `subMode === 'batch'` with `button[data-action="makeBatchSub"]`.
  - On-court `+1`, `+2`, `+3` scoring buttons (`data-action="scoreUsBtn" data-points="1|2|3"`) and opponent `+1`, `+2`, `+3` buttons (`data-action="scoreThem" data-points="1|2|3"`).
  - `🚫 Foul Out` button (`data-action="toggleFoulOutBtn"`) on player cards in Basketball mode with 1-tap replacement confirmation modal when an on-court player fouls out.
  - Dynamic labels (`On Field` vs `On Court`, `Period` vs `Quarter`, `Full Time` vs `Final`) and sport-aware Match Report + Parent Summary text.

- [ ] **Step 1: Write the failing Playwright E2E tests in `playwright_v4.test.js`**

Add a new E2E test section (Tests 7–10) in `playwright_v4.test.js` testing:
1. Switching to Basketball in Setup creates an isolated Basketball roster/match while preserving the Soccer roster when switching back.
2. Basketball mode renders `Quarter 1 / 4`, `On Court (5/5)`, `Recommended Line Sub`, 3:30 warning banner, 4:00 mid-quarter sub prompt, and executes `Make Line Sub (2 ⇄ 2)` pausing the clock.
3. Basketball `+1`, `+2`, `+3` scoring buttons update the score, timeline (`Q1 ... 🏀 +3`), Top Scorers (`pts`), Basketball badges (`🏀 Big Rebound`), and Parent Recap text (`Great basketball game today!`).
4. Clicking `🚫 Foul Out` on an on-court player opens the replacement modal and swaps in the recommended bench player while marking the fouled-out player `FOULED OUT`.

- [ ] **Step 2: Run Playwright tests to verify the new E2E tests fail**

Run: `node playwright_v4.test.js`
Expected: FAIL on Test 7 (sport selector not found)

- [ ] **Step 3: Implement HTML & App Controller updates in `soccer_sub_manager_v4.html`**

Update `soccer_sub_manager_v4.html`:
- Add Setup sport toggle buttons (`⚽ Soccer` / `🏀 Basketball`) at the top of `#setupModal`.
- Update `load()` and `save()` to use `CGM_ACTIVE_SPORT`, `SSM_V3` (Soccer), and `CGM_BASKETBALL_V1` (Basketball), plus `switchSport(targetSport)` in Setup.
- Add `#midSubBanner` in `<main>` for the 3:30 warning and 4:00 mid-quarter sub window alert.
- Render either the 1-for-1 recommendation or the multi-player Line Swap list in `#recommendCard` depending on `sportCfg.subMode`.
- Render `+1`, `+2`, `+3` scoring buttons and `🚫 Foul Out` in Basketball mode, and `⚽ Goal` in Soccer mode.
- Render sport-specific badges in the badge strip drawer (`Object.entries(sportCfg.badges)`).
- Update Match Report (`renderMatchLog`) and `generateParentSummaryText` for sport-specific terminology, points, and `(Fouled Out)` tags.

- [ ] **Step 4: Run unit and Playwright E2E tests to verify everything passes**

Run: `node --test v4_engine.test.js && node playwright_v4.test.js`
Expected: PASS (all unit tests and all 10 Playwright E2E tests pass)

- [ ] **Step 5: Commit Task 3**

```bash
git add soccer_sub_manager_v4.html playwright_v4.test.js
git commit -m "feat(ui): add multi-sport basketball UI, line swaps, 3:30/4:00 alerts, foul-out, and scoring"
```
