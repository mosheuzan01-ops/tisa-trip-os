// Stage 13, check 3 (docs/GOALS_STAGE13.md): every screen at 390, 768, 1024 and 1440 px, light and dark, with the
// sample trip (rule 16). For each: no horizontal scroll, nothing visible sticks out of the screen, no JS error.
// At 390: tap targets 44px and text 14px (the project's minimum). Screenshots: SHOTS=1 (default) at 390 and 1440.
// Waits for UI state (rule 6). Run 3 times. QA_OUT (default docs/evidence/stage13/browser), PORT (default 8192).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { sampleState } = require('./lib/sample-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage13/browser');
const SHOT_DIR = path.join(OUT, 'layout');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });
const PORT = Number(process.env.PORT ?? 8192);
const BASE = `http://127.0.0.1:${PORT}/`;
const WIDTHS = [[390, 844], [768, 1024], [1024, 768], [1440, 900]];
const SCREENS = ['home', 'itinerary', 'money', 'checklist', 'smart-bag', 'transfers', 'calendar', 'photos', 'places', 'summary', 'luggage', 'info', 'assistant', 'settings'];
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };

/** Visible elements that stick out of the screen sideways (not inside something that scrolls on purpose). */
const overflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const scrolls = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[hidden], dialog:not([open]), .sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if ((r.right > vw + 1 || r.left < -1) && !scrolls(el)) out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return { scroll: document.documentElement.scrollWidth > window.innerWidth, out: out.slice(0, 10) };
});

/** At 390: controls smaller than 44px and text smaller than 14px, on the open screen. */
const sizes = (page, screen) => page.evaluate((s) => {
  const panel = document.querySelector(`#panel-${s}`);
  const bad = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[hidden], .sr-only'); };
  for (const el of panel.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"]')) {
    if (!visible(el) || el.matches('input[type="checkbox"], input[type="radio"]') && el.closest('label')) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) bad.push(`target ${el.tagName.toLowerCase()}[${el.dataset.action ?? el.id ?? ''}] ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const el of panel.querySelectorAll('*')) {
    if (!visible(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 13.5) bad.push(`text ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${fs}px "${el.textContent.trim().slice(0, 20)}"`);
  }
  return [...new Set(bad)];
}, screen);

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  try {
    const seed = await sampleState();
    for (const theme of ['light', 'dark']) {
      for (const [w, h] of WIDTHS) {
        const st = structuredClone(seed);
        st.settings.theme = theme;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', serviceWorkers: 'block' });
        await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(st));
        const page = await ctx.newPage();
        watch(page);
        await page.clock.setFixedTime(new Date('2030-12-24T10:00:00+07:00'));
        await page.goto(`${BASE}#/home`);
        await ready(page);
        const bad = {};
        const small = {};
        for (const s of SCREENS) {
          await page.goto(`${BASE}#/${s}`);
          await page.waitForFunction((x) => !document.querySelector(`#panel-${x}`).hidden, s);
          await page.evaluate(() => document.fonts.ready);
          const o = await overflow(page);
          if (o.scroll || o.out.length) bad[s] = o;
          if (w === 390) { const z = await sizes(page, s); if (z.length) small[s] = z; }
          if (SHOTS && (w === 390 || w === 1440)) await page.screenshot({ path: `${SHOT_DIR}/${s}-${w}-${theme}.jpg`, type: 'jpeg', quality: 70, fullPage: true });
        }
        pass(`W ${w}px ${theme}: no horizontal scroll and nothing sticks out, on all ${SCREENS.length} screens`, Object.keys(bad).length === 0, { bad });
        if (w === 390) pass(`W ${w}px ${theme}: tap targets 44px and text 14px on all screens`, Object.keys(small).length === 0, { small });
        await ctx.close();
      }
    }
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    pass('no requests outside the app', outside.length === 0, { outside });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'layout-browser.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
