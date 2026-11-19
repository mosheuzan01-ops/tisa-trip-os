// Stage 6.0b browser checks: the calendar screen (docs/GOALS_STAGE6.md S6-3, S6-4, S6-13, S6-14 for this screen).
// 375px and 1280px, real app, real data in storage. Waits for UI state, not fixed sleeps (rule 6). Run 3 times.
// Writes only to QA_OUT, default docs/evidence/stage6/6.0b (rule 10). Run from the repo root (port 8093).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/6.0b');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8093;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = { mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const bag = { errors: [], external: [] };
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const NIS = (n) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n).replace(/\s+/g, ' ');

/** A v4 trip with what a day can show: stops (with a travel day), transfers (one without a time), tasks, expenses. */
function state({ dates = true } = {}) {
  const at = '2026-12-01T10:00:00.000Z';
  const exp = (o) => ({ amountMinor: o.baseMinor, currency: 'ILS', rate: 1, category: 'food', method: 'card', description: '', note: '', destinationId: null, ...o });
  return {
    schemaVersion: 4, appVersion: '0.5.5', createdAt: at, updatedAt: at,
    settings: { language: 'he', theme: null, lastBackupAt: '2026-12-05T10:00:00.000Z', assistantQuestionLimit: 50 },
    activeTripId: 'trip-1',
    trips: { 'trip-1': {
      id: 'trip-1', countryCode: 'TH', name: 'תאילנד', startDate: dates ? '2026-12-05' : null, endDate: dates ? '2027-01-03' : null,
      destinations: [
        { id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' },
        { id: 'd2', name: "צ'יאנג מאי", startDate: '2026-12-08', endDate: '2026-12-12', note: '' },
      ],
      budget: { currency: 'ILS', totalMinor: 1527000, categoriesMinor: {}, profileId: null, estimate: false },
      rates: {},
      expenses: [
        exp({ id: 'e1', baseMinor: 3000, date: '2026-12-06', status: 'paid', description: 'שולם' }),
        exp({ id: 'e2', baseMinor: 12000, date: '2026-12-06', status: 'planned', description: 'שוק' }),
        exp({ id: 'e3', baseMinor: 250000, date: '2026-12-06', status: 'committed', category: 'flight', description: 'טיסה' }),
        exp({ id: 'e4', baseMinor: 9900, date: '2026-12-07', status: 'paid', description: 'רק שולם' }),
      ],
      transfers: [
        { id: 't1', kind: 'bus', from: 'בנגקוק', to: "צ'יאנג מאי", date: '2026-12-08', time: '', company: '', booking: '', priceMinor: null, currency: 'ILS', link: '', status: 'planned', note: '', expenseId: null },
        { id: 't2', kind: 'train', from: "צ'יאנג מאי", to: 'צ\'יאנג ראי', date: '2026-12-08', time: '13:30', company: '', booking: '', priceMinor: null, currency: 'ILS', link: '', status: 'planned', note: '', expenseId: null },
      ],
      checklist: [],
      tasks: [
        { id: 'k1', title: 'להזמין שוק צף', status: 'open', due: '2026-12-05', note: '' },
        { id: 'k2', title: 'לכבס', status: 'open', due: '2026-12-06', note: '' },
        { id: 'k3', title: 'מוזיאון', status: 'done', due: '2026-12-06', note: '' },
      ],
      events: [], info: {}, assistant: {}, journal: {}, checkins: [], luggage: { bags: [] },
    } },
  };
}

function watch(page) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
}
async function open(browser, view, s, route, extra = {}) {
  const ctx = await browser.newContext({ viewport: VIEWS[view], deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem', ...extra });
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(s));
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2026-12-06T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}
const day = (page, iso) => page.locator(`#panel-calendar [data-date="${iso}"]`);

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  for (const view of Object.keys(VIEWS)) {
    // ---------- CB-1: opened from the itinerary, the itinerary tab stays lit, Back returns to the itinerary ----------
    {
      const { ctx, page } = await open(browser, view, state(), 'itinerary');
      const tabsBefore = await page.locator('[role="tab"]').count();
      await page.click('#panel-itinerary [data-go="calendar"]');
      await page.locator('#panel-calendar').waitFor();
      const url = new URL(page.url()).hash;
      const lit = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab');
      const tabsAfter = await page.locator('[role="tab"]').count();
      await page.goBack();
      await page.locator('#panel-itinerary').waitFor();
      const back = new URL(page.url()).hash;
      pass(`CB-1 open and back ${view}`, url === '#/calendar' && lit === 'itinerary' && back === '#/itinerary' && tabsBefore === tabsAfter, { url, lit, back, tabsBefore, tabsAfter });
      await ctx.close();
    }

    // ---------- CB-2..CB-5: the days and what each one shows ----------
    {
      const { ctx, page } = await open(browser, view, state(), 'calendar');
      const days = await page.locator('#panel-calendar [data-date]').count();
      const today = day(page, '2026-12-06');
      const todayCls = await today.getAttribute('class');
      const todayCurrent = await today.getAttribute('aria-current');
      const inView = await today.evaluate((n) => { const r = n.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
      pass(`CB-2 days and today ${view}`, days === 30 && /is-today/.test(todayCls) && todayCurrent === 'date' && inView,
        { days, todayCls, todayCurrent, inView });

      const travel = await day(page, '2026-12-08').innerText();
      const iBkk = travel.indexOf('בנגקוק');
      const iCm = travel.indexOf("צ'יאנג מאי");
      const t1 = travel.indexOf('שעה: עוד לא הוזנה');
      const t2 = travel.indexOf('13:30');
      pass(`CB-3 travel day and transfers ${view}`, iBkk >= 0 && iCm > iBkk && /עזיבה/.test(travel) && /הגעה/.test(travel) && t1 >= 0 && t2 > t1,
        { travel });

      const d5 = day(page, '2026-12-05');
      const overdue = await d5.locator('.cal-task.is-overdue').count();
      const d6 = await day(page, '2026-12-06').innerText();
      const doneTask = await day(page, '2026-12-06').locator('.cal-task.is-done').count();
      pass(`CB-4 tasks ${view}`, overdue === 1 && /לכבס/.test(d6) && doneTask === 1, { overdue, doneTask });

      const planned6 = (await day(page, '2026-12-06').locator('[data-slot="cal-planned"]').innerText()).replace(/\s+/g, ' ');
      const planned7 = await day(page, '2026-12-07').locator('[data-slot="cal-planned"]').innerText();
      const noExpenseList = !/שוק|שולם/.test(d6); // the total only, not the list of expenses
      pass(`CB-5 planned per day ${view}`, planned6.includes(NIS(2620)) && !planned6.includes(NIS(2650)) && /אין תכנון ליום זה/.test(planned7) && noExpenseList,
        { planned6, planned7, noExpenseList });

      const empty = await day(page, '2026-12-20').innerText();
      pass(`CB-6 a day with nothing ${view}`, /אין תחנה ליום הזה/.test(empty) && /אין תכנון ליום זה/.test(empty), { empty });

      if (SHOTS) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${OUT}/after-calendar-top-${view}.png` });
        await today.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${OUT}/after-calendar-today-${view}.png` });
      }

      const audit = await page.evaluate(() => {
        const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]'); };
        const all = [...document.querySelector('#panel-calendar').querySelectorAll('*')];
        const small = all.filter((b) => b.matches('button, input, select, a') && vis(b)).map((b) => ({ el: b.dataset.action ?? b.tagName, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
        const tiny = all.filter((n) => vis(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 14).map((n) => n.textContent.trim().slice(0, 20));
        const clipped = all.filter((b) => b.matches('button') && vis(b) && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
        return { hscroll: document.documentElement.scrollWidth > innerWidth, dir: getComputedStyle(document.querySelector('#panel-calendar')).direction, small, tiny, clipped };
      });
      pass(`CB-7 layout ${view}`, !audit.hscroll && audit.dir === 'rtl' && !audit.small.length && !audit.tiny.length && !audit.clipped.length, audit);
      await ctx.close();
    }

    // ---------- CB-8: no trip dates: say so, no days, a way to set them ----------
    {
      const { ctx, page } = await open(browser, view, state({ dates: false }), 'calendar');
      const emptyShown = await page.locator('[data-slot="cal-empty"]').isVisible();
      const days = await page.locator('#panel-calendar [data-date]').count();
      const text = await page.locator('[data-slot="cal-empty"]').innerText();
      await page.click('[data-slot="cal-empty"] [data-go="itinerary"]');
      await page.locator('#panel-itinerary').waitFor();
      const to = new URL(page.url()).hash;
      if (SHOTS) {
        await page.goBack(); await page.locator('#panel-calendar').waitFor();
        await page.screenshot({ path: `${OUT}/after-calendar-nodates-${view}.png` });
      }
      pass(`CB-8 no dates ${view}`, emptyShown && days === 0 && /עוד אין תאריכי טיול/.test(text) && to === '#/itinerary', { emptyShown, days, text, to });
      await ctx.close();
    }
  }

  // ---------- CB-9: today follows the Bangkok calendar: 00:30 on 7.12 in Bangkok is still 6.12 in Israel ----------
  {
    const { ctx, page } = await open(browser, 'mobile', state(), 'calendar');
    await page.clock.setFixedTime(new Date('2026-12-06T17:30:00Z'));
    await page.reload(); await ready(page);
    const cls = await day(page, '2026-12-07').getAttribute('class');
    const old = await day(page, '2026-12-06').getAttribute('class');
    pass('CB-9 today by the Bangkok calendar', /is-today/.test(cls) && !/is-today/.test(old), { cls, old });
    await ctx.close();
  }

  // ---------- CB-10: dark mode shot, and the new files are cached for offline use ----------
  {
    const ctx = await browser.newContext({ viewport: VIEWS.mobile, deviceScaleFactor: 2, locale: 'he-IL', colorScheme: 'dark', reducedMotion: 'reduce' });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state()));
    const page = await ctx.newPage();
    watch(page);
    await page.clock.setFixedTime(new Date('2026-12-06T10:00:00+07:00'));
    await page.goto(`${BASE}#/calendar`);
    await ready(page);
    if (SHOTS) { await day(page, '2026-12-06').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/after-calendar-today-mobile-dark.png` }); }
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('tisa-')));
      const urls = (await c.keys()).map((r) => new URL(r.url).pathname);
      return { keys, files: urls.filter((u) => /calendar/.test(u)) };
    });
    await ctx.setOffline(true);
    await page.reload(); await ready(page);
    const offlineDays = await page.locator('#panel-calendar [data-date]').count();
    await ctx.setOffline(false);
    pass('CB-10 offline', cached.files.length === 2 && offlineDays === 30, { cached, offlineDays });
    await ctx.close();
  }

  pass('no JS errors, no outside requests', bag.errors.length === 0 && bag.external.length === 0, bag);
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); console.error(JSON.stringify(bag)); process.exit(2); });
