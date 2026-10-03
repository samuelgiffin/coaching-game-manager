const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const filePath = 'file://' + path.resolve(__dirname, 'soccer_sub_manager_v4.html');
  
  console.log(`Loading ${filePath}...`);
  await page.goto(filePath);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Add 7 players
  const names = ['Mason', 'Mia', 'Leo', 'Ava', 'Jack', 'Noah', 'Emma'];
  for (const name of names) {
    await page.fill('#draftPlayerName', name);
    await page.click('button[data-action="draftAddPlayer"]');
  }

  // Toggle first 5 to Starters using nth-child selector
  for (let i = 1; i <= 5; i++) {
    await page.click(`#draftRosterList .player-card:nth-child(${i}) button`);
  }

  await page.click('button[data-action="saveSetup"]');
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'v4_01_main_dashboard.png' });
  console.log('Saved v4_01_main_dashboard.png');

  // Open Badge Drawer on Mason
  await page.click('button[data-action="toggleBadgeDrawer"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'v4_02_badge_drawer.png' });
  console.log('Saved v4_02_badge_drawer.png');

  // Award a badge to Mason
  await page.click('button[data-action="awardBadge"][data-badge="hustle"]');

  // Open Match Recap / Report Modal
  await page.click('button[data-action="openMatchLog"]');
  await page.waitForSelector('#matchLogModal:not(.hidden)');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'v4_03_recap_gauge.png' });
  console.log('Saved v4_03_recap_gauge.png');

  await browser.close();
  console.log('v4 Inspection complete!');
})();
