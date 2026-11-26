// 1.2.0 screenshots: the five screens, light and dark, at 390 and 1440 (first screen), with the sample trip
// (rule 16), mid-trip so the route shows DONE / NOW / AHEAD. QA_OUT (default docs/evidence/1.2.0/after), PORT.
// Run it from an older checkout to get the "before" pictures of the same states.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { sampleState } = require('./lib/sample-trip.cjs');
const { ROOT, startServer } = require('./lib/cloud-owner.cjs');

const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/1.2.0/after');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8222);

(async () => {
  const { server, base } = await startServer(PORT);
  const browser = await chromium.launch();
  try {
    const seed = await sampleState();
    for (const scheme of ['light', 'dark']) for (const [w, h] of [[390, 844], [1440, 900]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, serviceWorkers: 'block', reducedMotion: 'reduce', deviceScaleFactor: 1 });
      await ctx.addInitScript((x) => { if (!localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); }, JSON.stringify({ ...seed, settings: { ...seed.settings, theme: scheme } }));
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date('2030-12-26T05:00:00Z'));
      await page.goto(`${base}index.html#/home`);
      await page.waitForSelector('#panel-home:not([hidden])'); await page.evaluate(() => document.fonts.ready);
      for (const tab of ['home', 'itinerary', 'money', 'checklist', 'tools']) {
        await page.click(`.tabbar [aria-controls="panel-${tab}"]`);
        await page.waitForSelector(`#panel-${tab}:not([hidden])`); await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT, `${tab}-${scheme}-${w}.png`) });
      }
      await ctx.close();
    }
  } finally { await browser.close(); server.kill(); }
  console.log('wrote', fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length, 'screenshots to', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
