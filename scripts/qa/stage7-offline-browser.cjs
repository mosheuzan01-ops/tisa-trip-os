// S7-10: Stage 7 works in airplane mode. Real service worker (not blocked), cache "tisa-<version>" holds the new
// files, then offline: reload, open photos and summary, add a photo. QA_OUT default docs/evidence/stage7/offline.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage7/offline');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8122);
const BASE = `http://127.0.0.1:${PORT}/`;
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(BASE);
    await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    const cached = await page.evaluate(async (v) => {
      const c = await caches.open(`tisa-${v}`);
      const want = ['photo-store.js', 'photos-view.js', 'summary-view.js', 'core/photos.js', 'core/zip.js', 'core/photo-backup.js', 'core/summary.js'];
      const out = {};
      for (const f of want) out[f] = !!(await c.match(`./src/js/${f}`));
      return { keys: await caches.keys(), out };
    }, version);
    pass('S7-10 cache has every Stage 7 file', cached.keys.includes(`tisa-${version}`) && Object.values(cached.out).every(Boolean), cached);

    await ctx.setOffline(true);
    await page.goto(`${BASE}#/photos`);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    const v = await page.locator('[data-slot="version-app"]').textContent();
    pass('S7-10 offline: app opens with the new version', v === version, { v });
    pass('S7-10 offline: photos screen', await page.locator('#panel-photos').isVisible());
    const jpg = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 200;
      const g = c.getContext('2d'); g.fillStyle = 'teal'; g.fillRect(0, 0, 300, 200);
      const b = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8))).arrayBuffer());
      let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
    });
    await page.locator('#photo-file').setInputFiles({ name: 'offline.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg, 'base64') });
    await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb img[src]').length === 1, null, { timeout: 15000 });
    pass('S7-10 offline: a photo can be added', true);
    await page.goto(`${BASE}#/summary`);
    pass('S7-10 offline: summary screen', await page.locator('#panel-summary').isVisible() && (await page.locator('[data-slot="sum-photos"]').innerText()) === '1');
    await page.screenshot({ path: `${OUT}/offline-summary-mobile.png` });
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'offline-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, x]) => x.result !== 'PASS');
  for (const [k, x] of Object.entries(results)) console.log(`${x.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
