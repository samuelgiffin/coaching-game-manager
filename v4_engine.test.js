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
    state = Engine.start(state, 0);

    // Q1 scoring
    state = Engine.recordScore(state, 'us', 'p1', 3, 60000);
    state = Engine.recordScore(state, 'us', 'p1', 1, 90000);
    state = Engine.recordScore(state, 'them', null, 2, 120000);

    // Advance to Q4 and score comeback points
    state.match.period = 4;
    state.match.clock.elapsedMs = 0;
    state.match.clock.startedAt = 0;
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
    const klay = metrics.players.find(p => p.id === 'p2');
    const draymond = metrics.players.find(p => p.id === 'p3');
    assert.strictEqual(steph.pointsScored, 7);
    assert.deepStrictEqual(steph.shotMix, { pt1: 1, pt2: 0, pt3: 2 });
    assert.deepStrictEqual(steph.pointsByPeriod, [4, 0, 0, 3]);
    assert.deepStrictEqual(klay.pointsByPeriod, [0, 0, 0, 2]);
    assert.deepStrictEqual(draymond.pointsByPeriod, [0, 0, 0, 0]);

    // Chronological playByPlay with running scores
    assert.ok(Array.isArray(metrics.playByPlay));
    assert.strictEqual(metrics.playByPlay.length, 5);
    assert.deepStrictEqual(
      metrics.playByPlay.map(e => ({
        period: e.period,
        clockMs: e.clockMs,
        points: e.points,
        playerName: e.playerName,
        runningUs: e.runningUs,
        runningThem: e.runningThem
      })),
      [
        { period: 1, clockMs: 60000, points: 3, playerName: 'Steph', runningUs: 3, runningThem: 0 },
        { period: 1, clockMs: 90000, points: 1, playerName: 'Steph', runningUs: 4, runningThem: 0 },
        { period: 1, clockMs: 120000, points: 2, playerName: 'Opponent', runningUs: 4, runningThem: 2 },
        { period: 4, clockMs: 60000, points: 2, playerName: 'Klay', runningUs: 6, runningThem: 2 },
        { period: 4, clockMs: 120000, points: 3, playerName: 'Steph', runningUs: 9, runningThem: 2 }
      ]
    );

    // Headline & Impact awards
    assert.ok(typeof metrics.headline === 'string' && metrics.headline.length > 10);
    assert.ok(Array.isArray(metrics.impactAwards) && metrics.impactAwards.length >= 2);
    const glassAward = metrics.impactAwards.find(a => a.badgeType === 'rebound');
    assert.ok(glassAward);
    assert.strictEqual(glassAward.leaderName, 'Draymond');
    assert.strictEqual(glassAward.count, 2);
  });
});

test('Real-World Simulation & Edge-Case Regression Suite', async (t) => {
  await t.test('1. undo() after a substitution while clock is running preserves exact elapsed clock without double-counting time', () => {
    let s = Engine.createState('basketball');
    s.roster = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(id => ({ id, name: id.toUpperCase() }));
    s.starterIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);

    // At 2:00 (120,000 ms), sub p1 -> p6 while clock is running
    s = Engine.substitute(s, 'p1', 'p6', 120000);
    // At 2:05 (125,000 ms), undo the sub while clock is still running!
    s = Engine.undo(s, 125000);

    // And 5 seconds later at 2:10 (130,000 ms), clock must be 130,000 ms (NOT 120,000 + 130,000 = 250,000 ms!)
    assert.strictEqual(Engine.clockMs(s, 130000), 130000, 'Clock must not double-count elapsed time before the sub');
    assert.strictEqual(Engine.times(s, 'p1', 130000).totalMs, 130000);
    assert.strictEqual(Engine.times(s, 'p3', 130000).totalMs, 130000);
  });

  await t.test('2. substituteBatch at 0:00 (start of quarter) does not prematurely mark midSubDoneForPeriod even for 1-min periods', () => {
    let s = Engine.createState('basketball');
    s.settings = { fieldSize: 2, periodMinutes: 1, periodCount: 4 };
    s.roster = ['p1', 'p2', 'p3', 'p4'].map(id => ({ id, name: id.toUpperCase() }));
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);

    // Sub at 0:00 before starting clock
    s = Engine.substituteBatch(s, ['p1', 'p2'], ['p3', 'p4'], 0);
    assert.strictEqual(s.match.midSubDoneForPeriod, 0, 'Line sub at 0:00 must not mark mid-quarter sub done');
    s = Engine.start(s, 0);
    assert.strictEqual(Engine.midQuarterSubStatus(s, 30000), 'due', 'At 0:30 midpoint of 1-min period, mid-quarter sub should be due');
  });

  await t.test('3. resetMatch clears score, scoring events, and player badges for a fresh game (and supports undo)', () => {
    let s = Engine.createState('basketball');
    s.roster = ['p1', 'p2'].map(id => ({ id, name: id.toUpperCase() }));
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);
    s = Engine.recordScore(s, 'us', 'p1', 3, 30000);
    s = Engine.recordScore(s, 'them', null, 2, 40000);
    s = Engine.awardBadge(s, 'p1', 'rebound', 50000);

    // Reset match for new game
    const resetS = Engine.resetMatch(s, 60000);
    assert.deepStrictEqual(resetS.match.score, { us: 0, them: 0 });
    assert.strictEqual(resetS.match.events.length, 0);
    assert.strictEqual(resetS.match.players.p1.badges.length, 0);

    // Undoing resetMatch restores the previous game's score, events, and badges
    const undone = Engine.undo(resetS, 65000);
    assert.deepStrictEqual(undone.match.score, { us: 3, them: 2 });
    assert.strictEqual(undone.match.events.length, 2);
    assert.strictEqual(undone.match.players.p1.badges.length, 1);
  });

  await t.test('4. times() computes live fairDeltaMs relative to active players average playtime', () => {
    let s = Engine.createState('basketball');
    s.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    s.roster = ['p1', 'p2', 'p3'].map(id => ({ id, name: id.toUpperCase() }));
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);

    // At 3:00 (180,000 ms): p1=180k, p2=180k, p3=0. Average = 360k / 3 = 120k.
    // p1 fairDeltaMs should be +60,000 ms; p3 fairDeltaMs should be -120,000 ms.
    const t1 = Engine.times(s, 'p1', 180000);
    const t3 = Engine.times(s, 'p3', 180000);
    assert.strictEqual(t1.fairDeltaMs, 60000);
    assert.strictEqual(t3.fairDeltaMs, -120000);
  });

  await t.test('5. toggleFoulOut on an active on-court player banks their shift time and moves them off the court', () => {
    let s = Engine.createState('basketball');
    s.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    s.roster = ['p1', 'p2'].map(id => ({ id, name: id.toUpperCase() }));
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);

    // At 2:00 (120,000 ms), p1 fouls out with no eligible bench replacement (or Mark Fouled Out Only)
    s = Engine.toggleFoulOut(s, 'p1', 120000);
    assert.strictEqual(s.match.players.p1.fouledOut, true);
    assert.strictEqual(s.match.players.p1.onField, false, 'Fouled-out player must be moved off the court');
    assert.strictEqual(s.match.players.p1.periodMs[0], 120000, 'Fouled-out player shift time must be banked');
    assert.strictEqual(s.match.clock.running, false, 'Clock should pause when an active player fouls out');
  });

  await t.test('6. recapMetrics caps current period elapsedMs at periodMinutes via clockMs()', () => {
    let s = Engine.createState('basketball');
    s.settings = { fieldSize: 5, periodMinutes: 8, periodCount: 4 };
    s.roster = ['p1', 'p2', 'p3', 'p4', 'p5'].map(id => ({ id, name: id.toUpperCase() }));
    s.starterIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    s = Engine.resetMatch(s, 0);
    s = Engine.start(s, 0);

    // 10 minutes wall-clock pass in an 8-minute (480,000 ms) quarter before pause
    const metrics = Engine.recapMetrics(s, 600000);
    assert.strictEqual(metrics.targetMs, 480000, 'targetMs must cap at period length (480,000 ms), not 600,000 ms');
  });
});

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

  await t.test('isMatchComplete, playerHasMatchData, and resetMatch attendance/pruning', () => {
    let s = Engine.createState('basketball');
    s.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    s.roster = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }, { id: 'p3', name: 'C' }];
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);

    // resetMatch initializes attendance fields
    assert.strictEqual(s.match.completedPeriodsMs, 0);
    assert.strictEqual(s.match.players.p1.absent, false);
    assert.strictEqual(s.match.players.p1.arrivedAtMs, 0);
    assert.strictEqual(s.match.players.p1.firstArrivedAtMs, 0);
    assert.strictEqual(s.match.players.p1.departedAtMs, null);
    assert.strictEqual(s.match.players.p1.presentMs, 0);

    // playerHasMatchData detects played time, badges, and events
    assert.strictEqual(Engine.playerHasMatchData(s, 'p3', 0), false);
    s = Engine.start(s, 0);
    assert.strictEqual(Engine.playerHasMatchData(s, 'p1', 10000), true);
    assert.strictEqual(Engine.playerHasMatchData(s, 'p3', 10000), false);

    // isMatchComplete requires final period and full period clock
    assert.strictEqual(Engine.isMatchComplete(s, 480000), false);
    s.match.period = 4;
    s.match.clock = { running: false, startedAt: null, elapsedMs: 479999 };
    assert.strictEqual(Engine.isMatchComplete(s, 479999), false);
    s.match.clock.elapsedMs = 480000;
    assert.strictEqual(Engine.isMatchComplete(s, 480000), true);

    // resetMatch prunes removed players from match.players
    s.roster = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];
    const reset = Engine.resetMatch(s, 500000);
    assert.strictEqual(reset.match.players.p3, undefined);
  });
});

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

  await t.test('recommend and recommendBatch treat all-absent bench as no-bench', () => {
    let s = Engine.createState('soccer');
    s.settings = { fieldSize: 2, periodMinutes: 8, periodCount: 4 };
    s.roster = [
      { id: 'p1', name: 'Starter1' },
      { id: 'p2', name: 'Starter2' },
      { id: 'p3', name: 'AbsentKid' }
    ];
    s.starterIds = ['p1', 'p2'];
    s = Engine.resetMatch(s, 0);
    s.match.players.p3.absent = true;
    s.match.players.p3.arrivedAtMs = null;
    s.match.players.p3.firstArrivedAtMs = null;

    assert.strictEqual(Engine.recommend(s, 60000).status, 'no-bench');
    s.sport = 'basketball';
    assert.strictEqual(Engine.recommendBatch(s, 60000).status, 'no-bench');
  });
});

