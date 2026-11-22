// Stage 13: before and after screenshots of what changed on screen: settings (privacy and terms, opened) and the
// home screen (F1: the cards show only once their order is known; the final screen is the same).
// 390 px and desktop (1440), light and dark. Sample trip (rule 16, lib/rich-trip.cjs).
// APP_DIR: the app to serve (default: this checkout). TAG: before | after (default after).
// "before": APP_DIR=<a checkout of main> TAG=before node scripts/qa/shots-stage13.cjs
// QA_OUT (default docs/evidence/stage13/shots), PORT (default 8195).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { richState } = require('./lib/rich-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.resolve(process.env.APP_DIR ?? ROOT);
const TAG = process.env.TAG ?? 'after';
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage13/shots');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8195);
const BASE = `http://127.0.0.1:${PORT}/`;

(async () => {
  const server = spawn(process.execPath, [path.join(APP, 'scripts/serve.js')], { cwd: APP, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const made = [];
  try {
    const seed = await richState();
    for (const theme of ['light', 'dark']) {
      for (const [name, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
        const st = structuredClone(seed);
        st.settings.theme = theme;
        const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', serviceWorkers: 'block' });
        await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(st));
        const page = await ctx.newPage();
        await page.clock.setFixedTime(new Date('2030-12-24T10:00:00+07:00'));
        await page.goto(`${BASE}#/home`);
        await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
        await page.evaluate(() => document.fonts.ready);
        const home = `${TAG}-home-${name}-${theme}.jpg`;
        await page.screenshot({ path: path.join(OUT, home), type: 'jpeg', quality: 75 });
        await page.goto(`${BASE}#/settings`);
        await page.waitForFunction(() => !document.querySelector('#panel-settings').hidden);
        const opened = await page.evaluate(() => {
          const folds = [...document.querySelectorAll('#panel-settings [data-slot="privacy"], #panel-settings [data-slot="terms"]')];
          for (const d of folds) d.open = true;
          (folds[0] ?? document.querySelector('#panel-settings [aria-labelledby="set-limits-title"]')).scrollIntoView({ block: 'start' });
          return folds.length;
        });
        await page.evaluate(() => window.scrollBy(0, -80)); // the sticky top bar
        const settings = `${TAG}-settings-${name}-${theme}.jpg`;
        await page.screenshot({ path: path.join(OUT, settings), type: 'jpeg', quality: 75 });
        made.push(home, `${settings} (folds: ${opened})`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(made.join('\n'));
})();
