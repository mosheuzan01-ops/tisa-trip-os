// PR #56: before/after screenshots of the five tabs (home, route, budget, lists, tools) at 390 and 1440, light and
// dark. Sample data only (rule 16): the rich sample trip. Run once before and once after the change, QA_OUT apart.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { richState } = require('./lib/rich-trip.cjs');
const { createFakeSupabase } = require('./lib/fake-supabase.cjs');
const { ROOT, startServer, newContext } = require('./lib/cloud-owner.cjs');

const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/redesign-56/shots');
const SCREENS = (process.env.SCREENS ?? 'home,itinerary,money,checklist,tools').split(',');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const { server, base } = await startServer(Number(process.env.PORT ?? 8256));
  const browser = await chromium.launch();
  const sb = await createFakeSupabase();
  try {
    for (const theme of ['light', 'dark']) {
      const seed = await richState(); seed.settings = { ...(seed.settings ?? {}), theme };
      if (process.env.PAID_SAMPLE) { // sample only: the one sample expense made larger, so the ring's arc shows
        const e = seed.trips[seed.activeTripId].expenses[0];
        Object.assign(e, { amountMinor: Number(process.env.PAID_SAMPLE), baseMinor: Number(process.env.PAID_SAMPLE) });
      }
      for (const w of [390, 1440]) {
        const ctx = await newContext(browser, sb, { seed, viewport: { width: w, height: w === 390 ? 844 : 900 }, scheme: theme });
        const page = await ctx.newPage();
        for (const s of SCREENS) {
          await page.goto(`${base}#/${s}`); await page.waitForSelector(`#panel-${s}:not([hidden])`);
          await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(900); // the pass shine settles
          await page.screenshot({ path: path.join(OUT, `${s}-${theme}-${w}.png`), fullPage: w === 390 });
        }
        await ctx.close();
      }
    }
    console.log('shots:', fs.readdirSync(OUT).length);
  } finally { await browser.close(); server.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
