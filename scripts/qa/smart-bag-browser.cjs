// Stage 12 PR 2 (0.11.1): smart suitcase, docs/GOALS_STAGE12.md S12-3 to S12-8. Sample trip only (rule 16).
// Waits for UI state (rule 6). Run 3 times. QA_OUT (default docs/evidence/stage12/browser), PORT (default 8173), SHOTS=0.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { sampleState } = require('./lib/sample-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage12/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8173);
const BASE = `http://127.0.0.1:${PORT}/`;
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
const keysIn = (page, group) => page.locator(`[data-slot="sbag-${group}"] .sbag-item`).evaluateAll((els) => els.map((e) => e.dataset.key));
const go = async (page, screen) => {
  await page.goto(`${BASE}#/${screen}`);
  await page.waitForFunction((s) => !document.querySelector(`#panel-${s}`).hidden, screen);
};

async function open(browser, { viewport = MOBILE, theme = 'light', sw = false, route = 'home', state } = {}) {
  const st = state ?? await sampleState();
  st.settings.theme = theme;
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', acceptDownloads: true, ...(sw ? {} : { serviceWorkers: 'block' }) });
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(st));
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2030-12-10T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  try {
    const a = await open(browser, { route: 'checklist' });
    const { page } = a;
    const before = await trip(page);

    // ---------- L1: opened from the lists; the lists tab stays lit ----------
    const entry = await page.locator('#panel-checklist [data-go="smart-bag"]').count();
    pass('L0 the lists screen has a "מזוודה חכמה" button', entry === 1, { entry });
    if (!entry) throw new Error('no smart suitcase entry');
    await page.click('#panel-checklist [data-go="smart-bag"]');
    await page.waitForFunction(() => location.hash === '#/smart-bag' && !document.querySelector('#panel-smart-bag').hidden);
    const lit = await page.locator('#tab-lists').getAttribute('aria-selected');
    const head = await page.evaluate(() => ({ days: document.querySelector('[data-slot="sbag-days"]').textContent, kinds: document.querySelector('[data-slot="sbag-kinds"]').textContent }));
    pass('L1 the lists open "מזוודה חכמה"; the lists tab stays lit; the screen shows the days and the stops by kind',
      lit === 'true' && /32 ימים/.test(head.days) && /7 ימים/.test(head.days) && /עיר: בנגקוק/.test(head.kinds) && /אי: /.test(head.kinds), { lit, head });
    if (SHOTS) await page.screenshot({ path: `${OUT}/after-smart-bag-mobile-light.jpg`, type: 'jpeg', quality: 80, fullPage: true });

    // ---------- L2 (S12-3): activities change the suggestions, and the choice survives a reload ----------
    const noDive = !(await keysIn(page, 'must')).includes('dive-card');
    await page.check('#panel-smart-bag input[data-activity="snorkel"]');
    await page.waitForFunction(() => !!document.querySelector('[data-slot="sbag-must"] [data-key="dive-card"]'));
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => !document.querySelector('#panel-smart-bag').hidden);
    const kept = await page.isChecked('#panel-smart-bag input[data-activity="snorkel"]');
    const t2 = await trip(page);
    pass('L2 (S12-3) ticking "שנורקל או צלילה" adds a dive-card suggestion; the choice is saved (trip.smartBag) and survives a reload',
      noDive && kept && JSON.stringify(t2.smartBag) === JSON.stringify({ activities: ['snorkel'] }), { kept, smartBag: t2.smartBag });

    // ---------- L3 (S12-4): one tap adds one item; a fast double tap still adds one; nothing else changes ----------
    const sugBefore = await keysIn(page, 'nice');
    const target = sugBefore.find((k) => k === 'rash-guard') ?? sugBefore[0];
    await page.locator(`[data-slot="sbag-nice"] [data-key="${target}"] [data-action="sbag-add"]`).dblclick();
    await page.waitForFunction((k) => !document.querySelector(`[data-slot="sbag-nice"] [data-key="${k}"]`), target);
    const t3 = await trip(page);
    const added3 = t3.checklist.filter((x) => x.smart === target);
    const same = JSON.stringify(t3.checklist.slice(0, before.checklist.length)) === JSON.stringify(before.checklist);
    const toast = await page.locator('[data-slot="toast"]').textContent();
    pass('L3 (S12-4) a double tap on "להוסיף" adds exactly one item, in the bag or carry-on lists; the row leaves; older items are untouched',
      added3.length === 1 && t3.checklist.length === before.checklist.length + 1 && same && /נוסף לרשימות/.test(toast), { target, added: added3, toast });

    // ---------- L4: "add all the musts" adds each once; then the must group is empty and the button hides ----------
    const mustKeys = await keysIn(page, 'must');
    await page.click('[data-action="sbag-add-all"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-slot="sbag-must"] .sbag-item').length === 0);
    const t4 = await trip(page);
    const smartKeys = t4.checklist.filter((x) => x.smart).map((x) => x.smart);
    const hidden = await page.locator('[data-action="sbag-add-all"]').isHidden();
    const none = await page.locator('[data-slot="sbag-must-none"]').isVisible();
    pass('L4 "להוסיף את כל החובה" adds every must once (no duplicates); the group then says so and the button hides',
      mustKeys.length > 0 && mustKeys.every((k) => smartKeys.filter((x) => x === k).length === 1) && hidden && none, { mustKeys, smartKeys });

    // ---------- L5 (S12-4): no suggestion that matches the checklist (built-in and flight items) or a bag ----------
    const names = await page.evaluate(() => [...document.querySelectorAll('#panel-smart-bag .sbag-item-name')].map((e) => e.textContent.trim()));
    const listNames = new Set(t4.checklist.map((x) => x.name.trim().replace(/\s+/g, ' ').toLowerCase()));
    const dup = names.filter((n) => listNames.has(n.toLowerCase()));
    const avoidHasNoAdd = await page.locator('[data-slot="sbag-avoid"] [data-action="sbag-add"]').count();
    pass('L5 (S12-4) no shown suggestion has a name already in the lists; "לא כדאי" has no add button', dup.length === 0 && avoidHasNoAdd === 0, { dup, avoidHasNoAdd });

    // ---------- L6 (S12-6): ticking an added item survives a reload, then a backup and a restore ----------
    await go(page, 'checklist');
    const firstSmart = t4.checklist.find((x) => x.smart);
    await page.check(`#panel-checklist input[data-action="item-toggle"][data-id="${firstSmart.id}"]`);
    await page.waitForFunction((id) => JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].checklist.find((x) => x.id === id).done === true, firstSmart.id);
    await page.reload();
    await ready(page);
    const afterReload = (await trip(page)).checklist.find((x) => x.id === firstSmart.id).done;
    await go(page, 'settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    const file = path.join(OUT, 'sample-backup.json');
    await dl.saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.rmSync(file);
    const bt = backup.data.trips[backup.data.activeTripId];
    // change things, then restore the file through the screen
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); const tr = s.trips[s.activeTripId]; tr.smartBag = { activities: [] }; tr.checklist = tr.checklist.map((x) => ({ ...x, done: false })); localStorage.setItem('tisa:v1', JSON.stringify(s)); });
    await page.reload();
    await ready(page);
    await go(page, 'settings');
    await page.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => document.querySelector('#dlg-import').open);
    await page.click('[data-action="import-confirm"]');
    await page.waitForFunction(() => !document.querySelector('#dlg-import').open);
    const restored = await trip(page);
    pass('L6 (S12-6) the tick on an added item survives a reload; the backup file has the activities and ticks; a restore brings them back',
      afterReload === true && backup.schemaVersion === 8 && JSON.stringify(bt.smartBag) === JSON.stringify({ activities: ['snorkel'] })
      && bt.checklist.find((x) => x.id === firstSmart.id).done === true
      && JSON.stringify(restored.smartBag) === JSON.stringify({ activities: ['snorkel'] }) && restored.checklist.find((x) => x.id === firstSmart.id).done === true,
      { afterReload, schema: backup.schemaVersion, smartBag: restored.smartBag });

    // ---------- L7 (S12-3): a route change updates the suggestions, never the items already added ----------
    const itemsBefore = JSON.stringify((await trip(page)).checklist);
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); const tr = s.trips[s.activeTripId]; tr.destinations = tr.destinations.map((d) => ({ ...d, name: 'בנגקוק' })); localStorage.setItem('tisa:v1', JSON.stringify(s)); });
    await page.reload();
    await ready(page);
    await go(page, 'smart-bag');
    const kinds7 = await page.locator('[data-slot="sbag-kinds"]').textContent();
    const itemsAfter = JSON.stringify((await trip(page)).checklist);
    pass('L7 (S12-3) a route with only a city changes the stops line (no island); the items already added stay exactly',
      !/אי:/.test(kinds7) && /עיר: בנגקוק/.test(kinds7) && itemsAfter === itemsBefore, { kinds7 });

    // ---------- L8: 390px no side scroll; add buttons have names and 44px; activities are labelled checkboxes ----------
    const a11y = await page.evaluate(() => {
      const adds = [...document.querySelectorAll('#panel-smart-bag [data-action="sbag-add"]')];
      const boxes = [...document.querySelectorAll('#panel-smart-bag input[data-activity]')];
      return {
        hs: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        addsNamed: adds.every((b) => /^להוסיף את .+ לרשימות$/.test(b.getAttribute('aria-label') ?? '')),
        addsBig: adds.every((b) => b.getBoundingClientRect().height >= 44),
        boxes: boxes.length,
        boxesNamed: boxes.every((b) => b.labels?.[0]?.textContent.trim().length > 0),
        legend: document.querySelector('#panel-smart-bag fieldset legend')?.textContent.trim(),
      };
    });
    pass('L8 390px: no horizontal scroll; each "להוסיף" says what it adds and is 44px tall; 7 labelled activity checkboxes in a fieldset',
      !a11y.hs && a11y.addsNamed && a11y.addsBig && a11y.boxes === 7 && a11y.boxesNamed && a11y.legend === 'פעילויות', a11y);
    await a.ctx.close();

    // ---------- L9 (S12-8): light and dark, 390px and desktop ----------
    for (const theme of ['light', 'dark']) {
      for (const [vName, viewport] of [['mobile', MOBILE], ['desktop', DESKTOP]]) {
        const c = await open(browser, { theme, viewport, route: 'smart-bag' });
        await c.page.waitForFunction(() => !document.querySelector('#panel-smart-bag').hidden);
        if (SHOTS) await c.page.screenshot({ path: `${OUT}/after-smart-bag-${vName}-${theme}.jpg`, type: 'jpeg', quality: 80 });
        await c.ctx.close();
      }
    }
    pass('L9 (S12-8) the screen renders in light and dark, at 390px and desktop (screenshots after-smart-bag-*)', errors.length === 0, { errors });

    // ---------- L10 (S12-7): airplane mode: offline, the screen and its rules load from the cache ----------
    const o = await open(browser, { sw: true, route: 'smart-bag' });
    await o.page.waitForFunction(async () => (await navigator.serviceWorker?.getRegistration())?.active?.state === 'activated');
    await o.page.reload();
    await ready(o.page);
    await o.ctx.setOffline(true);
    await o.page.reload();
    await ready(o.page);
    await o.page.waitForFunction(() => !document.querySelector('#panel-smart-bag').hidden && document.querySelectorAll('[data-slot="sbag-must"] .sbag-item').length > 0);
    const offCount = await o.page.locator('#panel-smart-bag .sbag-item').count();
    if (SHOTS) await o.page.screenshot({ path: `${OUT}/after-smart-bag-airplane-mobile.jpg`, type: 'jpeg', quality: 80 });
    await o.ctx.close();
    pass('L10 (S12-7) airplane mode: offline, the smart suitcase shows its suggestions from the cache', offCount > 0, { offCount });

    pass('L11 (S12-7) zero requests outside the app in the whole run, no page errors', outside.length === 0 && errors.length === 0, { outside, errors });
  } catch (e) {
    pass('ERROR the run stopped', false, { message: String(e.message ?? e).split('\n')[0] });
  } finally {
    await browser.close();
    server.kill();
    fs.writeFileSync(path.join(OUT, 'smart-bag-browser.json'), `${JSON.stringify(results, null, 2)}\n`);
    const fails = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
    for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
    if (fails.length) { console.log(JSON.stringify(fails, null, 2).slice(0, 3000)); process.exitCode = 1; }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
