// 0.5.3 flights and transfers screen (docs/GOALS_STAGE5.md TB-1..TB-8), mobile 375 and desktop 1280.
// Stage 9 (owner, 2026-11-21): the old route and the 3 old profiles moved to the archive; this script uses them from there.
// Waits for UI state (rule 6). Run 3 times before PASS. QA_OUT for reruns (rule 10).
// Run from the repo root: node scripts/qa/transfers-browser.cjs   (port 8081)
const { chromium } = require('playwright');
const { openMoneyDetails } = require('./lib/money-details.cjs');
const { blankTrip } = require('./lib/blank-trip.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage5/transfers-0.5.3');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8081;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s ? s.trips[s.activeTripId] : null; });
const closed = (page, sel) => page.waitForSelector(`${sel}:not([open])`, { state: 'attached' });
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); };
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ''));

async function fill(page, o) {
  for (const k of ['kind', 'currency', 'status']) if (o[k]) await page.selectOption(`#dlg-transfer [name="${k}"]`, o[k]);
  for (const k of ['from', 'to', 'date', 'time', 'company', 'booking', 'price', 'link', 'note']) if (o[k] !== undefined) await page.fill(`#dlg-transfer [name="${k}"]`, o[k]);
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  for (const [w, h, tag] of [[375, 812, 'mobile'], [1280, 900, 'desktop']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true });
    await blankTrip(ctx); // pre-stage-10 PR B: start from a 0.8.3-style trip (no budget), see scripts/qa/lib/blank-trip.cjs
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    await page.clock.setFixedTime(new Date('2026-11-25T09:00:00+07:00'));
    await page.goto(`${BASE}#/itinerary`);
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    await page.click('[data-slot="itin-empty"] [data-action="seed-archive-open"]');
    await page.click('[data-action="seed-confirm"]');
    await closed(page, '#dlg-seed');
    await page.click('[data-tab="budget"]');
    await openMoneyDetails(page); // 1.0.1: inside "details"
    await page.click('[data-slot="money-empty"] [data-action="profile-open"]');
    await page.locator('#dlg-profile details.profile-archive').evaluate((d) => { d.open = true; }); await page.check('#dlg-profile input[value="realistic"]');
    await page.click('#dlg-profile [type="submit"]');
    await closed(page, '#dlg-profile');
    const committed0 = num(await page.locator('[data-slot="money-committed"]').textContent());

    // entry point from the itinerary screen
    await page.click('[data-tab="itinerary"]');
    await page.click('#panel-itinerary [data-go="transfers"]');
    await page.waitForFunction(() => location.hash === '#/transfers');
    const panelShown = await page.waitForSelector('#panel-transfers', { state: 'visible', timeout: 5000 }).then(() => true).catch(() => false); // wait for the screen (rule 6)
    const future = (await page.locator('[data-slot="transfers-future"]').textContent()).trim();
    await toastGone(page);
    await shot(page, `after-transfers-empty-${tag}`);

    // TB-5 validation, then TB-1 add a booked flight with a price
    await page.click('#panel-transfers [data-action="transfer-add"]');
    await fill(page, { kind: 'flight', from: 'תל אביב', to: 'בנגקוק', date: '2026-12-05', link: 'javascript:alert(1)' });
    await page.click('#dlg-transfer [type="submit"]');
    const linkErr = (await page.locator('#transfer-error').textContent()).trim();
    await fill(page, { link: 'https://example.org/booking', company: 'חברת תעופה', booking: 'ABC123', price: '2600', currency: 'ILS', status: 'booked', note: 'מושב ליד חלון' });
    if (tag === 'mobile') await shot(page, `after-transfer-dialog-${tag}`, false);
    await page.click('#dlg-transfer [type="submit"]');
    await closed(page, '#dlg-transfer');
    const card = (await page.locator('#panel-transfers .transfer').first().textContent()).trim();
    const noTime = /שעה: עוד לא הוזנה/.test(card);
    const linkRel = await page.locator('#panel-transfers .transfer a').first().evaluate((a) => [a.target, a.rel, a.href]);
    let t = await trip(page);
    const exp = t.expenses.find((e) => e.transferId === t.transfers[0].id);
    pass(`TB-1 add (${tag})`, panelShown && t.transfers.length === 1 && exp && exp.category === 'flight' && exp.status === 'committed' && exp.amountMinor === 260000
      && /תל אביב/.test(card) && /בנגקוק/.test(card) && /ABC123/.test(card) && /2,600/.test(card) && /הוזמן/.test(card), { card: card.slice(0, 160), exp });
    pass(`TB-5 honest fields (${tag})`, /קישור/.test(linkErr) && noTime && linkRel[0] === '_blank' && /noopener/.test(linkRel[1]) && /בגרסה עתידית/.test(future) && !/\d/.test(future),
      { linkErr, noTime, linkRel, future });

    // TB-2 the budget sees it once; editing updates the same expense
    await page.click('[data-tab="budget"]');
    const committed1 = num(await page.locator('[data-slot="money-committed"]').textContent());
    await page.click('[data-tab="itinerary"]');
    await page.click('#panel-itinerary [data-go="transfers"]');
    await page.click('#panel-transfers [data-action="transfer-edit"]');
    await fill(page, { price: '2500', status: 'paid', time: '07:45' });
    await page.click('#dlg-transfer [type="submit"]');
    await closed(page, '#dlg-transfer');
    t = await trip(page);
    const linked = t.expenses.filter((e) => e.transferId);
    await page.click('[data-tab="budget"]');
    const paid = num(await page.locator('[data-slot="money-paid"]').textContent());
    const committed2 = num(await page.locator('[data-slot="money-committed"]').textContent());
    pass(`TB-2 budget (${tag})`, committed1 - committed0 === 2600 && linked.length === 1 && linked[0].status === 'paid' && linked[0].amountMinor === 250000 && paid === 2500 && committed2 === committed0,
      { committed0, committed1, committed2, paid, linked: linked.length });

    // TB-3 a Bangkok -> Chiang Mai bus shows on both stops in the itinerary
    await page.click('[data-tab="itinerary"]');
    await page.click('#panel-itinerary [data-go="transfers"]');
    await page.click('#panel-transfers [data-action="transfer-add"]');
    await fill(page, { kind: 'bus', from: 'בנגקוק', to: "צ'יאנג מאי", date: '2026-12-08', time: '20:00', status: 'planned' });
    await page.click('#dlg-transfer [type="submit"]');
    await closed(page, '#dlg-transfer');
    const order = await page.locator('#panel-transfers .transfer-route').allTextContents();
    await toastGone(page);
    await shot(page, `after-transfers-list-${tag}`);
    await page.click('[data-tab="itinerary"]');
    const onStops = await page.evaluate(() => [...document.querySelectorAll('.stop')].map((s) => [s.querySelector('.stop-name').textContent, s.querySelectorAll('.stop-transfer').length]).filter(([, n]) => n));
    await shot(page, `after-itinerary-${tag}`);
    pass(`TB-3 itinerary (${tag})`, JSON.stringify(onStops) === JSON.stringify([['בנגקוק', 2], ["צ'יאנג מאי", 1]]) && /תל אביב/.test(order[0]) && /בנגקוק/.test(order[1]),
      { onStops, order });

    // TB-4 delete: cancel keeps; "keep the expense" keeps it; "with expense" removes it
    await page.click('#panel-itinerary [data-go="transfers"]');
    await page.click('#panel-transfers .transfer:has-text("ABC123") [data-action="transfer-delete"]');
    const ask = (await page.locator('[data-slot="transfer-delete-text"]').textContent()).trim();
    const boxShown = await page.locator('#dlg-transfer-delete [name="withExpense"]').isVisible();
    await page.click('#dlg-transfer-delete [data-close]');
    await closed(page, '#dlg-transfer-delete');
    const afterNo = (await trip(page)).transfers.length;
    await page.click('#panel-transfers .transfer:has-text("ABC123") [data-action="transfer-delete"]');
    await page.uncheck('#dlg-transfer-delete [name="withExpense"]');
    await page.click('[data-action="transfer-delete-confirm"]');
    await closed(page, '#dlg-transfer-delete');
    t = await trip(page);
    const keptExpense = t.expenses.length === 1 && !t.expenses[0].transferId;
    pass(`TB-4 delete (${tag})`, /למחוק/.test(ask) && boxShown && afterNo === 2 && t.transfers.length === 1 && keptExpense, { ask, afterNo, transfers: t.transfers.length, keptExpense });

    // TB-6 backup round trip
    await page.click('.settings-btn');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    const file = path.join(OUT, `roundtrip-${tag}.json`);
    await download.saveAs(file);
    const before = await trip(page);
    await page.click('[data-action="reset-open"]');
    await page.fill('[data-slot="reset-input"]', 'איפוס');
    await page.click('[data-action="reset-confirm"]');
    await closed(page, '#dlg-reset');
    await page.setInputFiles('#import-file', file);
    await page.waitForSelector('#dlg-import[open]');
    await page.click('[data-action="import-confirm"]');
    await closed(page, '#dlg-import');
    const after = await trip(page);
    fs.unlinkSync(file);
    pass(`TB-6 backup (${tag})`, JSON.stringify(before.transfers) === JSON.stringify(after.transfers) && JSON.stringify(before.expenses) === JSON.stringify(after.expenses) && after.transfers.length === 1, {});

    // TB-7 layout
    await page.goto(`${BASE}#/transfers`);
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    await page.click('#panel-transfers [data-action="transfer-add"]');
    const audit = await page.evaluate(() => {
      const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]') && !n.closest('dialog:not([open])'); };
      const roots = [document.querySelector('#panel-transfers'), document.querySelector('#dlg-transfer')];
      const all = roots.flatMap((r) => [...r.querySelectorAll('*')]);
      const small = all.filter((b) => b.matches('button, input, select, a') && vis(b)).map((b) => ({ el: b.name ?? b.dataset.action ?? b.tagName, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
      const tiny = all.filter((n) => vis(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 14).map((n) => n.textContent.trim().slice(0, 20));
      const clipped = all.filter((b) => b.matches('button') && vis(b) && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
      return { hscroll: document.documentElement.scrollWidth > innerWidth, small, tiny, clipped };
    });
    await page.click('#dlg-transfer [data-close]');
    pass(`TB-7 layout (${tag})`, !audit.hscroll && !audit.small.length && !audit.tiny.length && !audit.clipped.length, audit);
    await ctx.close();
  }

  // TB-8 offline: the new files are cached
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'he-IL' });
    await blankTrip(ctx); // pre-stage-10 PR B: start from a 0.8.3-style trip (no budget), see scripts/qa/lib/blank-trip.cjs
    const page = await ctx.newPage();
    await page.goto(`${BASE}#/transfers`);
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('tisa-')));
      const urls = (await c.keys()).map((r) => new URL(r.url).pathname);
      return ['/src/js/core/transfers.js', '/src/js/transfers-view.js'].filter((f) => urls.includes(f)).length;
    });
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    await page.click('#panel-transfers [data-action="transfer-add"]');
    await fill(page, { kind: 'boat', from: 'קו סמוי', to: 'קופנגן', date: '2026-12-28', status: 'planned' });
    await page.click('#dlg-transfer [type="submit"]');
    await closed(page, '#dlg-transfer');
    const saved = (await trip(page)).transfers.length;
    pass('TB-8 offline', cached === 2 && saved === 1, { cached, saved });
    await ctx.close();
  }

  pass('no JS errors', errors.length === 0, { errors });
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [k, r] of Object.entries(results)) console.log(`${r.result}  ${k}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
