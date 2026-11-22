// 1.0.1 (owner, 2026-11-22; docs/BUDGET_AND_START.md): one total budget. A new install types one number; the
// categories are an optional plan under "details" (closed by default), with a suggested split that is saved only on
// an explicit approval; editing a category never changes the total; the emergency fund is part of the total.
// Existing data shows exactly what it showed in 1.0.0. Shared sample data (rule 22, lib/sample-trip.cjs).
// Waits for UI state (rule 6). Run 3 times. QA_OUT (default docs/evidence/v1.0.1/browser), PORT (default 8196).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { sampleState } = require('./lib/sample-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/v1.0.1/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8196);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];
const num = (t) => Number(String(t ?? '').replace(/[^\d.-]/g, ''));

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
const go = async (page, screen) => { await page.goto(`${BASE}#/${screen}`); await page.waitForFunction((s) => !document.querySelector(`#panel-${s}`).hidden, screen); };
const money = (page) => page.evaluate(() => {
  const n = (slot) => document.querySelector(`[data-slot="${slot}"]`);
  return {
    free: n('money-free')?.textContent, total: n('money-total')?.textContent, today: n('money-today')?.textContent,
    reserved: n('money-reserved-row') && !n('money-reserved-row').hidden ? n('money-reserved')?.textContent : null,
    emheld: n('money-emheld-row') && !n('money-emheld-row').hidden ? n('money-emheld')?.textContent : null,
    unalloc: n('money-unallocated')?.textContent ?? null, fx: n('total-fx')?.textContent ?? null,
    detailsOpen: n('money-details')?.open ?? null,
  };
});
async function context(browser, state, viewport = { width: 390, height: 844 }, theme = 'light') {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', serviceWorkers: 'block', colorScheme: theme });
  if (state) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state));
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2026-12-01T10:00:00+07:00'));
  return { ctx, page };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  try {
    // ---------- T1: a new install: one field, "details" closed; home opens the same single field ----------
    const { ctx, page } = await context(browser, null);
    await go(page, 'money');
    await ready(page);
    const form = await page.locator('#panel-money [data-form="total"]').count();
    const m1 = await money(page);
    await go(page, 'home');
    await page.click('#panel-home [data-step="budget"]');
    const homeDialog = await page.waitForSelector('#dlg-budget[open]', { timeout: 3000 }).then(() => true, () => false);
    const homeField = homeDialog ? await page.locator('#dlg-budget [name="amount"]').count() : 0;
    const currencySelect = await page.locator('#dlg-budget select[name="currency"]').count();
    if (homeDialog) await page.click('#dlg-budget [data-close]');
    pass('T1 new install: one total field on the money screen, "details" closed, no budget yet; home "set the budget" opens the single shekel field (no currency menu)',
      form === 1 && m1.detailsOpen === false && m1.free === '—' && homeDialog && homeField === 1 && currencySelect === 0, { form, m1, homeDialog, homeField, currencySelect });
    if (!form) throw new Error('no total field on the money screen yet');

    // ---------- T2: type 15,000: free 15,000; $ and baht below; only the total and the anchor are saved ----------
    await go(page, 'money');
    const before2 = await trip(page);
    await page.fill('#panel-money [data-form="total"] [name="total"]', '15,000');
    const fxTyping = await page.locator('[data-slot="total-fx"]').textContent().catch(() => '');
    await page.click('#panel-money [data-form="total"] [type="submit"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].budget.anchor === 'total', null, { timeout: 3000 }).catch(() => {});
    const t2 = await trip(page);
    const m2 = await money(page);
    if (SHOTS) await page.screenshot({ path: `${OUT}/total-15000-money-mobile-light.jpg`, type: 'jpeg', quality: 80 });
    pass('T2 "15,000" saved as the anchor: free 15,000 with nothing else entered; $4,054 and ฿150,000 shown small; categories untouched',
      t2.budget.anchor === 'total' && t2.budget.totalMinor === 1500000 && JSON.stringify(t2.budget.categoriesMinor) === JSON.stringify(before2.budget.categoriesMinor)
      && num(m2.free) === 15000 && /4,054/.test(m2.fx ?? '') && /150,000/.test(m2.fx ?? '') && /\$/.test(m2.fx ?? '') && /฿/.test(m2.fx ?? ''),
      { fxTyping, m2, budget: t2.budget });

    // ---------- T3: details: left to split, a suggestion marked as such, nothing saved yet ----------
    await page.click('[data-slot="money-details"] > summary');
    await page.waitForFunction(() => document.querySelector('[data-slot="money-details"]').open);
    const sug = await page.evaluate(() => ({
      text: document.querySelector('[data-slot="money-suggest"]')?.innerText ?? '',
      flight: document.querySelector('[data-slot="money-suggest"] [data-suggest="flight"]')?.textContent ?? '',
      hint: document.querySelector('[data-slot="money-suggest-hint"]')?.textContent ?? '',
      apply: !!document.querySelector('[data-action="suggest-apply"]'),
    }));
    const m3 = await money(page);
    const t3 = await trip(page);
    if (SHOTS) await page.screenshot({ path: `${OUT}/details-suggestion-mobile-light.jpg`, type: 'jpeg', quality: 80, fullPage: true });
    pass('T3 details: "left to split 15,000"; the suggestion is marked as a suggestion (not an expense), flight 3,750, the "already paid flight" hint; nothing saved, free still 15,000',
      /נשאר לחלק/.test(m3.unalloc ?? '') && /15,000/.test(m3.unalloc ?? '') && /הצעה/.test(sug.text) && /לא הוצאה/.test(sug.text) && /3,750/.test(sug.flight)
      && /טיסה ששולמה/.test(sug.hint) && sug.apply && num(m3.free) === 15000 && Object.values(t3.budget.categoriesMinor).every((v) => v === 0), { sug, m3 });

    // ---------- T4: approve: categories saved, the total stays 15,000; the saved flight plan is set aside ----------
    await page.click('[data-action="suggest-apply"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].budget.categoriesMinor.flight === 375000, null, { timeout: 3000 }).catch(() => {});
    const t4 = await trip(page);
    const m4 = await money(page);
    pass('T4 approving saves the split (flight 3,750 ... misc 750) and keeps the total 15,000; free 11,250 with 3,750 set aside for the flight; nothing left to split',
      t4.budget.totalMinor === 1500000 && t4.budget.categoriesMinor.flight === 375000 && t4.budget.categoriesMinor.misc === 75000 && num(m4.total) === 15000
      && num(m4.free) === 11250 && num(m4.reserved) === 3750 && /נשאר לחלק/.test(m4.unalloc ?? '') && /\b0\b|‏0/.test(m4.unalloc ?? ''), { m4 });

    // ---------- T5: editing one category changes only that one; the total stays; "over" is shown ----------
    await page.click('#panel-money [data-action="cats-open"]:visible');
    await page.waitForSelector('#dlg-cats[open]');
    await page.fill('#dlg-cats [name="food"]', '5000');
    await page.fill('#dlg-cats [name="emergency"]', '1000');
    await page.click('#dlg-cats [type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#dlg-cats[open]'));
    const t5 = await trip(page);
    const m5 = await money(page);
    const othersSame = ['flight', 'lodging', 'transport', 'attractions', 'insurance-sim-gear', 'misc'].every((k) => t5.budget.categoriesMinor[k] === t4.budget.categoriesMinor[k]);
    pass('T5 food 5,000 and emergency 1,000: total still 15,000, other categories unchanged, "over 3,375"; the emergency fund is inside the total (free 10,250, 1,000 held)',
      t5.budget.totalMinor === 1500000 && othersSame && t5.budget.categoriesMinor.food === 500000 && num(m5.total) === 15000
      && /חריגה/.test(m5.unalloc ?? '') && /3,375/.test(m5.unalloc ?? '') && num(m5.free) === 10250 && num(m5.emheld) === 1000, { m5 });

    // ---------- T6: a reload keeps it all; "details" is closed again ----------
    await page.reload();
    await ready(page);
    const m6 = await money(page);
    pass('T6 after a reload: the same numbers; "details" closed by default', num(m6.free) === 10250 && num(m6.total) === 15000 && m6.detailsOpen === false, { m6 });

    // ---------- T7: home dialog: prefilled with the total; 16,000 changes only the total ----------
    await go(page, 'home');
    await page.click('#panel-home [data-step="budget"]');
    await page.waitForSelector('#dlg-budget[open]');
    const pre = await page.inputValue('#dlg-budget [name="amount"]');
    const homeFx = await page.locator('#dlg-budget [data-slot="budget-fx"]').textContent();
    await page.fill('#dlg-budget [name="amount"]', '16000');
    await page.click('#dlg-budget [type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#dlg-budget[open]'));
    const t7 = await trip(page);
    pass('T7 home: the field shows 15,000 with $ and ฿ below; 16,000 changes the total only, the categories stay',
      /15,?000/.test(pre) && /\$/.test(homeFx) && /฿/.test(homeFx) && t7.budget.totalMinor === 1600000 && JSON.stringify(t7.budget.categoriesMinor) === JSON.stringify(t5.budget.categoriesMinor), { pre, homeFx });

    // ---------- T8: whole shekels only ----------
    await go(page, 'money');
    await page.fill('#panel-money [data-form="total"] [name="total"]', '15000.5');
    await page.click('#panel-money [data-form="total"] [type="submit"]');
    const err = await page.locator('#panel-money [data-form="total"] .form-error').textContent();
    const t8 = await trip(page);
    pass('T8 "15000.5" is refused with a message; nothing changes', err.trim().length > 0 && t8.budget.totalMinor === 1600000, { err });
    await ctx.close();

    // ---------- T9: existing data (the 1.0.0 sample: 20,000 template) shows the 1.0.0 numbers; viewing saves nothing ----------
    const legacy = await sampleState();
    const l = await context(browser, legacy);
    await go(l.page, 'money');
    await ready(l.page);
    const lm = await money(l.page);
    const field = await l.page.inputValue('#panel-money [data-form="total"] [name="total"]');
    await go(l.page, 'home');
    const stored = await l.page.evaluate(() => localStorage.getItem('tisa:v1'));
    pass('T9 existing data: free 15,000 and total 20,000 as in 1.0.0, emergency apart, the field shows 20,000; nothing written (no anchor)',
      num(lm.free) === 15000 && num(lm.total) === 20000 && lm.emheld === null && /20,?000/.test(field) && !/"anchor"/.test(stored) && JSON.parse(stored).trips[legacy.activeTripId].budget.categoriesMinor.emergency === 250000,
      { lm, field });
    await l.ctx.close();

    // ---------- T10: screenshots and layout at 390 and 1440, light and dark ----------
    const bad = {};
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      for (const theme of ['light', 'dark']) {
        const st = await sampleState();
        st.settings.theme = theme;
        Object.assign(st.trips[st.activeTripId].budget, { anchor: 'total', totalMinor: 1500000 });
        const c = await context(browser, st, { width: w, height: h }, theme);
        await go(c.page, 'money');
        await ready(c.page);
        await c.page.click('[data-slot="money-details"] > summary');
        await c.page.waitForFunction(() => document.querySelector('[data-slot="money-details"]').open);
        const scroll = await c.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        if (scroll) bad[`${w}-${theme}`] = 'horizontal scroll';
        if (SHOTS) await c.page.screenshot({ path: `${OUT}/money-details-${w}-${theme}.jpg`, type: 'jpeg', quality: 75, fullPage: true });
        await c.ctx.close();
      }
    }
    pass('T10 390 and 1440, light and dark: no horizontal scroll with "details" open', Object.keys(bad).length === 0, { bad });
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    pass('no requests outside the app', outside.length === 0, { outside });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'budget-total-browser.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
