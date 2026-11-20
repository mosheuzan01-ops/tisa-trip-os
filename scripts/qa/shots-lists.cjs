// Before/after shots of the lists screen (rule 1): where the luggage button lives. 375 and 1280.
// BASE_DIR serves another checkout (main, for "before"). Writes to QA_OUT. Waits for UI state (rule 6).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const SERVE_DIR = process.env.BASE_DIR ? path.resolve(process.env.BASE_DIR) : ROOT;
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/6.0e');
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const server = spawn(process.execPath, [path.join(SERVE_DIR, 'scripts/serve.js')], { cwd: SERVE_DIR, env: { ...process.env, PORT: '8101' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  for (const [view, viewport] of Object.entries({ mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } })) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:8101/#/checklist');
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${OUT}/${PREFIX}-lists-${view}.png` });
    await ctx.close();
  }
  await browser.close();
  server.kill();
})().catch((e) => { console.error(e); process.exit(2); });
