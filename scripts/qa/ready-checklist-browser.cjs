// Pre-stage-10, PR A: the built-in checklist (owner decision 2026-11-21, docs/GOALS_STAGE10.md "PR A").
// - A fresh install and a reset come with the full built-in list: nothing ticked, four progress bars.
// - Ticks survive a reload; reloading again adds nothing (no duplicates).
// - Old data (real v5 sample, tests/fixtures): every item and tick stays; a one-time card offers only the
//   missing built-in items; adding twice adds nothing; "not now" hides the card but the button stays.
// - Settings say where the data lives (browser or home-screen app) and what it holds (Safari and the home-screen
//   app keep separate data on iPhone; nothing is merged or copied automatically).
// - Offline: the list works with no network through the service worker.
// Waits for UI state (rule 6). Run 3 times. QA_OUT (default docs/evidence/stage10/pre-a/browser), PORT (default 8131).
// SHOTS=0 skips screenshots. SHOTS_ONLY=1 with APP_ROOT=<checkout> takes only the "before" screenshots (e.g. main).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.resolve(process.env.APP_ROOT ?? ROOT);
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage10/pre-a/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8131);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const v5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v5-stage7.json'), 'utf8');
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1') ?? 'null'); return s ? s.trips[s.activeTripId] : null; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const visible = (page, sel) => page.locator(sel).isVisible().catch(() => false);
const items = (page) => page.locator('#panel-checklist .item').count();

async function open(browser, seed, route, viewport = MOBILE) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });
  if (seed) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2026-12-11T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}

async function shots(browser, label) {
  for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
    const f = await open(browser, null, 'checklist', vp);
    await f.page.screenshot({ path: `${OUT}/${label}-fresh-lists-${name}.png`, fullPage: true });
    await f.page.goto(`${BASE}#/settings`);
    await f.page.locator('#panel-settings').waitFor();
    await f.page.locator('#set-storage-title').scrollIntoViewIfNeeded();
    await f.page.screenshot({ path: `${OUT}/${label}-settings-storage-${name}.png` });
    await f.ctx.close();
    const o = await open(browser, v5, 'checklist', vp);
    await o.page.screenshot({ path: `${OUT}/${label}-old-data-lists-${name}.png`, fullPage: true });
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
  const { TH } = await import(pathToFileURL(path.join(ROOT, 'data/packs/th.js')).href);
  const builtin = TH.checklistBuiltin ?? [];
  try {
    // ---------- R1: fresh install comes with the full list, nothing ticked ----------
    const a = await open(browser, null, 'checklist');
    const t1 = await trip(a.page);
    const shown = await items(a.page);
    const bars = {};
    for (const k of ['prep', 'carry', 'bag', 'arrival']) bars[k] = (await a.page.locator(`[data-slot="${k}-num"]`).innerText().catch(() => '')).trim();
    pass('R1 fresh install: the full built-in list is saved and shown, nothing ticked',
      builtin.length > 0 && t1?.checklist.length === builtin.length && shown === builtin.length && t1.checklist.every((x) => x.done === false && x.builtin),
      { builtin: builtin.length, saved: t1?.checklist.length ?? null, shown });
    pass('R2 four separate progress bars (prep, carry-on, checked bag, after landing)',
      Object.values(bars).every((v) => /0 מתוך \d+/.test(v)), bars);
    pass('R3 no offer card and no add button when nothing is missing',
      !(await visible(a.page, '[data-slot="builtin-offer"]')) && !(await visible(a.page, '[data-action="list-builtin"]')));
    pass('R4 390px: no sideways scroll on the lists screen', !(await hScroll(a.page)));
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-fresh-lists-mobile.png`, fullPage: true });

    // ---------- R5: a tick survives a reload; reloading adds nothing ----------
    const first = a.page.locator('#panel-checklist .item input[type="checkbox"]').first();
    await first.check();
    await a.page.waitForFunction(() => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].checklist.some((x) => x.done));
    await a.page.reload();
    await ready(a.page);
    await a.page.reload();
    await ready(a.page);
    const t2 = await trip(a.page);
    const firstChecked = await a.page.locator('#panel-checklist .item input[type="checkbox"]').first().isChecked();
    pass('R5 a tick survives two reloads, and reloading adds no items',
      firstChecked && t2.checklist.filter((x) => x.done).length === 1 && t2.checklist.length === builtin.length && (await items(a.page)) === builtin.length,
      { done: t2.checklist.filter((x) => x.done).length, saved: t2.checklist.length });

    // ---------- R6: a reset comes back with the full list ----------
    await a.page.goto(`${BASE}#/settings`);
    await a.page.locator('#panel-settings').waitFor();
    await a.page.click('[data-action="reset-open"]');
    await a.page.locator('#dlg-reset[open]').waitFor();
    const typed = (await a.page.locator('[data-slot="reset-type-label"]').innerText()).split(':').pop().trim();
    await a.page.fill('[data-slot="reset-input"]', typed);
    await a.page.click('[data-action="reset-confirm"]');
    await closed(a.page, '#dlg-reset');
    const t3 = await trip(a.page);
    pass('R6 after a reset the full list is back, nothing ticked',
      t3?.checklist.length === builtin.length && t3.checklist.every((x) => !x.done), { typed, saved: t3?.checklist.length ?? null });

    // ---------- R7: settings say where the data lives ----------
    const device = (await a.page.locator('[data-slot="device-data"]').innerText().catch(() => '')).trim();
    const iphoneNote = await visible(a.page, '[data-slot="device-iphone-note"]');
    pass('R7 settings show where the data lives and what it holds; the iPhone note is there',
      /דפדפן/.test(device) && new RegExp(`${builtin.length}`).test(device) && iphoneNote, { device });
    if (SHOTS) {
      await a.page.locator('#set-storage-title').scrollIntoViewIfNeeded();
      await a.page.screenshot({ path: `${OUT}/after-settings-storage-mobile.png` });
    }
    await a.ctx.close();

    // ---------- R8: old data: nothing changes until yes; then only missing built-in items ----------
    const b = await open(browser, v5, 'checklist');
    const before = await trip(b.page);
    const cardShown = await visible(b.page, '[data-slot="builtin-offer"]');
    const cardText = (await b.page.locator('[data-slot="builtin-offer-text"]').innerText().catch(() => '')).trim();
    const unchanged = JSON.stringify((await trip(b.page)).checklist) === JSON.stringify(JSON.parse(v5).trips[JSON.parse(v5).activeTripId].checklist);
    pass('R8 old data: the card offers the missing items and nothing is changed before yes', cardShown && /\d+/.test(cardText) && unchanged, { cardText });
    if (SHOTS) await b.page.screenshot({ path: `${OUT}/after-old-data-lists-mobile.png`, fullPage: true });
    await b.page.click('[data-action="builtin-add"]');
    await b.page.waitForSelector('[data-slot="builtin-offer"]', { state: 'hidden' });
    const after = await trip(b.page);
    const oldKept = before.checklist.every((x) => JSON.stringify(after.checklist.find((y) => y.id === x.id)) === JSON.stringify(x));
    const names = after.checklist.map((x) => x.name.trim().toLowerCase());
    const noDupNames = new Set(names).size === names.length;
    const added = after.checklist.length - before.checklist.length;
    pass('R9 yes: every old item and tick stays exactly; only missing items are added, no repeated names, none ticked',
      oldKept && noDupNames && added > 0 && after.checklist.slice(before.checklist.length).every((x) => !x.done && x.builtin),
      { before: before.checklist.length, after: after.checklist.length, added });
    await b.page.reload();
    await ready(b.page);
    const again = await trip(b.page);
    pass('R10 after a reload: no card, no add button, no new items',
      !(await visible(b.page, '[data-slot="builtin-offer"]')) && !(await visible(b.page, '[data-action="list-builtin"]')) && again.checklist.length === after.checklist.length);
    await b.ctx.close();

    // ---------- R11: "not now" hides the card for good; the button still adds, once ----------
    const c = await open(browser, v5, 'checklist');
    await c.page.click('[data-action="builtin-later"]');
    await c.page.waitForSelector('[data-slot="builtin-offer"]', { state: 'hidden' });
    const notNow = await trip(c.page);
    await c.page.reload();
    await ready(c.page);
    const stillHidden = !(await visible(c.page, '[data-slot="builtin-offer"]'));
    const btn = await visible(c.page, '[data-action="list-builtin"]');
    await c.page.click('[data-action="list-builtin"]');
    await c.page.locator('#dlg-list-confirm[open]').waitFor();
    await c.page.click('[data-action="list-confirm-yes"]');
    await closed(c.page, '#dlg-list-confirm');
    const viaBtn = await trip(c.page);
    pass('R11 "not now": only the answer is saved, the card stays hidden after a reload, the button adds the missing items once',
      notNow.checklist.length === JSON.parse(v5).trips[JSON.parse(v5).activeTripId].checklist.length && stillHidden && btn
      && viaBtn.checklist.length > notNow.checklist.length && !(await visible(c.page, '[data-action="list-builtin"]')),
      { notNow: notNow.checklist.length, viaBtn: viaBtn.checklist.length });
    await c.ctx.close();

    // ---------- desktop ----------
    if (SHOTS) {
      const d = await open(browser, null, 'checklist', DESKTOP);
      await d.page.screenshot({ path: `${OUT}/after-fresh-lists-desktop.png`, fullPage: true });
      await d.page.goto(`${BASE}#/settings`);
      await d.page.locator('#set-storage-title').scrollIntoViewIfNeeded();
      await d.page.screenshot({ path: `${OUT}/after-settings-storage-desktop.png` });
      await d.ctx.close();
      const e = await open(browser, v5, 'checklist', DESKTOP);
      await e.page.screenshot({ path: `${OUT}/after-old-data-lists-desktop.png`, fullPage: true });
      await e.ctx.close();
    }

    // ---------- O: offline through the service worker ----------
    const octx = await browser.newContext({ viewport: MOBILE, locale: 'he-IL', reducedMotion: 'reduce' });
    const op = await octx.newPage();
    watch(op);
    await op.goto(BASE);
    await op.evaluate(() => navigator.serviceWorker.ready);
    await op.reload();
    await op.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    await octx.setOffline(true);
    await op.goto(`${BASE}#/checklist`);
    await op.reload();
    await ready(op);
    await op.locator('#panel-checklist .item input[type="checkbox"]').nth(1).check();
    await op.waitForFunction(() => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].checklist.some((x) => x.done));
    const offItems = await items(op);
    pass('O offline: the full list shows and a tick is saved with no network', offItems === builtin.length, { offItems });
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
