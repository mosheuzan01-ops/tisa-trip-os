// Diagnostic: L10's exact steps, with the SW precache made slow on purpose (a proxy delays the one file that only the
// SW precache fetches: the Supabase vendor bundle). MODE=asis: L10 as written. MODE=realwait: the same steps, but the wait
// for "activated" really waits (navigator.serviceWorker.ready, then a sync check of the controller). App code untouched.
const ROOT = '/home/user/tisa-trip-os';
const { chromium } = require(require.resolve('playwright', { paths: [ROOT] }));
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { sampleState } = require(path.join(ROOT, 'scripts/qa/lib/sample-trip.cjs'));
const UP = 8374, PORT = 8373, BASE = `http://127.0.0.1:${PORT}/`;
const DELAY = Number(process.env.DELAY ?? 0), N = Number(process.env.N ?? 5), MODE = process.env.MODE ?? 'asis';
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
(async () => {
  const up = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(UP) }, stdio: 'ignore' });
  const proxy = http.createServer((req, res) => {
    const go = () => { const u = http.request({ host: '127.0.0.1', port: UP, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); u.on('error', () => res.destroy()); req.pipe(u); };
    if (req.url.includes('/vendor/supabase/')) setTimeout(go, DELAY); else go();
  }).listen(PORT, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  let fail = 0;
  for (let i = 0; i < N; i++) {
    const st = await sampleState();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', acceptDownloads: true });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(st));
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2030-12-10T10:00:00+07:00'));
    await page.goto(`${BASE}#/smart-bag`); await ready(page);
    const t = Date.now();
    if (MODE === 'asis') await page.waitForFunction(async () => (await navigator.serviceWorker?.getRegistration())?.active?.state === 'activated');
    else { await page.evaluate(() => navigator.serviceWorker.ready); }
    const waited = Date.now() - t;
    const stAfterWait = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { installing: r?.installing?.state ?? null, active: r?.active?.state ?? null }; });
    await page.reload(); await ready(page);
    if (MODE !== 'asis') await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const ctl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    let res = 'PASS';
    try { await page.reload(); await ready(page); await page.waitForFunction(() => !document.querySelector('#panel-smart-bag').hidden && document.querySelectorAll('[data-slot="sbag-must"] .sbag-item').length > 0, null, { timeout: 10000 }); }
    catch (e) { res = `FAIL ${String(e.message).split('\n')[0]}`; fail++; }
    console.log(JSON.stringify({ i, MODE, DELAY, waitedMs: waited, stAfterWait, controllerBeforeOffline: ctl, res }));
    await ctx.close();
  }
  console.log(`SUMMARY MODE=${MODE} DELAY=${DELAY} n=${N} fail=${fail}`);
  await browser.close(); proxy.close(); up.kill();
})();
