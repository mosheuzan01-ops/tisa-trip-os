// Stage 8 design: dark-mode screenshots (first screen only). QA_OUT default docs/evidence/stage8-design/shots.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage8-design/shots');
fs.mkdirSync(OUT, { recursive: true });
const seed = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v4-stage6.json'), 'utf8');
(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: '8123' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('s')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('s', '1'); } }, seed);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2026-12-11T10:00:00+07:00'));
  for (const r of (process.env.SCREENS ?? 'home,money,summary').split(',')) {
    await page.goto(`http://127.0.0.1:8123/#/${r}`);
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${OUT}/${process.env.PREFIX ?? 'v3'}-${r}-dark.png` });
  }
  await browser.close(); server.kill();
})();
