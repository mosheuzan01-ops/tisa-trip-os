// Stage 3 browser checks at 375px (docs/GOALS_STAGE3.md S3-1, S3-3..S3-7, S3-9, S3-11).
// Dev-only: needs a Chromium through Playwright on the developer's machine. The app has no dependencies.
// Run from the repo root: node scripts/qa/stage3-browser.cjs   (starts its own server on port 8093)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.QA_OUT ? path.resolve(process.env.QA_OUT) : path.join(ROOT, 'docs/evidence/stage3'); // rule 10: reruns write elsewhere
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8093;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEW = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce' };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'tisa:v1';

function watch(page, bag) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
  await page.evaluate(() => document.fonts.ready);
}
const stored = (page) => page.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); return s ? s.trips[s.activeTripId] : { destinations: [] }; }, KEY); // nothing is written until the first change
const names = (page) => page.locator('.stop-name').allTextContents();

async function addStop(page, { name, start, end, note = '' }) {
  await page.locator('#panel-itinerary [data-action="stop-add"]:visible').first().click();
  await page.fill('#dlg-stop [name="name"]', name);
  await page.fill('#dlg-stop [name="start"]', start);
  await page.fill('#dlg-stop [name="end"]', end);
  if (note) await page.fill('#dlg-stop [name="note"]', note);
  await page.click('#dlg-stop [data-slot="stop-save"]');
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const bag = { errors: [], external: [] };

  // ---------- S3-1, S3-3, S3-4, S3-2 on screen ----------
  {
    const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    watch(page, bag);
    await page.clock.setFixedTime(new Date('2026-11-19T10:00:00+07:00'));
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    await page.screenshot({ path: `${OUT}/after-itinerary-empty-375-light.png`, fullPage: true });
    const emptyShown = await page.locator('[data-slot="itin-empty"]').isVisible();

    // S3-3: departure before arrival is refused with a Hebrew message; nothing is saved
    await addStop(page, { name: 'פאי', start: '2027-01-10', end: '2027-01-08' });
    const err = (await page.locator('#stop-error').textContent()).trim();
    const dialogStillOpen = await page.locator('#dlg-stop').evaluate((d) => d.open);
    await page.screenshot({ path: `${OUT}/after-error-before-arrival-375.png` });
    const savedAfterError = (await stored(page)).destinations.length;
    await page.click('#dlg-stop [data-close]');

    // S3-1 + S3-2: two stops out of order, across a month change, then a reload
    await addStop(page, { name: 'קו טאו', start: '2027-01-30', end: '2027-02-02', note: 'צלילה' });
    await addStop(page, { name: 'בנגקוק', start: '2027-01-27', end: '2027-01-30' });
    await page.waitForFunction(() => document.querySelectorAll('.stop').length === 2);
    const rawKeys = await page.evaluate(() => Object.keys(localStorage));
    await page.reload();
    await ready(page);
    const afterReload = await names(page);
    const summary = await page.locator('[data-slot="itin-summary"]').textContent();
    const nightsShown = await page.locator('.stop-nights').allTextContents();
    pass('S3-1', afterReload.length === 2 && rawKeys.every((k) => k.startsWith('tisa:')), { afterReload, rawKeys });
    pass('S3-2 (screen)', afterReload.join('|') === 'בנגקוק|קו טאו' && summary === '2 תחנות, 6 לילות' && nightsShown.join('|') === '3 לילות|3 לילות', { order: afterReload, summary, nightsShown });

    // S3-3: overlap gives a warning first, saving needs a second tap
    await addStop(page, { name: 'קו פנגן', start: '2027-01-29', end: '2027-01-31' });
    const warnText = (await page.locator('[data-slot="stop-warn"]').textContent()).trim();
    const buttonText = (await page.locator('#dlg-stop [data-slot="stop-save"]').textContent()).trim();
    const notYet = (await stored(page)).destinations.length;
    await page.screenshot({ path: `${OUT}/after-overlap-warning-375.png` });
    await page.click('#dlg-stop [data-slot="stop-save"]');
    await page.waitForFunction(() => document.querySelectorAll('.stop').length === 3);
    const listWarn = (await page.locator('[data-slot="itin-warn"]').textContent()).trim();
    pass('S3-3', /העזיבה.*לפני.*ההגעה/.test(err) && dialogStillOpen && savedAfterError === 0
      && /חופפים/.test(warnText) && buttonText === 'לשמור בכל זאת' && notYet === 2 && /חופפים/.test(listWarn),
    { err, dialogStillOpen, savedAfterError, warnText, buttonText, savedBeforeSecondTap: notYet, listWarn });

    // S3-4: edit, reorder, delete with confirmation (cancel keeps it, confirm removes it)
    await page.click('.stop[data-id] [data-action="stop-edit"] >> nth=2');
    await page.fill('#dlg-stop [name="name"]', 'קו טאו (צלילה)');
    await page.click('#dlg-stop [data-slot="stop-save"]');
    const editWarn = (await page.locator('[data-slot="stop-warn"]').textContent()).trim(); // still overlaps: asks again
    await page.click('#dlg-stop [data-slot="stop-save"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.stop-name')].some((n) => n.textContent === 'קו טאו (צלילה)'));
    const edited = await names(page);
    await page.click('.stop:first-child [data-action="stop-down"]');
    await page.waitForFunction(() => document.querySelector('.stop-name').textContent !== 'בנגקוק');
    const moved = await names(page);
    const movedData = (await stored(page)).destinations.map((d) => [d.name, d.startDate, d.endDate]);
    await page.click('.stop:last-child [data-action="stop-delete"]');
    const askText = await page.locator('[data-slot="stop-delete-text"]').textContent();
    await page.screenshot({ path: `${OUT}/after-delete-confirm-375.png` });
    await page.click('#dlg-stop-delete [data-close]');
    const afterCancel = (await stored(page)).destinations.length;
    await page.click('.stop:last-child [data-action="stop-delete"]');
    await page.click('[data-action="stop-delete-confirm"]');
    await page.waitForFunction(() => document.querySelectorAll('.stop').length === 2);
    const afterDelete = (await stored(page)).destinations.length;
    pass('S3-4', edited.includes('קו טאו (צלילה)') && moved[0] !== 'בנגקוק' && /למחוק את/.test(askText) && afterCancel === 3 && afterDelete === 2,
      { editWarn, edited, moved, movedData, askText, afterCancel, afterDelete });
    await ctx.close();
  }

  // ---------- S3-5: "today" by the Bangkok clock, with a fixed fake date ----------
  {
    const results5 = {};
    for (const [label, when, expect] of [
      ['before', '2026-12-01T09:00:00+07:00', { phase: 'before', place: 'בנגקוק', today: null }],
      ['during', '2026-12-12T09:00:00+07:00', { phase: 'during', place: 'פאי', today: 'פאי' }],
      ['handover', '2026-12-13T09:00:00+07:00', { phase: 'during', place: 'פוקט', today: 'פוקט' }],
      ['bangkok-midnight', '2026-12-12T17:30:00Z', { phase: 'during', place: 'פוקט', today: 'פוקט' }], // 00:30 on 13.12 in Bangkok, still 12.12 in UTC
      ['after', '2027-01-05T09:00:00+07:00', { phase: 'after', place: '', today: null }],
    ]) {
      const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });
      const page = await ctx.newPage();
      watch(page, bag);
      await page.clock.setFixedTime(new Date(when));
      await page.goto(`${BASE}#/itinerary`);
      await ready(page);
      await page.click('[data-slot="itin-empty"] [data-action="seed-open"]');
      await page.click('[data-action="seed-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('.stop').length === 11);
      const got = {
        phase: await page.locator('[data-slot="itin-now"]').getAttribute('data-phase'),
        place: (await page.locator('[data-slot="itin-now-place"]').textContent()).trim(),
        today: await page.locator('.stop.is-today .stop-name').count() ? await page.locator('.stop.is-today .stop-name').textContent() : null,
        ariaCurrent: await page.locator('.stop[aria-current="date"]').count(),
      };
      results5[label] = { got, ok: got.phase === expect.phase && got.place === expect.place && got.today === expect.today && got.ariaCurrent === (expect.today ? 1 : 0) };
      if (label === 'during') {
        await page.screenshot({ path: `${OUT}/after-itinerary-today-375-light.png`, fullPage: true });
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
        await page.screenshot({ path: `${OUT}/after-itinerary-today-375-dark.png`, fullPage: true });
      }
      await ctx.close();
    }
    pass('S3-5', Object.values(results5).every((r) => r.ok), results5);
  }

  // ---------- S3-11 replan + S3-7 backup round trip + S3-9 layout ----------
  {
    const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block', acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page, bag);
    await page.clock.setFixedTime(new Date('2026-11-19T10:00:00+07:00'));
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    await page.click('[data-slot="itin-empty"] [data-action="seed-open"]');
    const seedText = await page.locator('[data-slot="seed-text"]').textContent();
    await page.screenshot({ path: `${OUT}/after-seed-offer-375.png` });
    const beforeSeed = (await stored(page)).destinations.length;
    await page.click('[data-action="seed-confirm"]');
    await page.waitForFunction(() => document.querySelectorAll('.stop').length === 11);
    const seeded = await stored(page);
    const seedOk = beforeSeed === 0 && seeded.startDate === '2026-12-05' && seeded.endDate === '2027-01-03'
      && (await page.locator('[data-slot="itin-summary"]').textContent()) === '11 תחנות, 29 לילות';

    // Replan: shift two days later; preview first, nothing saved until confirm
    await page.click('[data-action="replan-open"]');
    await page.fill('#dlg-replan [name="start"]', '2026-12-07');
    await page.fill('#dlg-replan [name="end"]', '2027-01-05');
    const previewRows = await page.locator('.replan-changes li').count();
    const firstRow = await page.locator('.replan-changes li >> nth=0').textContent();
    await page.screenshot({ path: `${OUT}/after-replan-preview-375.png` });
    const unchanged = (await stored(page)).destinations[0].startDate;
    await page.click('#dlg-replan [data-slot="replan-save"]');
    await page.waitForFunction(() => !document.querySelector('#dlg-replan').open);
    const shifted = await stored(page);
    // Flex: one more day comes from Koh Tao (1 -> 2 nights); two more is refused
    await page.click('[data-action="replan-open"]');
    await page.check('#dlg-replan input[value="flex"]');
    await page.fill('#dlg-replan [name="end"]', '2027-01-07');
    const flexErr = (await page.locator('#replan-error').textContent()).trim();
    const flexDisabled = await page.locator('#dlg-replan [data-slot="replan-save"]').isDisabled();
    await page.fill('#dlg-replan [name="end"]', '2027-01-06');
    const flexRows = await page.locator('.replan-changes li').count();
    await page.click('#dlg-replan [data-slot="replan-save"]');
    await page.waitForFunction(() => !document.querySelector('#dlg-replan').open);
    const flexed = await stored(page);
    const tao = flexed.destinations.find((d) => d.flexible);
    pass('S3-11', seedOk && previewRows === 11 && /היה/.test(firstRow) && /יהיה/.test(firstRow) && unchanged === '2026-12-05'
      && shifted.destinations[0].startDate === '2026-12-07' && shifted.startDate === '2026-12-07'
      && /גמיש/.test(flexErr) && flexDisabled && flexRows === 2 && tao.endDate === '2027-01-05' && flexed.endDate === '2027-01-06',
    { seedText, seedOk, previewRows, firstRow, savedBeforeConfirm: unchanged, shiftedFirst: shifted.destinations[0], flexErr, flexDisabled, flexRows, tao });

    // S3-9: 375px, RTL, no sideways scroll, every itinerary control >= 44px, text >= 14px
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('#panel-itinerary');
      const small = [...panel.querySelectorAll('button, a, input, label.replan-mode')].filter((b) => b.offsetParent)
        .map((b) => ({ el: b.dataset.action ?? b.className, ...b.getBoundingClientRect().toJSON() }))
        .filter((r) => r.width < 44 || r.height < 44);
      const tiny = [...panel.querySelectorAll('*')].filter((n) => n.offsetParent && n.childNodes.length && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()))
        .map((n) => ({ text: n.textContent.trim().slice(0, 20), size: parseFloat(getComputedStyle(n).fontSize) })).filter((x) => x.size < 14);
      return { dir: document.documentElement.dir, width: innerWidth, hscroll: document.documentElement.scrollWidth > innerWidth, small, tiny };
    });
    await page.screenshot({ path: `${OUT}/after-itinerary-full-375-light.png`, fullPage: true });
    pass('S3-9 (browser)', layout.dir === 'rtl' && layout.width === 375 && !layout.hscroll && !layout.small.length && !layout.tiny.length, layout);

    // S3-7: export from settings, wipe, import, same stops
    await page.click('.settings-btn');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    const file = path.join(OUT, 'roundtrip-backup.json');
    await download.saveAs(file);
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    const before = JSON.stringify((await stored(page)).destinations);
    await page.click('[data-action="reset-open"]');
    await page.fill('[data-slot="reset-input"]', 'איפוס');
    await page.click('[data-action="reset-confirm"]');
    const wiped = (await stored(page)).destinations.length;
    await page.setInputFiles('#import-file', file);
    await page.click('[data-action="import-confirm"]');
    await page.waitForFunction(() => !document.querySelector('#dlg-import').open);
    const after = JSON.stringify((await stored(page)).destinations);
    await page.click('[data-tab="itinerary"]');
    const shown = await page.locator('.stop').count();
    fs.unlinkSync(file);
    pass('S3-7', exported.format === 'tisa-backup' && wiped === 0 && before === after && shown === 11,
      { exportedStops: exported.data.trips[exported.data.activeTripId].destinations.length, wiped, identical: before === after, shown });
    await ctx.close();
  }

  // ---------- S3-6: offline. Service worker installs v-cache, then the itinerary works with the network off ----------
  {
    const ctx = await browser.newContext({ ...VIEW });
    const page = await ctx.newPage();
    watch(page, bag);
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await ready(page);
    const caches = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('tisa-')));
      const urls = (await c.keys()).map((r) => new URL(r.url).pathname);
      return { keys, hasView: urls.includes('/src/js/itinerary-view.js'), hasCore: urls.includes('/src/js/core/itinerary.js'), hasPack: urls.includes('/data/packs/th.js') };
    });
    await ctx.setOffline(true);
    await page.reload();
    await ready(page);
    await page.click('[data-slot="itin-empty"] [data-action="seed-open"]');
    await page.click('[data-action="seed-confirm"]');
    await page.waitForFunction(() => document.querySelectorAll('.stop').length === 11);
    await addStop(page, { name: 'צ׳יאנג ראי', start: '2027-01-03', end: '2027-01-04' });
    await page.waitForFunction(() => document.querySelectorAll('.stop').length === 12);
    await page.screenshot({ path: `${OUT}/after-offline-375.png` });
    const version = await page.locator('[data-slot="version-app"]').textContent();
    const offlineBanner = await page.locator('.banner').allTextContents();
    pass('S3-6', caches.keys.includes(`tisa-${version}`) && caches.hasView && caches.hasCore && caches.hasPack, { caches, version, offlineBanner, stopsOffline: 12 });
    await ctx.close();
  }

  pass('no errors / no outside requests', bag.errors.length === 0 && bag.external.length === 0, bag);
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, 'browser-check.json'), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
