// Stage 13, checks 10 and 11 (docs/GOALS_STAGE13.md): a phone that has 0.7.1 installed gets this version.
// The real 0.7.1 app (from git, commit b64c21d) runs with a real service worker on one origin. Its data is built
// with 0.7.1's own core functions (sample data only, rule 16), plus one photo in IndexedDB. Then the same origin
// serves this version: the old worker shows the "update" banner, the tap reloads, and the data is migrated.
// U1 0.7.1 opens the sample data (schema 5) with no error, and the photo file is stored
// U2 the update banner shows; no reload before the tap
// U3 after the tap: this version, schema 8, the old cache is gone
// U4 every 0.7.1 field of the trip is unchanged after the migration (new fields only added); settings kept
// U5 the photo file is still in IndexedDB; no corrupt copy was made
// U6 the screens show the old data: route, money, lists, calendar note, check-in, bag, photo
// U7 a JSON backup from the upgraded app restores to the same data
// Waits for UI state (rule 6). Run 3 times. QA_OUT (default docs/evidence/stage13/browser), PORT (default 8191).
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage13/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8191);
const BASE = `http://127.0.0.1:${PORT}/`;
const OLD_COMMIT = 'b64c21d'; // Stage 8 design, 0.7.1 (schema 5)
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
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tisa:v1')));
const idbIds = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('tisa-photos');
  r.onsuccess = () => {
    if (!r.result.objectStoreNames.contains('photos')) { res([]); return; }
    const g = r.result.transaction('photos').objectStore('photos').getAllKeys();
    g.onsuccess = () => { res(g.result.sort()); r.result.close(); };
  };
  r.onerror = () => res([]);
}));
const go = async (page, screen) => {
  await page.goto(`${BASE}#/${screen}`);
  await page.waitForFunction((s) => document.querySelector(`#panel-${s}`) && !document.querySelector(`#panel-${s}`).hidden, screen);
};

/** 0.7.1-shaped sample data, made by 0.7.1's own functions. */
async function oldState(dir) {
  const mod = (p) => import(pathToFileURL(path.join(dir, p)).href);
  const [schema, it, cl, money, jr, ci, lg, ph, { TH }] = await Promise.all(['src/js/core/schema.js', 'src/js/core/itinerary.js', 'src/js/core/checklist.js',
    'src/js/core/money.js', 'src/js/core/journal.js', 'src/js/core/checkins.js', 'src/js/core/luggage.js', 'src/js/core/photos.js', 'data/packs/th.js'].map(mod));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config/app.config.json'), 'utf8'));
  let n = 0;
  const makeId = () => `old-${++n}`;
  const at = '2030-11-01T10:00:00.000Z';
  const state = schema.createDefaultState({ now: () => new Date(at), appVersion: cfg.appVersion, makeId, countryCode: 'TH', tripName: 'תאילנד', language: 'he' });
  state.settings.theme = 'dark';
  state.settings.lastBackupAt = at;
  const trip = state.trips[state.activeTripId];
  const stops = it.seedFromPack(TH, 'he', makeId);
  trip.startDate = stops[0].startDate;
  trip.endDate = stops.at(-1).endDate;
  trip.destinations = stops;
  trip.checklist = cl.seedChecklist(TH, 'he', makeId);
  trip.checklist[0].done = true;
  trip.checklist.push(cl.makeItem({ group: 'clothing', name: 'כובע דוגמה', qty: '2', note: 'הערת דוגמה' }, makeId));
  trip.tasks = [...cl.seedTasks(TH, 'he', makeId), cl.makeTask({ title: 'משימת דוגמה', status: 'doing', due: trip.startDate, note: '' }, makeId)];
  trip.budget = money.profileToBudget(TH.budgetProfiles?.[1] ?? TH.budgetProfiles?.[0]);
  const rates = money.effectiveRates(trip.rates, TH.planningRates);
  const cat = trip.budget.categoriesMinor ? Object.keys(trip.budget.categoriesMinor)[0] : 'food';
  trip.expenses = [
    money.makeExpense({ amount: '120.50', currency: 'ILS', category: cat, date: trip.startDate, destinationId: stops[0].id, description: 'הוצאת דוגמה', method: 'card', status: 'paid', note: '' }, rates, makeId),
    money.makeExpense({ amount: '900', currency: 'THB', category: cat, date: stops[1].startDate, destinationId: stops[1].id, description: 'הוצאת דוגמה 2', method: 'cash', status: 'planned', note: 'דוגמה' }, rates, makeId),
  ];
  trip.journal = jr.setNote(trip.journal, stops[0].startDate, 'הערת יומן לדוגמה', at);
  trip.checkins = [ci.makeCheckin({ kind: 'hotel', title: 'מלון דוגמה', stopId: stops[0].id, date: stops[0].startDate, time: '14:00', zone: 'Asia/Bangkok', booking: '', link: '', note: '' }, makeId)];
  const bag = lg.makeBag({ name: 'מזוודת דוגמה', limit: '23' }, makeId);
  trip.luggage = lg.saveItem(lg.saveBag(trip.luggage, bag), lg.makeLuggageItem({ name: 'נעלי דוגמה', weight: '1.2' }, makeId), bag.id);
  trip.photos = [ph.makePhoto({ id: 'old-photo-1', date: stops[0].startDate, dateSource: 'manual', width: 4, height: 3, bytes: 0, addedAt: at, featured: true, caption: 'תמונת דוגמה' })];
  const problems = schema.validateState(state);
  if (problems.length) throw new Error(`0.7.1 sample data is not valid in 0.7.1: ${problems.join(', ')}`);
  return state;
}

/** Every field the old trip had is still there with the same value (the migration may only add fields). */
function sameOld(before, after, at = 'trip') {
  const diffs = [];
  for (const [k, v] of Object.entries(before)) {
    const p = `${at}.${k}`;
    if (!(k in after)) diffs.push(`${p} missing`);
    else if (v && typeof v === 'object' && !Array.isArray(v)) diffs.push(...sameOld(v, after[k] ?? {}, p));
    else if (JSON.stringify(v) !== JSON.stringify(after[k])) diffs.push(`${p} changed`);
  }
  return diffs;
}

(async () => {
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tisa-071-'));
  execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${OLD_COMMIT} | tar -x -C "${oldDir}"`]);
  const oldVersion = JSON.parse(fs.readFileSync(path.join(oldDir, 'config/app.config.json'), 'utf8')).appVersion;
  const newVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;
  let server = serve(oldDir);
  await up();
  const browser = await chromium.launch();
  try {
    const seed = await oldState(oldDir);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', acceptDownloads: true });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(seed));
    const page = await ctx.newPage();
    watch(page);

    // ---------- U1: 0.7.1 with its own data and a real service worker ----------
    await page.goto(`${BASE}#/photos`);
    await ready(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    await page.evaluate(async () => {
      const { putPhoto } = await import('/src/js/photo-store.js');
      const c = new OffscreenCanvas(4, 3);
      c.getContext('2d').fillRect(0, 0, 4, 3);
      const buf = await (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer();
      await putPhoto({ id: 'old-photo-1', type: 'image/jpeg', full: buf, thumb: buf.slice(0) });
    });
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb img[src]').length === 1, null, { timeout: 15000 });
    const shownOld = await page.locator('[data-slot="version-app"]').textContent();
    const before = await stored(page);
    const filesBefore = await idbIds(page);
    const cachesBefore = await page.evaluate(() => caches.keys());
    pass('U1 0.7.1 opens the 0.7.1 sample data (schema 5) with no error; the photo file is stored',
      shownOld === oldVersion && oldVersion === '0.7.1' && before.schemaVersion === 5 && JSON.stringify(before.trips) === JSON.stringify(seed.trips)
      && filesBefore.length === 1 && errors.length === 0, { shownOld, schema: before.schemaVersion, filesBefore, cachesBefore, errors: [...errors] });

    // ---------- U2: the same address now serves this version ----------
    await down(server);
    server = serve(ROOT);
    await up();
    await page.evaluate(() => { window.__noReload = 'still-here'; });
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    const bannerShown = await page.waitForSelector('.banner [data-action="update"]', { timeout: 20000 }).then(() => true, () => false);
    await wait(1500); // the new worker waits: the page must not reload by itself
    const noReload = await page.evaluate(() => window.__noReload === 'still-here');
    if (SHOTS) await page.screenshot({ path: `${OUT}/upgrade-071-banner-mobile.jpg`, type: 'jpeg', quality: 80 });
    pass('U2 the old app shows the update banner; no reload before the tap', bannerShown && noReload, { bannerShown, noReload });

    // ---------- U3: tap "update" ----------
    if (bannerShown) await Promise.all([page.waitForEvent('load', { timeout: 20000 }), page.click('.banner [data-action="update"]')]);
    await ready(page);
    await go(page, 'settings');
    const shownNew = await page.locator('[data-slot="version-app"]').textContent();
    const after = await stored(page);
    const cachesAfter = await page.evaluate(() => caches.keys());
    pass('U3 after the tap: this version, schema 8, the old cache is gone',
      shownNew === newVersion && after.schemaVersion === 8 && cachesAfter.includes(`tisa-${newVersion}`) && !cachesAfter.includes(`tisa-${oldVersion}`),
      { shownNew, schema: after.schemaVersion, cachesAfter });

    // ---------- U4, U5: nothing from 0.7.1 changed; the photo file is still there ----------
    const id = before.activeTripId;
    const tripDiffs = sameOld(before.trips[id], after.trips[id]);
    const settingsDiffs = sameOld(before.settings, after.settings, 'settings');
    pass('U4 every 0.7.1 field of the trip and of the settings is unchanged (the migration only adds)',
      after.activeTripId === id && tripDiffs.length === 0 && settingsDiffs.length === 0 && after.createdAt === before.createdAt,
      { tripDiffs, settingsDiffs, added: Object.keys(after.trips[id]).filter((k) => !(k in before.trips[id])) });
    const filesAfter = await idbIds(page);
    const corrupt = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tisa:corrupt')));
    pass('U5 the photo file is still in IndexedDB; no corrupt copy was made', JSON.stringify(filesAfter) === JSON.stringify(filesBefore) && corrupt.length === 0, { filesAfter, corrupt });

    // ---------- U6: the screens show the old data ----------
    const t = before.trips[id];
    await go(page, 'itinerary');
    const stopsShown = await page.locator('#panel-itinerary [data-slot="stops"] [data-action="stop-edit"]').count();
    await go(page, 'money');
    const moneyText = await page.locator('#panel-money').innerText();
    await go(page, 'checklist');
    const listText = await page.locator('#panel-checklist').innerText();
    await go(page, 'calendar');
    const calText = await page.locator('#panel-calendar').innerText();
    await go(page, 'luggage');
    const bagText = await page.locator('#panel-luggage').innerText();
    await go(page, 'photos');
    await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb img[src]').length === 1, null, { timeout: 15000 });
    if (SHOTS) await page.screenshot({ path: `${OUT}/upgrade-071-photos-after-mobile.jpg`, type: 'jpeg', quality: 80 });
    pass('U6 the screens show the 0.7.1 data: every stop, both expenses, the extra list item, the journal note, the check-in, the bag, the photo',
      stopsShown === t.destinations.length && /הוצאת דוגמה 2/.test(moneyText) && /כובע דוגמה/.test(listText)
      && /הערת יומן לדוגמה/.test(calText) && /מלון דוגמה/.test(calText) && /מזוודת דוגמה/.test(bagText) && /נעלי דוגמה/.test(bagText),
      { stopsShown, stops: t.destinations.length });

    // ---------- U7: a backup of the upgraded data restores to the same data ----------
    await go(page, 'settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    const file = path.join(os.tmpdir(), `tisa-u7-${process.pid}.json`);
    await dl.saveAs(file);
    const saved = await stored(page);
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); const tr = s.trips[s.activeTripId]; tr.expenses = []; tr.destinations = []; localStorage.setItem('tisa:v1', JSON.stringify(s)); });
    await page.reload();
    await ready(page);
    await go(page, 'settings');
    await page.locator('#import-file').setInputFiles(file);
    await page.waitForSelector('#dlg-import[open]');
    await page.click('#dlg-import [data-action="import-confirm"]');
    await page.waitForFunction(() => !document.querySelector('#dlg-import[open]'));
    const restored = await stored(page);
    fs.rmSync(file, { force: true });
    pass('U7 a JSON backup from the upgraded app restores to the same trip data',
      JSON.stringify(restored.trips) === JSON.stringify(saved.trips) && restored.schemaVersion === 8, { name: dl.suggestedFilename() });
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
  fs.writeFileSync(path.join(OUT, 'upgrade-browser.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
