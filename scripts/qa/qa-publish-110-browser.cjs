// QA before publish on 1.1.0 (site-qa-before-publish, 2026-11-23), browser side. Node side: tests/qa-publish-110.test.js.
// QP-1: a booking link that arrives from a backup or a shared trip (not typed in the form) is shown as a link only when
//       it is http(s). A javascript: / data: / intent: link is shown as nothing, and the row itself stays.
// QP-K: the static scanner's KNOWN items (rule 7) checked in the real page, so KNOWN is not taken on trust:
//       K1 one visible h1 on every screen; K2 #/home and #/settings are routes that open their screen;
//       K3 every visible field on every screen has an accessible name (the scanner cannot see wrapping <label>);
//       K4 with reduced motion the sheet opens without an animation.
// QP-M: no sideways scroll on every screen at 360/390/768/1280.
// Shared sample data (rule 22, lib/rich-trip.cjs). Waits for UI state (rule 6). Run 3 times.
// QA_OUT (default docs/evidence/qa-publish-110/browser), PORT (default 8198).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { richState } = require('./lib/rich-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/qa-publish-110/browser');
fs.mkdirSync(OUT, { recursive: true });
const RUN = process.env.RUN ?? '1';
const PORT = Number(process.env.PORT ?? 8198);
const BASE = `http://127.0.0.1:${PORT}/`;
const ROUTES = ['home', 'itinerary', 'calendar', 'transfers', 'money', 'checklist', 'luggage', 'smart-bag', 'photos', 'places', 'summary', 'assistant', 'settings', 'info'];
const WIDTHS = [360, 390, 768, 1280];
const BAD = ['javascript:alert(1)', 'data:text/html,x', 'intent://x#Intent;end'];
const GOOD = 'https://example.com/booking';
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
}
const ready = (page) => page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
const shown = (page, s) => page.waitForFunction((x) => document.querySelector(`#panel-${x}`) && !document.querySelector(`#panel-${x}`).hidden, s);
const go = async (page, screen) => { await page.goto(`${BASE}#/${screen}`); await ready(page); await shown(page, screen); };

async function seedWithLinks() {
  const st = await richState();
  const trip = st.trips[st.activeTripId];
  const tr0 = trip.transfers[0];
  const ci0 = trip.checkins[0];
  // as if they came from a backup or from another member of a shared trip: never through the form
  trip.transfers = [{ ...tr0, link: GOOD }, ...BAD.map((link, i) => ({ ...tr0, id: `qp-t${i}`, from: `ק${i}`, link }))];
  trip.checkins = [{ ...ci0, link: GOOD }, ...BAD.map((link, i) => ({ ...ci0, id: `qp-c${i}`, title: `צ'ק-אין ${i}`, link }))];
  return st;
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    await new Promise((r) => setTimeout(r, 400));
    // ---------- QP-1 ----------
    const seed = JSON.stringify(await seedWithLinks());
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript((x) => { if (!localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); }, seed);
    const page = await ctx.newPage();
    watch(page);
    await go(page, 'transfers');
    await page.waitForFunction(() => document.querySelectorAll('#panel-transfers .transfer').length >= 8);
    const links = await page.evaluate(() => [...document.querySelectorAll('#panel-transfers a.transfer-link')].map((a) => a.getAttribute('href')));
    const rows = await page.evaluate(() => document.querySelectorAll('#panel-transfers .transfer').length);
    pass('QP-1a only http(s) links are shown (transfers and check-ins)', links.length === 2 && links.every((h) => h === 'https://example.com/booking'), { links });
    pass('QP-1b the rows with a refused link are still shown', rows >= 8, { rows });
    const before = await page.evaluate(() => localStorage.getItem('tisa:v1'));
    await page.reload(); await ready(page); await shown(page, 'transfers');
    const after = await page.evaluate(() => localStorage.getItem('tisa:v1'));
    const kept = JSON.parse(after).trips[JSON.parse(after).activeTripId].transfers.filter((t) => BAD.includes(t.link)).length;
    pass('QP-1c the stored data is not changed (nothing deleted or rewritten)', kept === BAD.length && before.length > 0, { kept });
    await ctx.close();

    // ---------- QP-K and QP-M ----------
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const rich = JSON.stringify(await richState());
    await ctx2.addInitScript((x) => { if (!localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); }, rich);
    const p2 = await ctx2.newPage();
    watch(p2);
    const h1 = {}; const unnamed = {}; const hscroll = {};
    for (const w of WIDTHS) {
      await p2.setViewportSize({ width: w, height: 844 });
      for (const r of ROUTES) {
        await go(p2, r);
        const info = await p2.evaluate(() => {
          const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden'; };
          const name = (e) => (e.getAttribute('aria-label') || '').trim() || (e.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join('').trim()
            || [...(e.labels ?? [])].map((l) => l.textContent).join('').trim() || (e.getAttribute('title') || '').trim();
          // out of the accessibility tree and the tab order (aria-hidden + tabindex=-1): the file inputs opened by a
          // named button, the KNOWN item of rule 7. Counted apart, so a new one is still seen.
          const hiddenFromAt = (e) => Boolean(e.closest('[aria-hidden="true"]')) && e.tabIndex < 0;
          const fields = [...document.querySelectorAll('main input:not([type=hidden]), main select, main textarea')].filter((e) => vis(e) && !hiddenFromAt(e));
          return {
            h1: [...document.querySelectorAll('h1')].filter(vis).length,
            unnamed: fields.filter((e) => !name(e)).map((e) => e.name || e.id || e.outerHTML.slice(0, 60)),
            hscroll: document.documentElement.scrollWidth > innerWidth,
          };
        });
        if (info.h1 !== 1) h1[`${r} ${w}`] = info.h1;
        if (info.unnamed.length) unnamed[`${r} ${w}`] = info.unnamed;
        if (info.hscroll) hscroll[`${r} ${w}`] = true;
      }
    }
    pass('QP-K1 exactly one visible h1 on every screen at every width', Object.keys(h1).length === 0, { screens: ROUTES.length * WIDTHS.length, bad: h1 });
    pass('QP-K3 every visible field on every screen has an accessible name', Object.keys(unnamed).length === 0, { bad: unnamed });
    pass('QP-M no sideways scroll on any screen at 360/390/768/1280', Object.keys(hscroll).length === 0, { bad: hscroll });

    await p2.setViewportSize({ width: 390, height: 844 });
    await go(p2, 'money');
    await p2.click('a.settings-btn[href="#/settings"]');
    await shown(p2, 'settings');
    const toSettings = await p2.evaluate(() => location.hash);
    await p2.click('a.brand[href="#/home"]');
    await shown(p2, 'home');
    const toHome = await p2.evaluate(() => location.hash);
    pass('QP-K2 #/settings and #/home are routes that open their screen', toSettings === '#/settings' && toHome === '#/home', { toSettings, toHome });

    await go(p2, 'money');
    await p2.click('#panel-money [data-action="expense-add"]');
    await p2.waitForFunction(() => document.querySelector('#dlg-expense').open);
    const anim = await p2.evaluate(() => document.querySelector('#dlg-expense').getAnimations().length);
    await p2.keyboard.press('Escape');
    await p2.waitForFunction(() => !document.querySelector('#dlg-expense').open);
    pass('QP-K4 reduced motion: the sheet opens with no animation', anim === 0, { animations: anim });
    await ctx2.close();

    pass('QP-E no page errors', errors.length === 0, { errors });
    pass('QP-N no request leaves the app', outside.length === 0, { outside });
  } catch (e) {
    pass('QP-X script finished', false, { error: e.message });
  } finally {
    await browser.close();
    server.kill();
  }
  const fails = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  fs.writeFileSync(path.join(OUT, `qa-publish-110-run${RUN}.json`), JSON.stringify(results, null, 2));
  for (const [k, v] of Object.entries(results)) console.log(`${v.result} ${k}`);
  console.log(fails.length ? `FAIL ${fails.length}` : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
