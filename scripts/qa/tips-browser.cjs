// Stage 12 PR 1 (0.11.0): the info button ("ⓘ"), docs/GOALS_STAGE12.md S12-1, S12-7, S12-8.
// Sample trip only (rule 16). Waits for UI state (rule 6). Run 3 times.
// QA_OUT (default docs/evidence/stage12/browser), PORT (default 8172), SHOTS=0 skips screenshots.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { sampleState } = require('./lib/sample-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage12/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8172);
const BASE = `http://127.0.0.1:${PORT}/`;
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const HE = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales/he.json'), 'utf8'));
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];

// Where each of the 15 tips is reached on the sample trip.
const WHERE = {
  freeBefore: 'money', freeAfter: 'money', planned: 'money', committed: 'money', today: 'money', base: 'money', emergency: 'money', rates: 'money',
  backup: 'settings', photoBackup: 'settings', unverified: 'info', userProvided: 'info', verify: 'checklist', flex: 'itinerary', placeDates: 'places',
};

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const go = async (page, screen) => {
  await page.goto(`${BASE}#/${screen}`);
  await page.waitForFunction((s) => document.querySelector(`#panel-${s}`) && !document.querySelector(`#panel-${s}`).hidden, screen);
};
const tipOpen = (page) => page.evaluate(() => document.querySelector('#dlg-tip').open);
// Closed means: the sheet is closed AND its close handler ran (aria-expanded back to false). The close event is async.
const waitTip = (page, open) => page.waitForFunction((o) => document.querySelector('#dlg-tip')?.open === o
  && (o || !document.querySelector('button[data-tip][aria-expanded="true"]')), open, { timeout: 5000 });
const firstVisible = (page, key) => page.locator(`button[data-tip="${key}"]:visible`).first();

async function open(browser, { viewport = MOBILE, theme = 'light', sw = false, route = 'home' } = {}) {
  const state = await sampleState();
  state.settings.theme = theme;
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', ...(sw ? {} : { serviceWorkers: 'block' }) });
  await ctx.addInitScript((x) => { if (!localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); }, JSON.stringify(state));
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2030-12-25T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}

async function reachPlaceDialog(page) {
  await go(page, 'places');
  await page.click('#panel-places [data-action="place-add"]');
  await page.waitForFunction(() => document.querySelector('#dlg-place').open);
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  try {
    const a = await open(browser);
    const { page } = a;

    // ---------- K1 (S12-1 aria, S12-2): every one of the 15 tips is on its screen, named, sized, closed ----------
    const seen = {};
    for (const [key, screen] of Object.entries(WHERE)) {
      if (screen === 'places') await reachPlaceDialog(page); else await go(page, screen);
      if (screen === 'info') await page.evaluate(() => { for (const d of document.querySelectorAll('#panel-info details')) d.open = true; });
      const btn = firstVisible(page, key);
      const info = !(await btn.count()) ? null : await btn.evaluate((b) => {
        const r = b.getBoundingClientRect();
        return { label: b.getAttribute('aria-label'), popup: b.getAttribute('aria-haspopup'), controls: b.getAttribute('aria-controls'), expanded: b.getAttribute('aria-expanded'), w: Math.round(r.width), h: Math.round(r.height) };
      }).catch(() => null);
      seen[key] = info;
      if (screen === 'places') { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#dlg-place').open); }
    }
    const bad = Object.entries(seen).filter(([k, x]) => !x || x.label !== `הסבר על ${HE[`tip.${k}.name`]}` || x.popup !== 'dialog' || x.controls !== 'dlg-tip' || x.expanded !== 'false' || x.w < 44 || x.h < 44);
    pass('K1 all 15 info buttons are on their screens: aria-label "הסבר על <פריט>", aria-haspopup=dialog, aria-controls, closed, at least 44x44',
      Object.keys(seen).length === 15 && bad.length === 0, { bad, seen });

    // ---------- K2 (S12-1 touch): a tap opens the right text; tap outside closes; focus back on the button ----------
    await go(page, 'money');
    const b = firstVisible(page, 'committed');
    await b.tap().catch(() => b.click());
    await waitTip(page, true);
    const shown = await page.evaluate(() => ({ title: document.querySelector('#dlg-tip-title').textContent, text: document.querySelector('#dlg-tip-text').textContent, exp: document.querySelector('button[data-tip="committed"]').getAttribute('aria-expanded'), focus: document.activeElement?.matches('#dlg-tip [data-close]') }));
    if (SHOTS) await page.screenshot({ path: `${OUT}/after-tip-open-mobile-light.jpg`, type: 'jpeg', quality: 80 });
    await page.mouse.click(5, 5); // the backdrop, outside the sheet
    await waitTip(page, false);
    const back = await page.evaluate(() => ({ focus: document.activeElement?.dataset.tip ?? null, exp: document.querySelector('button[data-tip="committed"]').getAttribute('aria-expanded') }));
    pass('K2 touch: the tap opens the sheet with the right title and text (aria-expanded=true); a tap outside closes it and focus is back on the button',
      shown.title === HE['tip.committed.name'] && shown.text === HE['tip.committed.text'] && shown.exp === 'true' && shown.focus && back.focus === 'committed' && back.exp === 'false', { shown, back });

    // ---------- K3 (S12-1 keyboard): Enter opens, Esc closes, Space opens, the close button closes; focus returns ----------
    await firstVisible(page, 'freeBefore').focus();
    await page.keyboard.press('Enter');
    await waitTip(page, true);
    const t1 = await page.locator('#dlg-tip-title').textContent();
    await page.keyboard.press('Escape');
    await waitTip(page, false);
    const f1 = await page.evaluate(() => document.activeElement?.dataset.tip ?? null);
    await page.keyboard.press(' ');
    await waitTip(page, true);
    await page.keyboard.press('Enter'); // focus is on the close button
    await waitTip(page, false);
    const f2 = await page.evaluate(() => document.activeElement?.dataset.tip ?? null);
    pass('K3 keyboard: Enter opens, Esc closes, Space opens, Enter on "סגירה" closes; focus goes back to the same button each time',
      t1 === HE['tip.freeBefore.name'] && f1 === 'freeBefore' && f2 === 'freeBefore', { t1, f1, f2 });

    // ---------- K4 (S12-1 one at a time): one shared sheet; while it is open the rest of the page is inert ----------
    await firstVisible(page, 'planned').click();
    await waitTip(page, true);
    const one = await page.evaluate(() => ({ sheets: document.querySelectorAll('#dlg-tip').length, open: document.querySelectorAll('dialog[open]').length, modal: document.querySelector('#dlg-tip').matches(':modal') }));
    await page.keyboard.press('Escape');
    await waitTip(page, false);
    pass('K4 only one explanation at a time: a single shared modal sheet, and it is the only open dialog', one.sheets === 1 && one.open === 1 && one.modal, one);

    // ---------- K5: inside another sheet (place dialog): Esc closes only the explanation, then the place sheet ----------
    await reachPlaceDialog(page);
    await firstVisible(page, 'placeDates').click();
    await waitTip(page, true);
    const both = await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.id));
    await page.keyboard.press('Escape');
    await waitTip(page, false);
    const after = await page.evaluate(() => ({ place: document.querySelector('#dlg-place').open, focus: document.activeElement?.dataset.tip ?? null }));
    if (SHOTS) await page.screenshot({ path: `${OUT}/after-place-dialog-mobile-light.jpg`, type: 'jpeg', quality: 80 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dlg-place').open);
    pass('K5 inside the place sheet: the explanation opens on top; Esc closes only it, the place sheet stays, focus is on the button',
      both.includes('dlg-place') && both.includes('dlg-tip') && after.place && after.focus === 'placeDates', { both, after });

    // ---------- K6: a redrawn screen (itinerary rows, checklist rows) still gets the focus back ----------
    await go(page, 'checklist');
    await firstVisible(page, 'verify').click();
    await waitTip(page, true);
    await page.keyboard.press('Escape');
    await waitTip(page, false);
    const fv = await page.evaluate(() => document.activeElement?.dataset.tip ?? null);
    await go(page, 'itinerary');
    await firstVisible(page, 'flex').click();
    await waitTip(page, true);
    const route = await page.evaluate(() => location.hash);
    await page.keyboard.press('Escape');
    await waitTip(page, false);
    const ff = await page.evaluate(() => ({ tip: document.activeElement?.dataset.tip ?? null, hash: location.hash }));
    pass('K6 checklist and itinerary rows: the info button opens only the explanation (no other action, same screen) and focus returns',
      fv === 'verify' && ff.tip === 'flex' && route === '#/itinerary' && ff.hash === '#/itinerary', { fv, ff, route });

    // ---------- K7: the layout does not move: a row with a button is as tall as a row without one; no side scroll ----------
    await go(page, 'money');
    const rows = await page.evaluate(() => {
      const h = (sel) => Math.round(document.querySelector(sel).closest('div').getBoundingClientRect().height);
      return { paid: h('[data-slot="money-paid"]'), planned: h('[data-slot="money-planned"]'), committed: h('[data-slot="money-committed"]') };
    });
    const hs = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    pass('K7 no layout shift: the "מתוכנן" and "התחייבות עתידית" rows are as tall as "שולם" (no button); no horizontal scroll at 390px',
      rows.planned === rows.paid && rows.committed === rows.paid && !hs, { rows, hs });
    await a.ctx.close();

    // ---------- K8 (S12-8): dark mode: the sheet text is readable; screenshots light and dark, 390 and desktop ----------
    const contrasts = {};
    for (const theme of ['light', 'dark']) {
      for (const [vName, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]]) {
        const c = await open(browser, { theme, viewport, route: 'money' });
        await go(c.page, 'money');
        await firstVisible(c.page, 'freeAfter').click();
        await waitTip(c.page, true);
        // The sheet is the dark-metal sheet of every dialog (a gradient image, so a background colour says nothing).
        // Its text must use the same light token as the sheet titles, which the Stage 8 contrast check covers.
        contrasts[`${theme}-${vName}`] = await c.page.evaluate(() => {
          const text = getComputedStyle(document.querySelector('#dlg-tip-text')).color;
          const title = getComputedStyle(document.querySelector('#dlg-tip-title')).color;
          const metal = getComputedStyle(document.querySelector('#dlg-tip')).backgroundImage;
          const ref = getComputedStyle(document.querySelector('#dlg-place h2') ?? document.querySelector('#dlg-tip-title')).color;
          return { text, title, ref, gradient: /gradient/.test(metal) };
        });
        if (SHOTS) await c.page.screenshot({ path: `${OUT}/after-tip-${vName}-${theme}.jpg`, type: 'jpeg', quality: 80 });
        await c.ctx.close();
      }
    }
    pass('K8 light and dark, 390px and desktop: the explanation sits on the dark-metal sheet in the same light colour as every sheet title (contrast-checked in Stage 8)',
      Object.values(contrasts).every((x) => x.gradient && x.text === x.title && x.title === x.ref), { contrasts });

    // ---------- K9 (S12-7): airplane mode: after one online visit, offline the tips still open with their text ----------
    const o = await open(browser, { sw: true, route: 'money' });
    await o.page.waitForFunction(async () => (await navigator.serviceWorker?.getRegistration())?.active?.state === 'activated');
    await o.page.reload();
    await ready(o.page);
    await o.ctx.setOffline(true);
    await o.page.reload();
    await ready(o.page);
    await go(o.page, 'money');
    await firstVisible(o.page, 'base').click();
    await waitTip(o.page, true);
    const off = await o.page.evaluate(() => ({ text: document.querySelector('#dlg-tip-text').textContent, icon: [...document.querySelectorAll('button[data-tip] use')].length }));
    if (SHOTS) await o.page.screenshot({ path: `${OUT}/after-tip-airplane-mobile.jpg`, type: 'jpeg', quality: 80 });
    await o.ctx.close();
    pass('K9 airplane mode: offline, the page loads from the cache and the explanation opens with its text', off.text === HE['tip.base.text'] && off.icon > 0, off);

    pass('K10 zero requests outside the app in the whole run (S12-7), no page errors', outside.length === 0 && errors.length === 0, { outside, errors });
  } catch (e) {
    pass('ERROR the run stopped', false, { message: String(e.message ?? e).split('\n')[0] });
  } finally {
    await browser.close();
    server.kill();
    fs.writeFileSync(path.join(OUT, 'tips-browser.json'), `${JSON.stringify(results, null, 2)}\n`);
    const fails = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
    for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
    if (fails.length) { console.log(JSON.stringify(fails, null, 2).slice(0, 3000)); process.exitCode = 1; }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
