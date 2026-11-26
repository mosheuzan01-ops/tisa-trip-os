// 1.2.0 browser checks: the final design in the real app (sample trip only, rule 16; no network beyond the local server).
// TAB1 the five tabs, clicked: each shows its own screen, lit; light and dark; 360, 390 and 1440: no sideways scroll
// CAP the board caption is whole (not cut) at 360, 390 and 1440, light and dark
// RT1 mid-trip: one NOW (the app's own "today" badge), DONE before it, AHEAD after it; the caption is shown
// RT2 before the trip every stop is AHEAD; after it every stop is DONE (dates only, no "booked")
// RT3 every row keeps edit / up / down / delete; edit opens the stop dialog
// LS1 ticking an item changes its group count, the four notes and the notebook line; unticking restores them
// LS2 the notebook line hides while "hide what is ready" is on and while searching, and comes back
// TL1 the tools links open the existing luggage, smart-bag and info screens
// DATA visiting the five tabs and opening the tools links writes nothing: the saved data is byte for byte the same
// CON text contrast on the new parts: status tags, NOW, the note labels, list items (4.5:1 or more)
// RUN no page errors, no request outside the local server
// QA_OUT (default docs/evidence/1.2.0/browser), PORT (default 8220), RUN.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { sampleState } = require('./lib/sample-trip.cjs');
const { ROOT, startServer } = require('./lib/cloud-owner.cjs');

const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/1.2.0/browser');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8220);
const RUN = process.env.RUN ?? '1';
const results = {}; const errors = [];
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const TABS = ['home', 'itinerary', 'money', 'checklist', 'tools'];
const DURING = '2030-12-26T05:00:00Z'; const BEFORE = '2030-11-25T05:00:00Z'; const AFTER = '2031-02-10T05:00:00Z';

const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
const SEEN_BG = (n) => { const layers = []; let x = n;
  while (x) { const c = getComputedStyle(x).backgroundColor.match(/[\d.]+/g).map(Number); if ((c[3] ?? 1) > 0) layers.push(c); if ((c[3] ?? 1) >= 1) break; x = x.parentElement; }
  let out = [0, 0, 0]; for (const c of layers.reverse()) { const a = c[3] ?? 1; out = out.map((v, i) => v * (1 - a) + c[i] * a); }
  return `rgb(${out.map(Math.round).join(', ')})`; };
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

async function open(browser, base, seed, { scheme = 'light', width = 390, clock = DURING } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('qa-seeded') && !localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); sessionStorage.setItem('qa-seeded', '1'); }, JSON.stringify(seed));
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  await page.clock.setFixedTime(new Date(clock));
  page.on('pageerror', (e) => errors.push(`${scheme}-${width}: ${e}`));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) errors.push(`outside request ${u}`); });
  await page.goto(`${base}index.html#/home`);
  await page.waitForSelector('#panel-home:not([hidden])');
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}
const tab = async (page, name) => { await page.click(`.tabbar [aria-controls="panel-${name}"]`); await page.waitForSelector(`#panel-${name}:not([hidden])`); };
const statuses = (page) => page.$$eval('#panel-itinerary .stops > li', (rows) => rows.map((li) => (li.classList.contains('is-today') ? 'now'
  : (li.querySelector(':scope > .stop-status')?.className.replace('stop-status is-', '') ?? '-'))));

const sec = async (ids, fn) => {
  try { await fn(); } catch (e) { for (const id of ids) if (!results[id]) pass(id, false, { error: String(e).split('\n')[0] }); }
};

(async () => {
  const { server, base } = await startServer(PORT);
  const browser = await chromium.launch();
  try {
    const seed = await sampleState();
    // the sample trip's theme follows the color scheme of each context
    const seedFor = (scheme) => ({ ...seed, settings: { ...seed.settings, theme: scheme } });

    // TAB1
    const tabRows = []; const capRows = [];
    for (const scheme of ['light', 'dark']) for (const width of [360, 390, 1440]) {
      const { ctx, page } = await open(browser, base, seedFor(scheme), { scheme, width });
      for (const name of TABS) {
        await tab(page, name);
        const s = await page.evaluate((n) => ({ lit: document.querySelector(`.tabbar [aria-controls="panel-${n}"]`).getAttribute('aria-selected'),
          ox: document.documentElement.scrollWidth - innerWidth, theme: document.documentElement.dataset.theme }), name);
        tabRows.push({ scheme, width, name, ...s, ok: s.lit === 'true' && s.ox <= 0 && s.theme === scheme });
        // CAP the board caption (CSS text, not cut): its line holds the whole text at every width
        if (name === 'itinerary') capRows.push({ scheme, width, ...await page.$eval('[data-slot="stops-head"]', (n) => ({ fits: n.scrollWidth <= n.clientWidth, scroll: n.scrollWidth, client: n.clientWidth })) });
      }
      await ctx.close();
    }
    pass('TAB1', tabRows.every((r) => r.ok), { states: tabRows.length, failed: tabRows.filter((r) => !r.ok) });
    pass('CAP', capRows.length === 6 && capRows.every((r) => r.fits), { rows: capRows });

    // RT1, RT3, CON (route)
    const { ctx, page } = await open(browser, base, seedFor('dark'), { scheme: 'dark' });
    const con = [];
    await sec(['RT1', 'RT3'], async () => {
    await tab(page, 'itinerary'); await page.waitForTimeout(200);
    const st = await statuses(page); const k = st.indexOf('now');
    const cap = await page.$eval('[data-slot="stops-head"]', (n) => ({ hidden: n.hidden, text: getComputedStyle(n, '::before').content }));
    pass('RT1', k > 0 && st.filter((x) => x === 'now').length === 1 && st.slice(0, k).every((x) => x === 'done') && st.slice(k + 1).every((x) => x === 'ahead')
      && !cap.hidden && cap.text.includes('DESTINATION'), { statuses: st, caption: cap });
    const rows = await page.$$eval('#panel-itinerary .stops > li', (lis) => lis.map((li) => li.querySelectorAll('.stop-actions .icon-btn').length));
    await page.click('#panel-itinerary .stops > li:first-child [data-action="stop-edit"]');
    const dlg = await page.waitForSelector('dialog[open]', { timeout: 3000 }).then(() => true, () => false);
    await page.keyboard.press('Escape');
    pass('RT3', rows.every((n) => n === 4) && dlg, { buttonsPerRow: rows, editOpens: dlg });
    for (const sel of ['#panel-itinerary .stop-status.is-done', '#panel-itinerary .stop-status.is-ahead', '#panel-itinerary .stop-badge-today']) {
      const c = await page.$eval(sel, (n, f) => [getComputedStyle(n).color, (0, eval)(`(${f})`)(n)], SEEN_BG.toString());
      con.push({ sel, fg: c[0], bg: c[1], ratio: +ratio(c[0], c[1]).toFixed(2) });
    }

    });

    // DATA (before any change): the five tabs and the tools links write nothing
    await sec(['TL1', 'DATA'], async () => {
    const saved0 = await page.evaluate(() => localStorage.getItem('tisa:v1'));
    for (const name of TABS) await tab(page, name);
    // TL1
    const links = [];
    for (const [href, screen] of [['#/luggage', 'luggage'], ['#/smart-bag', 'smart-bag'], ['#/info', 'info']]) {
      await tab(page, 'tools');
      await page.click(`#panel-tools .tools-more a[href="${href}"]`);
      const ok = await page.waitForFunction((s) => location.hash === `#/${s}` && [...document.querySelectorAll('main > section, main section.panel')].some((x) => !x.hidden && x.offsetParent !== null), screen, { timeout: 3000 }).then(() => true, () => false);
      links.push({ href, ok, hash: await page.evaluate(() => location.hash) });
    }
    pass('TL1', links.every((x) => x.ok), { links });
    const saved1 = await page.evaluate(() => localStorage.getItem('tisa:v1'));
    pass('DATA', saved0 === saved1 && saved0 && saved0.length > 1000, { bytes: saved0?.length, same: saved0 === saved1 });

    });

    // LS1, LS2, CON (lists)
    await sec(['LS1', 'LS2'], async () => {
    await tab(page, 'checklist'); await page.waitForTimeout(200);
    const read = () => page.evaluate(() => ({ group: document.querySelector('#panel-checklist .list-group-head .bar-num').textContent,
      notes: [...document.querySelectorAll('#panel-checklist .lists-progress .bar-num')].map((n) => n.textContent).join('|'),
      line: document.querySelector('[data-slot="lists-summary-count"]').textContent, lineHidden: document.querySelector('[data-slot="lists-summary"]').hidden,
      checked: document.querySelector('#panel-checklist .item-check input').checked }));
    const r0 = await read();
    await page.click('#panel-checklist .item-check input'); await page.waitForTimeout(250);
    const r1 = await read();
    await page.click('#panel-checklist .item-check input'); await page.waitForTimeout(250);
    const r2 = await read();
    pass('LS1', !r0.checked && r1.checked && r1.group !== r0.group && r1.notes !== r0.notes && r1.line !== r0.line && JSON.stringify(r2) === JSON.stringify(r0) && !r0.lineHidden, { before: r0, ticked: r1, after: r2 });
    await page.click('#panel-checklist [data-filter="hide-done-items"]'); await page.waitForTimeout(150);
    const hidF = await page.$eval('[data-slot="lists-summary"]', (n) => n.hidden);
    await page.click('#panel-checklist [data-filter="hide-done-items"]'); await page.waitForTimeout(150);
    await page.fill('#panel-checklist [data-slot="search-input"]', 'דרכון'); await page.waitForTimeout(250);
    const hidS = await page.$eval('[data-slot="lists-summary"]', (n) => n.hidden);
    await page.fill('#panel-checklist [data-slot="search-input"]', ''); await page.waitForTimeout(250);
    const back = await page.$eval('[data-slot="lists-summary"]', (n) => n.hidden);
    pass('LS2', hidF && hidS && !back, { hiddenWhileFilter: hidF, hiddenWhileSearch: hidS, shownAgain: !back });
    // list items on their paper (the note labels sit on gradients: checked against their wash colours below)
    for (const sel of ['#panel-checklist .item-name', '#panel-checklist .item-note']) {
      const c = await page.$eval(sel, (n, f) => [getComputedStyle(n).color, (0, eval)(`(${f})`)(n)], SEEN_BG.toString());
      con.push({ sel, fg: c[0], bg: c[1], ratio: +ratio(c[0], c[1]).toFixed(2) });
    }
    });
    await ctx.close();
    // the note labels sit on watercolour gradients: their base colours (the last layer of each wash token) are checked
    await sec(['CON'], async () => {
    const washes = [];
    for (const scheme of ['light', 'dark']) {
      const o = await open(browser, base, seedFor(scheme), { scheme });
      await tab(o.page, 'checklist');
      washes.push(...await o.page.evaluate((s) => { const p = document.querySelector('#panel-checklist'); const cs = getComputedStyle(p);
        const ink = getComputedStyle(p.querySelector('.lists-progress .bar-label')).color;
        return [1, 2, 3, 4].map((i) => { const m = cs.getPropertyValue(`--wc-${i}`).match(/linear-gradient\((#[0-9A-Fa-f]{6})/); return { scheme: s, wash: i, ink, base: m && m[1] }; }); }, scheme));
      await o.ctx.close();
    }
    const hex = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
    for (const w of washes) con.push({ sel: `note ${w.wash} label (${w.scheme})`, ratio: +ratio(w.ink, hex(w.base)).toFixed(2) });
    pass('CON', con.length >= 9 && con.every((c) => c.ratio >= 4.5), { checks: con });
    });

    // RT2
    await sec(['RT2'], async () => {
    const edge = {};
    for (const [name, clock] of [['before', BEFORE], ['after', AFTER]]) {
      const o = await open(browser, base, seedFor('light'), { clock });
      await tab(o.page, 'itinerary'); await o.page.waitForTimeout(150);
      edge[name] = await statuses(o.page); await o.ctx.close();
    }
    pass('RT2', edge.before.length > 0 && edge.before.every((x) => x === 'ahead') && edge.after.every((x) => x === 'done'), edge);
    });

    pass('RUN', errors.length === 0, { errors });
  } finally {
    await browser.close(); server.kill();
  }
  const fails = Object.values(results).filter((r) => r.result !== 'PASS').length;
  fs.writeFileSync(path.join(OUT, `design-120-run${RUN}.json`), JSON.stringify(results, null, 2));
  const line = Object.entries(results).map(([k, v]) => `${v.result} ${k}`).join('\n') + `\n${Object.keys(results).length - fails}/${fails}`;
  console.log(line); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
