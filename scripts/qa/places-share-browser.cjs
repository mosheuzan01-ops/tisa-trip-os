// Stage 10, PR 2 (0.9.1): photos of places in the slideshow, sharing, copying, places files (docs/GOALS_STAGE10.md,
// L7-L10, L12, L13). Sample data only (rule 16): made-up names, 2030 dates. Waits for UI state (rule 6). Run 3 times.
// QA_OUT (default docs/evidence/stage10/pr2/browser), PORT (default 8151), SHOTS=0 skips screenshots.
// SHOTS_ONLY=1 with APP_ROOT=<checkout> takes only the "before" screenshots (places and summary on PR 1).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.resolve(process.env.APP_ROOT ?? ROOT);
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage10/pr2/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8151);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const MAPS = 'https://www.google.com/maps/search/?api=1&query=';
const NOW = '2030-11-01T10:00:00.000Z';

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1') ?? 'null'); return s ? s.trips[s.activeTripId] : null; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

// Records share-sheet calls and clipboard writes; the share sheet can be absent, cancelled, or present.
const SPY = (mode) => {
  window.__shared = [];
  window.__copied = [];
  window.__geoCalls = 0;
  window.open = () => null;
  if (mode === 'none') Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  else navigator.share = async (data) => { window.__shared.push(data); if (mode === 'abort') throw new DOMException('cancel', 'AbortError'); };
  const clip = { writeText: async (txt) => { window.__copied.push(txt); } };
  if (mode === 'noclip') { clip.writeText = async () => { throw new Error('blocked'); }; }
  Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
  const exec = document.execCommand.bind(document);
  document.execCommand = (cmd, ...rest) => { if (cmd === 'copy') { window.__copied.push(`exec:${document.activeElement?.value ?? ''}`); return true; } return exec(cmd, ...rest); };
  const g = navigator.geolocation;
  if (g) { const real = g.getCurrentPosition.bind(g); g.getCurrentPosition = (a, b, o) => { window.__geoCalls += 1; return real(a, b, o); }; }
};

function sampleState(places = [], photos = []) {
  const id = 'trip-s';
  const s = {
    schemaVersion: 7, appVersion: '0.9.1', createdAt: NOW, updatedAt: NOW,
    settings: { language: 'he', theme: null, lastBackupAt: NOW, assistantQuestionLimit: 50 },
    activeTripId: id,
    trips: { [id]: {
      id, countryCode: 'TH', name: 'תאילנד', startDate: '2030-12-20', endDate: '2031-01-10',
      destinations: [{ id: 's1', name: 'בנגקוק', startDate: '2030-12-21', endDate: '2030-12-25', note: '' }],
      expenses: [], transfers: [], checklist: [], events: [], tasks: [], checkins: [], photos, places,
      budget: { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false, categoryNames: {}, hidden: [] },
      rates: {}, info: {}, assistant: {}, journal: {}, luggage: { bags: [] }, archive: { budgets: [], routes: [] }, templateOffer: 'declined', builtinOffer: { declined: 99 },
    } },
  };
  return JSON.stringify(s);
}
const place = (over) => ({ id: 'pl1', name: 'שוק לילה לדוגמה', category: 'market', status: 'loved', lat: '13.75630', lng: '100.50180', address: 'רחוב לדוגמה 1', note: 'הערה פרטית', stopId: 's1', plannedDate: '2030-12-22', visitedDate: '2030-12-23', photoIds: [], createdAt: NOW, updatedAt: NOW, ...over });
const photo = (i, date, featured = false) => ({ id: `ph${String(i).padStart(2, '0')}`, date, dateSource: 'exif', stopId: null, caption: '', featured, width: 300, height: 200, bytes: 1000, addedAt: `2030-11-01T10:00:${String(i).padStart(2, '0')}.000Z` });

async function open(browser, { seed = null, route = 'places', viewport = MOBILE, mode = 'share', extra = {}, block = true } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: block ? 'block' : 'allow', timezoneId: 'Asia/Jerusalem', acceptDownloads: true, ...extra });
  if (seed) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
  await ctx.addInitScript(SPY, mode);
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2030-11-01T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}
const checks = (page) => page.locator('[data-slot="place-share-checks"] input').evaluateAll((els) => els.map((e) => `${e.value}:${e.checked ? 1 : 0}`));
const preview = (page) => page.locator('[data-slot="place-share-preview"]').innerText();
const status = (page) => page.locator('[data-slot="place-share-status"]').innerText();
async function openShare(page, id = 'pl1') {
  await page.click(`#panel-places [data-action="place-share"][data-place-id="${id}"]`);
  await page.locator('#dlg-place-share[open]').waitFor();
}
async function jpeg(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = 'teal'; g.fillRect(0, 0, 300, 200);
    const b = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))).arrayBuffer());
    let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
  });
}

async function beforeShots(browser) {
  for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
    const o = await open(browser, { seed: sampleState([place()]), viewport: vp });
    await o.page.screenshot({ path: `${OUT}/before-places-${name}.png`, fullPage: true });
    await o.ctx.close();
  }
}

(async () => {
  const server = spawn(process.execPath, [path.join(APP, 'scripts/serve.js')], { cwd: APP, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  if (process.env.SHOTS_ONLY === '1') {
    try { await beforeShots(browser); console.log('before shots written'); } finally { await browser.close(); server.kill(); }
    return;
  }
  try {
    // ---------- H1 (L8): only the ticked fields; note and dates start unticked ----------
    const a = await open(browser, { seed: sampleState([place()]) });
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-places-mobile.png`, fullPage: true });
    await openShare(a.page);
    const c1 = await checks(a.page);
    const p1 = await preview(a.page);
    pass('H1 share window: name, address and map link ticked; category, coordinates, dates and note offered but not ticked; preview has only the ticked fields',
      JSON.stringify(c1) === JSON.stringify(['name:1', 'category:0', 'address:1', 'coords:0', 'map:1', 'planned:0', 'visited:0', 'note:0'])
      && p1 === `שוק לילה לדוגמה\nרחוב לדוגמה 1\n${MAPS}13.75630%2C100.50180` && !/פרטית/.test(p1), { c1, p1 });
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-share-mobile.png`, fullPage: true });
    pass('H1b 390px: the share window has no sideways scroll', !(await hScroll(a.page)));
    await a.page.uncheck('[data-slot="place-share-checks"] input[value="address"]');
    await a.page.check('[data-slot="place-share-checks"] input[value="note"]');
    const p1b = await preview(a.page);

    // ---------- H2 (L8): the phone's share sheet gets exactly the preview ----------
    await a.page.click('[data-action="place-share-send"]');
    await a.page.waitForFunction(() => window.__shared.length === 1);
    const shared = await a.page.evaluate(() => window.__shared[0]);
    pass('H2 "share": the phone share sheet (WhatsApp is one of its targets) gets the title and exactly the ticked text; no outside request',
      shared.title === 'שוק לילה לדוגמה' && shared.text === p1b && p1b === `שוק לילה לדוגמה\n${MAPS}13.75630%2C100.50180\nהערה פרטית` && outside.length === 0,
      { shared, s: await status(a.page) });

    // ---------- H3 (L9): copy ----------
    await a.page.click('[data-action="place-share-copy"]');
    await a.page.waitForFunction(() => window.__copied.length === 1);
    const copied = await a.page.evaluate(() => window.__copied[0]);
    pass('H3 "copy": the same text goes to the clipboard and the window says so', copied === p1b && /הועתק/.test(await status(a.page)), { copied });
    await a.page.click('#dlg-place-share [data-close]');
    await closed(a.page, '#dlg-place-share');
    const t3 = await trip(a.page);
    pass('H3b sharing and copying change nothing in the saved place', JSON.stringify(t3.places) === JSON.stringify([place()]));
    await a.ctx.close();

    // ---------- H4 (L9): no share sheet (computer), cancelled, and clipboard refused ----------
    const none = await open(browser, { seed: sampleState([place()]), mode: 'none' });
    await openShare(none.page);
    await none.page.click('[data-action="place-share-send"]');
    await none.page.waitForFunction(() => window.__copied.length === 1);
    const noneStatus = await status(none.page);
    await none.ctx.close();
    const ab = await open(browser, { seed: sampleState([place()]), mode: 'abort' });
    await openShare(ab.page);
    await ab.page.click('[data-action="place-share-send"]');
    await ab.page.waitForFunction(() => /בוטל/.test(document.querySelector('[data-slot="place-share-status"]').textContent));
    const abCopied = await ab.page.evaluate(() => window.__copied.length);
    await ab.ctx.close();
    const nc = await open(browser, { seed: sampleState([place()]), mode: 'noclip' });
    await openShare(nc.page);
    await nc.page.click('[data-action="place-share-copy"]');
    await nc.page.waitForFunction(() => window.__copied.length === 1);
    const ncCopied = await nc.page.evaluate(() => window.__copied[0]);
    await nc.ctx.close();
    pass('H4 no share sheet: the text is copied and the window says why; cancelled: nothing copied or sent; clipboard refused: the older copy way',
      /אין כאן חלון שיתוף/.test(noneStatus) && abCopied === 0 && ncCopied === `exec:שוק לילה לדוגמה\nרחוב לדוגמה 1\n${MAPS}13.75630%2C100.50180`,
      { noneStatus, abCopied, ncCopied });

    // ---------- H5: share my current location with friends: one reading, no tracking ----------
    const g = await open(browser, { seed: sampleState([]), extra: { permissions: ['geolocation'], geolocation: { latitude: 13.7563, longitude: 100.5018, accuracy: 9 } } });
    await g.page.click('[data-action="place-here-locate"]');
    await g.page.locator('[data-action="place-here-share"]').waitFor({ state: 'visible' });
    await g.page.click('[data-action="place-here-share"]');
    await g.page.locator('#dlg-place-share[open]').waitFor();
    const p5 = await preview(g.page);
    const fileBtn = await g.page.locator('[data-action="place-share-file"]').isVisible();
    const note5 = await status(g.page);
    if (SHOTS) await g.page.screenshot({ path: `${OUT}/after-share-here-mobile.png`, fullPage: true });
    await g.page.click('[data-action="place-share-send"]');
    await g.page.waitForFunction(() => window.__shared.length === 1);
    pass('H5 share my location: one reading, then the share sheet with "my location", the coordinates and the map link; no file; says there is no tracking; nothing saved',
      p5 === `המיקום שלי\n13.756300, 100.501800\n${MAPS}13.756300%2C100.501800` && !fileBtn && /אין מעקב/.test(note5)
      && (await g.page.evaluate(() => window.__geoCalls)) === 1 && (await trip(g.page)).places.length === 0, { p5, note5 });
    await g.ctx.close();

    // ---------- H6 (L10): export what is shown; place details only ----------
    const two = [place(), place({ id: 'pl2', name: 'מקדש לדוגמה', category: 'temple', status: 'want', lat: null, lng: null, address: '', note: '', plannedDate: null, visitedDate: null, stopId: null })];
    const e = await open(browser, { seed: sampleState(two) });
    const [download] = await Promise.all([e.page.waitForEvent('download'), e.page.click('[data-action="places-export"]')]);
    const filePath = path.join(OUT, 'export-sample.json');
    await download.saveAs(filePath);
    const exported = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    pass('H6 export: a "tisa-places" file named by date with the two places, details only (no status, dates, stop or photos)',
      download.suggestedFilename() === 'tisa-places-2030-11-01.json' && exported.format === 'tisa-places' && exported.places.length === 2
      && exported.places.every((x) => JSON.stringify(Object.keys(x).sort()) === JSON.stringify(['address', 'category', 'id', 'lat', 'lng', 'name', 'note'])),
      { name: download.suggestedFilename(), keys: Object.keys(exported.places[0]) });
    // single place from the share window
    await openShare(e.page);
    const [one] = await Promise.all([e.page.waitForEvent('download'), e.page.click('[data-action="place-share-file"]')]);
    const onePath = path.join(OUT, 'export-one-sample.json');
    await one.saveAs(onePath);
    pass('H6b export of one place from the share window', JSON.parse(fs.readFileSync(onePath, 'utf8')).places.map((x) => x.id).join() === 'pl1');
    await e.ctx.close();

    // ---------- H7 (L10): import the same file twice; nothing overwritten, no duplicates ----------
    const mine = place({ id: 'mine', name: 'שלי', lat: null, lng: null, address: '', status: 'visited' });
    const im = await open(browser, { seed: sampleState([mine]) });
    await im.page.locator('#places-file').setInputFiles(filePath);
    await im.page.locator('#dlg-places-import[open]').waitFor();
    const text1 = await im.page.locator('[data-slot="places-import-text"]').innerText();
    const unchangedBeforeYes = (await trip(im.page)).places.length;
    if (SHOTS) await im.page.screenshot({ path: `${OUT}/after-import-mobile.png`, fullPage: true });
    await im.page.click('[data-action="places-import-yes"]');
    await closed(im.page, '#dlg-places-import');
    const after1 = (await trip(im.page)).places;
    await im.page.locator('#places-file').setInputFiles(filePath);
    await im.page.locator('#dlg-places-import[open]').waitFor();
    const text2 = await im.page.locator('[data-slot="places-import-text"]').innerText();
    const yes2 = await im.page.locator('[data-action="places-import-yes"]').isVisible();
    if (SHOTS) await im.page.screenshot({ path: `${OUT}/after-import-again-mobile.png`, fullPage: true });
    await im.page.click('#dlg-places-import [data-close]');
    await closed(im.page, '#dlg-places-import');
    const after2 = (await trip(im.page)).places;
    const added = after1.filter((x) => x.id !== 'mine');
    pass('H7 import: preview first (nothing saved before yes); 2 new come in as "want to visit" with no dates or stop; mine unchanged',
      /2 חדשים/.test(text1) && unchangedBeforeYes === 1 && after1.length === 3 && JSON.stringify(after1[0]) === JSON.stringify(mine)
      && added.every((x) => x.status === 'want' && x.plannedDate === null && x.visitedDate === null && x.stopId === null && x.photoIds.length === 0)
      && added[0].lat === '13.75630', { text1 });
    pass('H7b the same file again: "0 new, 2 already here", no add button, nothing changes',
      /0 חדשים/.test(text2) && /2 כבר אצלך/.test(text2) && !yes2 && JSON.stringify(after2) === JSON.stringify(after1), { text2 });

    // ---------- H8 (L10): a bad file is refused; nothing changes ----------
    await im.page.locator('#places-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"tisa-backup"}') });
    await im.page.waitForFunction(() => document.querySelector('[data-slot="places-import-error"]').textContent.length > 0);
    const err8 = await im.page.locator('[data-slot="places-import-error"]').innerText();
    pass('H8 a backup or broken file is refused with a message; nothing changes', /לא קובץ מקומות/.test(err8) && (await trip(im.page)).places.length === 3, { err8 });
    await im.ctx.close();

    // ---------- H9 (L7): link a real photo to a place; the slideshow shows it with the place name; the star is untouched ----------
    const ph = await open(browser, { seed: sampleState([place({ photoIds: [] })]), route: 'photos' });
    const jpg = Buffer.from(await jpeg(ph.page), 'base64');
    await ph.page.locator('#photo-file').setInputFiles([{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg }, { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpg }]);
    await ph.page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId].photos.length === 2; }, null, { timeout: 15000 });
    const photosBefore = (await trip(ph.page)).photos;
    await ph.page.goto(`${BASE}#/places`);
    await ph.page.locator('#panel-places').waitFor();
    await ph.page.click('#panel-places [data-action="place-edit"][data-place-id="pl1"]');
    await ph.page.locator('#dlg-place[open]').waitFor();
    await ph.page.waitForFunction(() => document.querySelectorAll('[data-slot="place-photo-pick"] img[src]').length === 2);
    const target = photosBefore[1].id;
    await ph.page.check(`[data-slot="place-photo-pick"] input[value="${target}"]`);
    if (SHOTS) await ph.page.screenshot({ path: `${OUT}/after-place-photos-mobile.png`, fullPage: true });
    await ph.page.click('[data-form="place"] [type="submit"]');
    await closed(ph.page, '#dlg-place');
    const t9 = await trip(ph.page);
    const card9 = await ph.page.locator('#panel-places .place-card').first().innerText();
    await ph.page.goto(`${BASE}#/summary`);
    await ph.page.locator('#panel-summary').waitFor();
    const strip = await ph.page.locator('[data-slot="sum-strip"] [data-photo-id]').evaluateAll((els) => els.map((x) => x.dataset.photoId));
    const note9 = await ph.page.locator('[data-slot="sum-show-note"]').innerText();
    await ph.page.click('[data-action="show-play"]');
    await ph.page.locator('#dlg-show[open]').waitFor();
    await ph.page.waitForFunction(() => document.querySelector('[data-slot="show-caption"]').textContent.length > 0);
    const caption = await ph.page.locator('[data-slot="show-caption"]').innerText();
    if (SHOTS) await ph.page.screenshot({ path: `${OUT}/after-slide-place-mobile.png` });
    pass('H9 a photo linked to a place (by id, no copy) joins the slideshow with the place name; no star changed; photos not copied',
      JSON.stringify(t9.places[0].photoIds) === JSON.stringify([target]) && /תמונה אחת/.test(card9)
      && JSON.stringify(t9.photos) === JSON.stringify(photosBefore) && t9.photos.every((x) => x.featured === false)
      && JSON.stringify(strip) === JSON.stringify([target]) && /מקומות שמורים/.test(note9) && /שוק לילה לדוגמה/.test(caption),
      { strip, note9, caption });
    await ph.ctx.close();

    // ---------- H10 (L7): 12 in all, starred first; the star limit and marks unchanged ----------
    const many = [...Array.from({ length: 10 }, (_, i) => photo(i, `2030-12-${String(21 + i).padStart(2, '0')}`, true)), ...Array.from({ length: 5 }, (_, i) => photo(20 + i, `2030-12-2${i + 1}`))];
    const s10 = sampleState([place({ photoIds: many.slice(10).map((x) => x.id) })], many);
    const m = await open(browser, { seed: s10, route: 'summary' });
    await m.page.locator('#panel-summary').waitFor();
    const strip10 = await m.page.locator('[data-slot="sum-strip"] [data-photo-id]').evaluateAll((els) => els.map((x) => x.dataset.photoId));
    const t10 = await trip(m.page);
    pass('H10 10 starred + 5 place photos: 12 in the slideshow (all 10 starred, then the first 2 place photos by date); every star as it was',
      strip10.length === 12 && many.filter((x) => x.featured).every((x) => strip10.includes(x.id)) && strip10.filter((x) => x.startsWith('ph2')).join() === 'ph20,ph21'
      && JSON.stringify(t10.photos.map((x) => x.featured)) === JSON.stringify(many.map((x) => x.featured)), { strip10 });
    await m.ctx.close();

    // ---------- H11 (L12): airplane mode with the service worker: share text, copy and import work ----------
    {
      const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;
      const o = await open(browser, { seed: sampleState([place()]), block: false });
      await o.page.evaluate(() => navigator.serviceWorker.ready);
      await o.page.reload();
      await o.page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
      const cached = await o.page.evaluate(async (v) => !!(await (await caches.open(`tisa-${v}`)).match('./src/js/core/place-share.js')), version);
      await o.ctx.setOffline(true);
      await o.page.reload();
      await ready(o.page);
      await openShare(o.page);
      await o.page.click('[data-action="place-share-copy"]');
      await o.page.waitForFunction(() => window.__copied.length === 1);
      await o.page.click('#dlg-place-share [data-close]');
      await closed(o.page, '#dlg-place-share');
      await o.page.locator('#places-file').setInputFiles(filePath);
      await o.page.locator('#dlg-places-import[open]').waitFor();
      const off = await o.page.locator('[data-slot="places-import-text"]').innerText();
      pass('H11 airplane mode (service worker): place-share.js cached; copy works; an import file is read offline (1 new, 1 already here)',
        cached && /1 חדשים/.test(off) && /1 כבר אצלך/.test(off), { off, version });
      await o.ctx.close();
    }

    // ---------- H12 (L13): desktop, and every new field has a name ----------
    const w = await open(browser, { seed: sampleState([place()]), viewport: DESKTOP });
    if (SHOTS) await w.page.screenshot({ path: `${OUT}/after-places-desktop.png`, fullPage: true });
    await openShare(w.page);
    if (SHOTS) await w.page.screenshot({ path: `${OUT}/after-share-desktop.png` });
    const unnamed = await w.page.evaluate(() => [...document.querySelectorAll('#dlg-place-share input, #panel-places input:not([type="file"]), #panel-places select')]
      .filter((e) => !(e.labels?.length || e.getAttribute('aria-label'))).map((e) => e.outerHTML.slice(0, 80)));
    const fileName = await w.page.locator('#places-file').getAttribute('aria-label');
    pass('H12 desktop: no sideways scroll; every field in the share window and the screen has a name (the hidden file input too)',
      !(await hScroll(w.page)) && unnamed.length === 0 && !!fileName, { unnamed, fileName });
    await w.ctx.close();
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    for (const f of ['export-sample.json', 'export-one-sample.json']) fs.rmSync(path.join(OUT, f), { force: true });
    pass('no JS errors, no outside requests', errors.length === 0 && outside.length === 0, { errors, outside });
    fs.writeFileSync(`${OUT}/places-share-browser.json`, JSON.stringify(results, null, 2));
    for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
    await browser.close();
    server.kill();
    process.exitCode = Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1;
  }
})();
