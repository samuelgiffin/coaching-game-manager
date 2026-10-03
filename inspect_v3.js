const { chromium } = require('playwright');
const path = require('path');

(async () => {
  // Launch browser
  const browser = await chromium.launch();
  
  // Create a mobile context (e.g. iPhone 13)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  
  const page = await context.newPage();
  
  // Load the v3 HTML
  const fileUrl = `file://${path.join(__dirname, 'soccer_sub_manager_v3.html')}`;
  console.log(`Loading ${fileUrl}...`);
  await page.goto(fileUrl);
  
  // 1. Screenshot of the initial Setup Modal (since roster is empty)
  await page.screenshot({ path: 'v3_01_setup_modal.png' });
  console.log('Saved v3_01_setup_modal.png');
  
  // 2. Inject sample state into localStorage to bypass setup and view the main dashboard
  await page.evaluate(() => {
    const sampleState = {
      v: 3,
      settings: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
      roster: [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
        { id: '3', name: 'Charlie' },
        { id: '4', name: 'David' },
        { id: '5', name: 'Eve' },
        { id: '6', name: 'Frank' },
        { id: '7', name: 'Grace' }
      ],
      starterIds: ['1', '2', '3', '4', '5'],
      match: {
        period: 1,
        clock: { running: false, startedAt: null, elapsedMs: 0 },
        players: {
          '1': { onField: true, stintStartMs: 0, periodMs: [0, 0, 0, 0], resting: false },
          '2': { onField: true, stintStartMs: 0, periodMs: [0, 0, 0, 0], resting: false },
          '3': { onField: true, stintStartMs: 0, periodMs: [0, 0, 0, 0], resting: false },
          '4': { onField: true, stintStartMs: 0, periodMs: [0, 0, 0, 0], resting: false },
          '5': { onField: true, stintStartMs: 0, periodMs: [0, 0, 0, 0], resting: false },
          '6': { onField: false, stintStartMs: 0, periodMs: [0, 0, 0, 0], resting: false },
          '7': { onField: false, stintStartMs: 0, periodMs: [0, 0, 0, 0], resting: false }
        },
        pinnedId: null,
        skipIds: [],
        undo: null
      }
    };
    localStorage.setItem('SSM_V3', JSON.stringify(sampleState));
    // Reload the app to pick up the injected state
    window.location.reload();
  });
  
  // Wait for reload
  await page.waitForLoadState('networkidle');
  
  // 3. Screenshot of the main dashboard with players loaded
  await page.screenshot({ path: 'v3_02_main_dashboard.png', fullPage: true });
  console.log('Saved v3_02_main_dashboard.png');

  // 4. Start the clock and wait 2 seconds, then pause to see active clock UI
  await page.click('[data-action="toggleClock"]'); // Starts clock
  await page.waitForTimeout(2000);
  await page.click('[data-action="toggleClock"]'); // Pauses clock
  await page.screenshot({ path: 'v3_03_clock_running.png', fullPage: true });
  console.log('Saved v3_03_clock_running.png');

  // 5. Test manual swap UI
  // Tap the first field player
  await page.click('[data-action="tapField"]:first-child');
  // Tap the first bench player
  await page.click('[data-action="tapBench"]:first-child');
  await page.waitForTimeout(300); // Wait for UI update
  await page.screenshot({ path: 'v3_04_manual_swap.png', fullPage: true });
  console.log('Saved v3_04_manual_swap.png');

  // Cancel swap
  await page.click('[data-action="cancelSwap"]');
  await page.waitForTimeout(300);

  // 6. Test Match Report
  // Record a few goals
  await page.locator('[data-action="scoreUsBtn"]').nth(0).click(); // goal for us
  await page.waitForTimeout(100);
  await page.locator('[data-action="scoreUsBtn"]').nth(1).click(); // another goal for us
  await page.waitForTimeout(100);
  await page.click('[data-action="scoreThem"]'); // goal for them
  await page.waitForTimeout(300);

  // Open match log
  await page.click('[data-action="openMatchLog"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'v3_05_match_report.png' });
  console.log('Saved v3_05_match_report.png');

  await browser.close();
  console.log('Inspection complete! Please check the generated PNGs.');
})();
