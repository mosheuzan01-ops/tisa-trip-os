// Pre-stage-10, PR B: a new trip comes with the plan20k budget and, once dates are entered, the suggested route.
// Stage 13 (owner, 2026-11-22, docs/BUDGET_AND_START.md): T1 and O now check the new start (the shared dates and the
// route, no budget amounts); T3 starts from a trip with no dates (lib/blank-trip.cjs), as an older version left it.
// An existing route is rebuilt from the template only after a preview and a yes; the old route goes to the archive.
// Owner decision 2026-11-21 (docs/GOALS_STAGE10.md "PR B"). Sample dates only (2030, rule 16).
// Waits for UI state (rule 6). Run 3 times. QA_OUT (default docs/evidence/stage10/pre-b/browser), PORT (default 8132).
// SHOTS=0 skips screenshots. SHOTS_ONLY=1 with APP_ROOT=<checkout> takes only the "before" screenshots (e.g. main).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { blankState } = require('./lib/blank-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.resolve(process.env.APP_ROOT ?? ROOT);
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage10/pre-b/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8132);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const v5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v5-stage7.json'), 'utf8');
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const START = '2030-12-20';
const END = '2031-01-20';

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1') ?? 'null'); return s ? s.trips[s.activeTripId] : null; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const visible = (page, sel) => page.locator(sel).isVisible().catch(() => false);
const sum = (o) => Object.entries(o ?? {}).filter(([k]) => k !== 'emergency').reduce((s, [, v]) => s + v, 0);

async function open(browser, seed, route, viewport = MOBILE, extra = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem', ...extra });
  if (seed) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2030-11-01T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}
async function setDates(page, start, end) {
  await page.goto(`${BASE}#/settings`);
  await page.locator('#panel-settings').waitFor();
  await page.fill('[data-form="settings-dates"] [name="start"]', start);
  await page.fill('[data-form="settings-dates"] [name="end"]', end);
  await page.click('[data-form="settings-dates"] [type="submit"]');
}

async function shots(browser, label) {
  for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
    const f = await open(browser, null, 'money', vp);
    await f.page.screenshot({ path: `${OUT}/${label}-fresh-money-${name}.png`, fullPage: true });
    await setDates(f.page, START, END);
    await f.page.waitForFunction((s) => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].startDate === s, START);
    await f.page.goto(`${BASE}#/itinerary`);
    await f.page.locator('#panel-itinerary').waitFor();
    await f.page.screenshot({ path: `${OUT}/${label}-fresh-itinerary-after-dates-${name}.png`, fullPage: true });
    await f.ctx.close();
    const o = await open(browser, v5, 'itinerary', vp);
    await o.page.screenshot({ path: `${OUT}/${label}-old-data-itinerary-${name}.png`, fullPage: true });
    await o.ctx.close();
  }
}

(async () => {
  const server = spawn(process.execPath, [path.join(APP, 'scripts/serve.js')], { cwd: APP, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  if (process.env.SHOTS_ONLY === '1') {
    try { await shots(browser, 'before'); console.log('before shots written'); } finally { await browser.close(); server.kill(); }
    return;
  }
  try {
    // ---------- T1: a fresh install: the shared dates and the route, the template categories at 0 ----------
    const a = await open(browser, null, 'money');
    const t1 = await trip(a.page);
    const free = await a.page.locator('[data-slot="money-free"]').textContent();
    pass('T1 fresh install: no budget of its own (template categories at 0, "—"), no template card; the shared dates and their route',
      t1?.budget.profileId === null && sum(t1.budget.categoriesMinor) === 0 && 'flight' in t1.budget.categoriesMinor && free === '—'
      && !(await visible(a.page, '[data-slot="template-card"]')) && t1.startDate === '2026-12-20' && t1.endDate === '2027-01-20' && t1.destinations.length >= 5,
      { profile: t1?.budget.profileId ?? null, total: t1 ? sum(t1.budget.categoriesMinor) : null, free, dates: [t1?.startDate, t1?.endDate], stops: t1?.destinations.length });
    pass('T2 390px: no sideways scroll on the money screen', !(await hScroll(a.page)));
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-fresh-money-mobile.png`, fullPage: true });

    // ---------- T3: entering dates on a trip with no dates builds the route; a reload keeps it ----------
    await a.ctx.close();
    const noDates = await open(browser, await blankState(), 'money');
    a.page = noDates.page;
    a.ctx = noDates.ctx;
    await setDates(a.page, START, END);
    await a.page.waitForFunction(() => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].destinations.length > 0, null, { timeout: 5000 }).catch(() => {});
    await a.page.goto(`${BASE}#/itinerary`);
    await a.page.locator('#panel-itinerary').waitFor();
    await a.page.reload();
    await ready(a.page);
    const t3 = await trip(a.page);
    const stopCards = await a.page.locator('#panel-itinerary [data-slot="stops"] .stop').count();
    pass('T3 dates on a new trip: the suggested route is built at once, from the day after departure to the return date, and kept after a reload',
      t3.destinations.length >= 5 && stopCards === t3.destinations.length && t3.destinations[0].startDate === '2030-12-21' && t3.destinations.at(-1).endDate === END
      && t3.destinations.every((x) => x.suggested) && t3.destinations[0].name === 'בנגקוק',
      { stops: t3.destinations.map((x) => `${x.name} ${x.startDate}–${x.endDate}`), stopCards });
    pass('T4 390px: no sideways scroll on the itinerary', !(await hScroll(a.page)));
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-fresh-itinerary-after-dates-mobile.png`, fullPage: true });

    // ---------- T5: new dates with stops: "new route from the template" previews first; cancel keeps everything ----------
    const before5 = await trip(a.page);
    await a.page.click('[data-action="replan-open"]');
    await a.page.locator('#dlg-replan[open]').waitFor();
    await a.page.fill('[data-form="replan"] [name="end"]', '2031-01-25');
    await a.page.check('[data-form="replan"] input[name="mode"][value="template"]');
    await a.page.waitForSelector('[data-slot="replan-preview"] .replan-new');
    const previewText = await a.page.locator('[data-slot="replan-preview"]').innerText();
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-replan-template-preview-mobile.png` });
    await a.page.click('#dlg-replan [data-close]');
    await closed(a.page, '#dlg-replan');
    const afterCancel = await trip(a.page);
    pass('T5 template mode shows the new stops and says the old route goes to the archive; cancel changes nothing',
      /ארכיון/.test(previewText) && /בנגקוק/.test(previewText) && JSON.stringify(afterCancel) === JSON.stringify(before5), { previewText: previewText.slice(0, 300) });

    // ---------- T6: yes: route rebuilt for the new dates, old route archived exactly ----------
    await a.page.click('[data-action="replan-open"]');
    await a.page.locator('#dlg-replan[open]').waitFor();
    await a.page.fill('[data-form="replan"] [name="end"]', '2031-01-25');
    await a.page.check('[data-form="replan"] input[name="mode"][value="template"]');
    await a.page.waitForSelector('[data-slot="replan-preview"] .replan-new');
    await a.page.click('[data-slot="replan-save"]');
    await closed(a.page, '#dlg-replan');
    const t6 = await trip(a.page);
    pass('T6 yes: new route ends on the new return date; the previous route is in the archive, unchanged; budget and checklist unchanged',
      t6.endDate === '2031-01-25' && t6.destinations.at(-1).endDate === '2031-01-25' && JSON.stringify(t6.archive.routes.at(-1)?.destinations) === JSON.stringify(before5.destinations)
      && JSON.stringify(t6.budget) === JSON.stringify(before5.budget) && JSON.stringify(t6.checklist) === JSON.stringify(before5.checklist),
      { archived: t6.archive.routes.length });
    await a.ctx.close();

    // ---------- T7: old data: card on the itinerary opens the template preview; expenses never change ----------
    const b = await open(browser, v5, 'itinerary');
    const before7 = await trip(b.page);
    const card = await visible(b.page, '[data-slot="itin-template-card"]');
    if (SHOTS) await b.page.screenshot({ path: `${OUT}/after-old-data-itinerary-mobile.png`, fullPage: true });
    await b.page.click('[data-slot="itin-template-card"] [data-action="itin-template-open"]');
    await b.page.locator('#dlg-replan[open]').waitFor();
    const preset = await b.page.locator('[data-form="replan"] input[name="mode"][value="template"]').isChecked();
    await b.page.waitForSelector('[data-slot="replan-preview"] .replan-new');
    const untouched = JSON.stringify(await trip(b.page)) === JSON.stringify(before7);
    await b.page.click('[data-slot="replan-save"]');
    await closed(b.page, '#dlg-replan');
    const t7 = await trip(b.page);
    pass('T7 old data: the itinerary card opens the template preview (nothing saved before yes); after yes the old stops are archived, expenses and budget unchanged',
      card && preset && untouched && JSON.stringify(t7.archive.routes.at(-1)?.destinations) === JSON.stringify(before7.destinations)
      && JSON.stringify(t7.expenses) === JSON.stringify(before7.expenses) && JSON.stringify(t7.budget) === JSON.stringify(before7.budget)
      && t7.destinations.every((x) => x.suggested),
      { card, preset, untouched });
    await b.ctx.close();

    // ---------- T8: "not now" on the itinerary card hides it for good and changes nothing else ----------
    const c = await open(browser, v5, 'itinerary');
    const before8 = await trip(c.page);
    await c.page.click('[data-slot="itin-template-card"] [data-action="itin-template-decline"]');
    await c.page.waitForSelector('[data-slot="itin-template-card"]', { state: 'hidden' });
    await c.page.reload();
    await ready(c.page);
    const t8 = await trip(c.page);
    const { templateOffer, ...rest8 } = t8;
    const { templateOffer: _o, ...restBefore } = before8;
    pass('T8 "not now": only the answer is saved; the card stays hidden after a reload',
      templateOffer === 'declined' && JSON.stringify(rest8) === JSON.stringify(restBefore) && !(await visible(c.page, '[data-slot="itin-template-card"]')));
    await c.ctx.close();

    // ---------- desktop ----------
    if (SHOTS) {
      const d = await open(browser, null, 'money', DESKTOP);
      await d.page.screenshot({ path: `${OUT}/after-fresh-money-desktop.png`, fullPage: true });
      await setDates(d.page, START, END);
      await d.page.waitForFunction(() => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].destinations.length > 0);
      await d.page.goto(`${BASE}#/itinerary`);
      await d.page.locator('#panel-itinerary').waitFor();
      await d.page.screenshot({ path: `${OUT}/after-fresh-itinerary-after-dates-desktop.png`, fullPage: true });
      await d.ctx.close();
      const e = await open(browser, v5, 'itinerary', DESKTOP);
      await e.page.screenshot({ path: `${OUT}/after-old-data-itinerary-desktop.png`, fullPage: true });
      await e.ctx.close();
    }

    // ---------- O: offline: dates entered with no network still build the route ----------
    const octx = await browser.newContext({ viewport: MOBILE, locale: 'he-IL', reducedMotion: 'reduce' });
    await octx.addInitScript((x) => { if (!localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); }, await blankState());
    const op = await octx.newPage();
    watch(op);
    await op.goto(BASE);
    await op.evaluate(() => navigator.serviceWorker.ready);
    await op.reload();
    await op.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    await octx.setOffline(true);
    await op.reload();
    await ready(op);
    await setDates(op, START, END);
    await op.waitForFunction(() => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].destinations.length > 0, null, { timeout: 5000 }).catch(() => {});
    const off = await trip(op);
    pass('O offline: on a trip with no dates yet, entering dates builds the route with no network', off.startDate === START && off.destinations.length >= 5, { stops: off.destinations.length });
    await octx.close();
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'browser-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
