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
    assert.strictEqual(Array.isArray(state.match.players['p1'].badges), true);
    assert.strictEqual(state.match.players['p1'].badges.length, 0);
  });
});

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
      'p1': { onField: true, stintStartMs: 0, periodMs: [0, 0], resting: false, badges: [{ id: 'b1', type: 'hustle' }] },
      'p2': { onField: true, stintStartMs: 0, periodMs: [0, 0], resting: false, badges: [] },
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
