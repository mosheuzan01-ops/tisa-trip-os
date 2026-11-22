// Stage 3 polish checks at 375px (docs/GOALS_STAGE3.md S3-12, S3-13).
// Stage 9 (owner, 2026-11-21): the old route and the 3 old profiles moved to the archive; this script uses them from there.
// S3-12: the home "today" card names the stop you are at (by the destination clock) and links to the itinerary.
// S3-13: changing trip dates from home or settings, when there are stops, opens the replan preview; nothing is saved until yes.
// Run from the repo root: PHASE=after node scripts/qa/stage3-polish-browser.cjs   (port 8094)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { blankTrip } = require('./lib/blank-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.QA_OUT ? path.resolve(process.env.QA_OUT) : path.join(ROOT, 'docs/evidence/stage3/polish'); // rule 10: reruns write elsewhere
fs.mkdirSync(OUT, { recursive: true });
const PHASE = process.env.PHASE ?? 'after';
const PORT = 8094;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEW = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block' };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stored = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s ? s.trips[s.activeTripId] : { destinations: [] }; });
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const isOpen = (page, id) => page.locator(id).evaluate((d) => d.open);

async function seeded(browser, when, bag) {
  const ctx = await browser.newContext(VIEW);
  await blankTrip(ctx); // stage 13: a new install now has the shared dates and a route; start from a trip with no stops (lib/blank-trip.cjs)
  const page = await ctx.newPage();
  page.on('pageerror', (e) => bag.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') bag.push(m.text()); });
  await page.clock.setFixedTime(new Date(when));
  await page.goto(`${BASE}#/itinerary`);
  await ready(page);
  await page.click('[data-slot="itin-empty"] [data-action="seed-archive-open"]');
  await page.click('[data-action="seed-confirm"]');
  await page.waitForFunction(() => document.querySelectorAll('.stop').length === 11);
  await page.click('[data-tab="home"]');
  return { ctx, page };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const errors = [];

  // ---------- S3-12: home card knows where you are ----------
  {
    const { ctx, page } = await seeded(browser, '2026-12-12T09:00:00+07:00', errors);
    await page.screenshot({ path: `${OUT}/${PHASE}-home-during-375-light.png`, fullPage: true });
    const where = page.locator('[data-slot="today-stop"]');
    const shown = await where.count() ? await where.isVisible() : false;
    const text = shown ? (await where.textContent()).trim() : '';
    let landed = '';
    if (shown) { await where.locator('a').click(); await page.waitForFunction(() => location.hash === '#/itinerary'); landed = await page.evaluate(() => location.hash); }
    await ctx.close();
    const { ctx: c2, page: p2 } = await seeded(browser, '2026-11-19T09:00:00+07:00', errors);
    const before = (await p2.locator('[data-slot="today-stop"]').count()) ? (await p2.locator('[data-slot="today-stop"]').textContent()).trim() : '';
    await p2.screenshot({ path: `${OUT}/${PHASE}-home-before-trip-375-light.png`, fullPage: true });
    await c2.close();
    pass('S3-12', /פאי/.test(text) && landed === '#/itinerary' && /בנגקוק/.test(before), { during: text, landed, beforeTrip: before });
  }

  // ---------- S3-13: dates from settings / home open the replan preview ----------
  {
    const { ctx, page } = await seeded(browser, '2026-11-19T09:00:00+07:00', errors);
    await page.click('.settings-btn');
    await page.fill('[data-form="settings-dates"] [name="start"]', '2026-12-08');
    await page.fill('[data-form="settings-dates"] [name="end"]', '2027-01-06');
    await page.click('[data-form="settings-dates"] [type="submit"]');
    await sleep(200);
    const opened = await isOpen(page, '#dlg-replan');
    const prefilled = opened ? [await page.inputValue('#dlg-replan [name="start"]'), await page.inputValue('#dlg-replan [name="end"]')] : [];
    const rows = opened ? await page.locator('.replan-changes li').count() : 0;
    const note = opened ? (await page.locator('[data-slot="replan-from"]').textContent()).trim() : '';
    if (opened) await page.screenshot({ path: `${OUT}/${PHASE}-settings-replan-375.png` });
    const notSavedYet = (await stored(page)).startDate;
    if (opened) { await page.click('#dlg-replan [data-close]'); await page.waitForSelector('#dlg-replan:not([open])', { state: 'attached' }); await sleep(150); }
    const afterCancel = await stored(page);
    const settingsField = await page.inputValue('[data-form="settings-dates"] [name="start"]');
    // again, and confirm
    await page.fill('[data-form="settings-dates"] [name="start"]', '2026-12-08');
    await page.fill('[data-form="settings-dates"] [name="end"]', '2027-01-06');
    await page.click('[data-form="settings-dates"] [type="submit"]');
    await page.waitForSelector('#dlg-replan[open]', { timeout: 5000 }).catch(() => {});
    if (await isOpen(page, '#dlg-replan')) await page.click('#dlg-replan [data-slot="replan-save"]');
    await page.waitForSelector('#dlg-replan:not([open])', { state: 'attached' });
    await sleep(150);
    const afterYes = await stored(page);
    // from the home dates sheet, mode "dates only"
    await page.click('[data-tab="home"]');
    await page.click('[data-open="dates"]');
    await page.fill('#dlg-dates [name="start"]', '2026-12-09');
    await page.fill('#dlg-dates [name="end"]', '2027-01-06');
    await page.click('#dlg-dates [type="submit"]');
    await sleep(200);
    const fromHome = await isOpen(page, '#dlg-replan');
    const datesSheetClosed = !(await isOpen(page, '#dlg-dates'));
    if (fromHome) { await page.check('#dlg-replan input[value="datesOnly"]'); await page.click('#dlg-replan [data-slot="replan-save"]'); }
    await sleep(200);
    const afterHome = await stored(page);
    await ctx.close();

    // no stops: dates save straight away, as before
    const c3 = await browser.newContext(VIEW);
    await blankTrip(c3); // stage 13: a new install now has the shared dates and a route; start from a trip with no stops (lib/blank-trip.cjs)
    const p3 = await c3.newPage();
    await p3.goto(`${BASE}#/settings`);
    await ready(p3);
    await p3.fill('[data-form="settings-dates"] [name="start"]', '2026-12-05');
    await p3.fill('[data-form="settings-dates"] [name="end"]', '2027-01-03');
    await p3.click('[data-form="settings-dates"] [type="submit"]');
    await sleep(200);
    const plain = { replanOpened: await isOpen(p3, '#dlg-replan'), saved: (await stored(p3)).startDate };
    await c3.close();

    pass('S3-13', opened && prefilled.join() === '2026-12-08,2027-01-06' && rows === 11 && note.length > 0
      && notSavedYet === '2026-12-05' && afterCancel.startDate === '2026-12-05' && afterCancel.destinations[0].startDate === '2026-12-05' && settingsField === '2026-12-05'
      && afterYes.startDate === '2026-12-08' && afterYes.destinations.find((d) => d.name === 'בנגקוק').startDate === '2026-12-08'
      && fromHome && datesSheetClosed && afterHome.startDate === '2026-12-09' && afterHome.destinations[0].startDate === '2026-12-08'
      && !plain.replanOpened && plain.saved === '2026-12-05',
    { opened, prefilled, rows, note, notSavedYet, afterCancel: [afterCancel.startDate, afterCancel.destinations[0]?.startDate], settingsField,
      afterYes: [afterYes.startDate, afterYes.destinations[0]?.startDate], fromHome, datesSheetClosed, afterHome: [afterHome.startDate, afterHome.destinations[0]?.startDate], plain });
  }

  pass('no errors', errors.length === 0, { errors });
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check-${PHASE}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
