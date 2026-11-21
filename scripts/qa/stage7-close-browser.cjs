// Stage 7 closing checks in a real browser (docs/GOALS_STAGE7.md, "סגירה"), before the iPhone round:
// C1 the stored file is a real JPEG (markers, decodes, long side <= 1280, PNG in -> JPEG out)
// C2 the slideshow holds at most 12: a 13th star is refused with a message, the slideshow shows 12
// C3 restoring the same photo ZIP twice: no duplicates, nothing deleted
// C4 JSON backup -> restore keeps the photo details and does not touch the files in IndexedDB
// C5 app update on an installed copy: no reload before the tap, then the new version in settings,
//    old cache gone, localStorage data and IndexedDB photos kept
// Sample data only (tests/fixtures/v4-stage6.json). Waits for UI state (rule 6). Run 3 times.
// Writes only to QA_OUT, default docs/evidence/stage7-close/browser (rule 10). Ports 8124 and 8125.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage7-close/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const seed = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v4-stage6.json'), 'utf8');
const serve = (dir, port) => spawn(process.execPath, [path.join(dir, 'scripts/serve.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
const idbIds = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('tisa-photos');
  r.onsuccess = () => {
    if (!r.result.objectStoreNames.contains('photos')) { res([]); return; }
    const g = r.result.transaction('photos').objectStore('photos').getAllKeys();
    g.onsuccess = () => res(g.result.sort());
  };
  r.onerror = () => res([]);
}));
const toastText = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="toast"]')?.classList.contains('show')); return page.locator('[data-slot="toast"]').innerText(); };
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 6000 }).catch(() => {});
/** A picture made by the real canvas, returned as bytes. */
const picture = (page, w, h, type) => page.evaluate(async ({ w, h, type }) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, 'teal'); grad.addColorStop(1, 'orange');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
  return [...new Uint8Array(await blob.arrayBuffer())];
}, { w, h, type });

(async () => {
  const s1 = serve(ROOT, 8124);
  await wait(700);
  const browser = await chromium.launch();
  const BASE = 'http://127.0.0.1:8124/';
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem', acceptDownloads: true });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
    const page = await ctx.newPage();
    watch(page);
    await page.clock.setFixedTime(new Date('2026-12-11T10:00:00+07:00'));
    await page.goto(`${BASE}#/photos`);
    await ready(page);

    // C1: a 2000x1500 PNG goes in; what is stored must be a JPEG that decodes, long side 1280.
    const png = Buffer.from(await picture(page, 2000, 1500, 'image/png'));
    await page.locator('#photo-file').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb img[src]').length === 1, null, { timeout: 15000 });
    const p0 = (await trip(page)).photos[0];
    const jpeg = await page.evaluate((id) => new Promise((res) => {
      const r = indexedDB.open('tisa-photos');
      r.onsuccess = () => {
        const g = r.result.transaction('photos').objectStore('photos').get(id);
        g.onsuccess = async () => {
          const b = new Uint8Array(g.result.full);
          let bmp = null;
          try { bmp = await createImageBitmap(new Blob([b], { type: 'image/jpeg' })); } catch { bmp = null; }
          res({ type: g.result.type, soi: b[0] === 0xff && b[1] === 0xd8, eoi: b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9, w: bmp?.width, h: bmp?.height, bytes: b.length });
        };
      };
    }), p0.id);
    pass('C1 stored file is a real JPEG that decodes, long side 1280', jpeg.type === 'image/jpeg' && jpeg.soi && jpeg.eoi && jpeg.w === 1280 && jpeg.h === 960 && p0.width === 1280 && p0.height === 960 && p0.bytes === jpeg.bytes, { jpeg, meta: { w: p0.width, h: p0.height, bytes: p0.bytes } });

    // C2: 12 photos already starred, 13 in all; starring the 13th is refused and the slideshow shows 12.
    const small = await picture(page, 120, 90, 'image/jpeg');
    await page.evaluate(async ({ bytes, first }) => {
      const buf = new Uint8Array(bytes).buffer;
      await new Promise((res) => {
        const r = indexedDB.open('tisa-photos');
        r.onsuccess = () => {
          const tx = r.result.transaction('photos', 'readwrite');
          for (let i = 1; i <= 12; i += 1) tx.objectStore('photos').put({ id: `s${i}`, type: 'image/jpeg', full: buf.slice(0), thumb: buf.slice(0) });
          tx.oncomplete = res;
        };
      });
      const s = JSON.parse(localStorage.getItem('tisa:v1'));
      const t = s.trips[s.activeTripId];
      for (let i = 1; i <= 12; i += 1) {
        t.photos.push({ id: `s${i}`, date: `2026-12-${String(5 + i).padStart(2, '0')}`, dateSource: 'exif', stopId: null, caption: '', featured: true, width: 120, height: 90, bytes: bytes.length, addedAt: `2026-12-0${i % 9}T00:00:00Z` });
      }
      localStorage.setItem('tisa:v1', JSON.stringify(s));
    }, { bytes: small, first: p0.id });
    await page.reload();
    await ready(page);
    await page.locator(`#panel-photos [data-photo-id="${p0.id}"]`).click();
    await page.locator('#dlg-photo[open]').waitFor();
    await page.check('#dlg-photo [name="featured"]');
    await page.click('#dlg-photo [type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#dlg-photo').open || document.querySelector('#dlg-photo .form-error').textContent.trim() !== '');
    const stillOpen = await page.locator('#dlg-photo[open]').count();
    const refusal = stillOpen ? await page.locator('#dlg-photo .form-error').innerText() : '';
    if (SHOTS) await page.screenshot({ path: `${OUT}/c2-13th-refused-mobile.png` });
    if (stillOpen) await page.click('#dlg-photo [data-close]');
    const starred = (await trip(page)).photos.filter((p) => p.featured).length;
    await page.goto(`${BASE}#/summary`);
    await page.click('[data-action="show-play"]');
    await page.locator('#dlg-show[open]').waitFor();
    const count = await page.locator('[data-slot="show-count"]').innerText();
    await page.keyboard.press('Escape');
    pass('C2 slideshow holds at most 12; the 13th star is refused with a message', /12/.test(refusal) && stillOpen === 1 && starred === 12 && /\/ 12$/.test(count.trim()), { refusal, starred, count });

    // C3: export the photo ZIP, then restore it twice: nothing doubled, nothing deleted.
    await page.goto(`${BASE}#/settings`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="photos-export"]')]);
    const zipPath = path.join(OUT, 'c3-photos.zip');
    await dl.saveAs(zipPath);
    await toastGone(page);
    const before = { meta: (await trip(page)).photos.map((p) => p.id).sort(), files: await idbIds(page) };
    const msgs = [];
    for (let i = 0; i < 2; i += 1) {
      await page.locator('#photos-import-file').setInputFiles(zipPath);
      msgs.push(await toastText(page));
      await toastGone(page);
    }
    const after = { meta: (await trip(page)).photos.map((p) => p.id).sort(), files: await idbIds(page) };
    pass('C3 restoring twice: no duplicates, nothing deleted', before.meta.length === 13 && JSON.stringify(after) === JSON.stringify(before) && new Set(after.meta).size === after.meta.length && msgs.every((m) => /כבר בטלפון/.test(m)), { before: before.meta.length, after: after.meta.length, files: after.files.length, msgs });

    // C4: JSON backup -> restore keeps the photo details; the files in IndexedDB stay.
    const [jdl] = await Promise.all([page.waitForEvent('download'), page.click('#panel-settings [data-action="export"]')]);
    const jsonPath = path.join(OUT, 'c4-backup.json');
    await jdl.saveAs(jsonPath);
    await toastGone(page);
    const photosBefore = (await trip(page)).photos;
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); s.trips[s.activeTripId].photos = []; localStorage.setItem('tisa:v1', JSON.stringify(s)); });
    await page.reload();
    await ready(page);
    await page.locator('#import-file').setInputFiles(jsonPath);
    await page.locator('#dlg-import[open]').waitFor();
    await page.click('[data-action="import-confirm"]');
    await toastText(page);
    const photosAfter = (await trip(page)).photos;
    const filesAfter = await idbIds(page);
    const fileHasPhotos = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).data.trips.t.photos.length;
    pass('C4 JSON backup and restore keep the photo details; files untouched', fileHasPhotos === 13 && JSON.stringify(photosAfter) === JSON.stringify(photosBefore) && filesAfter.length === 13 && !/data:image|base64/.test(fs.readFileSync(jsonPath, 'utf8')), { fileHasPhotos, after: photosAfter.length, files: filesAfter.length });
    await ctx.close();
  } catch (error) {
    pass('run part 1', false, { error: String(error.stack ?? error) });
  }

  // C5: an installed copy (real service worker) gets a new version.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'tisa-close-update-'));
  let s2 = null;
  try {
    fs.cpSync(ROOT, copy, { recursive: true, filter: (src) => !/[\\/](\.git|docs)([\\/]|$)/.test(src) });
    s2 = serve(copy, 8125);
    await wait(700);
    const URL2 = 'http://127.0.0.1:8125/';
    const oldVersion = JSON.parse(fs.readFileSync(path.join(copy, 'config/app.config.json'), 'utf8')).appVersion;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce' });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${URL2}#/photos`);
    await ready(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
    const shownBefore = await page.locator('[data-slot="version-app"]').textContent();
    await page.locator('#photo-file').setInputFiles({ name: 'u.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await picture(page, 300, 200, 'image/jpeg')) });
    await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb img[src]').length === 1, null, { timeout: 15000 });
    const dataBefore = await trip(page);
    const filesBefore = await idbIds(page);
    const cachesBefore = await page.evaluate(() => caches.keys());
    // Publish a new version on the "server": the version in all three places, as a real release does.
    const NEW = '9.9.9-test';
    for (const [f, re, to] of [['sw.js', /const VERSION = '[^']+'/, `const VERSION = '${NEW}'`], ['config/app.config.json', /"appVersion": "[^"]+"/, `"appVersion": "${NEW}"`], ['package.json', /"version": "[^"]+"/, `"version": "${NEW}"`]]) {
      const file = path.join(copy, f);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(re, to));
    }
    await page.evaluate(() => { window.__noReload = 'still-here'; });
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
    const bannerShown = await page.waitForSelector('.banner [data-action="update"]', { timeout: 15000 }).then(() => true, () => false);
    await wait(1500); // the new worker is installed and waiting: the page must not reload by itself
    const noReload = await page.evaluate(() => window.__noReload === 'still-here');
    if (SHOTS) await page.screenshot({ path: `${OUT}/c5-update-banner-mobile.png` });
    if (bannerShown && noReload) await Promise.all([page.waitForEvent('load'), page.click('.banner [data-action="update"]')]);
    await ready(page);
    await page.goto(`${URL2}#/settings`);
    await ready(page);
    const shownAfter = await page.locator('[data-slot="version-app"]').textContent();
    const cachesAfter = await page.evaluate(() => caches.keys());
    const dataAfter = await trip(page);
    const filesAfter = await idbIds(page);
    if (SHOTS) await page.screenshot({ path: `${OUT}/c5-settings-after-update-mobile.png` });
    pass('C5 update: banner, no reload before the tap, new version shown, old cache gone, data and photos kept',
      bannerShown && noReload && shownBefore === oldVersion && shownAfter === NEW && cachesAfter.includes(`tisa-${NEW}`) && !cachesAfter.includes(cachesBefore[0])
      && JSON.stringify(dataAfter.photos) === JSON.stringify(dataBefore.photos) && JSON.stringify(dataAfter.expenses) === JSON.stringify(dataBefore.expenses)
      && JSON.stringify(filesAfter) === JSON.stringify(filesBefore) && filesAfter.length === 1,
      { bannerShown, noReload, shownBefore, shownAfter, cachesBefore, cachesAfter, photos: dataAfter.photos.length, files: filesAfter.length });
    await ctx.close();
  } catch (error) {
    pass('run part 2', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    await browser.close();
    s1.kill();
    s2?.kill();
    fs.rmSync(copy, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(OUT, 'browser-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
