// 1.0.1: a phone with the released 1.0.0 gets this version (docs/FREEZE.md: an update must keep the data).
// The real 1.0.0 (from git, the merge commit of #48) runs with a real service worker; its data is the shared rich
// sample built by 1.0.0's own lib and code (rule 22: the lib of that version, taken from git). Then the same origin
// serves this version: banner, tap, and the data and every money figure must be exactly as before. No "anchor" is
// added and nothing is split again (owner, 2026-11-22: existing users see exactly what they saw).
// V1 1.0.0 shows the sample; V2 banner, no reload before the tap; V3 this version after the tap
// V4 the saved data is byte-for-byte the same (trips and settings); no anchor
// V5 the money screen and the home card show the same figures as in 1.0.0; V6 the photo file is still there
// Waits for UI state (rule 6). Run 3 times. QA_OUT (default docs/evidence/v1.0.1/browser), PORT (default 8197).
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/v1.0.1/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8197);
const BASE = `http://127.0.0.1:${PORT}/`;
const OLD_COMMIT = '60d09c4'; // the merge of #48: LATISA 1.0.0
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const serve = (dir) => spawn(process.execPath, [path.join(dir, 'scripts/serve.js')], { cwd: dir, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
const up = async () => { for (let i = 0; i < 50; i++) { try { await fetch(BASE); return; } catch { await wait(100); } } throw new Error('server did not start'); };
const down = (p) => new Promise((r) => { p.once('exit', r); p.kill(); });

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const stored = (page) => page.evaluate(() => localStorage.getItem('tisa:v1'));
const go = async (page, screen) => { await page.goto(`${BASE}#/${screen}`); await page.waitForFunction((s) => !document.querySelector(`#panel-${s}`).hidden, screen); };
const idbIds = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('tisa-photos');
  r.onsuccess = () => {
    if (!r.result.objectStoreNames.contains('photos')) { res([]); return; }
    const g = r.result.transaction('photos').objectStore('photos').getAllKeys();
    g.onsuccess = () => { res(g.result.sort()); r.result.close(); };
  };
  r.onerror = () => res([]);
}));
const figures = async (page) => {
  await go(page, 'money');
  const m = await page.evaluate(() => Object.fromEntries(['money-free', 'money-free-before', 'money-today', 'money-total', 'money-paid', 'money-planned', 'money-committed', 'money-free-small', 'money-base']
    .map((s) => [s, document.querySelector(`[data-slot="${s}"]`)?.textContent?.trim() ?? null]).concat([['reserved', document.querySelector('[data-slot="money-reserved-row"]')?.hidden === false ? document.querySelector('[data-slot="money-reserved"]').textContent.trim() : null]])));
  await go(page, 'home');
  const h = await page.evaluate(() => Object.fromEntries(['kpi-total', 'kpi-spent', 'kpi-left', 'today-money'].map((s) => [s, document.querySelector(`[data-slot="${s}"]`)?.textContent?.trim() ?? null])));
  return { ...m, ...h };
};

(async () => {
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tisa-100-'));
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${OLD_COMMIT} | tar -x -C "${oldDir}"`]);
  const oldVersion = JSON.parse(fs.readFileSync(path.join(oldDir, 'config/app.config.json'), 'utf8')).appVersion;
  const newVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;
  const { richState, putSamplePhoto } = require(path.join(oldDir, 'scripts/qa/lib/rich-trip.cjs')); // 1.0.0's own lib and code
  let server = serve(oldDir);
  await up();
  const browser = await chromium.launch();
  try {
    const seed = await richState();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok' });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(seed));
    const page = await ctx.newPage();
    watch(page);
    await page.clock.setFixedTime(new Date('2030-12-24T10:00:00+07:00'));
    await page.goto(`${BASE}#/home`);
    await ready(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    await putSamplePhoto(page);
    const shownOld = await page.locator('[data-slot="version-app"]').textContent();
    const before = await stored(page);
    const figBefore = await figures(page);
    const filesBefore = await idbIds(page);
    pass('V1 1.0.0 (from git) shows the rich sample built by its own code', shownOld === oldVersion && oldVersion === '1.0.0' && filesBefore.length === 1 && errors.length === 0,
      { shownOld, figBefore, errors: [...errors] });

    await down(server);
    server = serve(ROOT);
    await up();
    await page.evaluate(() => { window.__noReload = 'still-here'; });
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    const bannerShown = await page.waitForSelector('.banner [data-action="update"]', { timeout: 20000 }).then(() => true, () => false);
    await wait(1500); // the new worker waits: the page must not reload by itself
    const noReload = await page.evaluate(() => window.__noReload === 'still-here');
    pass('V2 the update banner; no reload before the tap', bannerShown && noReload, { bannerShown, noReload });

    if (bannerShown) await Promise.all([page.waitForEvent('load', { timeout: 20000 }), page.click('.banner [data-action="update"]')]);
    await ready(page);
    const shownNew = await page.locator('[data-slot="version-app"]').textContent();
    pass('V3 after the tap: this version', shownNew === newVersion && newVersion !== oldVersion, { shownNew });

    const figAfter = await figures(page);
    const after = await stored(page);
    const b = JSON.parse(before);
    const a = JSON.parse(after);
    pass('V4 the saved data is exactly the same (trips and settings); no "anchor" was added and nothing was split again',
      JSON.stringify(a.trips) === JSON.stringify(b.trips) && JSON.stringify(a.settings) === JSON.stringify(b.settings) && !/"anchor"/.test(after),
      { sameTrips: JSON.stringify(a.trips) === JSON.stringify(b.trips), sameSettings: JSON.stringify(a.settings) === JSON.stringify(b.settings) });
    const diff = Object.keys(figBefore).filter((k) => figBefore[k] !== figAfter[k]);
    if (SHOTS) { await go(page, 'money'); await page.screenshot({ path: `${OUT}/upgrade-100-money-mobile.jpg`, type: 'jpeg', quality: 80 }); }
    pass('V5 every money figure on the money screen and the home card is the same as in 1.0.0', diff.length === 0, { diff, figBefore, figAfter });
    const filesAfter = await idbIds(page);
    pass('V6 the photo file is still in IndexedDB', JSON.stringify(filesAfter) === JSON.stringify(filesBefore), { filesAfter });
    await ctx.close();
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    pass('no requests outside the app', outside.length === 0, { outside });
    await browser.close();
    await down(server);
    fs.rmSync(oldDir, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(OUT, 'upgrade-100-browser.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
