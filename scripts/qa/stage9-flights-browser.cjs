// Stage 9 PR 2 browser checks (docs/GOALS_STAGE9.md, PR 2): flight details in the form, a round trip as one
// expense, seat payments kept out of the budget, the latisa-flights import (dry run, duplicates skipped, a second
// import changes nothing, a bad file changes nothing), flight items on the checklist without duplicates,
// JSON backup and restore, and offline use through the service worker. Real v5 sample data (tests/fixtures).
// Sample flights only (rule 16): made-up numbers on the "ZZ" code, 2030 dates. Waits for UI state (rule 6). Run 3 times.
// QA_OUT (default docs/evidence/stage9/pr2/browser), PORT (default 8127). SHOTS=0 skips screenshots.
// SHOTS_ONLY=1 with APP_ROOT=<checkout> only takes the "before" screenshots of another checkout (e.g. main).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.resolve(process.env.APP_ROOT ?? ROOT);
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage9/pr2/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8127);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const v5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v5-stage7.json'), 'utf8');
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const flightsFile = (flights) => Buffer.from(JSON.stringify({ format: 'latisa-flights', version: 1, flights }));
const FILE = flightsFile([
  { flightNo: 'zz101', from: 'עיר א', to: 'עיר ב', date: '2030-03-01', price: '9999', status: 'planned', note: 'should not overwrite' },
  { flightNo: 'ZZ 102', from: 'עיר ב', to: 'עיר א', date: '2030-04-01', status: 'paid', ticket: 'included', seat: '2C', seatPrice: '75', currency: 'ILS' },
  { flightNo: 'ZZ 105', from: 'עיר א', to: 'עיר ג', date: '2030-02-30' },
]);

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const text = (page, sel) => page.locator(sel).innerText().catch(() => '');
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const toastText = async (page) => { await page.waitForSelector('[data-slot="toast"].show'); return page.locator('[data-slot="toast"]').innerText(); };
const toastGone = (page) => page.waitForSelector('[data-slot="toast"]:not(.show)', { state: 'attached', timeout: 6000 });

async function open(browser, seed, route, viewport = MOBILE, extra = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem', ...extra });
  if (seed) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2026-12-11T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}

async function fillFlight(page, f) {
  await page.click('#panel-transfers [data-action="transfer-add"]');
  await page.locator('#dlg-transfer[open]').waitFor();
  for (const [k, v] of Object.entries(f)) {
    const loc = page.locator(`[data-form="transfer"] [name="${k}"]`);
    if (await loc.evaluate((n) => n.tagName === 'SELECT')) await loc.selectOption(v); else await loc.fill(v);
  }
}

async function shots(browser, label) {
  for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
    const o = await open(browser, v5, 'transfers', vp);
    await o.page.screenshot({ path: `${OUT}/${label}-transfers-${name}.png`, fullPage: true });
    await o.page.click('#panel-transfers [data-action="transfer-add"]');
    await o.page.locator('#dlg-transfer[open]').waitFor();
    await o.page.screenshot({ path: `${OUT}/${label}-flight-form-${name}.png` });
    await o.page.goto(`${BASE}#/checklist`);
    await o.page.locator('#panel-checklist').waitFor();
    await o.page.screenshot({ path: `${OUT}/${label}-lists-${name}.png`, fullPage: true });
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
    // ---------- flight form: details, round trip, seat ----------
    const a = await open(browser, v5, 'transfers');
    const t0 = await trip(a.page);
    await fillFlight(a.page, { kind: 'bus' });
    const hiddenForBus = await a.page.locator('[data-slot="transfer-flight"]').isHidden();
    await a.page.locator('[data-form="transfer"] [name="kind"]').selectOption('flight');
    const shownForFlight = await a.page.locator('[data-slot="transfer-flight"]').isVisible();
    pass('F flight fields show for a flight only', hiddenForBus && shownForFlight);
    for (const [k, v] of Object.entries({ from: 'עיר א', to: 'עיר ב', date: '2030-03-01', flightNo: 'zz 101', price: '3000', seat: '1a', seatPrice: '90' })) await a.page.fill(`[data-form="transfer"] [name="${k}"]`, v);
    await a.page.locator('[data-form="transfer"] [name="ticket"]').selectOption('roundtrip');
    await a.page.locator('[data-form="transfer"] [name="status"]').selectOption('paid');
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-flight-form-filled-mobile.png` });
    await a.page.click('[data-form="transfer"] [type="submit"]');
    await closed(a.page, '#dlg-transfer');
    await toastGone(a.page);
    const t1 = await trip(a.page);
    const out = t1.transfers.find((x) => x.flightNo === 'ZZ 101');
    const outExp = t1.expenses.filter((e) => e.transferId === out?.id);
    pass('F-3 round trip: one flight expense for the ticket price', outExp.length === 1 && outExp[0].category === 'flight' && outExp[0].amountMinor === 300000 && t1.expenses.length === t0.expenses.length + 1, { outExp });
    pass('F-4 seat payment kept on the flight, not in the budget', out?.seatPriceMinor === 9000 && out?.seat === '1A' && !t1.expenses.some((e) => e.amountMinor === 9000));
    const card = await text(a.page, `#panel-transfers li.transfer[data-id="${out?.id}"]`);
    pass('F card shows number, round trip, seat and "not in the budget"', /ZZ 101/.test(card) && /הלוך ושוב/.test(card) && /מושב: 1A/.test(card) && /לא בתקציב/.test(card), { card });

    // the return leg: a price is refused, without a price it saves and adds no expense
    await fillFlight(a.page, { from: 'עיר ב', to: 'עיר א', date: '2030-04-01', flightNo: 'ZZ 103', ticket: 'included', price: '100' });
    await a.page.click('[data-form="transfer"] [type="submit"]');
    const err = await text(a.page, '#transfer-error');
    const stillOpen = await a.page.locator('#dlg-transfer[open]').count();
    await a.page.fill('[data-form="transfer"] [name="price"]', '');
    await a.page.click('[data-form="transfer"] [type="submit"]');
    await closed(a.page, '#dlg-transfer');
    await toastGone(a.page);
    const t2 = await trip(a.page);
    pass('F-3 return leg: a price is refused; without one it saves and the budget is unchanged', stillOpen === 1 && /ריק/.test(err) && t2.transfers.length === t1.transfers.length + 1 && t2.expenses.length === t1.expenses.length, { err });
    // bad flight number
    await fillFlight(a.page, { from: 'א', to: 'ב', date: '2030-04-02', flightNo: 'not ok!' });
    await a.page.click('[data-form="transfer"] [type="submit"]');
    pass('F-1 a bad flight number is refused with a message', /מספר הטיסה לא תקין/.test(await text(a.page, '#transfer-error')));
    await a.page.click('#dlg-transfer [data-close]');
    await closed(a.page, '#dlg-transfer');

    // ---------- import: dry run, duplicates, invalid ----------
    const before = await trip(a.page);
    await a.page.locator('#flights-import-file').setInputFiles({ name: 'flights.json', mimeType: 'application/json', buffer: FILE });
    await a.page.locator('#dlg-flights-import[open]').waitFor();
    const summary = await text(a.page, '[data-slot="flights-import-text"]');
    const dry = await trip(a.page);
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-import-dialog-mobile.png` });
    pass('I import: the dialog counts 1 new, 1 already here, 1 invalid; nothing saved before yes', /שייכנסו: 1\./.test(summary) && /ישתנו: 1\./.test(summary) && /ייכנסו: 1\.$/.test(summary) && JSON.stringify(dry) === JSON.stringify(before), { summary });
    await a.page.click('[data-action="flights-import-confirm"]');
    await closed(a.page, '#dlg-flights-import');
    const toast1 = await toastText(a.page);
    await toastGone(a.page);
    const t3 = await trip(a.page);
    const dupAfter = t3.transfers.find((x) => x.id === out.id);
    const back = t3.transfers.find((x) => x.flightNo === 'ZZ 102');
    pass('I-3 the duplicate kept its own price, status, note and expense', JSON.stringify(dupAfter) === JSON.stringify(before.transfers.find((x) => x.id === out.id)) && JSON.stringify(t3.expenses.filter((e) => e.transferId === out.id)) === JSON.stringify(outExp));
    pass('I-2 the new return leg came in with its seat; the budget did not change', t3.transfers.length === before.transfers.length + 1 && back?.ticket === 'included' && back?.seatPriceMinor === 7500 && t3.expenses.length === before.expenses.length && /שיובאו: 1/.test(toast1), { toast1 });
    pass('I-6 the rest of the trip is untouched', ['destinations', 'checklist', 'tasks', 'checkins', 'budget', 'journal', 'luggage', 'photos'].every((k) => JSON.stringify(t3[k]) === JSON.stringify(before[k])) && before.expenses.every((e) => JSON.stringify(t3.expenses.find((x) => x.id === e.id)) === JSON.stringify(e)));

    // the same file again: nothing new, yes is disabled, nothing changes
    await a.page.locator('#flights-import-file').setInputFiles({ name: 'flights.json', mimeType: 'application/json', buffer: FILE });
    await a.page.locator('#dlg-flights-import[open]').waitFor();
    const summary2 = await text(a.page, '[data-slot="flights-import-text"]');
    const yesDisabled = await a.page.locator('[data-action="flights-import-confirm"]').isDisabled();
    await a.page.click('#dlg-flights-import [data-close]');
    await closed(a.page, '#dlg-flights-import');
    const t4 = await trip(a.page);
    pass('I-4 the same file twice: 0 new, import disabled, no change', /שייכנסו: 0\./.test(summary2) && /ישתנו: 2\./.test(summary2) && yesDisabled && JSON.stringify(t4) === JSON.stringify(t3), { summary2 });

    // a bad file: a message, no dialog, no change
    await a.page.locator('#flights-import-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"tisa-backup"}') });
    await a.page.waitForFunction(() => document.querySelector('[data-slot="flights-import-error"]').textContent.length > 0);
    const badMsg = await text(a.page, '[data-slot="flights-import-error"]');
    pass('I-1 a file of another format: a message and no change', /latisa-flights/.test(badMsg) && (await a.page.locator('#dlg-flights-import[open]').count()) === 0 && JSON.stringify(await trip(a.page)) === JSON.stringify(t3), { badMsg });
    // the button opens the file picker
    const [chooser] = await Promise.all([a.page.waitForEvent('filechooser'), a.page.click('[data-action="flights-import"]')]);
    pass('I the "import flights" button opens the file picker', chooser.isMultiple() === false);
    pass('M transfers screen: no horizontal scroll at 390px', !(await hScroll(a.page)));
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-transfers-mobile.png`, fullPage: true });

    // ---------- money screen sees one flight expense for the round trip ----------
    await a.page.goto(`${BASE}#/money`);
    await a.page.locator('#panel-money').waitFor();
    const moneyText = await text(a.page, '#panel-money');
    pass('F-3 the money screen lists the round trip once', (moneyText.match(/עיר א ⇄ עיר ב/g) ?? []).length === 1 && !/עיר ב – עיר א/.test(moneyText), {});

    // ---------- checklist: flight items, no duplicates, own items kept ----------
    await a.page.goto(`${BASE}#/checklist`);
    await a.page.locator('#panel-checklist').waitFor();
    // Pre-stage-10 PR A (owner decision 2026-11-21): the flight items are part of the built-in list (61 items). One
    // button adds whatever is missing; on this v5 sample that is 60 (its "דרכון" counts as the built-in passport).
    // The one-time card is answered "not now" first, so the button flow (confirm dialog) is the one checked here.
    const l0 = (await trip(a.page)).checklist;
    await a.page.click('[data-action="builtin-later"]');
    await a.page.click('[data-action="list-builtin"]');
    await a.page.locator('#dlg-list-confirm[open]').waitFor();
    const lText = await text(a.page, '[data-slot="list-confirm-text"]');
    await a.page.click('[data-action="list-confirm-yes"]');
    await closed(a.page, '#dlg-list-confirm');
    await toastGone(a.page);
    const l1 = (await trip(a.page)).checklist;
    const groups = await a.page.$$eval('#panel-checklist [data-slot="groups"] .list-group h3', (l) => l.map((x) => x.textContent));
    pass('C-1 flight items added in their groups; own items and ticks unchanged', l1.length === l0.length + 60 && l0.every((x) => JSON.stringify(l1.find((y) => y.id === x.id)) === JSON.stringify(x)) && ['הכנות דיגיטליות, 2–3 ימים לפני הטיסה', 'אוכל ושתייה לטיסה', 'נוחות ושינה במטוס'].every((g) => groups.includes(g)) && /60/.test(lText), { groups, lText });
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-lists-mobile.png`, fullPage: true });
    // tick one new item, then press again: nothing added, the tick stays
    const first = l1.find((x) => x.group === 'flightComfort');
    await a.page.check(`#panel-checklist input[data-action="item-toggle"][data-id="${first.id}"]`);
    await a.page.waitForFunction((id) => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].checklist.find((x) => x.id === id).done, first.id);
    // PR A: with nothing missing the button is gone, so it cannot add twice; a reload adds nothing and keeps the tick.
    const btnGone = await a.page.locator('[data-action="list-builtin"]').isHidden();
    await a.page.reload();
    await ready(a.page);
    const l2 = (await trip(a.page)).checklist;
    pass('C-3 nothing more to add: the button is gone, a reload adds nothing and keeps the tick', btnGone && l2.length === l1.length && l2.find((x) => x.id === first.id).done === true && (await a.page.locator('#dlg-list-confirm[open]').count()) === 0, { btnGone });
    pass('M lists screen: no horizontal scroll at 390px', !(await hScroll(a.page)));
    await toastGone(a.page);

    // ---------- JSON backup and restore keep the flight details ----------
    await a.ctx.close();
    const b = await open(browser, v5, 'transfers', MOBILE, { acceptDownloads: true });
    await b.page.locator('#flights-import-file').setInputFiles({ name: 'flights.json', mimeType: 'application/json', buffer: flightsFile([{ flightNo: 'ZZ 201', from: 'א', to: 'ב', date: '2030-05-01', ticket: 'roundtrip', price: '2000', status: 'booked', seat: '3B', seatPrice: '40' }]) });
    await b.page.locator('#dlg-flights-import[open]').waitFor();
    await b.page.click('[data-action="flights-import-confirm"]');
    await closed(b.page, '#dlg-flights-import');
    await toastGone(b.page);
    const saved = await trip(b.page);
    await b.page.goto(`${BASE}#/settings`);
    const [dl] = await Promise.all([b.page.waitForEvent('download'), b.page.click('#panel-settings [data-action="export"]')]);
    const jsonPath = path.join(OUT, 'pr2-backup-sample.json');
    await dl.saveAs(jsonPath);
    await toastGone(b.page);
    await b.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); s.trips[s.activeTripId].transfers = []; s.trips[s.activeTripId].expenses = []; localStorage.setItem('tisa:v1', JSON.stringify(s)); });
    await b.page.reload();
    await ready(b.page);
    await b.page.locator('#import-file').setInputFiles(jsonPath);
    await b.page.locator('#dlg-import[open]').waitFor();
    await b.page.click('[data-action="import-confirm"]');
    await toastGone(b.page);
    const restored = await trip(b.page);
    const z = restored.transfers.find((x) => x.flightNo === 'ZZ 201');
    pass('B backup and restore keep flight number, ticket, seat and the single expense', JSON.stringify(restored.transfers) === JSON.stringify(saved.transfers) && JSON.stringify(restored.expenses) === JSON.stringify(saved.expenses) && z?.ticket === 'roundtrip' && z?.seatPriceMinor === 4000);
    await b.ctx.close();

    // ---------- desktop ----------
    const d = await open(browser, v5, 'transfers', DESKTOP);
    await d.page.locator('#flights-import-file').setInputFiles({ name: 'flights.json', mimeType: 'application/json', buffer: FILE });
    await d.page.locator('#dlg-flights-import[open]').waitFor();
    await d.page.click('[data-action="flights-import-confirm"]');
    await closed(d.page, '#dlg-flights-import');
    await toastGone(d.page);
    pass('D desktop: import works and the screen has no horizontal scroll', (await trip(d.page)).transfers.length === 4 && !(await hScroll(d.page)));
    if (SHOTS) await d.page.screenshot({ path: `${OUT}/after-transfers-desktop.png`, fullPage: true });
    await d.page.click('#panel-transfers [data-action="transfer-add"]');
    await d.page.locator('#dlg-transfer[open]').waitFor();
    if (SHOTS) await d.page.screenshot({ path: `${OUT}/after-flight-form-desktop.png` });
    await d.page.click('#dlg-transfer [data-close]');
    await d.page.goto(`${BASE}#/checklist`);
    await d.page.click('[data-action="builtin-later"]');
    await d.page.click('[data-action="list-builtin"]');
    await d.page.locator('#dlg-list-confirm[open]').waitFor();
    await d.page.click('[data-action="list-confirm-yes"]');
    await closed(d.page, '#dlg-list-confirm');
    if (SHOTS) await d.page.screenshot({ path: `${OUT}/after-lists-desktop.png`, fullPage: true });
    await d.ctx.close();

    // ---------- offline: service worker on, network off ----------
    const octx = await browser.newContext({ viewport: MOBILE, locale: 'he-IL', reducedMotion: 'reduce' });
    const op = await octx.newPage();
    watch(op);
    await op.goto(BASE);
    await op.evaluate(() => navigator.serviceWorker.ready);
    await op.reload();
    await op.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;
    const cached = await op.evaluate(async (v) => !!(await (await caches.open(`tisa-${v}`)).match('./src/js/core/flights.js')), version);
    await octx.setOffline(true);
    await op.goto(`${BASE}#/transfers`);
    await op.reload();
    await ready(op);
    await op.locator('#flights-import-file').setInputFiles({ name: 'flights.json', mimeType: 'application/json', buffer: FILE });
    await op.locator('#dlg-flights-import[open]').waitFor();
    await op.click('[data-action="flights-import-confirm"]');
    await closed(op, '#dlg-flights-import');
    const offTrip = await op.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
    await op.goto(`${BASE}#/checklist`);
    // PR A: a new trip already has the built-in list (flight items included), offline too.
    await op.locator('#panel-checklist .item').first().waitFor();
    const offList = await op.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId].checklist; });
    pass('O offline: flights.js is cached; import and flight items work with no network', cached && offTrip.transfers.length === 2 && offList.length === 61, { cached, transfers: offTrip.transfers.length, items: offList.length });
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
