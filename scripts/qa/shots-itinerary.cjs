// Before/after shots of the itinerary screen (rule 1), with the suggested route loaded. 375 and 1280.
// Stage 9 (owner, 2026-11-21): the old route and the 3 old profiles moved to the archive; this script uses them from there.
// BASE_DIR serves another checkout (main, for "before"). Writes to QA_OUT. Waits for UI state (rule 6).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const SERVE_DIR = process.env.BASE_DIR ? path.resolve(process.env.BASE_DIR) : ROOT;
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/6.0b');
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const server = spawn(process.execPath, [path.join(SERVE_DIR, 'scripts/serve.js')], { cwd: SERVE_DIR, env: { ...process.env, PORT: '8092' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  for (const [view, viewport] of Object.entries({ mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } })) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-12-06T10:00:00+07:00'));
    await page.goto('http://127.0.0.1:8092/#/itinerary');
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    await page.click('[data-slot="itin-empty"] [data-action="seed-archive-open"]');
    await page.click('[data-action="seed-confirm"]');
    await page.waitForSelector('#dlg-seed:not([open])', { state: 'attached' });
    await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 6000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.itin-trip').scrollIntoViewIfNeeded(); // 1.1.4: the global tool links moved to the tools tab
    await page.screenshot({ path: `${OUT}/${PREFIX}-itinerary-${view}.png` });
    await ctx.close();
  }
  await browser.close();
  server.kill();
})().catch((e) => { console.error(e); process.exit(2); });
