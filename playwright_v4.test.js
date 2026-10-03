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
    
    // Make recommended sub
    await page.click('button[data-action="makeSub"]');
    
    // Check Undo bar label
    const undoVisible = await page.isVisible('#undoBar:not(.hidden)');
    assert.strictEqual(undoVisible, true, 'Undo bar should be visible after substitution');
    testPass('Clock Operation & Substitution with Undo Snapshot');

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

    console.log('\n✨ ALL 5 PLAYWRIGHT E2E TESTS PASSED SUCCESSFULLY! ✨');

  } catch (err) {
    console.error('\n❌ E2E TEST FAILED:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
