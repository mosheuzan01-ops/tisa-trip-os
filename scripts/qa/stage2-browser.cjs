// Stage 2 browser checks at 375px (docs/GOALS_STAGE2.md B11-B20).
// Dev-only: needs a Chromium through Playwright on the developer's machine. The app has no dependencies.
// Run from the repo root: node scripts/qa/stage2-browser.cjs   (starts its own servers on ports 8091 and 8092)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs/evidence/stage2');
fs.mkdirSync(OUT, { recursive: true });
const VIEW = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce' };
const ROUTES = ['home', 'itinerary', 'money', 'checklist', 'transfers', 'info', 'assistant', 'map', 'settings'];
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(dir, port) {
  const child = spawn(process.execPath, [path.join(dir, 'scripts/serve.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  return child;
}

function watch(page, bag) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') bag.errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', (r) => bag.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.protocol.startsWith('blob') && !u.protocol.startsWith('data')) bag.external.push(r.url()); });
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
  await page.evaluate(() => document.fonts.ready);
}

const visible = (page, sel) => page.locator(sel).isVisible();

(async () => {
  const base = 'http://127.0.0.1:8091/';
  const server = serve(ROOT, 8091);
  await sleep(600);
  const browser = await chromium.launch();

  // ---------- B11, B12, B13, B14, B19, B20 ----------
  {
    const ctx = await browser.newContext({ ...VIEW, acceptDownloads: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const bag = { errors: [], failed: [], external: [] };
    watch(page, bag);
    await page.goto(base);
    await ready(page);
    await page.screenshot({ path: `${OUT}/home-375.png` });

    // B11: every screen from the navigation; Back; refresh; aria-current
    const nav = {};
    const open = async (route) => {
      if (route === 'settings') await page.click('.settings-btn');
      else if (route === 'home') await page.click('[data-tab="home"]');
      else if (await page.locator(`[role="tab"][data-route="${route}"]`).count()) await page.click(`[role="tab"][data-route="${route}"]`);
      else { await page.click('[data-tab="itinerary"]'); await page.click(`.soon-link[data-route="${route}"]`); }
      await page.waitForFunction((r) => location.hash === `#/${r}`, route);
      await page.waitForSelector(`[data-route="${route}"][aria-current="page"]`, { state: "attached" }); // hashchange is handled a moment later
    };
    for (const route of ROUTES) {
      await open(route);
      const panel = route === 'home' ? '#panel-home' : route === 'settings' ? '#panel-settings' : '#panel-soon';
      const current = await page.locator(`[data-route="${route}"][aria-current="page"]`).count();
      const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      nav[route] = { hash: await page.evaluate(() => location.hash), panelVisible: await visible(page, panel), ariaCurrent: current, hscroll };
      if (route !== 'home' && route !== 'settings') {
        // B12: no fake action buttons on an empty screen (only "back to home" and real links)
        nav[route].buttons = await page.locator('#panel-soon button').evaluateAll((b) => b.map((x) => x.dataset.go ?? 'NO-DESTINATION'));
        nav[route].text = await page.locator('[data-slot="soon-text"]').textContent();
      }
    }
    await open('transfers');
    await open('settings');
    await page.goBack();
    const afterBack = await page.evaluate(() => location.hash);
    await page.reload();
    await ready(page);
    const afterReload = await page.evaluate(() => location.hash);
    const transfersVisible = await visible(page, '#panel-soon');
    await page.goto(`${base}#budget`); // Stage 1 address still works
    await ready(page);
    const legacyHash = await page.evaluate(() => location.hash);
    const b11 = Object.values(nav).every((n) => n.panelVisible && n.ariaCurrent > 0 && !n.hscroll) && afterBack === '#/transfers' && afterReload === '#/transfers' && transfersVisible && legacyHash === '#/money';
    pass('B11', b11, { nav, afterBack, afterReload, legacyHash });
    const soon = Object.entries(nav).filter(([r]) => !['home', 'settings'].includes(r));
    pass('B12', soon.every(([, n]) => n.buttons.length === 1 && n.buttons[0] === 'home' && /שלב \d|לא נכללת/.test(n.text)), { screens: Object.fromEntries(soon.map(([r, n]) => [r, { buttons: n.buttons, text: n.text }])) });
    await open('itinerary');
    await page.screenshot({ path: `${OUT}/empty-screen-itinerary.png`, fullPage: false });

    // B13: settings survive a refresh
    await open('settings');
    await page.fill('[data-form="settings-dates"] [name="start"]', '2026-12-05');
    await page.fill('[data-form="settings-dates"] [name="end"]', '2027-01-03');
    await page.click('[data-form="settings-dates"] [type="submit"]');
    await page.click('label.choice:has(input[value="dark"])');
    await sleep(700); // autosave pause
    await page.reload();
    await ready(page);
    const b13 = await page.evaluate(() => ({
      start: document.querySelector('[data-form="settings-dates"] [name="start"]').value,
      end: document.querySelector('[data-form="settings-dates"] [name="end"]').value,
      theme: document.documentElement.dataset.theme,
      radio: document.querySelector('input[name="theme"]:checked')?.value,
      stored: JSON.parse(localStorage.getItem('tisa:v1')).settings.theme,
    }));
    pass('B13', b13.start === '2026-12-05' && b13.end === '2027-01-03' && b13.theme === 'dark' && b13.radio === 'dark' && b13.stored === 'dark', b13);
    await page.screenshot({ path: `${OUT}/settings-375-dark.png`, fullPage: true });
    await page.click('label.choice:has(input[value="light"])');
    await sleep(600);
    await page.screenshot({ path: `${OUT}/settings-375-light.png`, fullPage: true });

    // B14: export, import with a confirmation (cancel changes nothing), broken file rejected, reset needs the typed word
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    const backupPath = path.join(OUT, 'sample-backup.json');
    await download.saveAs(backupPath);
    const fileName = download.suggestedFilename();
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    await page.fill('[data-form="settings-dates"] [name="start"]', '2027-02-01');
    await page.fill('[data-form="settings-dates"] [name="end"]', '2027-02-10');
    await page.click('[data-form="settings-dates"] [type="submit"]');
    await sleep(300);
    const before = await page.evaluate(() => localStorage.getItem('tisa:v1'));
    await page.setInputFiles('#import-file', backupPath);
    await page.waitForSelector('#dlg-import[open]');
    const summary = await page.locator('.import-summary').innerText();
    await page.screenshot({ path: `${OUT}/import-dialog.png` });
    await page.click('#dlg-import [data-close]');
    const afterCancel = await page.evaluate(() => localStorage.getItem('tisa:v1'));
    await page.setInputFiles('#import-file', backupPath);
    await page.waitForSelector('#dlg-import[open]');
    await page.click('[data-action="import-confirm"]');
    await sleep(300);
    const imported = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
    const broken = path.join(os.tmpdir(), 'tisa-broken.json');
    fs.writeFileSync(broken, '{"format":"something-else"}');
    await page.setInputFiles('#import-file', broken);
    await sleep(300);
    const brokenError = await page.locator('[data-slot="import-error"]').textContent();
    const brokenDialog = await page.locator('#dlg-import[open]').count();
    const afterBroken = await page.evaluate(() => localStorage.getItem('tisa:v1'));

    await page.click('[data-action="reset-open"]');
    await page.waitForSelector('#dlg-reset[open]');
    const disabledAtStart = await page.locator('[data-action="reset-confirm"]').isDisabled();
    await page.fill('[data-slot="reset-input"]', 'אפוס');
    const disabledWrong = await page.locator('[data-action="reset-confirm"]').isDisabled();
    const offersBackup = await page.locator('#dlg-reset [data-action="reset-backup"]').isVisible();
    await page.fill('[data-slot="reset-input"]', 'איפוס');
    const enabledRight = await page.locator('[data-action="reset-confirm"]').isEnabled();
    await page.screenshot({ path: `${OUT}/reset-dialog.png` });
    await page.click('[data-action="reset-confirm"]');
    await sleep(300);
    const afterReset = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return { start: s.trips[s.activeTripId].startDate, trips: Object.keys(s.trips).length }; });
    const b14 = {
      fileName, format: backup.format, summary, cancelKeptData: before === afterCancel,
      importedStart: imported.startDate, brokenError, brokenDialog, brokenKeptData: afterBroken === JSON.stringify(JSON.parse(afterBroken)) && JSON.parse(afterBroken).trips[JSON.parse(afterBroken).activeTripId].startDate === imported.startDate,
      disabledAtStart, disabledWrong, offersBackup, enabledRight, afterReset,
    };
    pass('B14', /^tisa-backup-\d{4}-\d{2}-\d{2}\.json$/.test(fileName) && backup.format === 'tisa-backup' && b14.cancelKeptData && imported.startDate === '2026-12-05'
      && brokenError.length > 0 && brokenDialog === 0 && b14.brokenKeptData && disabledAtStart && disabledWrong && offersBackup && enabledRight && afterReset.start === null && afterReset.trips === 1, b14);

    pass('B19', bag.errors.length === 0 && bag.external.length === 0 && Object.values(nav).every((n) => !n.hscroll)
      && (await page.evaluate(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'he')), { errors: bag.errors, external: bag.external, failed: bag.failed });
    await ctx.close();
  }

  // ---------- Stage 1 data moves to the new format in a real browser; corrupt data is kept ----------
  {
    const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const bag = { errors: [], failed: [], external: [] };
    watch(page, bag);
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('tisa:trip', JSON.stringify({ v: 1, trip: { dates: { start: '2027-03-10', end: '2027-03-19' }, budget: { amount: 12000, currency: 'ILS' } } }));
      localStorage.setItem('tisa:theme', 'dark');
    });
    await page.goto(base);
    await ready(page);
    const migrated = await page.evaluate(() => ({
      keys: Object.keys(localStorage).sort(),
      trip: (() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; })(),
      kpi: document.querySelector('[data-slot="kpi-total"]').textContent,
      theme: document.documentElement.dataset.theme,
    }));
    await page.evaluate(() => localStorage.setItem('tisa:v1', '{"schemaVersion":1, broken'));
    await page.reload();
    await ready(page);
    const corrupt = await page.evaluate(() => ({
      banner: document.querySelector('.banner')?.textContent ?? '',
      mainKey: localStorage.getItem('tisa:v1'),
      copies: Object.keys(localStorage).filter((k) => k.startsWith('tisa:corrupt:')).length,
    }));
    await page.screenshot({ path: `${OUT}/banner-corrupt.png` });
    results.migrationInBrowser = { result: migrated.trip.startDate === '2027-03-10' && migrated.trip.budget.amount === 12000 && migrated.theme === 'dark' && migrated.keys.includes('tisa:trip') ? 'PASS' : 'FAIL', migrated };
    results.corruptInBrowser = { result: corrupt.mainKey === '{"schemaVersion":1, broken' && corrupt.copies >= 1 && corrupt.banner.length > 0 ? 'PASS' : 'FAIL', corrupt, errors: bag.errors };
    await ctx.close();
  }

  // ---------- B15: localStorage blocked ----------
  {
    const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const bag = { errors: [], failed: [], external: [] };
    watch(page, bag);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
    });
    await page.goto(base);
    await ready(page);
    const banner = await page.locator('.banner').first().textContent();
    await page.click('.settings-btn');
    await page.fill('[data-form="settings-dates"] [name="start"]', '2026-12-05');
    await page.fill('[data-form="settings-dates"] [name="end"]', '2027-01-03');
    await page.click('[data-form="settings-dates"] [type="submit"]');
    const inMemory = await page.evaluate(() => document.querySelector('[data-form="settings-dates"] [name="start"]').value);
    await page.click('[data-tab="home"]');
    await page.waitForSelector('#panel-home:not([hidden])');
    const homeStatus = await page.locator('[data-slot="today-status"]').isVisible();
    await page.screenshot({ path: `${OUT}/banner-storage-blocked.png` });
    pass('B15', banner.length > 0 && bag.errors.length === 0 && inMemory === '2026-12-05' && homeStatus, { banner, errors: bag.errors, inMemory, homeStatus });
    await ctx.close();
  }

  // ---------- B16 offline, B18 install ----------
  {
    const ctx = await browser.newContext({ ...VIEW });
    const page = await ctx.newPage();
    await page.goto(base);
    await ready(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const cdp = await ctx.newCDPSession(page);
    const install = await cdp.send('Page.getInstallabilityErrors');
    const manifest = await cdp.send('Page.getAppManifest');
    pass('B18', install.installabilityErrors.length === 0 && manifest.errors.length === 0, { installabilityErrors: install.installabilityErrors, manifestErrors: manifest.errors, manifestUrl: manifest.url });
    await ctx.close();
  }
  {
    // A separate context for offline: a CDP session in the same context keeps navigator.onLine at true.
    const ctx = await browser.newContext({ ...VIEW });
    const page = await ctx.newPage();
    await page.goto(base);
    await ready(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    const bag = { errors: [], failed: [], external: [] };
    watch(page, bag);
    await ctx.setOffline(true);
    await page.reload();
    await ready(page);
    const offline = {};
    for (const route of ROUTES) {
      await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
      await sleep(150);
      offline[route] = await page.evaluate(() => ({
        hash: location.hash,
        font: document.fonts.check('16px Heebo'),
        styled: getComputedStyle(document.querySelector('.tabbar')).position === 'fixed',
        icons: document.querySelector('.tab-chip use') !== null,
      }));
    }
    await page.evaluate(() => { location.hash = '#/home'; });
    await page.waitForSelector('.banner-info', { timeout: 5000 }).catch(() => {});
    const banner = await page.locator('.banner').allTextContents();
    await page.screenshot({ path: `${OUT}/banner-offline.png` });
    const fontsLoaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
    pass('B16', Object.values(offline).every((o) => o.font && o.styled && o.icons) && bag.failed.length === 0 && bag.errors.length === 0 && banner.some((b) => b.includes('אין חיבור')),
      { offline, fontsLoaded, failedRequests: bag.failed, errors: bag.errors, banner });
    await ctx.close();
  }

  // ---------- B17 update: serve a copy, publish a new sw.js version, accept the banner, data stays ----------
  {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'tisa-update-'));
    fs.cpSync(ROOT, copy, { recursive: true, filter: (src) => !/[\\/](\.git|docs)([\\/]|$)/.test(src) });
    const s2 = serve(copy, 8092);
    await sleep(600);
    const url = 'http://127.0.0.1:8092/';
    const ctx = await browser.newContext({ ...VIEW });
    const page = await ctx.newPage();
    const bag = { errors: [], failed: [], external: [] };
    watch(page, bag);
    await page.goto(`${url}#/settings`);
    await ready(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.fill('[data-form="settings-dates"] [name="start"]', '2026-12-05');
    await page.fill('[data-form="settings-dates"] [name="end"]', '2027-01-03');
    await page.click('[data-form="settings-dates"] [type="submit"]');
    await sleep(300);
    const cacheBefore = await page.evaluate(() => caches.keys());
    const swFile = path.join(copy, 'sw.js');
    fs.writeFileSync(swFile, fs.readFileSync(swFile, 'utf8').replace(/const VERSION = '[^']+'/, "const VERSION = '9.9.9-test'"));
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    await page.waitForSelector('.banner [data-action="update"]', { timeout: 15000 });
    await page.click('[data-tab="home"]');
    await page.screenshot({ path: `${OUT}/banner-update.png` });
    await Promise.all([page.waitForEvent('load'), page.click('.banner [data-action="update"]')]);
    await ready(page);
    const after = await page.evaluate(async () => ({
      caches: await caches.keys(),
      start: (() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId].startDate; })(),
      banner: !!document.querySelector('.banner [data-action="update"]'),
    }));
    pass('B17', after.start === '2026-12-05' && after.caches.includes('tisa-9.9.9-test') && !after.caches.includes(cacheBefore[0]) && !after.banner && bag.errors.length === 0,
      { cacheBefore, after, errors: bag.errors });
    await ctx.close();
    s2.kill();
    fs.rmSync(copy, { recursive: true, force: true });
  }

  const shots = ['home-375.png', 'settings-375-dark.png', 'import-dialog.png', 'banner-offline.png', 'banner-update.png'];
  pass('B20', shots.every((f) => fs.existsSync(path.join(OUT, f))), { shots });

  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, 'browser-check.json'), JSON.stringify(results, null, 1));
  for (const [id, r] of Object.entries(results)) console.log(id, r.result);
})().catch((e) => { console.error(e); process.exit(1); });
