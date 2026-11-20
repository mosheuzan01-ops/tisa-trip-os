// Stage 6.0d browser checks: check-in for flights and hotels, reminders in the app only, time differences
// (docs/GOALS_STAGE6.md S6-6, S6-7, S6-8, S6-10, S6-1/12/13/14 for check-ins). 375px and 1280px, real app.
// Waits for UI state, not fixed sleeps (rule 6). Run 3 times. Writes only to QA_OUT, default docs/evidence/stage6/6.0d (rule 10).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/6.0d');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8098;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = { mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const bag = { errors: [], external: [], notify: [] };
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const stored = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });

function state(checkins = []) {
  const at = '2026-12-01T10:00:00.000Z';
  return {
    schemaVersion: 4, appVersion: '0.5.5', createdAt: at, updatedAt: at,
    settings: { language: 'he', theme: null, lastBackupAt: '2026-12-03T10:00:00.000Z', assistantQuestionLimit: 50 },
    activeTripId: 'trip-1',
    trips: { 'trip-1': {
      id: 'trip-1', countryCode: 'TH', name: 'תאילנד', startDate: '2026-12-05', endDate: '2027-01-03',
      destinations: [{ id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' }],
      budget: { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false },
      rates: {}, expenses: [],
      transfers: [{ id: 't1', kind: 'flight', from: 'תל אביב', to: 'בנגקוק', date: '2026-12-05', time: '', company: '', booking: 'ABC123', priceMinor: null, currency: 'ILS', link: '', status: 'booked', note: '', expenseId: null }],
      checklist: [], tasks: [], events: [], info: {}, assistant: {}, journal: {}, checkins, luggage: { bags: [] },
    } },
  };
}
const FLIGHT = { id: 'ci-f', kind: 'flight', title: 'צ\'ק-אין לטיסה', transferId: 't1', stopId: null, date: '2026-12-04', time: '', zone: 'Asia/Jerusalem', booking: 'ABC123', link: '', note: '', done: false };
const HOTEL = { id: 'ci-h', kind: 'hotel', title: 'מלון בבנגקוק', transferId: null, stopId: 'd1', date: '2026-12-05', time: '14:00', zone: 'Asia/Bangkok', booking: '', link: '', note: '', done: false };

function watch(page) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
}
async function open(browser, view, s, route, when, extra = {}) {
  const ctx = await browser.newContext({ viewport: VIEWS[view], deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem', ...extra });
  await ctx.addInitScript((x) => {
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); }
    // S6-7: count any attempt at a system notification.
    window.__notify = 0;
    if (window.Notification) { const N = window.Notification; window.Notification = function (...a) { window.__notify += 1; return new N(...a); }; window.Notification.requestPermission = () => { window.__notify += 1; return Promise.resolve('denied'); }; }
  }, JSON.stringify(s));
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date(when));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}
async function fill(page, o) {
  if (o.kind) { await page.selectOption('#dlg-checkin [name="kind"]', o.kind); }
  for (const k of ['title', 'date', 'time', 'booking', 'link', 'note']) if (k in o) await page.fill(`#dlg-checkin [name="${k}"]`, o[k]);
  if (o.zone) await page.selectOption('#dlg-checkin [name="zone"]', o.zone);
  if (o.transferId !== undefined) await page.selectOption('#dlg-checkin [name="transferId"]', o.transferId);
  if (o.stopId !== undefined) await page.selectOption('#dlg-checkin [name="stopId"]', o.stopId);
}
const item = (page, title) => page.locator('#panel-transfers .checkin', { hasText: title });

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  for (const view of Object.keys(VIEWS)) {
    // ---------- CI-1..CI-4: add by hand, on the transfers screen ----------
    {
      const { ctx, page } = await open(browser, view, state(), 'transfers', '2026-12-02T10:00:00+02:00');
      const empty = await page.locator('[data-slot="checkins-empty"]').isVisible();
      await page.click('#panel-transfers [data-action="checkin-add"]');
      await page.locator('#dlg-checkin[open]').waitFor();
      const zoneDefault = await page.inputValue('#dlg-checkin [name="zone"]');
      const stopHiddenForFlight = await page.locator('#dlg-checkin [data-slot="checkin-stop-field"]').isHidden();
      if (SHOTS && view === 'mobile') await page.screenshot({ path: `${OUT}/after-checkin-dialog-${view}.png` });
      // validation first: no title, no date, a bad link
      await fill(page, { title: '', date: '', link: 'www.example.com' });
      await page.click('#dlg-checkin [type="submit"]');
      const err = await page.locator('#checkin-error').innerText();
      await fill(page, { kind: 'flight', title: 'צ\'ק-אין לטיסה', date: '2026-12-04', time: '', zone: 'Asia/Jerusalem', link: 'https://airline.example/checkin', transferId: 't1' });
      await page.click('#dlg-checkin [type="submit"]');
      await closed(page, '#dlg-checkin');
      const f = await item(page, 'צ\'ק-אין לטיסה').innerText();
      pass(`CI-1 flight by hand ${view}`, empty && zoneDefault === 'Asia/Bangkok' && stopHiddenForFlight && /שעה: עוד לא הוזנה/.test(f) && /תל אביב – בנגקוק/.test(f) && /שעון ישראל/.test(f)
        && /כתבו|בחרו|תאריך/.test(err) && /קישור/.test(err), { empty, zoneDefault, stopHiddenForFlight, f, err });
      const link = await item(page, 'צ\'ק-אין לטיסה').locator('a').getAttribute('rel');

      await page.click('#panel-transfers [data-action="checkin-add"]');
      await page.locator('#dlg-checkin[open]').waitFor();
      await fill(page, { kind: 'hotel' });
      const flightHiddenForHotel = await page.locator('#dlg-checkin [data-slot="checkin-flight-field"]').isHidden();
      await fill(page, { title: 'מלון בבנגקוק', date: '2026-12-05', time: '14:00', zone: 'Asia/Bangkok', stopId: 'd1' });
      await page.click('#dlg-checkin [type="submit"]');
      await closed(page, '#dlg-checkin');
      const h = await item(page, 'מלון בבנגקוק').innerText();
      const t = await stored(page);
      // 14:00 in Bangkok on 5.12 is 09:00 in Israel (winter time); the screen works it out with Intl, the test checks it.
      pass(`CI-2 hotel with time, shown in the other zone ${view}`, flightHiddenForHotel && /14:00/.test(h) && /09:00/.test(h) && /בנגקוק/.test(h)
        && t.checkins.length === 2 && t.checkins[1].stopId === 'd1' && t.checkins[1].transferId === null && t.checkins[0].transferId === 't1' && t.checkins[0].time === '' && link === 'noopener noreferrer',
        { h, checkins: t.checkins });

      const diff = await page.locator('[data-slot="tz-diff"]').innerText();
      pass(`CI-3 time difference in winter ${view}`, /תאילנד/.test(diff) && /ישראל/.test(diff) && /5/.test(diff), { diff });
      if (SHOTS) {
        await page.locator('[data-slot="checkin-list"]').evaluate((n) => n.scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: `${OUT}/after-checkins-${view}.png` });
      }

      // CI-4: edit keeps it one entry; delete asks first.
      await item(page, 'מלון בבנגקוק').locator('[data-action="checkin-edit"]').click();
      await page.locator('#dlg-checkin[open]').waitFor();
      const pre = await page.inputValue('#dlg-checkin [name="time"]');
      await fill(page, { time: '15:00' });
      await page.click('#dlg-checkin [type="submit"]');
      await closed(page, '#dlg-checkin');
      const t2 = await stored(page);
      await item(page, 'מלון בבנגקוק').locator('[data-action="checkin-delete"]').click();
      await page.locator('#dlg-checkin-delete[open]').waitFor();
      const ask = await page.locator('#dlg-checkin-delete').innerText();
      await page.click('#dlg-checkin-delete [data-close]');
      await closed(page, '#dlg-checkin-delete');
      const afterNo = (await stored(page)).checkins.length;
      await item(page, 'מלון בבנגקוק').locator('[data-action="checkin-delete"]').click();
      await page.locator('#dlg-checkin-delete[open]').waitFor();
      await page.click('#dlg-checkin-delete [data-action="checkin-delete-yes"]');
      await closed(page, '#dlg-checkin-delete');
      const t3 = await stored(page);
      pass(`CI-4 edit and delete with a yes ${view}`, pre === '14:00' && t2.checkins.length === 2 && t2.checkins[1].time === '15:00' && /למחוק/.test(ask) && afterNo === 2 && t3.checkins.length === 1,
        { pre, ask, afterNo, after: t3.checkins.length });

      // CI-5: deleting the linked flight keeps the check-in, unlinked.
      await page.locator('#panel-transfers .transfer [data-action="transfer-delete"]').click();
      await page.locator('#dlg-transfer-delete[open]').waitFor();
      await page.click('[data-action="transfer-delete-confirm"]');
      await closed(page, '#dlg-transfer-delete');
      const t4 = await stored(page);
      const shown = await item(page, 'צ\'ק-אין לטיסה').innerText();
      pass(`CI-5 flight deleted, check-in kept ${view}`, t4.transfers.length === 0 && t4.checkins.length === 1 && t4.checkins[0].transferId === null && !/תל אביב – בנגקוק/.test(shown), { shown });

      const audit = await page.evaluate(() => {
        const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]') && !n.closest('dialog:not([open])'); };
        const all = [...document.querySelector('#panel-transfers').querySelectorAll('*')];
        const tap = (b) => (b.matches('input[type="checkbox"]') ? b.closest('label') : b);
        const small = all.filter((b) => b.matches('button, input, select, a') && vis(b)).map((b) => { const r = tap(b).getBoundingClientRect(); return { el: b.dataset.action ?? b.name ?? b.tagName, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44);
        const tiny = all.filter((n) => vis(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 14).map((n) => n.textContent.trim().slice(0, 20));
        const clipped = all.filter((b) => b.matches('button') && vis(b) && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
        return { hscroll: document.documentElement.scrollWidth > innerWidth, small, tiny, clipped };
      });
      pass(`CI-9 layout ${view}`, !audit.hscroll && !audit.small.length && !audit.tiny.length && !audit.clipped.length, audit);
      await ctx.close();
    }

    // ---------- CI-6: reminders in the app: home, assistant, calendar; "done" clears them ----------
    {
      // 4.12, 09:00 in Israel: the flight check-in (Israel zone) is due today; the hotel (5.12) is not yet.
      const { ctx, page } = await open(browser, view, state([FLIGHT, HOTEL]), 'home', '2026-12-04T09:00:00+02:00');
      const home = page.locator('[data-slot="home-checkin"]');
      await home.waitFor();
      const homeText = await home.innerText();
      if (SHOTS) await page.screenshot({ path: `${OUT}/after-home-checkin-${view}.png`, fullPage: false });
      await page.goto(`${BASE}#/assistant`); await ready(page);
      const ast = await page.locator('[data-slot="ast-today"]').innerText();
      await page.goto(`${BASE}#/calendar`); await ready(page);
      const cal5 = await page.locator('#panel-calendar [data-date="2026-12-05"]').innerText();
      await page.goto(`${BASE}#/transfers`); await ready(page);
      await item(page, 'צ\'ק-אין לטיסה').locator('[data-action="checkin-toggle"]').check();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('tisa:v1')).trips['trip-1'].checkins[0].done === true);
      await page.goto(`${BASE}#/home`); await ready(page);
      const gone = await page.locator('[data-slot="home-checkin"]').isHidden();
      pass(`CI-6 reminder in the app ${view}`, /צ'ק-אין לטיסה/.test(homeText) && /היום/.test(homeText) && /צ'ק-אין לטיסה/.test(ast) && /מלון בבנגקוק/.test(cal5) && /14:00/.test(cal5) && gone,
        { homeText, ast, cal5, gone });
      const notify = await page.evaluate(() => window.__notify);
      bag.notify.push(notify);
      await ctx.close();
    }

    // ---------- CI-7: a check-in that was not done is overdue the next day, in red; no done, no reminder ----------
    {
      const { ctx, page } = await open(browser, view, state([FLIGHT]), 'home', '2026-12-06T09:00:00+07:00');
      const home = page.locator('[data-slot="home-checkin"]');
      await home.waitFor();
      const cls = await home.getAttribute('class');
      const text = await home.innerText();
      await page.goto(`${BASE}#/transfers`); await ready(page);
      const itemCls = await item(page, 'צ\'ק-אין לטיסה').getAttribute('class');
      pass(`CI-7 overdue ${view}`, /is-overdue/.test(cls) && /עבר/.test(text) && /is-overdue/.test(itemCls), { cls, text, itemCls });
      await ctx.close();
    }
  }

  // ---------- CI-8: time difference follows the date: Israel summer time gives a different number ----------
  {
    const { ctx, page } = await open(browser, 'mobile', state(), 'transfers', '2026-07-01T10:00:00+03:00');
    const summer = await page.locator('[data-slot="tz-diff"]').innerText();
    await ctx.close();
    pass('CI-8 summer difference', /4/.test(summer) && !/5/.test(summer), { summer });
  }

  // ---------- CI-10: backup round trip and offline ----------
  {
    const ctx = await browser.newContext({ viewport: VIEWS.mobile, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state([FLIGHT, HOTEL])));
    const page = await ctx.newPage();
    watch(page);
    await page.clock.setFixedTime(new Date('2026-12-02T10:00:00+02:00'));
    await page.goto(`${BASE}#/transfers`);
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('tisa-')));
      return (await c.keys()).map((r) => new URL(r.url).pathname).filter((u) => /checkins|timezones/.test(u));
    });
    await page.click('.settings-btn');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#panel-settings [data-action="export"]')]);
    let rt = false;
    if (download) {
      const file = path.join(OUT, 'roundtrip.json');
      await download.saveAs(file);
      await page.click('[data-action="reset-open"]');
      await page.fill('[data-slot="reset-input"]', 'איפוס');
      await page.click('[data-action="reset-confirm"]');
      await closed(page, '#dlg-reset');
      const wiped = (await stored(page)).checkins.length;
      await page.setInputFiles('#import-file', file);
      await page.waitForSelector('#dlg-import[open]');
      await page.click('[data-action="import-confirm"]');
      await closed(page, '#dlg-import');
      fs.unlinkSync(file);
      rt = wiped === 0 && JSON.stringify((await stored(page)).checkins) === JSON.stringify([FLIGHT, HOTEL]);
    }
    await ctx.setOffline(true);
    await page.goto(`${BASE}#/transfers`);
    await page.reload(); await ready(page);
    await item(page, 'מלון בבנגקוק').locator('[data-action="checkin-toggle"]').check();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('tisa:v1')).trips['trip-1'].checkins[1].done === true);
    await ctx.setOffline(false);
    pass('CI-10 backup and offline', cached.length === 3 && rt, { cached, rt });
    await ctx.close();
  }

  pass('CI-11 no system notifications', bag.notify.every((n) => n === 0) && bag.notify.length === 2, { notify: bag.notify });
  pass('no JS errors, no outside requests', bag.errors.length === 0 && bag.external.length === 0, { errors: bag.errors, external: bag.external });
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); console.error(JSON.stringify(bag)); process.exit(2); });
