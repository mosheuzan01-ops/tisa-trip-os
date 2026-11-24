// 1.1.4: "before" screenshots of the screens this version changes (home, itinerary, settings card, admin dialog, share
// dialog), at 390 and 1440. FAKE Supabase only, sample users and data (rule 16). Run once on the code before 1.1.4.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { sampleState } = require('./lib/sample-trip.cjs');
const { createFakeSupabase } = require('./lib/fake-supabase.cjs');
const { ROOT, PASS, startServer, newContext, signInAndMove } = require('./lib/cloud-owner.cjs');

const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/1.1.4/before/shots');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const { server, base } = await startServer(Number(process.env.PORT ?? 8215));
  const browser = await chromium.launch();
  const sb = await createFakeSupabase();
  sb.fake.addUser({ email: 'admin-m@example.com', password: PASS, status: 'approved', role: 'admin' });
  for (const [e, s] of [['friend-f@example.com', 'approved'], ['pending-p1@example.com', 'pending'], ['pending-p2@example.com', 'pending'], ['blocked-x@example.com', 'blocked']]) sb.fake.addUser({ email: e, password: PASS, status: s });
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, `${n}.jpg`), type: 'jpeg', quality: 70 });
  try {
    const ctx = await newContext(browser, sb, { seed: await sampleState() });
    const page = await ctx.newPage();
    for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
      for (const s of ['home', 'itinerary']) {
        await page.goto(`${base}#/${s}`); await page.waitForSelector(`#panel-${s}:not([hidden])`);
        if (s === 'itinerary') await page.locator('#panel-itinerary [data-go="transfers"]').scrollIntoViewIfNeeded();
        await shot(page, `${s}-${w}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}#/settings`); await page.waitForSelector('#panel-settings:not([hidden])');
    await signInAndMove(page, 'admin-m@example.com');
    await page.locator('[data-slot="cloud-card"]').scrollIntoViewIfNeeded();
    await shot(page, 'settings-card-admin-390');
    await page.click('[data-cloud="admin"]');
    await page.waitForSelector('#dlg-cloud-admin[open] [data-slot="cloud-admin-users"] li');
    await page.waitForTimeout(400); // the open animation only, for the picture
    await shot(page, 'admin-dialog-390');
    await page.keyboard.press('Escape');
    await page.click('[data-cloud="share"]'); await page.waitForSelector('#dlg-cloud-share[open]'); await page.waitForTimeout(400);
    await shot(page, 'share-dialog-390');
    console.log('before shots:', fs.readdirSync(OUT).join(', '));
  } finally { await browser.close(); server.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
