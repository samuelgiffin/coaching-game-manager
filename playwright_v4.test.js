const { chromium } = require('playwright');
const path = require('path');
const assert = require('node:assert');

(async () => {
  console.log('🚀 Starting Playwright E2E Test Suite for Soccer Sub Manager v4...\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const filePath = 'file://' + path.resolve(__dirname, 'soccer_sub_manager_v4.html');

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

    const timelineText = await page.innerText('#logTimeline');
    assert.ok(timelineText.includes('Q1') && timelineText.includes('🏀 +3') && timelineText.includes('🏀 +2'), `Timeline should show Q1 and +3/+2 points, got "${timelineText}"`);
    assert.ok(timelineText.includes('Them 🏀 +2'), `Timeline should show Them 🏀 +2, got "${timelineText}"`);

    const topScorersText = await page.innerText('#logTopScorers');
    assert.ok(topScorersText.includes('🏀 5 pts'), `Top scorers should show 🏀 5 pts, got "${topScorersText}"`);

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

    console.log('\n✨ ALL 10 PLAYWRIGHT E2E TESTS PASSED SUCCESSFULLY! ✨');

  } catch (err) {
    console.error('\n❌ E2E TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
