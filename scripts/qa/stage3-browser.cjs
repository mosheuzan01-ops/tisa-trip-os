// Stage 3 browser checks at 375px (docs/GOALS_STAGE3.md S3-1 to S3-9).
// Dev-only: needs a Chromium through Playwright on the developer's machine. The app has no dependencies.
// Run from the repo root: node scripts/qa/stage3-browser.cjs   (starts its own server on port 8093)
// Results: docs/evidence/stage3/browser-check.json and screenshots in the same folder.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs/evidence/stage3');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8093;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEW = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce' };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// "Today" is set on the page clock. 08:00 UTC = 15:00 in Bangkok on the same date.
const AT = (iso) => new Date(`${iso}T08:00:00Z`);

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
  await page.evaluate(() => document.fonts.ready);
}

async function newPage(browser, { date = '2026-12-09', theme = 'light', sw = 'block' } = {}) {
  const ctx = await browser.newContext({ ...VIEW, colorScheme: theme, serviceWorkers: sw });
  const page = await ctx.newPage();
  const bag = { errors: [], external: [] };
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
  if (date) await page.clock.setFixedTime(AT(date));
  return { ctx, page, bag };
}

const stored = (page) => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('tisa:v1'));
  return { keys: Object.keys(localStorage), trip: s.trips[s.activeTripId] };
});
const names = (page) => page.locator('.stop-name').allTextContents();

async function addStop(page, { name, start, end, note = '' }) {
  await page.click('[data-action="stop-add"]');
  await page.fill('[data-form="stop"] [name=name]', name);
  await page.fill('[data-form="stop"] [name=start]', start);
  await page.fill('[data-form="stop"] [name=end]', end);
  await page.fill('[data-form="stop"] [name=note]', note);
  await page.click('[data-slot="stop-submit"]');
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();

  // ---------- First open, S3-1, S3-2, S3-8, S3-9 ----------
  {
    const { ctx, page, bag } = await newPage(browser);
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    const first = await stored(page);
    const seeded = { stops: first.trip.destinations.length, seededFlag: first.trip.itinerarySeeded, tripDates: [first.trip.startDate, first.trip.endDate] };
    await page.screenshot({ path: `${OUT}/after-itinerary-375-light.png`, fullPage: true });
    pass('seed', seeded.stops === 11 && seeded.seededFlag === true, { ...seeded, note: 'pack stops on first open; trip dates stay unset (not invented)' });

    // S3-1: add a stop, reload, still there; key starts with tisa:
    await page.click('.stop-delete >> nth=10'); // remove the last Bangkok night to make room (confirmed below)
    const delTitle = await page.locator('[data-slot="delete-title"]').textContent();
    const delFocus = await page.evaluate(() => document.activeElement.textContent.trim());
    await page.screenshot({ path: `${OUT}/after-delete-confirm-375.png` });
    await page.click('#dlg-delete [data-close]');
    const afterCancel = (await stored(page)).trip.destinations.length;
    await page.click('.stop-delete >> nth=10');
    await page.click('[data-action="delete-confirm"]');
    const afterDelete = (await stored(page)).trip.destinations.length;
    await addStop(page, { name: 'איוטאיה', start: '2027-01-02', end: '2027-01-03', note: 'יום מקדשים' });
    await page.reload();
    await ready(page);
    const reloaded = await stored(page);
    const added = reloaded.trip.destinations.find((s) => s.name === 'איוטאיה');
    pass('S3-1', Boolean(added) && added.note === 'יום מקדשים' && reloaded.keys.every((k) => k.startsWith('tisa:')) && (await names(page)).includes('איוטאיה'),
      { added, keys: reloaded.keys });

    // S3-4: delete asks first; cancel keeps; confirm removes; edit works
    await page.click('.stop-edit >> nth=2');
    await page.fill('[data-form="stop"] [name=note]', 'שוק לילה');
    await page.click('[data-slot="stop-submit"]');
    const edited = (await stored(page)).trip.destinations.find((s) => s.name === 'פאי');
    pass('S3-4', delTitle.includes('בנגקוק') && delFocus === 'ביטול' && afterCancel === 11 && afterDelete === 10 && edited.note === 'שוק לילה',
      { delTitle, focusOnOpen: delFocus, afterCancel, afterDelete, editedNote: edited.note });

    // S3-2: list in date order, nights per stop and total, month/year crossing
    const order = await page.evaluate(() => [...document.querySelectorAll('.stop')].map((li) => ({
      name: li.querySelector('.stop-name').textContent, dates: li.querySelector('.stop-dates').textContent, nights: li.querySelector('.stop-nights').textContent,
    })));
    const summary = await page.locator('[data-slot="itin-summary"]').textContent();
    await addStop(page, { name: 'קודם', start: '2026-12-01', end: '2026-12-03' });
    const firstName = (await names(page))[0];
    const phangan = order.find((o) => o.name === 'קופנגן');
    pass('S3-2', summary === '11 תחנות, 29 לילות' && firstName === 'קודם' && phangan.nights === '4 לילות' && /2026.*2027/.test(phangan.dates),
      { summary, firstAfterAddingEarlier: firstName, yearCrossing: phangan });

    // S3-8: one date format (Intl he-IL)
    const sample = order[0].dates;
    const expected = await page.evaluate(() => {
      const f = (iso) => new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
      return `${f('2026-12-05')} – ${f('2026-12-08')}`;
    });
    pass('S3-8', sample === expected, { shown: sample, intl: expected });

    // S3-9: 375px, RTL, 44px targets, 14px text, no sideways scroll
    const layout = await page.evaluate(() => {
      const small = [];
      for (const b of document.querySelectorAll('#panel-itinerary button, #panel-itinerary a')) {
        const r = b.getBoundingClientRect();
        if (r.width && (r.width < 44 || r.height < 44)) small.push(`${b.className} ${r.width}x${r.height}`);
      }
      const tiny = [];
      for (const n of document.querySelectorAll('#panel-itinerary *')) {
        if (!n.childNodes.length || ![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
        const px = parseFloat(getComputedStyle(n).fontSize);
        if (px < 14) tiny.push(`${n.className}: ${px}px`);
      }
      const visibleH1 = [...document.querySelectorAll('h1')].filter((h) => h.offsetParent).length; // qa_scan counts all 4 SPA h1s; one shows per screen
      return { dir: document.documentElement.dir, hscroll: document.documentElement.scrollWidth > innerWidth, visibleH1, small, tiny };
    });
    pass('S3-9', layout.dir === 'rtl' && !layout.hscroll && layout.visibleH1 === 1 && !layout.small.length && !layout.tiny.length, layout);
    pass('errors', bag.errors.length === 0 && bag.external.length === 0, bag);
    await ctx.close();
  }

  // ---------- S3-3: leave before arrive = error and nothing saved; overlap = warning ----------
  {
    const { ctx, page, bag } = await newPage(browser);
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    const before = (await stored(page)).trip.destinations.length;
    await addStop(page, { name: 'טעות', start: '2026-12-10', end: '2026-12-08' });
    const error = await page.locator('[data-slot="stop-error"]').textContent();
    const invalid = await page.locator('[data-form="stop"] [name=end]').getAttribute('aria-invalid');
    await page.screenshot({ path: `${OUT}/after-stop-error-375.png` });
    const stillOpen = await page.locator('#dlg-stop').evaluate((d) => d.open);
    await page.click('#dlg-stop [data-close]');
    const afterError = (await stored(page)).trip.destinations.length;

    await addStop(page, { name: 'חופף', start: '2026-12-06', end: '2026-12-07' });
    const warn = await page.locator('[data-slot="stop-warn"]').textContent();
    const button = await page.locator('[data-slot="stop-submit"]').textContent();
    await page.screenshot({ path: `${OUT}/after-stop-overlap-warning-375.png` });
    const notYet = (await stored(page)).trip.destinations.length;
    await page.click('[data-slot="stop-submit"]');
    const saved = (await stored(page)).trip.destinations.length;
    const flags = await page.locator('.stop-flag').allTextContents();
    const banner = await page.locator('[data-slot="itin-warnings"]').textContent();
    pass('S3-3', /העזיבה לפני תאריך ההגעה/.test(error) && invalid === 'true' && stillOpen && afterError === before
      && /חופפים/.test(warn) && button === 'לשמור בכל זאת' && notYet === before && saved === before + 1 && flags.length >= 2 && /חופפים/.test(banner),
    { error, ariaInvalid: invalid, savedAfterError: afterError === before, warn, button, savedAfterWarningOnly: notYet === before, savedAfterSecondTap: saved === before + 1, flags, banner });
    pass('errors-2', bag.errors.length === 0, bag);
    await ctx.close();
  }

  // ---------- S3-5: "today" by the Bangkok date: before, during, travel day, last day, after ----------
  {
    const cases = { before: '2026-11-19', during: '2026-12-09', travelDay: '2026-12-08', lastDay: '2027-01-03', after: '2027-01-10' };
    const seen = {};
    for (const [label, date] of Object.entries(cases)) {
      const { ctx, page } = await newPage(browser, { date });
      await page.goto(`${BASE}#/itinerary`);
      await ready(page);
      seen[label] = {
        date,
        text: await page.locator('[data-slot="itin-today-text"]').textContent(),
        highlighted: await page.locator('.stop.is-today .stop-name').allTextContents(),
        ariaCurrent: await page.locator('.stop[aria-current="date"]').count(),
      };
      if (label === 'during') await page.screenshot({ path: `${OUT}/after-today-during-375.png` });
      await ctx.close();
    }
    // Bangkok vs Israel: 2026-12-07 22:30 UTC is already 12-08 in Bangkok (UTC+7)
    const { ctx, page } = await newPage(browser, { date: null });
    await page.clock.setFixedTime(new Date('2026-12-07T22:30:00Z'));
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    seen.bangkokClock = { utc: '2026-12-07T22:30:00Z', highlighted: await page.locator('.stop.is-today .stop-name').allTextContents() };
    await ctx.close();
    const ok = /עוד 16 ימים/.test(seen.before.text) && seen.before.highlighted.length === 0
      && seen.during.highlighted.join() === "צ'יאנג מאי" && /לילה 2 מתוך 3/.test(seen.during.text) && seen.during.ariaCurrent === 1
      && seen.travelDay.highlighted.join() === "צ'יאנג מאי"
      && seen.lastDay.highlighted.join() === 'בנגקוק' && /עוזבים/.test(seen.lastDay.text)
      && seen.after.highlighted.length === 0 && /הסתיים/.test(seen.after.text)
      && seen.bangkokClock.highlighted.join() === "צ'יאנג מאי";
    pass('S3-5', ok, seen);
  }

  // ---------- Replan (3 modes, preview, nothing changes without a yes) + reorder ----------
  {
    const { ctx, page, bag } = await newPage(browser);
    await page.goto(`${BASE}#/settings`);
    await ready(page);
    const setDates = async (start, end) => {
      await page.fill('[data-form="settings-dates"] [name=start]', start);
      await page.fill('[data-form="settings-dates"] [name=end]', end);
      await page.click('[data-form="settings-dates"] [type=submit]');
    };
    // matching dates: no question asked
    await setDates('2026-12-05', '2027-01-03');
    const noDialog = !(await page.locator('#dlg-plan').evaluate((d) => d.open));
    // one more night, 2 days later
    await setDates('2026-12-07', '2027-01-06');
    const open1 = await page.locator('#dlg-plan').evaluate((d) => d.open);
    const defaultMode = await page.locator('[data-form="plan"] input[name=mode]:checked').getAttribute('value');
    await page.screenshot({ path: `${OUT}/after-replan-preview-375.png` });
    await page.click('#dlg-plan [data-close]');
    const cancelled = (await stored(page)).trip;
    const untouched = cancelled.startDate === '2026-12-05' && cancelled.destinations[0].startDate === '2026-12-05';
    // fit
    await setDates('2026-12-07', '2027-01-06');
    await page.click('[data-form="plan"] [type=submit]');
    const fit = (await stored(page)).trip;
    const tao = fit.destinations.find((s) => s.flexible);
    const fitOk = fit.startDate === '2026-12-07' && fit.destinations[0].startDate === '2026-12-07' && tao.startDate === '2027-01-03' && tao.endDate === '2027-01-05'
      && fit.destinations.at(-1).endDate === '2027-01-06';
    // shift
    await setDates('2026-12-10', '2027-01-09');
    await page.check('[data-form="plan"] input[value=shift]');
    await page.click('[data-form="plan"] [type=submit]');
    const shift = (await stored(page)).trip;
    const shiftOk = shift.destinations[0].startDate === '2026-12-10' && shift.destinations.at(-1).endDate === '2027-01-09';
    // dates only, with a warning
    await setDates('2026-12-12', '2027-01-09');
    await page.check('[data-form="plan"] input[value=datesOnly]');
    const warn = await page.locator('[data-slot="plan-warn"]').textContent();
    await page.click('[data-form="plan"] [type=submit]');
    const only = (await stored(page)).trip;
    const onlyOk = only.startDate === '2026-12-12' && only.destinations[0].startDate === '2026-12-10' && /מחוץ לתאריכי הטיול/.test(warn);
    // flexible range: 5 more nights is too many for Koh Tao (1-2), so "fit" is offered as unavailable
    await setDates('2026-12-12', '2027-01-16');
    const fitDisabled = await page.locator('[data-form="plan"] input[value=fit]').isDisabled();
    const fitWhy = await page.locator('[data-slot="plan-fit-desc"]').textContent();
    await page.click('#dlg-plan [data-close]');
    pass('replan', noDialog && open1 && defaultMode === 'fit' && untouched && fitOk && shiftOk && onlyOk && fitDisabled && /1 עד 2/.test(fitWhy),
      { noDialogWhenMatching: noDialog, previewOpened: open1, defaultMode, cancelChangesNothing: untouched, fitOk, kohTao: tao, shiftOk, datesOnlyWarning: warn, onlyOk, fitDisabled, fitWhy });

    // reorder: preview, confirm, nights kept
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    const before = await names(page);
    await page.click('.stop-down >> nth=0');
    await page.screenshot({ path: `${OUT}/after-reorder-preview-375.png` });
    await page.click('[data-form="plan"] [type=submit]');
    const after = await names(page);
    const t2 = (await stored(page)).trip;
    const bkk = t2.destinations.find((s) => s.name === 'בנגקוק');
    pass('reorder', after[0] === before[1] && after[1] === before[0] && bkk && (Date.parse(bkk.endDate) - Date.parse(bkk.startDate)) / 864e5 === 3,
      { before: before.slice(0, 3), after: after.slice(0, 3) });
    pass('errors-3', bag.errors.length === 0, bag);
    await ctx.close();
  }

  // ---------- S3-7: backup out, reset, backup in = same route ----------
  {
    const { ctx, page } = await newPage(browser);
    const c2 = await browser.newContext({ ...VIEW, acceptDownloads: true, serviceWorkers: 'block' });
    await ctx.close();
    const p = await c2.newPage();
    await p.clock.setFixedTime(AT('2026-12-09'));
    await p.goto(`${BASE}#/itinerary`);
    await ready(p);
    await addStop(p, { name: 'גיבוי', start: '2027-01-03', end: '2027-01-04', note: 'בדיקה הלוך חזור' });
    const original = (await stored(p)).trip.destinations;
    await p.goto(`${BASE}#/settings`);
    const [download] = await Promise.all([p.waitForEvent('download'), p.click('[data-action="export"]')]);
    const file = path.join(OUT, 'roundtrip-backup.json');
    await download.saveAs(file);
    await p.click('[data-action="reset-open"]');
    await p.fill('[data-slot="reset-input"]', 'איפוס');
    await p.click('[data-action="reset-confirm"]');
    const afterReset = (await stored(p)).trip.destinations.length;
    await p.setInputFiles('#import-file', file);
    await p.click('[data-action="import-confirm"]');
    const restored = (await stored(p)).trip.destinations;
    pass('S3-7', JSON.stringify(restored) === JSON.stringify(original) && afterReset === 11, { stops: original.length, afterResetPackOnly: afterReset, sameAfterImport: JSON.stringify(restored) === JSON.stringify(original) });
    fs.rmSync(file);
    await c2.close();
  }

  // ---------- S3-6: offline. New files cached, cache name has the new version ----------
  {
    const { ctx, page } = await newPage(browser, { sw: 'allow' });
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // the page is now controlled by the worker
    await ready(page);
    const caches = await page.evaluate(async () => {
      const names = await caches.keys();
      const c = await caches.open(names[0]);
      return { names, has: !!(await c.match('./src/js/core/itinerary.js')) };
    });
    await ctx.setOffline(true);
    await page.reload();
    await ready(page);
    const offline = { stops: await page.locator('.stop').count(), today: await page.locator('[data-slot="itin-today-text"]').textContent() };
    await addStop(page, { name: 'בלי רשת', start: '2027-01-03', end: '2027-01-04' });
    const savedOffline = (await stored(page)).trip.destinations.some((s) => s.name === 'בלי רשת');
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;
    pass('S3-6', caches.names.includes(`tisa-${version}`) && caches.has && offline.stops === 11 && savedOffline, { caches, offline, savedOffline, version });
    await ctx.close();
  }

  // ---------- Dark theme screenshot ----------
  {
    const { ctx, page } = await newPage(browser, { theme: 'dark' });
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    await page.screenshot({ path: `${OUT}/after-itinerary-375-dark.png`, fullPage: true });
    await ctx.close();
  }

  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, 'browser-check.json'), `${JSON.stringify(results, null, 2)}\n`);
  const fails = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [id, v] of Object.entries(results)) console.log(`${v.result}  ${id}`);
  process.exitCode = fails.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
