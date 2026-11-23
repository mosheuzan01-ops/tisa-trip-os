// Stage 9 PR 1 browser checks (docs/GOALS_STAGE9.md): template budget, daily base, emergency apart, route from the
// dates, archive, one-time card, moving money, renaming, a copy kept before migrating. Sample data and sample dates
// only (rule 16): 2030-03-01..2030-04-01 is 32 dates. 390px. Waits for UI state (rule 6). Run 3 times.
// Writes only to QA_OUT, default docs/evidence/stage9/browser (rule 10). Port 8126.
const { chromium } = require('playwright');
const { openMoneyDetails } = require('./lib/money-details.cjs');
const { blankTrip } = require('./lib/blank-trip.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage9/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const BASE = 'http://127.0.0.1:8126/';
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const v5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v5-stage7.json'), 'utf8');

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const text = (page, sel) => page.locator(sel).innerText().catch(() => '');
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

async function open(browser, seed, route) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });
  if (seed) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
  else await blankTrip(ctx); // pre-stage-10 PR B: a 0.8.3-style trip (no budget), see scripts/qa/lib/blank-trip.cjs
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2026-12-11T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}
async function setDates(page, start, end) {
  await page.goto(`${BASE}#/settings`);
  await page.fill('[data-form="settings-dates"] [name="start"]', start);
  await page.fill('[data-form="settings-dates"] [name="end"]', end);
  await page.click('[data-form="settings-dates"] [type="submit"]');
  await page.waitForFunction(([s]) => JSON.parse(localStorage.getItem('tisa:v1') ?? '{}')?.trips && Object.values(JSON.parse(localStorage.getItem('tisa:v1')).trips)[0].startDate === s, [start]);
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: '8126' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  try {
    // ---------- a new user ----------
    const n = await open(browser, null, 'money');
    await setDates(n.page, '2030-03-01', '2030-04-01');
    await n.page.goto(`${BASE}#/money`);
    await openMoneyDetails(n.page); // 1.0.1: inside "details"
    await n.page.click('[data-slot="money-empty"] [data-action="profile-open"]');
    await n.page.locator('#dlg-profile[open]').waitFor();
    const checked = await n.page.locator('#dlg-profile input[name="profile"]:checked').getAttribute('value');
    const archiveFolded = await n.page.locator('#dlg-profile details.profile-archive:not([open])').count();
    const archiveIds = await n.page.$$eval('#dlg-profile details.profile-archive input[name="profile"]', (l) => l.map((x) => x.value));
    const staleText = await text(n.page, '#dlg-profile details.profile-archive');
    if (SHOTS) await n.page.screenshot({ path: `${OUT}/profile-dialog-mobile.png` });
    pass('S9-4 new trip: the template is the default; the 3 old profiles are in a folded archive marked stale',
      checked === 'plan20k' && archiveFolded === 1 && archiveIds.join() === 'saver,realistic,comfort' && /לא מעודכנ/.test(staleText), { checked, archiveIds });
    await n.page.click('#dlg-profile [type="submit"]');
    await closed(n.page, '#dlg-profile');
    const t1 = await trip(n.page);
    const total = await text(n.page, '[data-slot="money-total"]');
    const base = await text(n.page, '[data-slot="money-base"]');
    const em = await text(n.page, '[data-slot="money-emergency-note"]');
    const counts = await text(n.page, '[data-slot="money-counts"]');
    const cats = await n.page.$$eval('#panel-money [data-slot="cat-list"] li.cat', (l) => l.map((x) => x.dataset.cat));
    const foodName = await text(n.page, '#panel-money [data-slot="cat-list"] li.cat[data-cat="food"] .cat-name');
    if (SHOTS) await n.page.screenshot({ path: `${OUT}/money-template-mobile.png`, fullPage: true });
    pass('S9-1 template: 20,000 base, emergency 2,500 shown apart and not counted in it',
      /20,000/.test(total) && /2,500/.test(em) && /22,500/.test(em) && t1.budget.categoriesMinor.emergency === 250000 && t1.budget.profileId === 'plan20k', { total, em });
    pass('S9-2 daily base 468.75 for 32 dates; dates, nights and lodging nights shown', /468\.75/.test(base) && /32/.test(base) && /32/.test(counts) && /31/.test(counts), { base, counts });
    pass('S9-1 template names; "green" hidden while empty', foodName.includes('אוכל ושתייה') && !cats.includes('green') && cats.length === 7, { cats, foodName });

    // route from the dates
    await n.page.goto(`${BASE}#/itinerary`);
    // Pre-stage-10 PR B (owner decision): entering the dates already built the suggested route; the "suggested
    // route" dialog is only for a trip whose route is empty. The route checks below are unchanged.
    const autoBuilt = (await trip(n.page)).destinations.length > 0;
    let seedText = '';
    if (!autoBuilt) {
      await n.page.click('[data-slot="itin-empty"] [data-action="seed-open"]');
      await n.page.locator('#dlg-seed[open]').waitFor();
      seedText = await text(n.page, '[data-slot="seed-text"]');
      await n.page.click('[data-action="seed-confirm"]');
      await closed(n.page, '#dlg-seed');
    }
    const t2 = await trip(n.page);
    const names = t2.destinations.map((s) => s.name);
    const note = await text(n.page, '[data-slot="route-note"]');
    const missing = await n.page.locator('#panel-itinerary .stop-transfer-missing').count();
    if (SHOTS) await n.page.screenshot({ path: `${OUT}/itinerary-suggested-mobile.png`, fullPage: true });
    const counts2 = await (async () => { await n.page.goto(`${BASE}#/money`); return text(n.page, '[data-slot="money-counts"]'); })();
    pass('S9-3 route from the dates: Bangkok first and last, southern islands, marked as a suggestion, transfers not entered',
      names[0] === 'בנגקוק' && names[names.length - 1] === 'בנגקוק' && !names.some((x) => /פאי|צ'יאנג|קראבי/.test(x)) && names.includes('קו לנטה')
      && t2.destinations.every((s) => s.suggested) && /לא הוזמן/.test(note) && missing === names.length - 1 && /30/.test(counts2) && (autoBuilt || /\d/.test(seedText)),
      { names, note, missing, counts2, autoBuilt });
    await n.ctx.close();

    // ---------- an existing user (real v5 data) ----------
    const e = await open(browser, v5, 'money');
    const copyKept = await e.page.evaluate(() => localStorage.getItem('tisa:premigration:v5'));
    pass('v6: the old data is kept once under its own key before migrating', copyKept === v5 && JSON.parse(copyKept).schemaVersion === 5, { kept: (copyKept ?? '').length, seed: v5.length });
    const card = await e.page.locator('[data-slot="template-card"]:not([hidden])').count();
    const before = await trip(e.page);
    await e.page.click('[data-action="template-decline"]');
    await e.page.waitForSelector('[data-slot="template-card"][hidden]', { state: 'attached' });
    await e.page.reload();
    await ready(e.page);
    const afterDecline = await trip(e.page);
    const cardAgain = await e.page.locator('[data-slot="template-card"]:not([hidden])').count();
    pass('S9-5 decline: one card, nothing changed, not shown again', card === 1 && cardAgain === 0 && afterDecline.templateOffer === 'declined'
      && JSON.stringify({ ...afterDecline, templateOffer: null }) === JSON.stringify({ ...before, templateOffer: null }));
    await e.ctx.close();

    // Sample trip dates set in the data (changing dates in settings would open the replan step, not tested here).
    const withDates = JSON.stringify({ ...JSON.parse(v5), trips: { t: { ...JSON.parse(v5).trips.t, startDate: '2030-03-01', endDate: '2030-04-01' } } });
    const a = await open(browser, withDates, 'money');
    const beforeApply = await trip(a.page);
    await a.page.click('[data-action="template-open"]');
    await a.page.locator('#dlg-template[open]').waitFor();
    const preview = await text(a.page, '[data-slot="template-preview"]');
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/template-confirm-mobile.png` });
    await a.page.click('[data-action="template-apply"]');
    await closed(a.page, '#dlg-template');
    const applied = await trip(a.page);
    const same = ['expenses', 'transfers', 'checkins', 'photos', 'journal', 'checklist', 'tasks', 'luggage'].every((k) => JSON.stringify(applied[k]) === JSON.stringify(beforeApply[k]));
    await openMoneyDetails(a.page); // 1.0.1: inside "details"
    const greenShown = await a.page.locator('#panel-money [data-slot="cat-list"] li.cat[data-cat="green"]').count();
    const archivedStop = await a.page.locator('#panel-money .exp:has-text("צ\'יאנג מאי")').count();
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/money-after-apply-mobile.png`, fullPage: true });
    pass('S9-5 apply: expenses and everything else unchanged; old budget and route archived; own emergency kept',
      same && applied.archive.budgets.length === 1 && applied.archive.routes.length === 1 && applied.budget.profileId === 'plan20k'
      && applied.budget.categoriesMinor.emergency === beforeApply.budget.categoriesMinor.emergency && /הוצאות/.test(preview), { preview });
    pass('S9-6 an expense in hidden "green" keeps it visible; an expense on an archived stop still shows the stop name', greenShown === 1 && archivedStop >= 1, { greenShown, archivedStop });

    // move money and rename
    await openMoneyDetails(a.page); // 1.0.1: inside "details"
    await a.page.click('#panel-money li.cat[data-cat="misc"] [data-action="cat-edit"]');
    await a.page.locator('#dlg-cat[open]').waitFor();
    await a.page.fill('#dlg-cat [name="name"]', 'מתנות');
    await a.page.fill('#dlg-cat [name="amount"]', '500');
    await a.page.selectOption('#dlg-cat [name="to"]', 'food');
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/cat-dialog-mobile.png` });
    await a.page.click('#dlg-cat [type="submit"]');
    await closed(a.page, '#dlg-cat');
    const moved = await trip(a.page);
    const sum = (b) => Object.entries(b.categoriesMinor).filter(([k]) => k !== 'emergency').reduce((s, [, v]) => s + v, 0);
    const miscName = await text(a.page, '#panel-money li.cat[data-cat="misc"] .cat-name');
    pass('S9-6 move 500 from reserve to food and rename: total unchanged, expenses unchanged',
      moved.budget.categoriesMinor.misc === 50000 && moved.budget.categoriesMinor.food === 400000 && sum(moved.budget) === sum(applied.budget)
      && moved.budget.categoryNames.misc === 'מתנות' && miscName.includes('מתנות') && JSON.stringify(moved.expenses) === JSON.stringify(applied.expenses), { miscName });
    pass('S9-9 390px: no horizontal scroll', !(await hScroll(a.page)));
    await a.ctx.close();

    // ---------- the old route only from the archive ----------
    const o = await open(browser, null, 'itinerary');
    await o.page.click('[data-slot="itin-empty"] [data-action="seed-archive-open"]');
    await o.page.locator('#dlg-seed[open]').waitFor();
    const archText = await text(o.page, '[data-slot="seed-text"]');
    await o.page.click('[data-action="seed-confirm"]');
    await closed(o.page, '#dlg-seed');
    const old = await trip(o.page);
    pass('S9-4 the old route loads only from the archive, marked as an old estimate', old.destinations.length === 11 && /לא מעודכנת/.test(archText) && old.destinations.some((s) => s.name === 'פאי'), { archText });
    await o.ctx.close();
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('S9-9 no JS errors', errors.length === 0, { errors });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'browser-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
