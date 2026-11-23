// Stage 4 browser checks at 375px (docs/GOALS_STAGE4.md S4-1, S4-3..S4-11).
// Stage 9 (owner, 2026-11-21): the old route and the 3 old profiles moved to the archive; this script uses them from there.
// Waits for UI state, not fixed sleeps (docs/RULES.md rule 6). Run 3 times before calling it PASS.
// Run from the repo root: node scripts/qa/stage4-browser.cjs   (port 8097)
const { chromium } = require('playwright');
const { openMoneyDetails } = require('./lib/money-details.cjs');
const { blankTrip } = require('./lib/blank-trip.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.QA_OUT ? path.resolve(process.env.QA_OUT) : path.join(ROOT, 'docs/evidence/stage4'); // rule 10: reruns write elsewhere
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEW = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce' };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const bag = { errors: [], external: [] };

const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s ? s.trips[s.activeTripId] : null; });
const num = (text) => Number(String(text).replace(/[^\d.-]/g, '')); // "‏11,271.65 ‏₪" -> 11271.65
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); };

function watch(page) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
}

async function fresh(browser, when, extra = {}) {
  const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block', ...extra });
  await blankTrip(ctx); // pre-stage-10 PR B: start from a 0.8.3-style trip (no budget), see scripts/qa/lib/blank-trip.cjs
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date(when));
  await page.goto(`${BASE}#/money`);
  await ready(page);
  return { ctx, page };
}

async function loadProfile(page, id = 'realistic') {
  await openMoneyDetails(page); // 1.0.1: inside "details"
  await page.click('#panel-money [data-action="profile-open"] >> nth=0');
  await page.locator('#dlg-profile details.profile-archive').evaluate((d) => { d.open = true; }); await page.check(`#dlg-profile input[value="${id}"]`);
  await page.click('#dlg-profile [type="submit"]');
  await closed(page, '#dlg-profile');
}

async function addExpense(page, o) {
  const count = await page.locator('#panel-money .exp').count();
  await page.click('#panel-money [data-action="expense-add"]');
  await page.fill('#dlg-expense [name="amount"]', o.amount);
  for (const k of ['currency', 'category', 'status', 'method']) if (o[k]) await page.selectOption(`#dlg-expense [name="${k}"]`, o[k]);
  if (o.date) await page.fill('#dlg-expense [name="date"]', o.date);
  if (o.description) await page.fill('#dlg-expense [name="description"]', o.description);
  await page.click('#dlg-expense [type="submit"]');
  if (o.expectError) return;
  await closed(page, '#dlg-expense');
  await page.waitForFunction((n) => document.querySelectorAll('#panel-money .exp').length > n || document.querySelector('[data-filter="category"]').value !== '', count);
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  // ---------- S4-7, S4-1, S4-3, S4-4, S4-6, S4-8 ----------
  {
    const { ctx, page } = await fresh(browser, '2026-12-12T09:00:00+07:00');
    await shot(page, 'after-money-empty-375-light');
    // S4-7: cancel loads nothing; yes loads; label shown; amounts editable
    await openMoneyDetails(page); // 1.0.1: inside "details"
    await page.click('[data-slot="money-empty"] [data-action="profile-open"]');
    await page.click('#dlg-profile [data-close]');
    await closed(page, '#dlg-profile');
    const afterCancel = (await trip(page))?.budget?.categoriesMinor ?? {};
    await loadProfile(page, 'realistic');
    const loaded = (await trip(page)).budget;
    const label = await page.locator('[data-slot="money-estimate"]').isVisible();
    const labelText = (await page.locator('[data-slot="money-estimate"]').textContent()).trim();
    await openMoneyDetails(page); // 1.0.1: inside "details"
    await page.click('[data-slot="money-cats"] [data-action="cats-open"]');
    await page.fill('#dlg-cats [name="food"]', '2500.50');
    await page.fill('#dlg-cats [name="emergency"]', '1000');
    await page.click('#dlg-cats [type="submit"]');
    await closed(page, '#dlg-cats');
    const edited = (await trip(page)).budget;
    pass('S4-7', Object.keys(afterCancel).length === 0 && loaded.profileId === 'realistic' && loaded.estimate === true && loaded.categoriesMinor.flight === 390000 && loaded.categoriesMinor.emergency === 250000
      && label && /הערכת תכנון, לא מאומת/.test(labelText) && edited.categoriesMinor.food === 250050 && edited.categoriesMinor.emergency === 100000,
    { afterCancel, loaded: { profileId: loaded.profileId, estimate: loaded.estimate, flight: loaded.categoriesMinor.flight }, labelText, editedFood: edited.categoriesMinor.food, emergency: edited.categoriesMinor.emergency });

    // S4-3: an expense at rate 10, then the rate changes to 12; the old one keeps 10
    await addExpense(page, { amount: '300', currency: 'THB', category: 'food', status: 'paid', description: 'פאד תאי' });
    await page.click('[data-action="rates-open"]');
    await page.fill('#dlg-rates [name="ILS_THB"]', '12');
    await page.click('#dlg-rates [type="submit"]');
    await closed(page, '#dlg-rates');
    const badgeCustom = (await page.locator('[data-slot="rates-badge"]').textContent()).trim();
    await addExpense(page, { amount: '300', currency: 'THB', category: 'food', status: 'paid', description: 'שוק לילה' });
    const ex = (await trip(page)).expenses;
    const first = ex.find((e) => e.description === 'פאד תאי');
    const second = ex.find((e) => e.description === 'שוק לילה');
    await page.click('[data-action="rates-open"]');
    await page.click('[data-action="rates-restore"]');
    await closed(page, '#dlg-rates');
    const badgePlanning = (await page.locator('[data-slot="rates-badge"]').textContent()).trim();
    const firstAfterRestore = (await trip(page)).expenses.find((e) => e.description === 'פאד תאי');
    pass('S4-3', first.amountMinor === 30000 && first.currency === 'THB' && first.baseMinor === 3000 && second.baseMinor === 2500
      && firstAfterRestore.baseMinor === 3000 && badgeCustom === 'שער שערכתם' && badgePlanning === 'שער תכנון' && Object.keys((await trip(page)).rates).length === 0,
    { first: { amountMinor: first.amountMinor, rate: first.rate, baseMinor: first.baseMinor }, second: { rate: second.rate, baseMinor: second.baseMinor }, badgeCustom, badgePlanning });

    // S4-1: survives a reload
    await page.reload();
    await ready(page);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    const listed = await page.locator('#panel-money .exp-name').allTextContents();
    pass('S4-1', listed.includes('פאד תאי') && listed.includes('שוק לילה') && keys.every((k) => k.startsWith('tisa:')), { listed, keys });

    // S4-4 + S4-6: overspend in food, statuses separate, sums match
    await addExpense(page, { amount: '2500', currency: 'ILS', category: 'food', status: 'planned', description: 'מסעדות' });
    await addExpense(page, { amount: '1200', currency: 'ILS', category: 'lodging', status: 'committed', description: 'מלון בפוקט' });
    await addExpense(page, { amount: '45.5', currency: 'USD', category: 'attractions', status: 'paid', description: 'קורס בישול' });
    await addExpense(page, { amount: '200', currency: 'ILS', category: 'emergency', status: 'paid', description: 'רופא' });
    const t = await trip(page);
    const normal = t.expenses.filter((e) => e.category !== 'emergency');
    const sum = (st) => normal.filter((e) => e.status === st).reduce((a, e) => a + e.baseMinor, 0);
    const total = Object.entries(t.budget.categoriesMinor).filter(([k]) => k !== 'emergency').reduce((a, [, v]) => a + v, 0);
    const want = { paid: sum('paid'), planned: sum('planned'), committed: sum('committed') };
    // Stage 13 (owner, 2026-11-22): the flight's plan is set aside until flight expenses cover it (docs/BUDGET_AND_START.md).
    const flightUsed = normal.filter((e) => e.category === 'flight' && ['paid', 'planned', 'committed'].includes(e.status)).reduce((a, e) => a + e.baseMinor, 0);
    want.reserved = Math.max((t.budget.categoriesMinor.flight ?? 0) - flightUsed, 0);
    want.free = total - want.paid - want.planned - want.committed - want.reserved;
    const shown = {};
    for (const k of ['paid', 'planned', 'committed', 'total']) shown[k] = Math.round(num(await page.locator(`[data-slot="money-${k}"]`).textContent()) * 100);
    shown.free = Math.round(num(await page.locator('[data-slot="money-free-small"]').textContent()) * 100);
    shown.big = Math.round(num(await page.locator('[data-slot="money-free"]').textContent()) * 100);
    shown.reserved = (await page.locator('[data-slot="money-reserved-row"]').isVisible()) ? Math.round(num(await page.locator('[data-slot="money-reserved"]').textContent()) * 100) : 0;
    await openMoneyDetails(page); // 1.0.1: inside "details"
    const foodOver = await page.locator('.cat-list .cat.is-over').allTextContents();
    await openMoneyDetails(page); // 1.0.1: inside "details"
    const foodLine = await page.locator('.cat-list .cat.c-4').textContent();
    await openMoneyDetails(page); // 1.0.1: inside "details"
    const emText = await page.locator('[data-slot="cat-emergency"]').textContent();
    await shot(page, 'after-money-full-375-light');
    pass('S4-6', shown.paid === want.paid && shown.planned === want.planned && shown.committed === want.committed && shown.free === want.free && shown.big === want.free
      && shown.reserved === want.reserved && shown.total === total && shown.paid + shown.planned + shown.committed + shown.reserved + shown.free === shown.total, { want, shown, total });
    pass('S4-4', foodOver.length === 1 && /אוכל/.test(foodOver[0]) && /חריגה/.test(foodLine) && /1,000/.test(emText) && /200/.test(emText) && /800/.test(emText),
      { foodOver: foodOver.map((x) => x.slice(0, 60)), emergency: emText.slice(0, 80) });

    // S4-8: filters, pie sums, delete with a yes
    await page.selectOption('[data-filter="category"]', 'food');
    const foodCount = await page.locator('#panel-money .exp').count();
    const pieFood = await page.locator('[data-slot="pie"] .slice').evaluateAll((n) => n.map((x) => [x.dataset.category, Number(x.dataset.minor)]));
    await page.selectOption('[data-filter="category"]', '');
    const pieAll = await page.locator('[data-slot="pie"] .slice').evaluateAll((n) => n.map((x) => [x.dataset.category, Number(x.dataset.minor)]));
    const byCat = {};
    for (const e of t.expenses) byCat[e.category] = (byCat[e.category] ?? 0) + e.baseMinor;
    const pieOk = pieAll.length === Object.keys(byCat).length && pieAll.every(([c, v]) => byCat[c] === v);
    const pieDesc = await page.locator('[data-slot="pie-desc"]').textContent();
    await page.selectOption('[data-filter="date"]', '2026-12-12');
    const dayCount = await page.locator('#panel-money .exp').count();
    await page.selectOption('[data-filter="date"]', '');
    await page.click('#panel-money .exp:has-text("רופא") [data-action="expense-delete"]');
    const ask = await page.locator('[data-slot="expense-delete-text"]').textContent();
    await shot(page, 'after-expense-delete-confirm-375', false);
    await page.click('#dlg-expense-delete [data-close]');
    await closed(page, '#dlg-expense-delete');
    const afterNo = (await trip(page)).expenses.length;
    await page.click('#panel-money .exp:has-text("רופא") [data-action="expense-delete"]');
    await page.click('[data-action="expense-delete-confirm"]');
    await closed(page, '#dlg-expense-delete');
    const afterYes = (await trip(page)).expenses.length;
    // validation: a bad amount is refused in Hebrew and nothing is saved
    await addExpense(page, { amount: '1.999', expectError: true });
    const err = (await page.locator('#expense-error').textContent()).trim();
    await shot(page, 'after-expense-error-375', false);
    await page.click('#dlg-expense [data-close]');
    await closed(page, '#dlg-expense');
    const afterBad = (await trip(page)).expenses.length;
    pass('S4-8', foodCount === 3 && pieFood.length === 1 && pieFood[0][1] === byCat.food && pieOk && /אוכל/.test(pieDesc) && dayCount === 6
      && /למחוק את רופא/.test(ask) && afterNo === 6 && afterYes === 5 && /סכום חיובי/.test(err) && afterBad === 5,
    { foodCount, pieFood, pieAll, dayCount, ask, afterNo, afterYes, err, afterBad });

    // S4-11 (layout) on the full money screen and an open dialog
    const audit = async () => page.evaluate(() => {
      const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]') && !n.closest('dialog:not([open])'); };
      const root = document.querySelector('dialog[open]') ?? document.querySelector('#panel-money');
      const small = [...root.querySelectorAll('button, a[href], input, select, label.replan-mode')].filter((b) => vis(b) && !b.disabled && b.type !== 'radio')
        .map((b) => ({ el: b.dataset.action ?? b.name ?? b.className, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
      const clipped = [...root.querySelectorAll('button')].filter((b) => vis(b) && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
      const tiny = [...root.querySelectorAll('*')].filter((n) => vis(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 14).map((n) => n.textContent.trim().slice(0, 20));
      return { hscroll: document.documentElement.scrollWidth > innerWidth, dir: document.documentElement.dir, small, clipped, tiny };
    });
    const screenA = await audit();
    await page.click('#panel-money [data-action="expense-add"]');
    const dialogA = await audit();
    await shot(page, 'after-expense-dialog-375', false);
    await page.click('#dlg-expense [data-close]');
    await closed(page, '#dlg-expense');
    await openMoneyDetails(page); // 1.0.1: inside "details"
    await page.click('[data-slot="money-cats"] [data-action="cats-open"]');
    const catsA = await audit();
    await page.click('#dlg-cats [data-close]');
    await closed(page, '#dlg-cats');
    const all = [screenA, dialogA, catsA];
    pass('S4-11 (layout)', all.every((a) => !a.hscroll && a.dir === 'rtl' && !a.small.length && !a.clipped.length && !a.tiny.length), { screenA, dialogA, catsA });

    // S4-9: backup round trip (itinerary + budget + rates + expenses)
    await page.click('[data-tab="itinerary"]');
    await page.click('[data-slot="itin-empty"] [data-action="seed-archive-open"]');
    await page.click('[data-action="seed-confirm"]');
    await closed(page, '#dlg-seed');
    await page.click('[data-tab="budget"]');
    await page.click('[data-action="rates-open"]');
    await page.fill('#dlg-rates [name="USD_ILS"]', '3.65');
    await page.click('#dlg-rates [type="submit"]');
    await closed(page, '#dlg-rates');
    await page.click('.settings-btn');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    const file = path.join(OUT, 'roundtrip-backup.json');
    await download.saveAs(file);
    const before = await trip(page);
    await page.click('[data-action="reset-open"]');
    await page.fill('[data-slot="reset-input"]', 'איפוס');
    await page.click('[data-action="reset-confirm"]');
    await closed(page, '#dlg-reset');
    const wiped = await trip(page);
    await page.setInputFiles('#import-file', file);
    await page.waitForSelector('#dlg-import[open]');
    await page.click('[data-action="import-confirm"]');
    await closed(page, '#dlg-import');
    const after = await trip(page);
    fs.unlinkSync(file);
    const same = (k) => JSON.stringify(before[k]) === JSON.stringify(after[k]);
    // Stage 13: a reset now starts from the shared dates and their route (docs/BUDGET_AND_START.md), not from 0 stops.
    pass('S4-9', wiped.expenses.length === 0 && wiped.startDate === '2026-12-20' && wiped.destinations.every((x) => x.suggested) && ['destinations', 'budget', 'rates', 'expenses'].every(same) && after.destinations.length === 11 && after.expenses.length === 5,
      { wiped: { expenses: wiped.expenses.length, destinations: wiped.destinations.length }, same: Object.fromEntries(['destinations', 'budget', 'rates', 'expenses'].map((k) => [k, same(k)])) });
    await ctx.close();
  }

  // ---------- S4-5: "left for today" by the trip clock, fake dates ----------
  {
    // Stage 13 (owner, 2026-11-22): the flight's 3,900 is set aside until a flight expense covers it, so free is
    // 15,270 - 3,900 = 11,370: 30 days -> 379, 15 days -> 758, the last day -> 11,370 (docs/BUDGET_AND_START.md).
    const cases = [
      ['before', '2026-11-19T09:00:00+07:00', /379/],
      ['middle', '2026-12-20T09:00:00+07:00', /758/],
      ['last-day', '2027-01-03T09:00:00+07:00', /11,370/],
      ['bangkok-midnight', '2027-01-02T17:30:00Z', /11,370/], // 00:30 on 3.1 in Bangkok, still 2.1 in UTC and in Israel
      ['after', '2027-01-04T09:00:00+07:00', /הטיול הסתיים/],
    ];
    const got = {};
    for (const [label, when, want] of cases) {
      const { ctx, page } = await fresh(browser, when, { timezoneId: 'Asia/Jerusalem' });
      await page.click('[data-tab="home"]');
      await page.click('[data-open="dates"]');
      await page.fill('#dlg-dates [name="start"]', '2026-12-05');
      await page.fill('#dlg-dates [name="end"]', '2027-01-03');
      await page.click('#dlg-dates [type="submit"]');
      await closed(page, '#dlg-dates');
      await page.click('[data-tab="budget"]');
      await loadProfile(page, 'realistic'); // 15,270 ILS running budget, no expenses
      const money = (await page.locator('[data-slot="money-today"]').textContent()).trim();
      await page.click('[data-tab="home"]');
      const home = (await page.locator('[data-slot="today-money"]').textContent()).trim();
      if (label === 'middle') await shot(page, 'after-home-375-light');
      got[label] = { money, home, ok: want.test(money) && money === home };
      await ctx.close();
    }
    pass('S4-5', Object.values(got).every((g) => g.ok), got);
  }

  // ---------- S4-10: offline ----------
  {
    const ctx = await browser.newContext({ ...VIEW });
    await blankTrip(ctx); // pre-stage-10 PR B: start from a 0.8.3-style trip (no budget), see scripts/qa/lib/blank-trip.cjs
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${BASE}#/money`);
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await ready(page);
    const caches = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('tisa-')));
      const urls = (await c.keys()).map((r) => new URL(r.url).pathname);
      return { keys, files: ['/src/js/money-view.js', '/src/js/core/money.js', '/src/js/core/split.js', '/data/packs/th.js'].filter((f) => urls.includes(f)) };
    });
    await ctx.setOffline(true);
    await page.reload();
    await ready(page);
    await loadProfile(page, 'saver');
    await addExpense(page, { amount: '60', currency: 'THB', category: 'food', status: 'paid', description: 'קפה' });
    const offline = (await trip(page)).expenses.length;
    const version = await page.locator('[data-slot="version-app"]').textContent();
    await shot(page, 'after-offline-375', false);
    pass('S4-10', caches.keys.includes(`tisa-${version}`) && version === JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion && caches.files.length === 4 && offline === 1, { caches, version, offlineExpenses: offline });
    await ctx.close();
  }

  // dark-mode screenshot of the money screen
  if (SHOTS) {
    const { ctx, page } = await fresh(browser, '2026-12-12T09:00:00+07:00', { colorScheme: 'dark' });
    await loadProfile(page, 'realistic');
    await addExpense(page, { amount: '300', currency: 'THB', category: 'food', status: 'paid', description: 'פאד תאי' });
    await addExpense(page, { amount: '1200', currency: 'ILS', category: 'lodging', status: 'committed', description: 'מלון' });
    await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
    await shot(page, 'after-money-full-375-dark');
    await ctx.close();
  }

  pass('S4-11 (no JS errors, no outside requests)', bag.errors.length === 0 && bag.external.length === 0, bag);
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
