# Soccer Sub Manager v4 (Sportsmanship Badges & Visual Fairness Recap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `soccer_sub_manager_v4.html` to add live 1-tap sportsmanship badges for players and a parent-ready, screenshot-optimized Match Recap screen featuring an equal-play-time visual gauge and 1-tap parent SMS text generator.

**Architecture:** Extend the existing single-file architecture (`soccer_sub_manager_v3.html` -> `soccer_sub_manager_v4.html`). Pure functional engine functions in `<script id="engine">` state machine, decoupled from the DOM/Event layer in `<script id="app">`. CSS high-contrast screenshot-ready cards.

**Tech Stack:** Vanilla HTML5, Vanilla JavaScript (ES2022), Pure Vanilla CSS, Node `node:test` + `node:vm` for zero-dependency headless unit tests.

**Spec:** [docs/specs/v4-recap-badges-fairness.md](v4-recap-badges-fairness.md)

## Global Constraints

- **Single self-contained HTML file:** No CDN, external fonts, scripts, or build steps.
- **Offline operation:** 100% offline support with CSP meta tag (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`).
- **Backward compatibility:** Migration of legacy `v3` and `v2` `localStorage` saves to `SSM_V4`.
- **Pure Engine Architecture:** Engine functions in `#engine` take `(state, ...args, now)` and return new state; no DOM or wall-clock dependencies.
- **Ergonomics:** Tap targets $\ge 48\text{px}$, high-contrast sunlight colors, haptic feedback (`navigator.vibrate(40)`).

---

### Task 1: Create `soccer_sub_manager_v4.html` Scaffold & Data Migration (Schema `v: 4`)

**Files:**
- Create: `soccer_sub_manager_v4.html` (copied from `soccer_sub_manager_v3.html`)
- Modify: `v4_engine.test.js` (create from `engine.test.js` to target `soccer_sub_manager_v4.html`)

**Interfaces:**
- Consumes: `state` schema from `v3`
- Produces: `state` schema with `v: 4`, `badges: []` per player, updated `Engine.createState()` and `Engine.normalize()`.

- [ ] **Step 1: Create `soccer_sub_manager_v4.html` and `v4_engine.test.js` failing test for `v: 4` schema**

Create `v4_engine.test.js`:
```javascript
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('./soccer_sub_manager_v4.html', 'utf8');
const scriptMatch = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error("Could not find engine script");

const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(scriptMatch[1], context);
const Engine = context.globalThis.Engine;

test('Engine v4 Schema & Migration', async (t) => {
  await t.test('createState initializes v: 4 and badge arrays', () => {
    const state = Engine.createState();
    assert.strictEqual(state.v, 4);
  });

  await t.test('normalize upgrades v3 data and ensures badges array on players', () => {
    const v3Data = {
      v: 3,
      settings: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
      roster: [{ id: 'p1', name: 'Mason' }],
      match: {
        period: 1,
        clock: { running: false, startedAt: null, elapsedMs: 0 },
        players: {
          'p1': { onField: true, stintStartMs: 0, periodMs: [0,0,0,0], resting: false }
        }
      }
    };
    const state = Engine.normalize(v3Data);
    assert.strictEqual(state.v, 4);
    assert.deepStrictEqual(state.match.players['p1'].badges, []);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test v4_engine.test.js`
Expected: FAIL (because `soccer_sub_manager_v4.html` currently has `v: 3` and no badge normalization).

- [ ] **Step 3: Implement Engine updates in `soccer_sub_manager_v4.html`**

In `soccer_sub_manager_v4.html` under `<script id="engine">`:
Update `createState`:
```javascript
createState() {
  return {
    v: 4,
    settings: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
    roster: [],
    starterIds: [],
    match: {
      period: 1,
      clock: { running: false, startedAt: null, elapsedMs: 0 },
      players: {},
      pinnedId: null,
      skipIds: [],
      undo: null
    }
  };
}
```
Update `normalize(raw)`:
```javascript
// Ensure state.v is 4
state.v = 4;
// For each player in match.players:
for (const pid in state.match.players) {
  if (!Array.isArray(state.match.players[pid].badges)) {
    state.match.players[pid].badges = [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test v4_engine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add soccer_sub_manager_v4.html v4_engine.test.js
git commit -m "feat(v4): add v4 state schema and badge data normalization"
```

---

### Task 2: Implement Engine Functions (`awardBadge`, `removeBadge`, `recapMetrics`)

**Files:**
- Modify: `soccer_sub_manager_v4.html: engine script block`
- Test: `v4_engine.test.js`

**Interfaces:**
- Consumes: `state` with `v: 4`
- Produces: `Engine.awardBadge(state, pid, badgeType, now)`, `Engine.removeBadge(state, pid, badgeId, now)`, `Engine.recapMetrics(state, now)`

- [ ] **Step 1: Write failing tests for Engine badge & recap functions**

Add to `v4_engine.test.js`:
```javascript
test('Engine v4 Badge Functions', async (t) => {
  await t.test('awardBadge adds badge and creates undo entry', () => {
    let state = Engine.createState();
    state.roster = [{ id: 'p1', name: 'Mason' }];
    state.match.players['p1'] = { onField: true, stintStartMs: 0, periodMs: [0,0,0,0], resting: false, badges: [] };

    state = Engine.awardBadge(state, 'p1', 'hustle', 1000);
    assert.strictEqual(state.match.players['p1'].badges.length, 1);
    assert.strictEqual(state.match.players['p1'].badges[0].type, 'hustle');
    assert.ok(state.match.undo);
    assert.strictEqual(state.match.undo.label, 'Awarded Great Hustle to Mason');

    // Test undoing badge
    state = Engine.undo(state, 2000);
    assert.strictEqual(state.match.players['p1'].badges.length, 0);
  });

  await t.test('removeBadge removes badge by id and creates undo entry', () => {
    let state = Engine.createState();
    state.roster = [{ id: 'p1', name: 'Mason' }];
    state.match.players['p1'] = { onField: true, stintStartMs: 0, periodMs: [0,0,0,0], resting: false, badges: [] };
    state = Engine.awardBadge(state, 'p1', 'save', 1000);
    const badgeId = state.match.players['p1'].badges[0].id;

    state = Engine.removeBadge(state, 'p1', badgeId, 2000);
    assert.strictEqual(state.match.players['p1'].badges.length, 0);
    assert.ok(state.match.undo);
  });

  await t.test('recapMetrics calculates target time, player totals, and badge counts', () => {
    let state = Engine.createState();
    state.settings = { fieldSize: 2, periodMinutes: 10, periodCount: 2 };
    state.roster = [
      { id: 'p1', name: 'Mason' },
      { id: 'p2', name: 'Mia' },
      { id: 'p3', name: 'Leo' }
    ];
    state.match.period = 1;
    state.match.clock.elapsedMs = 600000; // 10 mins elapsed
    state.match.players = {
      'p1': { onField: true, stintStartMs: 0, periodMs: [600000, 0], resting: false, badges: [{ id: 'b1', type: 'hustle' }] },
      'p2': { onField: true, stintStartMs: 0, periodMs: [600000, 0], resting: false, badges: [] },
      'p3': { onField: false, stintStartMs: 0, periodMs: [0, 0], resting: false, badges: [] }
    };

    const metrics = Engine.recapMetrics(state, 600000);
    // Total field slots = 2. Elapsed = 10 mins (600,000 ms). Total field time = 1,200,000 ms.
    // Active players = 3. Target share = 1,200,000 / 3 = 400,000 ms (6:40 mins).
    assert.strictEqual(metrics.targetMs, 400000);
    assert.strictEqual(metrics.totalBadges, 1);
    assert.strictEqual(metrics.players.length, 3);
    
    const p1Metrics = metrics.players.find(p => p.id === 'p1');
    assert.strictEqual(p1Metrics.totalMs, 600000);
    assert.strictEqual(p1Metrics.badgeCounts.hustle, 1);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test v4_engine.test.js`
Expected: FAIL with `Engine.awardBadge is not a function`.

- [ ] **Step 3: Implement Engine functions in `soccer_sub_manager_v4.html`**

In `<script id="engine">` of `soccer_sub_manager_v4.html`:
```javascript
const BADGE_MAP = {
  hustle: { icon: '⚡', title: 'Great Hustle' },
  save:   { icon: '🛡️', title: 'Big Save' },
  pass:   { icon: '🤝', title: 'Great Pass' },
  kick:   { icon: '🚀', title: 'Super Kick' },
  teammate:{ icon: '🌟', title: 'Star Teammate' }
};

awardBadge(state, playerId, badgeType, now) {
  const p = state.match.players[playerId];
  const r = state.roster.find(x => x.id === playerId);
  if (!p || !r || !BADGE_MAP[badgeType]) return state;

  const undoState = snapshotUndo(state, `Awarded ${BADGE_MAP[badgeType].title} to ${r.name}`, true);
  const newBadge = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'b_' + Math.random().toString(36).slice(2, 9),
    type: badgeType,
    timestampMs: this.clockMs(state, now)
  };

  const updatedPlayer = {
    ...p,
    badges: [...(p.badges || []), newBadge]
  };

  return {
    ...undoState,
    match: {
      ...undoState.match,
      players: {
        ...undoState.match.players,
        [playerId]: updatedPlayer
      }
    }
  };
},

removeBadge(state, playerId, badgeId, now) {
  const p = state.match.players[playerId];
  const r = state.roster.find(x => x.id === playerId);
  if (!p || !r) return state;

  const badge = (p.badges || []).find(b => b.id === badgeId);
  if (!badge) return state;

  const undoState = snapshotUndo(state, `Removed ${BADGE_MAP[badge.type]?.title || 'Badge'} from ${r.name}`, true);
  const updatedPlayer = {
    ...p,
    badges: (p.badges || []).filter(b => b.id !== badgeId)
  };

  return {
    ...undoState,
    match: {
      ...undoState.match,
      players: {
        ...undoState.match.players,
        [playerId]: updatedPlayer
      }
    }
  };
},

recapMetrics(state, now) {
  const activePlayers = state.roster.filter(r => state.match.players[r.id] && !state.match.players[r.id].resting);
  const elapsedMs = state.match.clock.elapsedMs + (state.match.clock.running ? Math.max(0, now - state.match.clock.startedAt) : 0);
  const totalPeriodElapsedMs = (state.match.period - 1) * state.settings.periodMinutes * 60 * 1000 + elapsedMs;
  
  const totalFieldMs = totalPeriodElapsedMs * state.settings.fieldSize;
  const targetMs = activePlayers.length > 0 ? Math.round(totalFieldMs / activePlayers.length) : 0;

  let totalBadges = 0;
  let maxPlayerMs = 0;

  const playerMetrics = state.roster.map(r => {
    const p = state.match.players[r.id] || { periodMs: [], badges: [] };
    const t = this.times(state, r.id, now);
    const totalMs = t.totalMs;
    if (totalMs > maxPlayerMs) maxPlayerMs = totalMs;

    const badgeCounts = { hustle: 0, save: 0, pass: 0, kick: 0, teammate: 0 };
    (p.badges || []).forEach(b => {
      if (badgeCounts[b.type] !== undefined) badgeCounts[b.type]++;
      totalBadges++;
    });

    const diff = totalMs - targetMs;
    let fairnessStatus = 'equal';
    if (diff > 90000) fairnessStatus = 'over';
    else if (diff < -90000) fairnessStatus = 'under';

    return {
      id: r.id,
      name: r.name,
      totalMs,
      targetDeltaMs: diff,
      fairnessStatus,
      badgeCounts,
      badges: p.badges || []
    };
  });

  return {
    targetMs,
    totalBadges,
    maxPlayerMs: Math.max(maxPlayerMs, targetMs, 60000),
    players: playerMetrics
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test v4_engine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add soccer_sub_manager_v4.html v4_engine.test.js
git commit -m "feat(v4): implement awardBadge, removeBadge, and recapMetrics engine APIs"
```

---

### Task 3: Implement In-Game Badging UI & Interaction

**Files:**
- Modify: `soccer_sub_manager_v4.html: style and app script block`

**Interfaces:**
- Consumes: `Engine.awardBadge`, player cards DOM structure
- Produces: `+ 🌟` Quick Badge Drawer on player cards, badge icon indicators on cards, event listener delegation for `data-action="open-badge-drawer"` and `data-action="award-badge"`.

- [ ] **Step 1: Add CSS styling for Badge Drawer & Badge Badges**

Add CSS rules to `<style>` in `soccer_sub_manager_v4.html`:
```css
.badge-strip {
  display: flex;
  gap: 6px;
  align-items: center;
  background: var(--surface-2);
  padding: 4px 8px;
  border-radius: 8px;
  margin-top: 6px;
}
.badge-btn {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 16px;
  min-width: 44px;
  min-height: 44px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.badge-btn:active {
  transform: scale(0.95);
  background: var(--accent);
}
.card-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.badge-pill {
  background: rgba(255, 215, 0, 0.15);
  border: 1px solid rgba(255, 215, 0, 0.4);
  color: #ffd700;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
```

- [ ] **Step 2: Update Player Card Renderers in `<script id="app">`**

In `renderPlayerCard(p, r, state)`:
Render `card-badges` pills for earned badges, and a `+ 🌟` button that toggles an inline badge selector drawer:
```javascript
const badgesHtml = Object.entries(metrics.badgeCounts || {})
  .filter(([_, count]) => count > 0)
  .map(([type, count]) => `<span class="badge-pill">${BADGE_MAP[type].icon} ${count}</span>`)
  .join('');

const drawerHtml = activeBadgeDrawerPid === r.id ? `
  <div class="badge-strip" data-id="${r.id}">
    <button class="badge-btn" data-action="award-badge" data-badge="hustle" title="Great Hustle">⚡</button>
    <button class="badge-btn" data-action="award-badge" data-badge="save" title="Big Save">🛡️</button>
    <button class="badge-btn" data-action="award-badge" data-badge="pass" title="Great Pass">🤝</button>
    <button class="badge-btn" data-action="award-badge" data-badge="kick" title="Super Kick">🚀</button>
    <button class="badge-btn" data-action="award-badge" data-badge="teammate" title="Star Teammate">🌟</button>
  </div>
` : '';
```

- [ ] **Step 3: Update App Event Listeners**

Add handlers in click delegation listener:
```javascript
if (action === 'toggle-badge-drawer') {
  activeBadgeDrawerPid = activeBadgeDrawerPid === id ? null : id;
  renderAll();
} else if (action === 'award-badge') {
  const badgeType = target.dataset.badge;
  const pid = target.closest('[data-id]').dataset.id;
  state = Engine.awardBadge(state, pid, badgeType, Date.now());
  activeBadgeDrawerPid = null;
  saveState();
  renderAll();
  if (navigator.vibrate) navigator.vibrate(40);
}
```

- [ ] **Step 4: Verify manual rendering via node inspector script**

Run: `node inspect_v3.js` (or updated script) to verify DOM renders cleanly without JS syntax errors.

- [ ] **Step 5: Commit**

```bash
git add soccer_sub_manager_v4.html
git commit -m "feat(v4): add in-game sportsmanship badge drawer UI and event handlers"
```

---

### Task 4: Implement Visual Fairness Gauge & Accolades on Match Recap Screen

**Files:**
- Modify: `soccer_sub_manager_v4.html: style and recap modal/screen renderer`

**Interfaces:**
- Consumes: `Engine.recapMetrics(state, Date.now())`
- Produces: Visual progress bar chart with equal share benchmark indicator line, player accolade pills list on Match Recap modal/screen.

- [ ] **Step 1: Add CSS styling for Visual Fairness Gauge**

Add CSS to `soccer_sub_manager_v4.html`:
```css
.recap-fairness-card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}
.gauge-row {
  margin-bottom: 12px;
}
.gauge-header {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 4px;
}
.gauge-bar-track {
  position: relative;
  background: var(--surface-2);
  height: 20px;
  border-radius: 10px;
  overflow: hidden;
}
.gauge-bar-fill {
  height: 100%;
  border-radius: 10px;
  transition: width 0.3s ease;
}
.gauge-bar-fill.equal { background: #4caf50; }
.gauge-bar-fill.over  { background: #2196f3; }
.gauge-bar-fill.under { background: #ff9800; }

.target-line-indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ffffff;
  border-right: 1px dashed #000000;
  z-index: 2;
}
.recap-badges-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}
```

- [ ] **Step 2: Update Match Recap Modal Renderer in `<script id="app">`**

Update `renderMatchReport()` in `soccer_sub_manager_v4.html`:
```javascript
function renderMatchReport() {
  const metrics = Engine.recapMetrics(state, Date.now());
  const maxMs = metrics.maxPlayerMs || 1;
  const targetPct = Math.min(100, Math.round((metrics.targetMs / maxMs) * 100));

  let html = `
    <div class="recap-header">
      <h2>Match Recap</h2>
      <p class="recap-subtitle">Equal Target Share: ${formatTimeMs(metrics.targetMs)} • Badges: ${metrics.totalBadges} 🎉</p>
    </div>
    <div class="recap-fairness-card">
      <div style="position:relative; margin-bottom:12px;">
        <span style="font-size:12px; color:var(--text-muted);">Equal Share Target: ${formatTimeMs(metrics.targetMs)}</span>
      </div>
  `;

  metrics.players.forEach(p => {
    const widthPct = Math.min(100, Math.round((p.totalMs / maxMs) * 100));
    const badgePills = Object.entries(p.badgeCounts)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => `<span class="badge-pill">${BADGE_MAP[type].icon} ${BADGE_MAP[type].title} x${count}</span>`)
      .join('');

    html += `
      <div class="gauge-row">
        <div class="gauge-header">
          <span>${escapeHtml(p.name)}</span>
          <span>${formatTimeMs(p.totalMs)}</span>
        </div>
        <div class="gauge-bar-track">
          <div class="gauge-bar-fill ${p.fairnessStatus}" style="width: ${widthPct}%;"></div>
          <div class="target-line-indicator" style="left: ${targetPct}%;" title="Target Share"></div>
        </div>
        <div class="recap-badges-list">${badgePills || '<span style="font-size:11px; opacity:0.6;">No badges yet</span>'}</div>
      </div>
    `;
  });

  html += `</div>`;
  // Render into dialog...
}
```

- [ ] **Step 3: Run Node Unit Tests**

Run: `node --test v4_engine.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add soccer_sub_manager_v4.html
git commit -m "feat(v4): add visual fairness gauge and player accolades list to Match Recap screen"
```

---

### Task 5: Implement Parent SMS / WhatsApp Text Copy Generator & Screenshot Optimization

**Files:**
- Modify: `soccer_sub_manager_v4.html`

**Interfaces:**
- Consumes: `Engine.recapMetrics(state, Date.now())`
- Produces: "📋 Copy Parent Summary Text" button handler, plain-text generator function `generateParentSummaryText(metrics)`, `@media print` and screenshot styling tweaks.

- [ ] **Step 1: Implement `generateParentSummaryText(metrics)` in `<script id="app">`**

```javascript
function generateParentSummaryText(metrics) {
  let text = `Great soccer match today! 🐅\nEveryone got equal play time (~${Math.round(metrics.targetMs / 60000)} mins each).\n\n🌟 Sportsmanship Badges Earned Today:\n`;
  
  metrics.players.forEach(p => {
    const badges = Object.entries(p.badgeCounts)
      .filter(([_, count]) => count > 0)
      .map(([type, count]) => `${BADGE_MAP[type].icon} ${BADGE_MAP[type].title}${count > 1 ? ' x' + count : ''}`)
      .join(', ');
    
    text += `• ${p.name}: ${badges || 'Great Team Play'}\n`;
  });

  text += `\nThanks coaches & parents for a fantastic game! ⚽`;
  return text;
}
```

- [ ] **Step 2: Add Copy Button to Match Recap Modal**

```javascript
html += `
  <button class="btn btn-primary" data-action="copy-parent-recap" style="width:100%; margin-top:12px; padding:12px;">
    📋 Copy Parent Summary Text
  </button>
`;
```

Add click event listener:
```javascript
if (action === 'copy-parent-recap') {
  const metrics = Engine.recapMetrics(state, Date.now());
  const text = generateParentSummaryText(metrics);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast("Copied parent summary to clipboard! 📋");
    });
  } else {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast("Copied parent summary to clipboard! 📋");
  }
}
```

- [ ] **Step 3: Run Node Unit Tests**

Run: `node --test v4_engine.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add soccer_sub_manager_v4.html
git commit -m "feat(v4): implement parent SMS recap text generator and clipboard copy action"
```

---

### Task 6: End-to-End Inspection & Verification

**Files:**
- Create: `inspect_v4.js` (copy of `inspect_v3.js` updated for `soccer_sub_manager_v4.html`)

**Interfaces:**
- Consumes: `soccer_sub_manager_v4.html`
- Produces: Screenshot verification artifacts (`v4_01_main_dashboard.png`, `v4_02_badge_drawer.png`, `v4_03_recap_gauge.png`)

- [ ] **Step 1: Create `inspect_v4.js` script to capture screenshot artifacts**

Create `inspect_v4.js`:
```javascript
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const filePath = 'file://' + path.resolve(__dirname, 'soccer_sub_manager_v4.html');
  await page.goto(filePath);
  
  await page.screenshot({ path: 'v4_01_main_dashboard.png' });
  console.log('Saved v4_01_main_dashboard.png');
  await browser.close();
})();
```

- [ ] **Step 2: Execute `node inspect_v4.js` and verify clean screenshots**

Run: `node inspect_v4.js`
Expected: Successfully generates screenshots without errors.

- [ ] **Step 3: Run full test suite**

Run: `node --test v4_engine.test.js`
Expected: All tests pass.

- [ ] **Step 4: Final Commit**

```bash
git add inspect_v4.js v4_01_main_dashboard.png
git commit -m "chore(v4): complete verification and screenshot validation for v4 release"
```
