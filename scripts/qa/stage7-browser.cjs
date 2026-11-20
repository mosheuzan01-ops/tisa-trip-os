// Stage 7 browser checks (docs/GOALS_STAGE7.md S7-1..S7-6, S7-8, S7-11 part). Real app, real IndexedDB, real canvas.
// 390px for the flow, 1280px for layout. Waits for UI state, not fixed sleeps (rule 6). Run 3 times before PASS.
// Writes only to QA_OUT, default docs/evidence/stage7/browser (rule 10). Run from the repo root (port 8121).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage7/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8121);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const bag = { errors: [], external: [] };
const seed = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v4-stage6.json'), 'utf8');

/** Put an EXIF block (DateTimeOriginal) right after the JPEG's start marker. Same layout as tests/stage7-core.test.js. */
function withExif(jpeg, dateText) {
  const tiff = [];
  const u16 = (v) => [v & 255, v >> 8];
  const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24];
  tiff.push(0x49, 0x49, ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(44), ...u32(0));
  tiff.push(...[...dateText].map((c) => c.charCodeAt(0)), 0);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1, len >> 8, len & 255, ...app1]), jpeg.subarray(2)]);
}

function watch(page) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const stored = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
const idb = (page, id) => page.evaluate((key) => new Promise((res) => {
  const r = indexedDB.open('tisa-photos');
  r.onsuccess = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('photos')) { res(null); return; }
    const g = db.transaction('photos').objectStore('photos').get(key);
    g.onsuccess = () => res(g.result ? { full: g.result.full.byteLength, thumb: g.result.thumb.byteLength, type: g.result.type } : null);
    g.onerror = () => res(null);
  };
  r.onerror = () => res(null);
}), id);
const thumbsLoaded = (page, scope) => page.waitForFunction((sel) => {
  const imgs = [...document.querySelectorAll(`${sel} img`)];
  return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
}, scope, { timeout: 8000 });
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

async function open(browser, viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem', acceptDownloads: true, ...extra });
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2026-12-11T10:00:00+07:00'));
  return { ctx, page };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  try {
    const { ctx, page } = await open(browser, { width: 390, height: 844 });
    await page.goto(`${BASE}#/photos`);
    await ready(page);
    pass('B7-0 photos screen opens', await page.locator('#panel-photos').isVisible());

    // Test images, made by the real canvas: a small one (EXIF 2026-12-06) and a 10 MB+ noisy one.
    const make = (w, h, q) => page.evaluate(async ({ w, h, q }) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); const img = g.createImageData(w, h);
      let s = 7; for (let i = 0; i < img.data.length; i += 1) { s = (s * 1103515245 + 12345) & 0x7fffffff; img.data[i] = i % 4 === 3 ? 255 : s & 255; }
      g.putImageData(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      const b = new Uint8Array(await blob.arrayBuffer()); let out = ''; for (let i = 0; i < b.length; i += 0x8000) out += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(out);
    }, { w, h, q });
    const small = withExif(Buffer.from(await make(400, 300, 0.8), 'base64'), '2026:12:06 18:22:10');
    const big = withExif(Buffer.from(await make(4200, 3000, 0.97), 'base64'), '2026:11:01 12:00:00'); // before the route
    const input = page.locator('#photo-file');

    // S7-4 (in route): the EXIF date puts the photo on 6 Dec, Bangkok.
    await input.setInputFiles({ name: 'sunset.jpg', mimeType: 'image/jpeg', buffer: small });
    await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb').length === 1, null, { timeout: 15000 });
    const g1 = page.locator('[data-photo-group="2026-12-06"]');
    const place1 = await g1.locator('[data-slot="photo-group-place"]').innerText().catch(() => '');
    let trip = await stored(page);
    const p1 = trip.photos?.[0];
    pass('S7-4 auto place by EXIF date', (await g1.count()) === 1 && /בנגקוק/.test(place1) && p1?.date === '2026-12-06' && p1?.dateSource === 'exif' && p1?.stopId === null, { place1, p1 });

    // S7-2: 10 MB+ file is stored under 600 KB, long side 1280.
    await input.setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer: big });
    await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb').length === 2, null, { timeout: 30000 });
    trip = await stored(page);
    const p2 = trip.photos.find((x) => x.id !== p1.id);
    const rec2 = await idb(page, p2.id);
    pass('S7-2 10 MB compressed under 600 KB', big.length >= 10 * 1024 * 1024 && rec2 && rec2.full < 600 * 1024 && Math.max(p2.width, p2.height) === 1280 && p2.bytes === rec2.full, { original: big.length, stored: rec2?.full, w: p2.width, h: p2.height });

    // S7-4 (outside): a file date before the trip shows under "not assigned".
    const un = page.locator('[data-photo-group="unassigned"]');
    pass('S7-4 outside the route is shown as not assigned', (await un.locator(`[data-photo-id="${p2.id}"]`).count()) === 1 && p2.date === '2026-11-01', { date: p2.date });

    // S7-3: no image data in localStorage, only ids and metadata.
    const ls = await page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'));
    pass('S7-3 no image data in localStorage', !/data:image|data:[^"]*;base64/.test(ls) && !/[A-Za-z0-9+/]{200,}/.test(ls), { bytes: ls.length });

    // S7-1: survives a reload; thumbnails come back from IndexedDB.
    await page.reload();
    await ready(page);
    await thumbsLoaded(page, '#panel-photos');
    pass('S7-1 survives a reload', (await page.locator('#panel-photos .photo-thumb img').count()) === 2);
    if (SHOTS) await page.screenshot({ path: `${OUT}/photos-mobile.png`, fullPage: true });

    // Calendar: the day shows its photo.
    await page.goto(`${BASE}#/calendar`);
    await page.locator('#panel-calendar [data-date="2026-12-06"] .cal-photo').first().waitFor();
    await thumbsLoaded(page, '#panel-calendar [data-date="2026-12-06"] .cal-photos');
    pass('B7-1 calendar day shows its photos', (await page.locator('#panel-calendar [data-date="2026-12-06"] .cal-photo').count()) === 1 && (await page.locator('#panel-calendar [data-date="2026-11-01"]').count()) === 0);

    // Edit: move the unassigned photo to 9 Dec, it lands in Chiang Mai; star it for the slideshow.
    await page.goto(`${BASE}#/photos`);
    await page.locator(`#panel-photos [data-photo-id="${p2.id}"]`).click();
    await page.locator('#dlg-photo[open]').waitFor();
    await page.fill('#dlg-photo [name="date"]', '2026-12-09');
    await page.fill('#dlg-photo [name="caption"]', 'שוק לילה');
    await page.check('#dlg-photo [name="featured"]');
    if (SHOTS) await page.screenshot({ path: `${OUT}/photo-dialog-mobile.png` });
    await page.click('#dlg-photo [type="submit"]');
    await page.waitForSelector('#dlg-photo:not([open])', { state: 'attached' });
    trip = await stored(page);
    const e2 = trip.photos.find((x) => x.id === p2.id);
    const place2 = await page.locator('[data-photo-group="2026-12-09"] [data-slot="photo-group-place"]').innerText().catch(() => '');
    pass('B7-2 edit date, caption and star', e2.date === '2026-12-09' && e2.dateSource === 'manual' && e2.caption === 'שוק לילה' && e2.featured === true && /צ'יאנג מאי/.test(place2), { e2, place2 });

    // S7-6 and slideshow: summary numbers equal the money screen, category by category.
    await page.goto(`${BASE}#/money`);
    await page.locator('#panel-money li.cat[data-cat]').first().waitFor();
    const money = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#panel-money [data-slot="cat-list"] li.cat[data-cat]')]
      .map((li) => [li.dataset.cat, { plan: Number(li.dataset.planMinor), used: Number(li.dataset.usedMinor) }])));
    await page.goto(`${BASE}#/summary`);
    await page.locator('#panel-summary [data-slot="sum-table"] tr[data-row]').first().waitFor();
    const sum = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#panel-summary [data-slot="sum-table"] tr[data-row]')].map((tr) => {
      const v = (c) => Number(tr.querySelector(`[data-col="${c}"]`)?.dataset.minor);
      return [tr.dataset.row, { plan: v('plan'), paid: v('paid'), planned: v('planned'), committed: v('committed'), free: v('free') }];
    })));
    const ids = Object.keys(money).filter((id) => money[id].plan > 0 || money[id].used > 0); // 0 / 0 categories are not table rows
    const totalPlan = Object.values(money).reduce((n, x) => n + x.plan, 0);
    const same = ids.length > 0 && sum.total?.plan === totalPlan && ids.every((id) => sum[id] && sum[id].plan === money[id].plan && sum[id].paid + sum[id].planned + sum[id].committed === money[id].used && sum[id].free === money[id].plan - money[id].used);
    pass('S7-6 summary equals the money screen in every category', same, { money, sum });
    const days = await page.locator('[data-slot="sum-days"]').innerText();
    pass('B7-3 summary shows days and places', /30/.test(days) && (await page.locator('[data-slot="sum-places"] li').count()) === 2, { days });
    if (SHOTS) await page.screenshot({ path: `${OUT}/summary-mobile.png`, fullPage: true });
    await page.click('[data-action="show-play"]');
    await page.locator('#dlg-show[open]').waitFor();
    await page.waitForFunction(() => { const i = document.querySelector('#dlg-show [data-slot="show-img"]'); return i?.complete && i.naturalWidth > 0; });
    const cap = await page.locator('#dlg-show [data-slot="show-caption"]').innerText();
    pass('B7-4 slideshow shows the starred photo', /שוק לילה/.test(cap), { cap });
    if (SHOTS) await page.screenshot({ path: `${OUT}/slideshow-mobile.png` });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#dlg-show:not([open])', { state: 'attached' });

    // S7-8: export the photo ZIP, wipe the photo database, import it back.
    await page.goto(`${BASE}#/settings`);
    const sizeText = await page.locator('[data-slot="photos-size"]').innerText();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="photos-export"]')]);
    const zipPath = path.join(OUT, 'photos-backup.zip');
    await dl.saveAs(zipPath);
    const zip = fs.readFileSync(zipPath);
    const hasJson = zip.includes(Buffer.from('photos.json')) && zip.includes(Buffer.from(`photos/${p1.id}.jpg`));
    await page.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase('tisa-photos'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
    await page.reload();
    await ready(page);
    const gone = await idb(page, p1.id);
    await page.goto(`${BASE}#/photos`);
    await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb.is-missing').length === 2, null, { timeout: 5000 }).catch(() => {});
    const missing = await page.locator('#panel-photos .photo-thumb.is-missing').count();
    await page.goto(`${BASE}#/settings`);
    await page.locator('#photos-import-file').setInputFiles(zipPath);
    await page.waitForFunction(() => document.querySelector('[data-slot="toast"]')?.classList.contains('show'));
    const back1 = await idb(page, p1.id);
    const back2 = await idb(page, p2.id);
    await page.goto(`${BASE}#/photos`);
    await thumbsLoaded(page, '#panel-photos');
    trip = await stored(page);
    pass('S7-8 photo backup round trip', dl.suggestedFilename().endsWith('.zip') && /KB|MB/.test(sizeText) && hasJson && gone === null && missing === 2
      && back1?.full > 0 && back2?.full === rec2.full && trip.photos.length === 2 && (await page.locator('#panel-photos .photo-thumb.is-missing').count()) === 0,
    { file: dl.suggestedFilename(), sizeText, missing, back1, back2 });

    // S7-5: delete asks first; cancel keeps it; yes removes it from the list and from IndexedDB.
    await page.locator(`#panel-photos [data-photo-id="${p1.id}"]`).click();
    await page.locator('#dlg-photo[open]').waitFor();
    await page.click('#dlg-photo [data-action="photo-delete"]');
    await page.locator('#dlg-photo-delete[open]').waitFor();
    if (SHOTS) await page.screenshot({ path: `${OUT}/photo-delete-mobile.png` });
    await page.click('#dlg-photo-delete [data-close]');
    await page.waitForSelector('#dlg-photo-delete:not([open])', { state: 'attached' });
    const kept = (await stored(page)).photos.length === 2 && (await idb(page, p1.id)) !== null;
    await page.locator(`#panel-photos [data-photo-id="${p1.id}"]`).click();
    await page.click('#dlg-photo [data-action="photo-delete"]');
    await page.click('#dlg-photo-delete [data-action="photo-delete-yes"]');
    await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb').length === 1);
    await page.waitForFunction(async (id) => new Promise((res) => { const r = indexedDB.open('tisa-photos'); r.onsuccess = () => { const g = r.result.transaction('photos').objectStore('photos').get(id); g.onsuccess = () => res(!g.result); }; }), p1.id);
    pass('S7-5 delete asks, then removes from IndexedDB too', kept && (await stored(page)).photos.length === 1 && (await idb(page, p1.id)) === null, { kept });

    pass('S7-11 390px: no horizontal scroll on the new screens', !(await hScroll(page)));
    // S7-11: tap targets 44px and text 14px on the new screens and dialogs (visible elements only).
    const sizes = async () => page.evaluate(() => {
      const bad = [];
      for (const n of document.querySelectorAll('main .panel:not([hidden]) button, main .panel:not([hidden]) a, dialog[open] button, dialog[open] input, dialog[open] select')) {
        const r = n.getBoundingClientRect();
        if (r.width && r.height && (r.height < 44 || r.width < 44) && n.type !== 'checkbox') bad.push(`${n.className || n.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      for (const n of document.querySelectorAll('main .panel:not([hidden]) *, dialog[open] *')) {
        if (![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
        const r = n.getBoundingClientRect(); const fs = parseFloat(getComputedStyle(n).fontSize);
        if (r.width && fs < 14) bad.push(`font ${fs}px: ${n.textContent.trim().slice(0, 20)}`);
      }
      return bad;
    });
    const bad = [];
    for (const r of ['photos', 'summary', 'calendar']) { await page.goto(`${BASE}#/${r}`); await page.waitForTimeout(150); bad.push(...(await sizes()).map((x) => `${r} ${x}`)); }
    await page.goto(`${BASE}#/photos`);
    await page.locator('#panel-photos .photo-thumb').first().click();
    await page.locator('#dlg-photo[open]').waitFor();
    bad.push(...(await sizes()).map((x) => `dlg-photo ${x}`));
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}#/summary`);
    await page.click('[data-action="show-play"]');
    await page.locator('#dlg-show[open]').waitFor();
    bad.push(...(await sizes()).map((x) => `dlg-show ${x}`));
    await page.keyboard.press('Escape');
    pass('S7-11 390px: tap targets 44px, text 14px', bad.length === 0, { bad: [...new Set(bad)].slice(0, 30) });
    await ctx.close();

    // Storage nearly full: the photos screen warns.
    const w = await open(browser, { width: 390, height: 844 });
    await w.ctx.addInitScript(() => { Object.defineProperty(navigator, 'storage', { value: { estimate: async () => ({ usage: 900e6, quota: 1000e6 }), persisted: async () => true, persist: async () => true } }); });
    await w.page.goto(`${BASE}#/photos`);
    await ready(w.page);
    await w.page.locator('[data-slot="photo-storage-warn"]:not([hidden])').waitFor({ timeout: 5000 }).catch(() => {});
    pass('B7-5 storage warning near the limit', await w.page.locator('[data-slot="photo-storage-warn"]').isVisible());
    await w.ctx.close();

    // Desktop layout of the new screens.
    const d = await open(browser, { width: 1280, height: 800 });
    for (const r of ['photos', 'summary']) {
      await d.page.goto(`${BASE}#/${r}`);
      await ready(d.page);
      if (SHOTS) await d.page.screenshot({ path: `${OUT}/${r}-desktop.png`, fullPage: true });
    }
    pass('B7-6 desktop: no horizontal scroll', !(await hScroll(d.page)));
    await d.ctx.close();
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('S7-11 no JS errors', bag.errors.length === 0, { errors: bag.errors });
    pass('no external requests', bag.external.length === 0, { external: bag.external });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'browser-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
