const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });

  const fileUrl = `file://${path.join(__dirname, 'soccer_sub_manager_v3.html')}`;
  await page.goto(fileUrl);
  
  await page.evaluate(() => {
    const sampleState = {
      v: 3,
      settings: { fieldSize: 5, periodMinutes: 8, periodCount: 4 },
      roster: [{ id: '1', name: 'Alice' }],
      starterIds: ['1'],
      match: {
        period: 1,
        clock: { running: false, startedAt: null, elapsedMs: 0 },
        players: { '1': { onField: true, stintStartMs: 0, periodMs: [0, 0, 0, 0], resting: false } },
        pinnedId: null, skipIds: [], undo: null, score: { us: 0, them: 0 }, events: []
      }
    };
    localStorage.setItem('SSM_V3', JSON.stringify(sampleState));
  });
  await page.reload();
  
  await page.locator('[data-action="scoreUsBtn"]').nth(0).click();
  await page.click('[data-action="openMatchLog"]');
  
  await browser.close();
})();
