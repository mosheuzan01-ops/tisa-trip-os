// Stage 9 PR 3 browser checks (docs/GOALS_STAGE9.md, PR 3): the LATISA name, the icon in the top bar, the full
// logo on the dark About card in Settings, brand.html (light logo on light, dark logo on dark), every site and
// PWA icon loads, the masks keep the plane and the pin, 390px with no sideways scroll, readable text on the
// About card, and offline use through the service worker. Real v5 sample data (tests/fixtures).
// Waits for UI state (rule 6). Run 3 times.
// QA_OUT (default docs/evidence/stage9/pr3/browser), PORT (default 8131). SHOTS=0 skips screenshots.
// SHOTS_ONLY=1 with APP_ROOT=<checkout> only takes the "before" screenshots of another checkout (e.g. main).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.resolve(process.env.APP_ROOT ?? ROOT);
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage9/pr3/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8131);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const v5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v5-stage7.json'), 'utf8');
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const loaded = (page, sel) => page.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0; }, sel, { timeout: 8000 }).then(() => true, () => false);
const setTheme = async (page, theme) => {
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme) await page.click('.theme-btn');
  await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
};

async function open(browser, route, viewport = MOBILE, extra = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem', ...extra });
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, v5);
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}

async function shots(browser, label) {
  for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
    const o = await open(browser, 'home', vp, { deviceScaleFactor: 1 });
    await o.page.screenshot({ path: `${OUT}/${label}-home-top-${name}.png` });
    await o.page.goto(`${BASE}#/settings`);
    await o.page.waitForSelector('#panel-settings:not([hidden])');
    await o.page.evaluate(() => document.querySelector('.settings-version')?.scrollIntoView({ block: 'end' }));
    for (const theme of ['light', 'dark']) {
      await setTheme(o.page, theme);
      await o.page.evaluate(() => document.querySelector('.settings-version')?.scrollIntoView({ block: 'end' }));
      await o.page.screenshot({ path: `${OUT}/${label}-settings-bottom-${theme}-${name}.png` });
    }
    await o.ctx.close();
    const ctx = await browser.newContext({ viewport: vp, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto(`${BASE}brand.html`);
    await p.evaluate(() => document.fonts.ready);
    await p.locator('#s-logo').scrollIntoViewIfNeeded();
    await p.locator('#s-logo').evaluate((h) => h.closest('section').scrollIntoView());
    await p.screenshot({ path: `${OUT}/${label}-brand-logo-${name}.png` });
    await ctx.close();
  }
}

(async () => {
  const server = spawn(process.execPath, [path.join(APP, 'scripts/serve.js')], { cwd: APP, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  if (process.env.SHOTS_ONLY === '1') {
    try { await shots(browser, 'before'); console.log('before shots written'); } finally { await browser.close(); server.kill(); }
    return;
  }
  try {
    // ---------- name and top bar ----------
    for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
      const { ctx, page } = await open(browser, 'home', vp);
      const title = await page.title();
      const word = await page.locator('.topbar .brand-word').innerText();
      const markOk = await loaded(page, '.topbar img.brand-mark');
      const box = await page.locator('.topbar img.brand-mark').boundingBox({ timeout: 2000 }).catch(() => null);
      const label = await page.locator('.topbar .brand').getAttribute('aria-label');
      const markRight = box && (await page.locator('.topbar .brand-word').boundingBox()).x < box.x; // RTL: icon first, on the right
      pass(`L-1/L-3 ${name}: title, LATISA word and icon in the top bar`, /^LATISA/.test(title) && word === 'LATISA' && markOk && !!box && box.width >= 28 && box.width <= 32 && /^LATISA/.test(label) && markRight, { title, word, markOk, box, label });
      pass(`M ${name}: no sideways scroll`, !(await hScroll(page)));
      await ctx.close();
    }

    // ---------- About card ----------
    for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
      for (const theme of ['light', 'dark']) {
        const { ctx, page } = await open(browser, 'settings', vp);
        await setTheme(page, theme);
        const ok = await loaded(page, '.about-card img.about-logo');
        if (!ok) { pass(`L-4 ${name} ${theme}: About card is dark with the full dark logo, text AA`, false, { error: 'no About card logo' }); await ctx.close(); continue; }
        const info = await page.evaluate(() => {
          const card = document.querySelector('.about-card'); const img = card.querySelector('img');
          const toHex = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); return `#${m.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`; };
          const r = img.getBoundingClientRect(); const cr = card.getBoundingClientRect();
          return {
            bg: toHex(getComputedStyle(card).backgroundColor), deep: getComputedStyle(document.documentElement).getPropertyValue('--deep').trim().toLowerCase(),
            h2: toHex(getComputedStyle(card.querySelector('h2')).color), p: toHex(getComputedStyle(card.querySelector('p')).color),
            alt: img.alt, src: img.getAttribute('src'), inside: r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5, width: r.width,
          };
        });
        const { contrastRatio } = await import(path.join(ROOT, 'src/js/core/contrast.js'));
        const ratios = [contrastRatio(info.h2, info.bg), contrastRatio(info.p, info.bg)];
        pass(`L-4 ${name} ${theme}: About card is dark with the full dark logo, text AA`, ok && info.bg === info.deep && /latisa-logo-dark\.png$/.test(info.src) && /LATISA/.test(info.alt) && info.inside && info.width > 200 && ratios.every((x) => x >= 4.5), { ...info, ratios });
        pass(`M ${name} ${theme}: settings, no sideways scroll`, !(await hScroll(page)));
        await ctx.close();
      }
    }
    // ---------- brand.html ----------
    for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
      const ctx = await browser.newContext({ viewport: vp, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await ctx.newPage(); watch(page);
      await page.goto(`${BASE}brand.html`);
      const okL = await loaded(page, '[data-theme="light"] > img.bk-full');
      const okD = await loaded(page, '[data-theme="dark"] > img.bk-full');
      const srcs = await page.$$eval('img.bk-full', (a) => a.map((i) => `${i.closest('[data-theme]').dataset.theme}:${i.getAttribute('src')}`));
      const icons = await page.$$eval('.bk-appicons img', (a) => a.map((i) => i.complete && i.naturalWidth > 0));
      pass(`L-5 ${name}: brand.html full logo, light on light and dark on dark, icons load`, okL && okD && srcs.includes('light:./assets/brand/latisa-logo-light.png') && srcs.includes('dark:./assets/brand/latisa-logo-dark.png') && icons.length === 4 && icons.every(Boolean) && /^LATISA/.test(await page.title()), { srcs, icons });
      pass(`M ${name}: brand.html no sideways scroll`, !(await hScroll(page)));
      await ctx.close();
    }

    // ---------- icons, manifest, masks ----------
    {
      const { ctx, page } = await open(browser, 'home');
      const res = await page.evaluate(async () => {
        const links = [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute('href'));
        const man = await (await fetch('./manifest.webmanifest')).json();
        const all = [...links, ...man.icons.map((i) => `./${i.src}`)];
        const out = {};
        for (const u of all) {
          const r = await fetch(u); const b = await r.blob(); const bmp = await createImageBitmap(b);
          out[u] = { status: r.status, type: r.headers.get('content-type'), w: bmp.width, h: bmp.height };
        }
        return { name: man.name, short: man.short_name, out };
      });
      const allOk = Object.values(res.out).every((x) => x.status === 200 && /image\/png/.test(x.type) && x.w === x.h);
      pass('L-6 every favicon, touch and manifest icon loads as a square PNG', allOk && /^LATISA/.test(res.name) && res.short === 'LATISA' && Object.keys(res.out).length === 5, res);
      // Render the home-screen icons through the real masks for the evidence sheet. On a page of its own: the app's
      // page has a Content-Security-Policy (stage 14) that rightly refuses the sheet's inline styles.
      const sheet = await ctx.newPage();
      await sheet.setContent(`<body style="margin:0;background:#fff;display:flex;gap:24px;padding:24px;font:14px sans-serif">
        ${[['icons/icon-maskable-512.png', '50%', 'maskable: circle'], ['icons/icon-maskable-512.png', '22%', 'maskable: rounded square'], ['icons/icon-maskable-512.png', '0', 'maskable: full square'], ['icons/apple-touch-icon-180.png', '22.37%', 'iOS 180'], ['icons/icon-512.png', '0', 'icon 512 (any)'], ['icons/favicon-32.png', '0', 'favicon 32']]
          .map(([s, r, t]) => `<figure style="margin:0;text-align:center"><img src="${BASE}${s}" style="width:160px;height:160px;border-radius:${r};image-rendering:${s.includes('32') ? 'pixelated' : 'auto'}"><figcaption>${t}</figcaption></figure>`).join('')}</body>`);
      await sheet.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
      if (SHOTS) await sheet.screenshot({ path: `${OUT}/after-icon-masks.png`, fullPage: true });
      await ctx.close();
    }

    // ---------- offline: service worker on, network off ----------
    {
      const octx = await browser.newContext({ viewport: MOBILE, locale: 'he-IL', reducedMotion: 'reduce' });
      const op = await octx.newPage(); watch(op);
      await op.goto(BASE);
      await op.evaluate(() => navigator.serviceWorker.ready);
      await op.reload();
      await op.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
      const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;
      const files = ['./assets/brand/latisa-mark.png', './assets/brand/latisa-logo-dark.png', './assets/brand/latisa-logo-light.png', './icons/favicon-32.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon-180.png'];
      const cached = await op.evaluate(async ([v, fs2]) => { const c = await caches.open(`tisa-${v}`); const r = {}; for (const f of fs2) r[f] = !!(await c.match(f)); return r; }, [version, files]);
      await octx.setOffline(true);
      await op.goto(`${BASE}#/settings`);
      await op.reload();
      await ready(op);
      const mark = await loaded(op, '.topbar img.brand-mark');
      const logo = await loaded(op, '.about-card img.about-logo');
      pass('O offline: brand files are cached, icon and logo show with no network', Object.values(cached).every(Boolean) && mark && logo, { cached, mark, logo, cache: `tisa-${version}` });
      await octx.close();
    }

    if (SHOTS) await shots(browser, 'after');
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'browser-check.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
