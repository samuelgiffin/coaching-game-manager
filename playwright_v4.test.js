const { chromium } = require('playwright');
const path = require('path');
const assert = require('node:assert');

(async () => {
  console.log('🚀 Starting Playwright E2E Test Suite for Soccer Sub Manager v4...\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const filePath = 'file://' + path.resolve(__dirname, 'soccer_sub_manager_v4.html');
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message || String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Helper to log test pass
  const testPass = (name) => console.log(`  ✔ PASS: ${name}`);

  try {
    // ----------------------------------------------------
    // TEST 1: Setup & Roster Creation
    // ----------------------------------------------------
    await page.goto(filePath);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const names = ['Mason', 'Mia', 'Leo', 'Ava', 'Jack', 'Noah', 'Emma'];
    for (const name of names) {
      await page.fill('#draftPlayerName', name);
      await page.click('button[data-action="draftAddPlayer"]');
    }

    for (let i = 1; i <= 5; i++) {
      await page.click(`#draftRosterList .player-card:nth-child(${i}) button`);
    }

    await page.click('button[data-action="saveSetup"]');
    await page.waitForFunction(() => document.getElementById('setupModal').classList.contains('hidden'));

    const fieldCount = await page.innerText('#fieldCount');
    const benchCount = await page.innerText('#benchCount');
    assert.strictEqual(fieldCount, '5/5', 'Field count should be 5/5');
    assert.strictEqual(benchCount, '2', 'Bench count should be 2');
    testPass('Setup & Roster Creation (5 Field / 2 Bench)');

    // ----------------------------------------------------
    // TEST 2: Clock Operation & Recommended Sub
    // ----------------------------------------------------
    await page.click('#clockBtn'); // Start clock
    const clockText = await page.innerText('#clockBtn');
    assert.strictEqual(clockText, 'PAUSE', 'Clock button should say PAUSE when running');
    
    // Verify clock actively ticks forward without needing to press PAUSE (Issue 1)
    await page.waitForTimeout(1200);
    const clockDisplayRunning = await page.innerText('#clockDisplay');
    assert.notStrictEqual(clockDisplayRunning, '00:00', 'Clock display should tick past 00:00 while running');

    // Check initial recommendation (OUT Mason, IN Noah)
    const initialInName = await page.innerText('#recInName');
    assert.strictEqual(initialInName, 'Noah', 'Initial sub in should be Noah');

    // Make recommended sub (moves Mason to bench, Noah to field)
    await page.click('button[data-action="makeSub"]');
    
    // Check Undo bar label
    const undoVisible = await page.isVisible('#undoBar:not(.hidden)');
    assert.strictEqual(undoVisible, true, 'Undo bar should be visible after substitution');

    // Verify player just subbed out (Mason) is NOT immediately recommended back in (Issue 2)
    const nextInName = await page.innerText('#recInName');
    assert.strictEqual(nextInName, 'Emma', 'Player just subbed out (Mason) must not be next sub in; should be Emma');
    testPass('Clock Operation (Active Heartbeat) & Sub Deprioritization for Recent Sub-Out');

    // ----------------------------------------------------
    // TEST 3: In-Game Sportsmanship Badges
    // ----------------------------------------------------
    // Open drawer on first field player card
    await page.click('#fieldList .player-card:first-child button[data-action="toggleBadgeDrawer"]');
    const drawerVisible = await page.isVisible('.badge-strip');
    assert.strictEqual(drawerVisible, true, 'Badge strip drawer should be visible');

    // Award Great Hustle (⚡)
    await page.click('button[data-action="awardBadge"][data-badge="hustle"]');

    // Verify badge pill appears on player card
    const pillText = await page.innerText('#fieldList .player-card:first-child .badge-pill');
    assert.ok(pillText.includes('⚡ 1'), `Player card should display badge pill "⚡ 1", got "${pillText}"`);
    testPass('In-Game Sportsmanship Badge Awarding (1-Tap + 🌟 Drawer)');

    // ----------------------------------------------------
    // TEST 4: Match Recap & Visual Fairness Gauge
    // ----------------------------------------------------
    await page.click('button[data-action="openMatchLog"]');
    await page.waitForFunction(() => !document.getElementById('matchLogModal').classList.contains('hidden'));

    const recapHeader = await page.innerText('#logPlaytime');
    assert.ok(recapHeader.includes('Equal Target Share'), 'Recap should contain Equal Target Share header');
    assert.ok(recapHeader.includes('Total Badges: 1'), 'Recap should reflect total badges count');

    const gaugeRows = await page.$$eval('#logPlaytime .gauge-row', rows => rows.length);
    assert.strictEqual(gaugeRows, 7, 'Match Recap should display 7 player gauge rows');
    testPass('Match Recap Screen & Visual Fairness Gauge Bars');

    // Close Match Report modal
    await page.click('button[data-action="closeMatchLog"]');
    await page.waitForFunction(() => document.getElementById('matchLogModal').classList.contains('hidden'));

    // ----------------------------------------------------
    // TEST 5: Parent SMS Summary Text Copy Tool
    // ----------------------------------------------------
    const parentText = await page.evaluate(() => {
      const metrics = Engine.recapMetrics(state, Date.now());
      return generateParentSummaryText(metrics);
    });

    assert.ok(parentText.includes('Great soccer match today!'), 'Recap text should include opening header');
    assert.ok(parentText.toLowerCase().includes('equal play time'), 'Recap text should state equal play time');
    assert.ok(parentText.includes('Great Hustle'), 'Recap text should detail earned badges');
    testPass('Parent SMS / WhatsApp Recap Text Generator');

    // ----------------------------------------------------
    // TEST 6: End of Final Period Full-Time Match Report Trigger (Issue 3)
    // ----------------------------------------------------
    // Fast-forward to final period 4 and trigger completion
    await page.evaluate(() => {
      state.match.period = 4;
      state.match.clock.elapsedMs = state.settings.periodMinutes * 60 * 1000; // time expired
      state.match.clock.running = false;
      renderAll();
    });

    // Verify full time banner displays with Match Report button
    const bannerVisible = await page.isVisible('#periodBanner:not(.hidden)');
    assert.strictEqual(bannerVisible, true, 'Period banner should be visible at full time');
    const bannerText = await page.innerText('#periodBannerText');
    assert.ok(bannerText.includes('Full Time'), `Banner text should indicate Full Time, got "${bannerText}"`);
    
    // Advance confirm at final period triggers modal with View Match Report button
    await page.click('button[data-action="advancePeriodConfirm"]');
    await page.waitForFunction(() => !document.getElementById('modalOverlay').classList.contains('hidden'));
    
    const modalTitle = await page.innerText('#modalTitle');
    assert.ok(modalTitle.includes('Full Time') || modalTitle.includes('Match Complete'), `Modal title should indicate match completion, got "${modalTitle}"`);
    
    // Clicking View Match Report from modal opens the match report
    await page.click('#modalButtons button[data-action="openMatchLog"]');
    await page.waitForFunction(() => !document.getElementById('matchLogModal').classList.contains('hidden'));
    testPass('End of Final Period Full-Time Mechanics & Match Report Trigger');

    // Close Match Report before Basketball tests
    await page.click('button[data-action="closeMatchLog"]');
    await page.waitForFunction(() => document.getElementById('matchLogModal').classList.contains('hidden'));

    // ----------------------------------------------------
    // TEST 7: Multi-Sport Setup Selector & Storage Isolation
    // ----------------------------------------------------
    await page.click('button[data-action="openSetup"]');
    await page.waitForFunction(() => !document.getElementById('setupModal').classList.contains('hidden'));

    await page.click('button[data-action="selectSport"][data-sport="basketball"]');
    const sizeLabel = await page.innerText('#setupSizeLabel');
    assert.strictEqual(sizeLabel.toUpperCase(), 'COURT SIZE', 'Setup size label should be Court Size in Basketball mode');

    const bballDraftCount = await page.innerText('#draftRosterCount');
    assert.strictEqual(bballDraftCount, '0', 'Basketball roster should start empty and isolated from Soccer');

    const bballNames = ['Steph', 'Klay', 'Draymond', 'Wiggins', 'Looney', 'Poole', 'GP2'];
    for (const name of bballNames) {
      await page.fill('#draftPlayerName', name);
      await page.click('button[data-action="draftAddPlayer"]');
    }
    for (let i = 1; i <= 5; i++) {
      await page.click(`#draftRosterList .player-card:nth-child(${i}) button`);
    }
    await page.click('button[data-action="saveSetup"]');
    await page.waitForFunction(() => document.getElementById('setupModal').classList.contains('hidden'));

    const periodBadgeText = await page.innerText('#periodBadge');
    assert.strictEqual(periodBadgeText, 'Quarter 1 / 4', 'Basketball period badge should show Quarter 1 / 4');
    const surfaceHeaderText = await page.innerText('#surfaceHeader');
    assert.ok(surfaceHeaderText.includes('On Court (5/5)'), `Surface header should include On Court (5/5), got "${surfaceHeaderText}"`);

    // Verify Soccer roster is still preserved when switching back in Setup
    await page.click('button[data-action="openSetup"]');
    await page.click('button[data-action="selectSport"][data-sport="soccer"]');
    const soccerRosterText = await page.innerText('#draftRosterList');
    assert.ok(soccerRosterText.includes('Mason'), 'Soccer roster should preserve Mason');
    await page.click('button[data-action="selectSport"][data-sport="basketball"]');
    await page.click('button[data-action="closeSetup"]');
    testPass('Multi-Sport Setup Selector & Isolated Per-Sport Storage (Soccer vs Basketball)');

    // ----------------------------------------------------
    // TEST 8: Basketball Line Swap, 3:30 Warning & 4:00 Mid-Quarter Alert
    // ----------------------------------------------------
    // Verify Recommended Sub card is positioned BELOW Bench list in the layout
    const isRecBelowBench = await page.evaluate(() => {
      const benchRect = document.getElementById('benchList').getBoundingClientRect();
      const recRect = document.getElementById('recommendCard').getBoundingClientRect();
      return recRect.top >= benchRect.bottom;
    });
    assert.strictEqual(isRecBelowBench, true, 'Recommended Sub card must be positioned below the Bench list');

    const recCardText = await page.innerText('#recommendCard');
    assert.ok(recCardText.includes('Recommended Line Sub (2 ⇄ 2)'), `Should show Recommended Line Sub (2 ⇄ 2), got "${recCardText}"`);
    assert.ok(recCardText.includes('Poole') && recCardText.includes('GP2'), 'Line sub should recommend Poole and GP2 in');

    // Start clock and advance to 3:30 warning window
    await page.click('#clockBtn');
    await page.evaluate(() => {
      state.match.clock.running = false;
      state.match.clock.startedAt = null;
      state.match.clock.elapsedMs = (3 * 60 + 30) * 1000;
      renderAll();
    });

    const warnBannerVisible = await page.isVisible('#midSubBanner:not(.hidden)');
    assert.strictEqual(warnBannerVisible, true, 'Mid-quarter warning banner should be visible at 3:30');
    const warnBannerText = await page.innerText('#midSubBanner');
    assert.ok(warnBannerText.includes('30s to Mid-Quarter Sub'), `3:30 banner should warn 30s to Mid-Quarter Sub, got "${warnBannerText}"`);
    assert.ok(warnBannerText.includes('Poole') && warnBannerText.includes('GP2'), '3:30 banner should list incoming players for Scorer\'s Table');

    // Advance to 4:00 mid-quarter sub due window while clock is running
    await page.evaluate(() => {
      state.match.clock.elapsedMs = 4 * 60 * 1000;
      state.match.clock.running = true;
      state.match.clock.startedAt = Date.now();
      renderAll();
    });

    const dueBannerText = await page.innerText('#midSubBanner');
    assert.ok(dueBannerText.includes('4:00 Mid-Quarter Sub Window!'), `4:00 banner should show due message, got "${dueBannerText}"`);

    // Execute 1-tap Make Line Sub (2 ⇄ 2)
    await page.click('button[data-action="makeBatchSub"]');
    const clockBtnAfterSub = await page.innerText('#clockBtn');
    assert.strictEqual(clockBtnAfterSub, 'START', 'Clock should automatically pause when Make Line Sub is clicked');
    const bannerVisibleAfterSub = await page.isVisible('#midSubBanner');
    assert.strictEqual(bannerVisibleAfterSub, false, 'Mid-quarter banner should hide after completing the line sub');
    const fieldTextAfterSub = await page.innerText('#fieldList');
    assert.ok(fieldTextAfterSub.includes('Poole') && fieldTextAfterSub.includes('GP2'), 'Poole and GP2 should now be on court');
    testPass('Basketball Line Swap Recommendation, 3:30 Table Warning, 4:00 Alert & Clock Pause');

    // ----------------------------------------------------
    // TEST 9: Basketball Multi-Point Scoring (+1, +2, +3), Badges & Recap
    // ----------------------------------------------------
    await page.click('#fieldList .player-card:first-child button[data-action="scoreUsBtn"][data-points="3"]');
    await page.click('#fieldList .player-card:first-child button[data-action="scoreUsBtn"][data-points="2"]');
    await page.click('header button[data-action="scoreThem"][data-points="2"]');

    assert.strictEqual(await page.innerText('#scoreUs'), '5', 'Us score should be 5 after +3 and +2');
    assert.strictEqual(await page.innerText('#scoreThem'), '2', 'Them score should be 2 after +2');

    // Award Basketball Rebound badge (🏀 Big Rebound)
    await page.click('#fieldList .player-card:first-child button[data-action="toggleBadgeDrawer"]');
    await page.click('button[data-action="awardBadge"][data-badge="rebound"]');
    const bballPill = await page.innerText('#fieldList .player-card:first-child .badge-pill');
    assert.ok(bballPill.includes('🏀 1'), `Basketball badge pill should show "🏀 1", got "${bballPill}"`);

    await page.click('button[data-action="openMatchLog"]');
    await page.waitForFunction(() => !document.getElementById('matchLogModal').classList.contains('hidden'));

    // Verify Player Box Score table shows all 7 players, quarter columns, shot mix, and fits cleanly in 390px width
    const topScorersText = await page.innerText('#logTopScorers');
    for (const pName of bballNames) {
      assert.ok(topScorersText.includes(pName), `Player Box Score should include ${pName}, got "${topScorersText}"`);
    }
    assert.ok(topScorersText.includes('Q1') && topScorersText.includes('Q4') && topScorersText.includes('PTS'), `Player Box Score should show Q1..Q4 and PTS columns, got "${topScorersText}"`);
    assert.ok(topScorersText.includes('5 PTS'), `Player Box Score should show 5 PTS, got "${topScorersText}"`);
    assert.ok(topScorersText.includes('1×3PT') && topScorersText.includes('1×2PT'), `Player Box Score should show shot mix breakdown (1×3PT, 1×2PT), got "${topScorersText}"`);

    const boxScoreOverflow = await page.evaluate(() => {
      const wrap = document.querySelector('#logTopScorers > div');
      return wrap ? wrap.scrollWidth > wrap.clientWidth : false;
    });
    assert.strictEqual(boxScoreOverflow, false, 'Player Box Score table should fit without horizontal overflow on 390px viewport');

    // Verify Play-by-Play drawer starts collapsed by default for clean screenshots
    const pbpInitiallyVisible = await page.isVisible('#logTimeline');
    assert.strictEqual(pbpInitiallyVisible, false, 'Scoring Play-by-Play drawer should start collapsed by default');

    // Expand Play-by-Play drawer and verify Q1 events and running score
    await page.click('button[data-action="togglePlayByPlay"]');
    await page.waitForFunction(() => !document.getElementById('logTimeline').classList.contains('hidden'));
    const timelineText = await page.innerText('#logTimeline');
    assert.ok(timelineText.includes('Q1') && timelineText.includes('🏀 +3') && timelineText.includes('🏀 +2'), `Timeline should show Q1 and +3/+2 points, got "${timelineText}"`);
    assert.ok(timelineText.includes('Them 🏀 +2'), `Timeline should show Them 🏀 +2, got "${timelineText}"`);
    assert.ok(timelineText.includes('5 - 2'), `Timeline should show running score 5 - 2, got "${timelineText}"`);

    const boxScoreText = await page.innerText('#logBoxScore');
    assert.ok(boxScoreText.includes('Q1') && boxScoreText.includes('5') && boxScoreText.includes('2'), `Box score should display quarter-by-quarter points, got "${boxScoreText}"`);

    const awardsText = await page.innerText('#logImpactAwards');
    assert.ok(awardsText.includes('Glass Cleaner') || awardsText.includes('Big Rebound'), `Impact awards should display rebound award, got "${awardsText}"`);

    const bballParentText = await page.evaluate(() => {
      const metrics = Engine.recapMetrics(state, Date.now());
      return generateParentSummaryText(metrics);
    });
    assert.ok(bballParentText.includes('Great basketball game today! 🏀'), 'Basketball parent summary should have basketball header');
    assert.ok(bballParentText.includes('equal court time'), 'Basketball parent summary should mention equal court time');
    assert.ok(bballParentText.includes('Big Rebound'), 'Basketball parent summary should include Big Rebound badge');

    await page.click('button[data-action="closeMatchLog"]');
    await page.waitForFunction(() => document.getElementById('matchLogModal').classList.contains('hidden'));
    testPass('Basketball Multi-Point Scoring (+1/+2/+3), Rebound Badge, Timeline & Parent Recap');

    // ----------------------------------------------------
    // TEST 10: Basketball Foul-Out & 1-Tap Replacement Modal
    // ----------------------------------------------------
    const fouledOutPlayerName = await page.innerText('#fieldList .player-card:first-child .font-black.text-lg');
    await page.click('#fieldList .player-card:first-child button[data-action="toggleFoulOutBtn"]');
    await page.waitForFunction(() => !document.getElementById('modalOverlay').classList.contains('hidden'));

    const foulModalTitle = await page.innerText('#modalTitle');
    assert.ok(foulModalTitle.includes(`${fouledOutPlayerName} Fouled Out`), `Modal title should state player fouled out, got "${foulModalTitle}"`);
    const foulOnlyBtnVisible = await page.isVisible('button[data-action="confirmFoulOutOnly"]');
    assert.strictEqual(foulOnlyBtnVisible, true, 'Modal should also include Mark Fouled Out Only option');

    await page.click('button[data-action="confirmFoulOutSub"]');
    await page.waitForFunction(() => document.getElementById('modalOverlay').classList.contains('hidden'));

    assert.strictEqual(await page.innerText('#fieldCount'), '5/5', 'Court should still have 5/5 players after foul-out replacement');
    const benchTextAfterFoul = await page.innerText('#benchList');
    assert.ok(benchTextAfterFoul.includes(fouledOutPlayerName) && benchTextAfterFoul.includes('FOULED OUT'), 'Bench should show fouled-out player with FOULED OUT pill');

    await page.click('button[data-action="openMatchLog"]');
    await page.waitForFunction(() => !document.getElementById('matchLogModal').classList.contains('hidden'));
    const playtimeText = await page.innerText('#logPlaytime');
    assert.ok(playtimeText.includes(`${fouledOutPlayerName} (Fouled Out)`), `Playtime summary should label "${fouledOutPlayerName} (Fouled Out)"`);
    testPass('Basketball On-Court Foul-Out Prompt & 1-Tap Bench Replacement');

    // ----------------------------------------------------
    // TEST 11: Real-World Clock/Sub/Reset Edge Cases in Browser
    // ----------------------------------------------------
    await page.click('button[data-action="closeMatchLog"]');
    await page.waitForFunction(() => document.getElementById('matchLogModal').classList.contains('hidden'));

    // 11a: Select a player for manual swap (tap name on card), then execute Make Line Sub -> manual swap bar must auto-clear
    await page.click('#fieldList .player-card:first-child .font-black.text-lg');
    assert.strictEqual(await page.isVisible('#manualSwapBar:not(.hidden)'), true, 'Manual swap bar should open when tapping a court player');
    await page.click('button[data-action="makeBatchSub"]');
    assert.strictEqual(await page.isVisible('#manualSwapBar:not(.hidden)'), false, 'Manual swap bar must clear when Make Line Sub is executed');

    // 11b: Live fairness badges on player cards must show non-zero +/- values after play time
    const fairnessBadges = await page.$$eval('#fieldList .fairness-badge, #benchList .fairness-badge', els => els.map(e => e.textContent.trim()));
    assert.ok(fairnessBadges.some(txt => txt !== '0:00'), `Fairness badges should show live +/- deltas, got ${JSON.stringify(fairnessBadges)}`);

    // 11c: Bare Reset must NOT be in main footer; Reset Match lives in Setup Danger Zone
    assert.strictEqual(
      await page.locator('main button[data-action="resetMatchConfirm"]').count(),
      0,
      'Bare Reset button must not be in main dashboard footer'
    );
    await page.click('button[data-action="openSetup"]');
    await page.waitForFunction(() => !document.getElementById('setupModal').classList.contains('hidden'));
    await page.click('#setupDangerZone button[data-action="resetMatchConfirm"]');
    await page.waitForFunction(() => !document.getElementById('modalOverlay').classList.contains('hidden'));
    await page.click('#modalButtons button[data-action="resetMatch"]');
    await page.waitForFunction(() =>
      document.getElementById('setupModal').classList.contains('hidden') &&
      document.getElementById('modalOverlay').classList.contains('hidden')
    );
    assert.strictEqual(await page.innerText('#scoreUs'), '0', 'Score Us must reset to 0 on Reset Match');
    assert.strictEqual(await page.innerText('#scoreThem'), '0', 'Score Them must reset to 0 on Reset Match');
    assert.strictEqual(await page.locator('#fieldList .badge-pill, #benchList .badge-pill').count(), 0, 'Badges must clear on Reset Match');
    assert.strictEqual(await page.evaluate(() => state.match.events.length), 0, 'Events must clear on Reset Match');
    testPass('Real-World Edge Cases: Manual Swap Auto-Clear, Live Fairness Deltas & Setup Danger Zone Reset');

    // ----------------------------------------------------
    // TEST 12: Soccer Shorthanded Start, Live Late Arrival to Open Field Slot, Inline Not Here Yet Check-In, Left Early Swap & Undo
    // ----------------------------------------------------
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('setupModal').classList.contains('hidden'));

    const t12Players = ['Alex', 'Sam', 'Jordan', 'Taylor', 'AbsentKid'];
    for (const name of t12Players) {
      await page.fill('#draftPlayerName', name);
      await page.click('button[data-action="draftAddPlayer"]');
    }
    for (let i = 1; i <= 4; i++) {
      await page.click(`#draftRosterList .player-card:nth-child(${i}) button[data-action="draftToggleStarter"]`);
    }
    await page.click('#draftRosterList .player-card:nth-child(5) button[data-action="draftToggleAbsent"]');
    assert.strictEqual(await page.innerText('#draftStarterCount'), '4', 'Starter count should be 4');
    assert.strictEqual(await page.innerText('#draftTargetStarters'), '4', 'Target starters should pass at 4/4 with 1 absent');

    await page.click('button[data-action="saveSetup"]');
    await page.waitForFunction(() => document.getElementById('setupModal').classList.contains('hidden'));

    await page.click('#clockBtn');
    assert.strictEqual(await page.innerText('#clockBtn'), 'PAUSE', 'Clock should be running');
    await page.click('#fieldList .player-card:first-child button[data-action="scoreUsBtn"]');
    assert.strictEqual(await page.innerText('#scoreUs'), '1', 'Us score should be 1');
    await page.waitForTimeout(1100);

    assert.strictEqual(await page.innerText('#fieldCount'), '4/5', 'Field count should be 4/5 on shorthanded start');
    assert.strictEqual(await page.isVisible('#notHereSection:not(.hidden)'), true, '#notHereSection should be visible');
    assert.strictEqual(await page.innerText('#notHereToggleLabel'), 'Not Here Yet (1)', 'Toggle should show Not Here Yet (1)');

    await page.click('button[data-action="openRoster"]');
    await page.waitForFunction(() => !document.getElementById('rosterModal').classList.contains('hidden'));
    assert.strictEqual(await page.isVisible('#liveAddFieldBtn:not(.hidden)'), true, '+ Add to Field button should be visible');
    assert.strictEqual(await page.innerText('#liveAddFieldBtn'), '+ Add to Field', 'Soccer open-slot add button should say + Add to Field');
    await page.fill('#livePlayerName', 'LateSam');
    await page.click('button[data-action="liveAddField"]');
    assert.strictEqual(await page.innerText('#fieldCount'), '5/5', 'Field count should become 5/5 after liveAddField');
    assert.strictEqual(await page.innerText('#scoreUs'), '1', 'Score Us must stay 1 after liveAddField');
    assert.strictEqual(await page.innerText('#clockBtn'), 'PAUSE', 'Clock must stay running (PAUSE) after liveAddField');
    assert.strictEqual(await page.isVisible('#liveAddFieldBtn:not(.hidden)'), false, '+ Add to Field must hide when field is full');

    await page.click('button[data-action="closeRoster"]');
    await page.waitForFunction(() => document.getElementById('rosterModal').classList.contains('hidden'));

    await page.click('#notHereToggleBtn');
    await page.waitForFunction(() => !document.getElementById('notHereList').classList.contains('hidden'));
    assert.strictEqual(await page.innerText('#benchCount'), '0', 'Bench count should be 0 before check-in');
    await page.click('#notHereList button[data-action="quickArrivedBench"]');
    assert.strictEqual(await page.innerText('#benchCount'), '1', 'Bench count should increment to 1 after check-in');
    assert.strictEqual(await page.isVisible('#notHereSection'), false, '#notHereSection should hide when nobody is absent');
    assert.strictEqual(await page.isVisible('#undoBar:not(.hidden)'), true, 'Undo bar should be visible');
    assert.ok((await page.innerText('#undoLabel')).includes('AbsentKid Arrived'), 'Undo bar should show AbsentKid Arrived');

    // Undo arrival while clock continues running, then check AbsentKid back in
    await page.click('#undoBar[data-action="undo"]');
    assert.strictEqual(await page.innerText('#benchCount'), '0', 'Undo should revert AbsentKid back out of bench');
    assert.strictEqual(await page.isVisible('#notHereSection:not(.hidden)'), true, 'Undo should restore Not Here Yet section');
    assert.strictEqual(await page.innerText('#clockBtn'), 'PAUSE', 'Clock must stay running across arrival undo');
    await page.click('#notHereToggleBtn');
    await page.waitForFunction(() => !document.getElementById('notHereList').classList.contains('hidden'));
    await page.click('#notHereList button[data-action="quickArrivedBench"]');
    assert.strictEqual(await page.innerText('#benchCount'), '1', 'Bench count should return to 1 on re-arrival');

    // Mark an on-field player Left Early with Swap replacement
    await page.click('button[data-action="openRoster"]');
    await page.waitForFunction(() => !document.getElementById('rosterModal').classList.contains('hidden'));
    await page.click('#rosterPresentList .player-card:first-child button[data-action="rosterMarkAbsent"]');
    await page.waitForFunction(() => !document.getElementById('modalOverlay').classList.contains('hidden'));
    assert.strictEqual(await page.isVisible('#modalButtons button[data-action="confirmAbsentSwap"]'), true, 'Left Early modal must offer Swap');
    assert.strictEqual(await page.isVisible('#modalButtons button[data-action="confirmAbsentLeaveOpen"]'), true, 'Left Early modal must offer Leave Open');
    await page.click('#modalButtons button[data-action="confirmAbsentSwap"]');
    await page.waitForFunction(() => document.getElementById('modalOverlay').classList.contains('hidden'));

    assert.strictEqual(await page.innerText('#fieldCount'), '5/5', 'Field count should remain 5/5 after Left Early swap');
    assert.strictEqual(await page.innerText('#scoreUs'), '1', 'Score Us should remain 1 after Left Early swap');
    assert.strictEqual(await page.isVisible('#rosterAbsentSection:not(.hidden)'), true, 'Absent section in Roster should be visible');
    const absentText = await page.innerText('#rosterAbsentList');
    assert.ok(absentText.includes('Alex') && absentText.includes('Left Early'), `Alex should move to Absent section with Left Early badge, got "${absentText}"`);

    // Clicking trash on a player with playtime shows stat-preservation modal instead of deleting them
    await page.click('#rosterAbsentList .player-card:first-child button[data-action="rosterRemoveBtn"]');
    await page.waitForFunction(() => !document.getElementById('modalOverlay').classList.contains('hidden'));
    const statModalTitle = await page.innerText('#modalTitle');
    assert.ok(statModalTitle.includes('Match Stats Preserved'), `Should show stat-preservation modal, got "${statModalTitle}"`);
    await page.click('#modalButtons button[data-action="closeModal"]');
    await page.waitForFunction(() => document.getElementById('modalOverlay').classList.contains('hidden'));
    assert.ok((await page.innerText('#rosterAbsentList')).includes('Alex'), 'Alex must remain in roster after stat-preservation modal');
    await page.click('button[data-action="closeRoster"]');
    await page.waitForFunction(() => document.getElementById('rosterModal').classList.contains('hidden'));
    testPass('Soccer Shorthanded Start, Live Late Arrival, Inline Check-In, Left Early Swap & Undo');

    // ----------------------------------------------------
    // TEST 13: Basketball Live Roster Parity (Court labels, + Court open-slot entry, prorated batch line sub & foul-out exclusion)
    // ----------------------------------------------------
    await page.click('button[data-action="openSetup"]');
    await page.waitForFunction(() => !document.getElementById('setupModal').classList.contains('hidden'));
    await page.click('button[data-action="selectSport"][data-sport="basketball"]');
    await page.waitForFunction(() => !document.getElementById('modalOverlay').classList.contains('hidden'));
    const switchTitle = await page.innerText('#modalTitle');
    assert.ok(switchTitle.includes('Switch to 🏀 Basketball?'), `Sport-switch confirmation modal should show, got "${switchTitle}"`);
    await page.click('#modalButtons button[data-action="confirmSwitchSport"]');
    await page.waitForFunction(() => document.getElementById('modalOverlay').classList.contains('hidden'));

    const soccerRunningAfterSwitch = await page.evaluate(() => JSON.parse(localStorage.getItem('SSM_V3')).match.clock.running);
    assert.strictEqual(soccerRunningAfterSwitch, false, 'Live Soccer clock must be paused when switching to Basketball');

    const t13Players = ['Curry', 'Klay', 'Green', 'Wiggins', 'Looney', 'LateBaller'];
    for (const name of t13Players) {
      await page.fill('#draftPlayerName', name);
      await page.click('button[data-action="draftAddPlayer"]');
    }
    for (let i = 1; i <= 4; i++) {
      await page.click(`#draftRosterList .player-card:nth-child(${i}) button[data-action="draftToggleStarter"]`);
    }
    await page.click('#draftRosterList .player-card:nth-child(5) button[data-action="draftToggleAbsent"]');
    await page.click('#draftRosterList .player-card:nth-child(6) button[data-action="draftToggleAbsent"]');
    await page.click('button[data-action="saveSetup"]');
    await page.waitForFunction(() => document.getElementById('setupModal').classList.contains('hidden'));

    await page.click('#clockBtn');
    assert.strictEqual(await page.innerText('#surfaceHeader'), 'On Court (4/5)', 'Surface header should show On Court (4/5)');

    // Check in Looney to Bench while court is 4/5 so Bench card exposes + Court open-slot button
    await page.click('#notHereToggleBtn');
    await page.waitForFunction(() => !document.getElementById('notHereList').classList.contains('hidden'));
    await page.locator('#notHereList .player-card', { hasText: 'Looney' }).locator('button[data-action="quickArrivedBench"]').click();
    assert.strictEqual(
      await page.innerText('#benchList .player-card button[data-action="enterFieldBtn"]'),
      '+ Court',
      'Bench card should show + Court button in Basketball open-slot state'
    );

    await page.click('#benchList .player-card button[data-action="enterFieldBtn"]');
    assert.strictEqual(await page.innerText('#surfaceHeader'), 'On Court (5/5)', 'Surface header should update to On Court (5/5)');
    assert.strictEqual(await page.locator('#benchList button[data-action="enterFieldBtn"]').count(), 0, '+ Court button must disappear at 5/5');

    await page.waitForTimeout(1100);
    assert.strictEqual(await page.innerText('#notHereToggleLabel'), 'Not Here Yet (1)', 'LateBaller should remain in Not Here Yet (1)');
    await page.locator('#notHereList .player-card', { hasText: 'LateBaller' }).locator('button[data-action="quickArrivedBench"]').click();
    assert.strictEqual(await page.innerText('#benchCount'), '1', 'Bench count should be 1 after LateBaller arrives');
    assert.strictEqual(await page.isVisible('#notHereSection'), false, '#notHereSection should hide after LateBaller checks in');

    const recCardTextT13 = await page.innerText('#recommendCard');
    assert.ok(recCardTextT13.includes('Recommended Line Sub (1 ⇄ 1)'), `Batch line sub should show 1 ⇄ 1, got "${recCardTextT13}"`);
    assert.ok(recCardTextT13.includes('LateBaller'), 'Batch recommendation should suggest LateBaller IN');
    await page.click('button[data-action="makeBatchSub"]');
    assert.ok((await page.innerText('#fieldList')).includes('LateBaller'), 'LateBaller should move onto court after Make Line Sub');

    // Foul-out exclusion: mark the single bench player fouled out -> recommendBatch hides and noneEligibleNotice shows
    await page.click('#benchList .player-card:first-child button[data-action="toggleFoulOutBtn"]');
    assert.strictEqual(await page.isVisible('#recommendCard:not(.hidden)'), false, 'Fouled-out bench player must be excluded from batch recommendations');
    assert.strictEqual(await page.isVisible('#noneEligibleNotice:not(.hidden)'), true, 'All bench players resting/fouled out notice should display');

    // Roster modal uses Court labels in Basketball
    await page.click('button[data-action="openRoster"]');
    await page.waitForFunction(() => !document.getElementById('rosterModal').classList.contains('hidden'));
    const rosterPresentText = await page.innerText('#rosterPresentList');
    assert.ok(rosterPresentText.includes('On Court'), 'Roster modal must use On Court label in Basketball');
    assert.strictEqual(rosterPresentText.includes('On Field'), false, 'Roster modal must not use On Field label in Basketball');
    await page.locator('#rosterPresentList .player-card', { hasText: 'On Court' }).first().locator('button[data-action="rosterMarkAbsent"]').click();
    await page.waitForFunction(() => !document.getElementById('modalOverlay').classList.contains('hidden'));
    await page.click('#modalButtons button[data-action="confirmAbsentLeaveOpen"]');
    await page.waitForFunction(() => document.getElementById('modalOverlay').classList.contains('hidden'));
    assert.strictEqual(await page.innerText('#liveAddFieldBtn'), '+ Add to Court', 'Open-slot quick-add button should say + Add to Court');
    assert.strictEqual(await page.innerText('#rosterAbsentList button[data-action="rosterArrivedField"]'), '→ Court', 'Absent check-in button should say → Court');
    await page.click('button[data-action="closeRoster"]');
    await page.waitForFunction(() => document.getElementById('rosterModal').classList.contains('hidden'));
    testPass('Basketball Live Roster Parity (Court labels, + Court, Batch Sub & Foul-Out Exclusion)');

    // ----------------------------------------------------
    // TEST 14: Match Report Prorated Gauges, Absentee Exclusion & XSS Safety
    // ----------------------------------------------------
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('setupModal').classList.contains('hidden'));

    const t14Players = ['Mia', 'Leo', 'Ava', 'Jack', 'FullAbsent'];
    for (const name of t14Players) {
      await page.fill('#draftPlayerName', name);
      await page.click('button[data-action="draftAddPlayer"]');
    }
    for (let i = 1; i <= 4; i++) {
      await page.click(`#draftRosterList .player-card:nth-child(${i}) button[data-action="draftToggleStarter"]`);
    }
    await page.click('#draftRosterList .player-card:nth-child(5) button[data-action="draftToggleAbsent"]');
    await page.click('button[data-action="saveSetup"]');
    await page.waitForFunction(() => document.getElementById('setupModal').classList.contains('hidden'));

    await page.click('#clockBtn');
    await page.click('#fieldList .player-card:first-child button[data-action="scoreUsBtn"]');
    await page.click('#fieldList .player-card:first-child button[data-action="toggleBadgeDrawer"]');
    await page.click('button[data-action="awardBadge"][data-badge="hustle"]');
    await page.waitForTimeout(1100);

    // Quick-add validation rejects >20-char XSS payload safely, and <=20-char XSS payload renders literally
    const shortXssPayload = '<svg onload=__x=1>';
    const longXssPayload = '<img src=x onerror=window.__xss=1>';
    await page.click('button[data-action="openRoster"]');
    await page.waitForFunction(() => !document.getElementById('rosterModal').classList.contains('hidden'));
    await page.fill('#livePlayerName', longXssPayload);
    await page.click('button[data-action="liveAddBench"]');
    assert.strictEqual(await page.isVisible('#rosterErrors:not(.hidden)'), true, 'Validation should reject >20 char player name');
    assert.strictEqual(await page.evaluate(() => window.__xss), undefined, 'Rejected long XSS payload must not execute');

    await page.fill('#livePlayerName', shortXssPayload);
    await page.click('button[data-action="liveAddBench"]');
    assert.strictEqual(await page.evaluate(() => window.__x), undefined, 'window.__x must remain undefined after UI quick-add');
    assert.strictEqual(await page.locator('svg').count(), 0, 'No <svg> element should ever be injected into DOM');
    assert.ok((await page.innerText('#rosterPresentList')).includes(shortXssPayload), 'Roster modal should render XSS payload as literal text');

    // Mark Jack Left Early (leave slot open) so Match Report exercises Late Arrival, Left Early, and Absent together
    await page.waitForTimeout(1100);
    await page.locator('#rosterPresentList .player-card', { hasText: 'Jack' }).locator('button[data-action="rosterMarkAbsent"]').click();
    await page.waitForFunction(() => !document.getElementById('modalOverlay').classList.contains('hidden'));
    await page.click('#modalButtons button[data-action="confirmAbsentLeaveOpen"]');
    await page.waitForFunction(() => document.getElementById('modalOverlay').classList.contains('hidden'));
    await page.click('button[data-action="closeRoster"]');
    await page.waitForFunction(() => document.getElementById('rosterModal').classList.contains('hidden'));

    // Check literal rendering in Bench and Setup
    assert.ok((await page.innerText('#benchList')).includes(shortXssPayload), 'Bench card should render XSS payload as literal text');
    await page.click('button[data-action="openSetup"]');
    await page.waitForFunction(() => !document.getElementById('setupModal').classList.contains('hidden'));
    assert.ok((await page.innerText('#draftRosterList')).includes(shortXssPayload), 'Setup roster should render XSS payload as literal text');
    await page.click('button[data-action="closeSetup"]');
    await page.waitForFunction(() => document.getElementById('setupModal').classList.contains('hidden'));

    // Check Match Report gauges, prorated labels, absentee omission & XSS safety
    await page.click('button[data-action="openMatchLog"]');
    await page.waitForFunction(() => !document.getElementById('matchLogModal').classList.contains('hidden'));
    assert.strictEqual(await page.evaluate(() => window.__x), undefined, 'window.__x must remain undefined in Match Report');
    assert.strictEqual(await page.locator('svg').count(), 0, 'No <svg> element should exist in Match Report DOM');

    const logScorersText = await page.innerText('#logTopScorers');
    assert.ok(logScorersText.includes(shortXssPayload), 'Player Box Score should render XSS payload as literal text');

    const logPlaytimeText = await page.innerText('#logPlaytime');
    assert.ok(logPlaytimeText.includes(shortXssPayload) && logPlaytimeText.includes('(Late Arrival)'), `Late arrival should display (Late Arrival) in #logPlaytime, got "${logPlaytimeText}"`);
    assert.ok(logPlaytimeText.includes('Jack') && logPlaytimeText.includes('(Left Early)'), `Left early player should display (Left Early) in #logPlaytime, got "${logPlaytimeText}"`);
    assert.ok(logPlaytimeText.includes('FullAbsent') && logPlaytimeText.includes('Absent'), `Full-game absent player should display Absent in #logPlaytime, got "${logPlaytimeText}"`);

    const summaryText = await page.evaluate(() => generateParentSummaryText(Engine.recapMetrics(state, Date.now())));
    assert.ok(summaryText.includes('Mia') && summaryText.includes(shortXssPayload), 'Parent summary should include active/late players');
    assert.strictEqual(summaryText.includes('FullAbsent'), false, 'Parent summary must omit full-game absent player');

    await page.click('button[data-action="closeMatchLog"]');
    await page.waitForFunction(() => document.getElementById('matchLogModal').classList.contains('hidden'));

    // Also verify longer 31-char <img src=x onerror=window.__xss=1> payload via state normalization/render across all views
    await page.evaluate((payload) => {
      const injected = Engine.normalize({
        v: 4,
        sport: 'soccer',
        settings: { fieldSize: 2, periodMinutes: 8, periodCount: 4 },
        roster: [{ id: 'xss1', name: payload }, { id: 'p2', name: 'Ben' }],
        starterIds: ['xss1', 'p2'],
        match: {
          period: 1,
          clock: { running: false, startedAt: null, elapsedMs: 60000 },
          completedPeriodsMs: 0,
          players: {
            xss1: {
              onField: true, stintStartMs: 0, periodMs: [60000, 0, 0, 0],
              resting: false, fouledOut: false, absent: false,
              arrivedAtMs: 0, firstArrivedAtMs: 0, departedAtMs: null, presentMs: 0,
              badges: [{ id: 'b1', type: 'hustle', timestampMs: 10000 }]
            },
            p2: {
              onField: true, stintStartMs: 0, periodMs: [60000, 0, 0, 0],
              resting: false, fouledOut: false, absent: false,
              arrivedAtMs: 0, firstArrivedAtMs: 0, departedAtMs: null, presentMs: 0,
              badges: []
            }
          },
          pinnedId: null, skipIds: [], undo: null,
          score: { us: 1, them: 0 },
          events: [{ id: 'e1', type: 'goal_us', playerId: 'xss1', points: 1, period: 1, clockMs: 20000 }],
          lastSubOutId: null, midSubDoneForPeriod: 0
        }
      });
      state = injected;
      save();
      renderAll();
    }, longXssPayload);

    assert.strictEqual(await page.evaluate(() => window.__xss), undefined, 'Normalized long XSS payload must not execute on Dashboard');
    assert.ok((await page.innerText('#fieldList')).includes(longXssPayload), 'Dashboard must render long XSS payload literally');

    await page.click('button[data-action="openRoster"]');
    await page.waitForFunction(() => !document.getElementById('rosterModal').classList.contains('hidden'));
    assert.ok((await page.innerText('#rosterPresentList')).includes(longXssPayload), 'Roster must render long XSS payload literally');
    await page.click('button[data-action="closeRoster"]');

    await page.click('button[data-action="openSetup"]');
    await page.waitForFunction(() => !document.getElementById('setupModal').classList.contains('hidden'));
    assert.ok((await page.innerText('#draftRosterList')).includes(longXssPayload), 'Setup must render long XSS payload literally');
    await page.click('button[data-action="closeSetup"]');

    await page.click('button[data-action="openMatchLog"]');
    await page.waitForFunction(() => !document.getElementById('matchLogModal').classList.contains('hidden'));
    await page.click('button[data-action="togglePlayByPlay"]');
    await page.waitForFunction(() => !document.getElementById('logTimeline').classList.contains('hidden'));
    assert.strictEqual(await page.evaluate(() => window.__xss), undefined, 'window.__xss must stay undefined across Roster, Setup & Match Report');
    assert.strictEqual(await page.locator('img').count(), 0, 'No <img> element should ever be injected into DOM');
    assert.ok((await page.innerText('#logTopScorers')).includes(longXssPayload), 'Match Report box score must render long XSS payload literally');
    assert.ok((await page.innerText('#logImpactAwards')).includes(longXssPayload), 'Impact awards must render long XSS payload literally');
    assert.ok((await page.innerText('#logTimeline')).includes(longXssPayload), 'Play-by-Play must render long XSS payload literally');
    assert.ok((await page.innerText('#logPlaytime')).includes(longXssPayload), 'Playtime summary must render long XSS payload literally');
    await page.click('button[data-action="closeMatchLog"]');
    testPass('Match Report Prorated Gauges, Absentee Exclusion & XSS Safety');

    assert.deepStrictEqual(pageErrors, [], `Expected zero uncaught page errors, got: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `Expected zero console errors, got: ${JSON.stringify(consoleErrors)}`);

    console.log('\n✨ ALL 14 PLAYWRIGHT E2E TESTS PASSED SUCCESSFULLY! ✨');

  } catch (err) {
    console.error('\n❌ E2E TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
