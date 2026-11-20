// Stage 6.0e browser checks: the luggage screen (docs/GOALS_STAGE6.md S6-9, S6-10, S6-1/12/13/14 for luggage).
// 375px and 1280px, real app. Waits for UI state, not fixed sleeps (rule 6). Run 3 times.
// Writes only to QA_OUT, default docs/evidence/stage6/6.0e (rule 10). Run from the repo root (port 8100).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/6.0e');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8100;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = { mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const bag = { errors: [], external: [] };
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const stored = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });

function state() {
  const at = '2026-12-01T10:00:00.000Z';
  return {
    schemaVersion: 4, appVersion: '0.5.5', createdAt: at, updatedAt: at,
    settings: { language: 'he', theme: null, lastBackupAt: '2026-12-03T10:00:00.000Z', assistantQuestionLimit: 50 },
    activeTripId: 'trip-1',
    trips: { 'trip-1': {
      id: 'trip-1', countryCode: 'TH', name: 'תאילנד', startDate: '2026-12-05', endDate: '2027-01-03', destinations: [],
      budget: { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false },
      rates: {}, expenses: [], transfers: [],
      checklist: [{ id: 'c1', group: 'clothing', name: 'נעלי הליכה', qty: 1, note: '', done: false }],
      tasks: [], events: [], info: {}, assistant: {}, journal: {}, checkins: [], luggage: { bags: [] },
    } },
  };
}
function watch(page) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
}
async function open(browser, view, route, extra = {}) {
  const ctx = await browser.newContext({ viewport: VIEWS[view], deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', ...extra });
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state()));
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}
const card = (page, name) => page.locator('#panel-luggage .bag', { has: page.locator('.bag-name', { hasText: name }) });
async function addBag(page, name, limit) {
  await page.click('#panel-luggage [data-action="bag-add"]');
  await page.locator('#dlg-bag[open]').waitFor();
  await page.fill('#dlg-bag [name="name"]', name);
  await page.fill('#dlg-bag [name="limit"]', limit);
  await page.click('#dlg-bag [type="submit"]');
  await closed(page, '#dlg-bag');
}
async function addItem(page, bagName, name, weight) {
  await card(page, bagName).locator('[data-action="luggage-item-add"]').click();
  await page.locator('#dlg-luggage-item[open]').waitFor();
  await page.fill('#dlg-luggage-item [name="name"]', name);
  await page.fill('#dlg-luggage-item [name="weight"]', weight);
  await page.click('#dlg-luggage-item [type="submit"]');
  await closed(page, '#dlg-luggage-item');
}
const status = (page, name) => card(page, name).locator('[data-slot="bag-status"]').innerText();

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  for (const view of Object.keys(VIEWS)) {
    // LB-1: opened from the lists screen; the lists tab stays lit; Back returns to the lists.
    {
      const { ctx, page } = await open(browser, view, 'checklist');
      await page.click('#panel-checklist [data-go="luggage"]');
      await page.locator('#panel-luggage').waitFor();
      const url = new URL(page.url()).hash;
      const lit = await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab');
      const empty = await page.locator('[data-slot="luggage-empty"]').isVisible();
      await page.goBack();
      await page.locator('#panel-checklist').waitFor();
      pass(`LB-1 open and back ${view}`, url === '#/luggage' && lit === 'lists' && empty && new URL(page.url()).hash === '#/checklist', { url, lit, empty });
      await ctx.close();
    }

    const { ctx, page } = await open(browser, view, 'luggage');
    // LB-2: validation: a bag needs a name; a limit must be a weight.
    await page.click('#panel-luggage [data-action="bag-add"]');
    await page.locator('#dlg-bag[open]').waitFor();
    if (SHOTS && view === 'mobile') await page.screenshot({ path: `${OUT}/after-bag-dialog-${view}.png` });
    await page.fill('#dlg-bag [name="limit"]', 'הרבה');
    await page.click('#dlg-bag [type="submit"]');
    const bagErr = await page.locator('#bag-error').innerText();
    await page.click('#dlg-bag [data-close]');
    await closed(page, '#dlg-bag');
    await addBag(page, 'מזוודה גדולה', '23');
    await addBag(page, 'תיק גב', '');
    const noLimit = await status(page, 'תיק גב');
    pass(`LB-2 bags ${view}`, /שם/.test(bagErr) && /משקל|מגבלה/.test(bagErr) && /עוד לא נקבעה מגבלה/.test(noLimit), { bagErr, noLimit });

    // LB-3: no limit: it adds up, and never warns.
    await addItem(page, 'תיק גב', 'מחשב', '1.35');
    await addItem(page, 'תיק גב', 'נעליים', '0,85');
    const back = await status(page, 'תיק גב');
    const backOver = await card(page, 'תיק גב').locator('.bag-over').count();
    pass(`LB-3 no limit, no warning ${view}`, /2\.2/.test(back) && /עוד לא נקבעה מגבלה/.test(back) && backOver === 0, { back });

    // LB-4: exactly at the limit is fine; over the limit warns, by how much.
    await page.click('#panel-luggage [data-action="luggage-item-add"] >> nth=0');
    await page.locator('#dlg-luggage-item[open]').waitFor();
    await page.fill('#dlg-luggage-item [name="name"]', 'בגדים');
    await page.fill('#dlg-luggage-item [name="weight"]', 'כבד');
    await page.click('#dlg-luggage-item [type="submit"]');
    const itemErr = await page.locator('#luggage-item-error').innerText();
    await page.fill('#dlg-luggage-item [name="weight"]', '22.5');
    await page.click('#dlg-luggage-item [type="submit"]');
    await closed(page, '#dlg-luggage-item');
    await addItem(page, 'מזוודה גדולה', 'כלי רחצה', '0.5');
    const atLimit = await status(page, 'מזוודה גדולה');
    const atOver = await card(page, 'מזוודה גדולה').locator('.bag-over').count();
    await addItem(page, 'מזוודה גדולה', 'מטען', '0.3');
    const over = await card(page, 'מזוודה גדולה').locator('.bag-over').innerText();
    const cls = await card(page, 'מזוודה גדולה').getAttribute('class');
    const t4 = await stored(page);
    const grams = t4.luggage.bags[0].items.map((x) => x.grams);
    if (SHOTS) await page.screenshot({ path: `${OUT}/after-luggage-${view}.png`, fullPage: true });
    pass(`LB-4 at the limit and over ${view}`, /משקל/.test(itemErr) && /23/.test(atLimit) && atOver === 0 && /0\.3/.test(over) && /חריגה/.test(over) && /is-over/.test(cls)
      && JSON.stringify(grams) === JSON.stringify([22500, 500, 300]) && t4.luggage.bags[0].limitGrams === 23000,
      { itemErr, atLimit, over, grams });

    // LB-5: move an item to the other bag; change a limit. Totals follow.
    await card(page, 'מזוודה גדולה').locator('.bag-item', { hasText: 'מטען' }).locator('[data-action="luggage-item-edit"]').click();
    await page.locator('#dlg-luggage-item[open]').waitFor();
    const bags = await page.locator('#dlg-luggage-item [name="bagId"] option').allTextContents();
    await page.selectOption('#dlg-luggage-item [name="bagId"]', { label: 'תיק גב' });
    await page.click('#dlg-luggage-item [type="submit"]');
    await closed(page, '#dlg-luggage-item');
    const bigAfter = await card(page, 'מזוודה גדולה').locator('.bag-over').count();
    await card(page, 'תיק גב').locator('[data-action="bag-edit"]').click();
    await page.locator('#dlg-bag[open]').waitFor();
    await page.fill('#dlg-bag [name="limit"]', '2');
    await page.click('#dlg-bag [type="submit"]');
    await closed(page, '#dlg-bag');
    const backOver2 = await card(page, 'תיק גב').locator('.bag-over').innerText();
    pass(`LB-5 move and change the limit ${view}`, bags.length === 2 && bigAfter === 0 && /0\.5/.test(backOver2), { bags, backOver2 });

    // LB-6: deleting asks first: an item, then a bag with its items.
    await card(page, 'תיק גב').locator('.bag-item', { hasText: 'מחשב' }).locator('[data-action="luggage-item-delete"]').click();
    await page.locator('#dlg-luggage-delete[open]').waitFor();
    const askItem = await page.locator('#dlg-luggage-delete').innerText();
    await page.click('#dlg-luggage-delete [data-close]');
    await closed(page, '#dlg-luggage-delete');
    const kept = (await stored(page)).luggage.bags[1].items.length;
    await card(page, 'תיק גב').locator('.bag-item', { hasText: 'מחשב' }).locator('[data-action="luggage-item-delete"]').click();
    await page.locator('#dlg-luggage-delete[open]').waitFor();
    await page.click('#dlg-luggage-delete [data-action="luggage-delete-yes"]');
    await closed(page, '#dlg-luggage-delete');
    const afterItem = (await stored(page)).luggage.bags[1].items.map((x) => x.name);
    await card(page, 'תיק גב').locator('[data-action="bag-delete"]').click();
    await page.locator('#dlg-luggage-delete[open]').waitFor();
    const askBag = await page.locator('#dlg-luggage-delete').innerText();
    await page.click('#dlg-luggage-delete [data-action="luggage-delete-yes"]');
    await closed(page, '#dlg-luggage-delete');
    const t6 = await stored(page);
    pass(`LB-6 delete asks first ${view}`, /למחוק/.test(askItem) && kept === 3 && JSON.stringify(afterItem) === JSON.stringify(['נעליים', 'מטען']) && /2 פריטים/.test(askBag) && t6.luggage.bags.length === 1,
      { askItem, askBag, afterItem });

    // LB-7: layout, and the packing list is untouched (still a tick only, no weight).
    const audit = await page.evaluate(() => {
      const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]') && !n.closest('dialog:not([open])'); };
      const all = [...document.querySelector('#panel-luggage').querySelectorAll('*')];
      const small = all.filter((b) => b.matches('button, input, select, a') && vis(b)).map((b) => ({ el: b.dataset.action ?? b.tagName, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
      const tiny = all.filter((n) => vis(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 14).map((n) => n.textContent.trim().slice(0, 20));
      const clipped = all.filter((b) => b.matches('button') && vis(b) && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
      return { hscroll: document.documentElement.scrollWidth > innerWidth, dir: getComputedStyle(document.querySelector('#panel-luggage')).direction, small, tiny, clipped };
    });
    await page.goto(`${BASE}#/checklist`); await ready(page);
    const packing = await page.locator('#panel-checklist').innerText();
    const t7 = await stored(page);
    pass(`LB-7 layout and the packing list ${view}`, !audit.hscroll && audit.dir === 'rtl' && !audit.small.length && !audit.tiny.length && !audit.clipped.length
      && !/ק״ג|ק"ג/.test(packing) && JSON.stringify(Object.keys(t7.checklist[0]).sort()) === JSON.stringify(['done', 'group', 'id', 'name', 'note', 'qty']), audit);

    // LB-8: survives a reload, and a backup round trip.
    await page.goto(`${BASE}#/luggage`); await page.reload(); await ready(page);
    const reloaded = await status(page, 'מזוודה גדולה');
    await page.click('.settings-btn');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#panel-settings [data-action="export"]')]);
    let rt = false;
    if (download) {
      const before = JSON.stringify((await stored(page)).luggage);
      const file = path.join(OUT, `roundtrip-${view}.json`);
      await download.saveAs(file);
      await page.click('[data-action="reset-open"]');
      await page.fill('[data-slot="reset-input"]', 'איפוס');
      await page.click('[data-action="reset-confirm"]');
      await closed(page, '#dlg-reset');
      const wiped = (await stored(page)).luggage.bags.length;
      await page.setInputFiles('#import-file', file);
      await page.waitForSelector('#dlg-import[open]');
      await page.click('[data-action="import-confirm"]');
      await closed(page, '#dlg-import');
      fs.unlinkSync(file);
      rt = wiped === 0 && JSON.stringify((await stored(page)).luggage) === before;
    }
    pass(`LB-8 reload and backup ${view}`, /23/.test(reloaded) && rt, { reloaded, rt });
    await ctx.close();
  }

  // LB-9: dark shot; offline: the luggage code is cached and a bag can be added with no connection.
  {
    const ctx = await browser.newContext({ viewport: VIEWS.mobile, deviceScaleFactor: 2, locale: 'he-IL', colorScheme: 'dark', reducedMotion: 'reduce' });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state()));
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${BASE}#/luggage`);
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('tisa-')));
      return (await c.keys()).map((r) => new URL(r.url).pathname).filter((u) => /luggage/.test(u));
    });
    await ctx.setOffline(true);
    await page.reload(); await ready(page);
    await addBag(page, 'מזוודה', '7');
    await addItem(page, 'מזוודה', 'בגדים', '7.4');
    if (SHOTS) await page.screenshot({ path: `${OUT}/after-luggage-mobile-dark.png` });
    const t = await stored(page);
    await ctx.setOffline(false);
    pass('LB-9 offline and dark', cached.length === 2 && t.luggage.bags.length === 1 && t.luggage.bags[0].items[0].grams === 7400, { cached });
    await ctx.close();
  }

  pass('no JS errors, no outside requests', bag.errors.length === 0 && bag.external.length === 0, bag);
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); console.error(JSON.stringify(bag)); process.exit(2); });
