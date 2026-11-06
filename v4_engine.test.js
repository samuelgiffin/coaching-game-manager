const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('./soccer_sub_manager_v4.html', 'utf8');
const scriptMatch = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error("Could not find engine script");

vm.runInThisContext(scriptMatch[1]);
const Engine = globalThis.Engine;

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

test('Engine v4 Substitution & Recommendation Edge Cases', async (t) => {
  await t.test('substitute sets lastSubOutId on match state', () => {
    let state = Engine.createState();
    state.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    state.roster = [
      { id: 'p1', name: 'Mason' },
      { id: 'p2', name: 'Mia' },
      { id: 'p3', name: 'Noah' }
    ];
    state.starterIds = ['p1', 'p2'];
    state = Engine.resetMatch(state, 0);

    state = Engine.substitute(state, 'p1', 'p3', 0);
    assert.strictEqual(state.match.lastSubOutId, 'p1', 'lastSubOutId should be p1');
  });

  await t.test('recommendation does not pick player just subbed out when all players have 0 mins', () => {
    let state = Engine.createState();
    state.settings = { fieldSize: 5, periodMinutes: 8, periodCount: 4 };
    state.roster = [
      { id: 'p1', name: 'Mason' },
      { id: 'p2', name: 'Mia' },
      { id: 'p3', name: 'Leo' },
      { id: 'p4', name: 'Ava' },
      { id: 'p5', name: 'Jack' },
      { id: 'p6', name: 'Noah' },
      { id: 'p7', name: 'Emma' }
    ];
    state.starterIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    state = Engine.resetMatch(state, 0);

    // Initial rec recommends p1 out and p6 in
    const initialRec = Engine.recommend(state, 0);
    assert.strictEqual(initialRec.inId, 'p6');

    // Substitute p1 (Mason) out for p6 (Noah)
    state = Engine.substitute(state, 'p1', 'p6', 0);

    // Next rec MUST NOT recommend p1 (Mason) in because Mason was just subbed out!
    // It should recommend p7 (Emma) who is waiting on the bench.
    const nextRec = Engine.recommend(state, 0);
    assert.strictEqual(nextRec.inId, 'p7', `Expected Emma (p7) to be recommended in, but got ${nextRec.inId}`);
  });
});

test('Engine Multi-Sport Config, Schema & Multi-Point Scoring', async (t) => {
  await t.test('SPORTS registry defines soccer and basketball configs', () => {
    assert.ok(Engine.SPORTS.soccer);
    assert.ok(Engine.SPORTS.basketball);
    assert.strictEqual(Engine.SPORTS.soccer.subMode, 'rolling');
    assert.strictEqual(Engine.SPORTS.basketball.subMode, 'batch');
    assert.deepStrictEqual(Engine.SPORTS.basketball.scoreIncrements, [1, 2, 3]);
    assert.strictEqual(Engine.getSportConfig('basketball').id, 'basketball');
    assert.strictEqual(Engine.getSportConfig({ sport: 'basketball' }).id, 'basketball');
    assert.strictEqual(Engine.getSportConfig('unknown').id, 'soccer');
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

    // Backward-compatible recordGoal adds 1 point
    state = Engine.recordGoal(state, 'us', 'p1', 4000);
    assert.strictEqual(state.match.score.us, 3);
    assert.strictEqual(state.match.events[state.match.events.length - 1].points, 1);
  });

  await t.test('Basketball badges can be awarded and counted in recapMetrics', () => {
    let state = Engine.createState('basketball');
    state.roster = [{ id: 'p1', name: 'Steph' }];
    state.starterIds = ['p1'];
    state = Engine.resetMatch(state, 0);

    state = Engine.recordScore(state, 'us', 'p1', 3, 500);
    state = Engine.awardBadge(state, 'p1', 'rebound', 1000);
    state = Engine.awardBadge(state, 'p1', 'shot', 2000);
    state = Engine.awardBadge(state, 'p1', 'defense', 3000);

    const metrics = Engine.recapMetrics(state, 3000);
    assert.strictEqual(metrics.totalBadges, 3);
    assert.strictEqual(metrics.players[0].badgeCounts.rebound, 1);
    assert.strictEqual(metrics.players[0].badgeCounts.shot, 1);
    assert.strictEqual(metrics.players[0].badgeCounts.defense, 1);
    assert.strictEqual(metrics.players[0].pointsScored, 3);
    assert.strictEqual(metrics.players[0].fouledOut, false);
  });
});

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

  await t.test('recapMetrics computes quarter-by-quarter boxScore, shotMix (1pt/2pt/3pt), headline, and impactAwards', () => {
    let state = Engine.createState('basketball');
    state.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    state.roster = [
      { id: 'p1', name: 'Steph' },
      { id: 'p2', name: 'Klay' },
      { id: 'p3', name: 'Draymond' }
    ];
    state.starterIds = ['p1', 'p2'];
    state = Engine.resetMatch(state, 0);

    // Q1 scoring
    state = Engine.recordScore(state, 'us', 'p1', 3, 60000);
    state = Engine.recordScore(state, 'us', 'p1', 1, 90000);
    state = Engine.recordScore(state, 'them', null, 2, 120000);

    // Advance to Q4 and score comeback points
    state.match.period = 4;
    state = Engine.recordScore(state, 'us', 'p2', 2, 60000);
    state = Engine.recordScore(state, 'us', 'p1', 3, 120000);

    // Award badges
    state = Engine.awardBadge(state, 'p3', 'rebound', 130000);
    state = Engine.awardBadge(state, 'p3', 'rebound', 140000);
    state = Engine.awardBadge(state, 'p2', 'defense', 150000);

    const metrics = Engine.recapMetrics(state, 160000);

    // Box score per quarter
    assert.deepStrictEqual(metrics.boxScore.us, [4, 0, 0, 5]);
    assert.deepStrictEqual(metrics.boxScore.them, [2, 0, 0, 0]);
    assert.strictEqual(metrics.boxScore.totalUs, 9);
    assert.strictEqual(metrics.boxScore.totalThem, 2);

    // Team and player shot mix
    assert.deepStrictEqual(metrics.teamShotMix, { pt1: 1, pt2: 1, pt3: 2 });
    const steph = metrics.players.find(p => p.id === 'p1');
    assert.strictEqual(steph.pointsScored, 7);
    assert.deepStrictEqual(steph.shotMix, { pt1: 1, pt2: 0, pt3: 2 });

    // Headline & Impact awards
    assert.ok(typeof metrics.headline === 'string' && metrics.headline.length > 10);
    assert.ok(Array.isArray(metrics.impactAwards) && metrics.impactAwards.length >= 2);
    const glassAward = metrics.impactAwards.find(a => a.badgeType === 'rebound');
    assert.ok(glassAward);
    assert.strictEqual(glassAward.leaderName, 'Draymond');
    assert.strictEqual(glassAward.count, 2);
  });
});



