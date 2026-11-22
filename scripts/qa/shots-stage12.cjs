// Stage 12 before/after screenshots (rule 1): the screens that get an info button, at 390px and desktop, light and dark.
// PHASE=before|after (default after), QA_OUT (default docs/evidence/stage12/shots), PORT (default 8171).
// Sample trip only (scripts/qa/lib/sample-trip.cjs). Waits for UI state, not for time (rule 6).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { sampleState } = require('./lib/sample-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage12/shots');
fs.mkdirSync(OUT, { recursive: true });
const PHASE = process.env.PHASE ?? 'after';
const PORT = Number(process.env.PORT ?? 8171);
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 900 } };
const SCREENS = ['money', 'itinerary', 'checklist', 'info', 'settings'];
const EXTRA = (process.env.SCREENS ?? '').split(',').filter(Boolean);

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const made = [];
  try {
    for (const theme of ['light', 'dark']) {
      const state = await sampleState();
      state.settings.theme = theme;
      for (const [vName, viewport] of Object.entries(VIEWS)) {
        const ctx = await browser.newContext({ viewport, deviceScaleFactor: vName === 'mobile' ? 2 : 1, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Bangkok' });
        await ctx.addInitScript((x) => { if (!localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); }, JSON.stringify(state));
        const page = await ctx.newPage();
        await page.clock.setFixedTime(new Date('2030-12-25T10:00:00+07:00'));
        for (const screen of [...SCREENS, ...EXTRA]) {
          await page.goto(`${BASE}#/${screen}`);
          await page.waitForFunction((s) => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0
            && !document.querySelector(`#panel-${s}`)?.hidden, screen);
          await page.evaluate(() => document.fonts.ready);
          const file = `${PHASE}-${screen}-${vName}-${theme}.jpg`;
          await page.screenshot({ path: path.join(OUT, file), fullPage: false, type: 'jpeg', quality: 80 });
          made.push(file);
        }
        // the place dialog (planned day / visited date)
        await page.goto(`${BASE}#/places`);
        await page.waitForFunction(() => !document.querySelector('#panel-places')?.hidden);
        await page.click('#panel-places [data-action="place-add"]');
        await page.waitForFunction(() => document.querySelector('#dlg-place')?.open);
        const file = `${PHASE}-place-dialog-${vName}-${theme}.jpg`;
        await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 80 });
        made.push(file);
        await ctx.close();
      }
    }
    console.log(made.join('\n'));
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
