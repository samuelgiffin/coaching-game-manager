const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('./soccer_sub_manager_v3.html', 'utf8');
const scriptMatch = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error("Could not find engine script");

const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(scriptMatch[1], context);
const Engine = context.globalThis.Engine;

test('Engine Slice 1: createState, normalize, clockMs', async (t) => {
  await t.test('createState', () => {
    const state = Engine.createState();
    assert.deepStrictEqual(state.roster, []);
    assert.deepStrictEqual(state.match.clock, { running: false, startedAt: null, elapsedMs: 0 });
    assert.strictEqual(state.settings.periodMinutes, 8);
    assert.deepStrictEqual(state.match.score, { us: 0, them: 0 });
    assert.deepStrictEqual(state.match.events, []);
  });

  await t.test('clockMs', () => {
    const state = Engine.createState();
    assert.strictEqual(Engine.clockMs(state, 1000), 0);
    
    state.match.clock.running = true;
    state.match.clock.startedAt = 1000;
    assert.strictEqual(Engine.clockMs(state, 1000), 0);
    assert.strictEqual(Engine.clockMs(state, 2000), 1000);
    
    // capped at period length
    assert.strictEqual(Engine.clockMs(state, 100000000), 8 * 60 * 1000);
  });
  
  await t.test('normalize v2 data', () => {
    const v2Data = {
      playersOnField: 7,
      periodMinutes: 10,
      players: [{ id: '1', name: 'Alice' }]
    };
    const state = Engine.normalize(v2Data);
    assert.strictEqual(state.settings.fieldSize, 7);
    assert.strictEqual(state.settings.periodMinutes, 10);
    assert.strictEqual(state.roster[0].name, 'Alice');
  });
});

test('Engine Slice 2: Subs, undo, recommendations', async (t) => {
  await t.test('Sub and undo (Criterion 4)', () => {
    let state = Engine.createState();
    state.settings.periodMinutes = 10;
    state.roster = [{ id: 'out1', name: 'A' }, { id: 'in1', name: 'B' }];
    state.match.players['out1'] = { onField: true, stintStartMs: 0, periodMs: [0], resting: false };
    state.match.players['in1'] = { onField: false, stintStartMs: 0, periodMs: [0], resting: false };
    state.match.clock.running = true;
    state.match.clock.startedAt = 0;
    
    // Sub at 3:00 (180,000 ms)
    state = Engine.substitute(state, 'out1', 'in1', 180000);
    assert.strictEqual(state.match.players['out1'].onField, false);
    assert.strictEqual(state.match.players['in1'].onField, true);
    
    // Undo at 4:00 (240,000 ms)
    state = Engine.undo(state, 240000);
    // Outgoing player (A) is back on field, stint restored.
    // At 4:00, A's total time should be 4:00 (240,000)
    let times = Engine.times(state, 'out1', 240000);
    assert.strictEqual(times.shiftMs, 240000);
    assert.strictEqual(Engine.times(state, 'in1', 240000).shiftMs, 0);
  });
  
  await t.test('Recommend (Criterion 5)', () => {
    let state = Engine.createState();
    state.roster = [
      { id: 'f1', name: 'A' },
      { id: 'b1', name: 'B' },
      { id: 'b2', name: 'C' }
    ];
    state.match.players = {
      'f1': { onField: true, stintStartMs: 0, periodMs: [0], resting: false },
      'b1': { onField: false, stintStartMs: 0, periodMs: [0], resting: false },
      'b2': { onField: false, stintStartMs: 0, periodMs: [0], resting: false }
    };
    
    // b1 gets pinned
    state = Engine.skip(state, 1000); // this will skip b1 and pin b1? No, recommend returns the first bench player.
    // b1 is the first bench player
    assert.strictEqual(state.match.skipIds.length, 1);
    
    // Resting
    state = Engine.toggleRest(state, 'b1');
    assert.strictEqual(state.match.players['b1'].resting, true);
    
    // Check recommend
    let rec = Engine.recommend(state, 100000);
    // b1 is resting, so b2 should be recommended IN
    assert.strictEqual(rec.inId, 'b2');
    assert.strictEqual(rec.outId, 'f1');
  });
});

test('Engine Setup & Reset (Criteria 6, 7)', async (t) => {
  await t.test('Setup validation', () => {
    let state = Engine.createState();
    let draft = { fieldSize: 1, periodMinutes: 50, periodCount: 3, roster: [], starterIds: [] };
    let res = Engine.applySetup(state, draft, 0);
    assert.strictEqual(res.ok, false);
    assert.ok(res.errors.length >= 4);
  });

  await t.test('Reset undo', () => {
    let state = Engine.createState();
    state.roster = [{ id: 'p1', name: 'A' }];
    state.starterIds = ['p1'];
    state = Engine.resetMatch(state, 0);
    state.match.period = 2; // change something
    state = Engine.resetMatch(state, 0); // reset again
    assert.strictEqual(state.match.period, 1);
    state = Engine.undo(state, 0);
    assert.strictEqual(state.match.period, 2);
  });
});

test('Engine Slice: Scorekeeping', async (t) => {
  await t.test('Record goals', () => {
    let state = Engine.createState();
    state.roster = [{ id: 'p1', name: 'Alice' }];
    state.match.period = 1;
    
    // us score
    state = Engine.recordGoal(state, 'us', 'p1', 1000);
    assert.strictEqual(state.match.score.us, 1);
    assert.strictEqual(state.match.events.length, 1);
    assert.strictEqual(state.match.events[0].type, 'goal_us');
    assert.strictEqual(state.match.events[0].playerId, 'p1');
    assert.strictEqual(state.match.events[0].period, 1);
    assert.ok(state.match.events[0].id);

    // them score
    state = Engine.recordGoal(state, 'them', null, 2000);
    assert.strictEqual(state.match.score.them, 1);
    assert.strictEqual(state.match.events.length, 2);
    assert.strictEqual(state.match.events[1].type, 'goal_them');
    
    // undo score
    state = Engine.deleteEvent(state, state.match.events[0].id);
    assert.strictEqual(state.match.score.us, 0);
    assert.strictEqual(state.match.events.length, 1);
  });
});

