// Stage 7 before/after screenshots (rule 1). PREFIX=before|after, QA_OUT default docs/evidence/stage7/shots.
// Uses the real v4 data from Stage 6 (tests/fixtures/v4-stage6.json). SCREENS=comma list of routes.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage7/shots');
const PREFIX = process.env.PREFIX ?? 'after';
const SCREENS = (process.env.SCREENS ?? 'itinerary,calendar,settings').split(',');
const PORT = Number(process.env.PORT ?? 8120);
const BASE_DIR = process.env.BASE_DIR ?? ROOT;
fs.mkdirSync(OUT, { recursive: true });
const VIEWS = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const seed = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v4-stage6.json'), 'utf8');

(async () => {
  const server = spawn(process.execPath, [path.join(BASE_DIR, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  try {
    for (const [view, viewport] of Object.entries(VIEWS)) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: view === 'mobile' ? 2 : 1, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });
      await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date('2026-12-11T10:00:00+07:00'));
      for (const route of SCREENS) {
        await page.goto(`http://127.0.0.1:${PORT}/#/${route}`);
        await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400); // thumbnails load from IndexedDB; screenshots only
        await page.screenshot({ path: `${OUT}/${PREFIX}-${route}-${view}.png`, fullPage: true });
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log('shots in', OUT);
})();
