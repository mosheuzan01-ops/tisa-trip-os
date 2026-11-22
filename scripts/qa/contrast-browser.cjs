// Rule 7 (added 2026-11-22, owner approved): the QA gate's contrast check runs in dark mode too, on every button
// outside a card. For every screen and both themes, every visible button and link-button outside a card (.surface,
// .sheet, .setup and dark-metal surfaces are judged by their own rules) must reach 4.5:1 (3:1 for large text).
// Backgrounds are composited with their alpha up the tree. Elements on an image or gradient are listed, not judged.
// QA_OUT (default docs/evidence/stage10/qa-gate/contrast), PORT (default 8161). Run 3 times.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage10/qa-gate/contrast');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8161);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];

// Runs in the page: measure each button outside a card.
function measure() {
  const parse = (c) => { const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]; return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (x, y) => { const a = lum(x); const b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const out = [];
  const skipped = [];
  const panel = document.querySelector('.panel:not([hidden])');
  for (const el of panel.querySelectorAll('button, a[href]')) {
    if (!el.getClientRects().length || el.disabled || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.closest('.surface, .sheet, .setup, .dmetal, .pass, dialog, [role="tablist"]')) continue; // judged by their own surfaces
    if (!el.textContent.trim()) continue; // icon-only: the icon is not text
    // Background: composite every layer from the element up to the page.
    const layers = [];
    let image = false;
    for (let x = el; x; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (cs.backgroundImage !== 'none') { image = true; break; }
      const c = parse(cs.backgroundColor);
      if (c.a > 0) layers.push(c);
      if (c.a >= 1) break;
    }
    const label = `${el.dataset.action || el.dataset.go || el.dataset.route || el.getAttribute('href') || el.tagName}: "${el.textContent.trim().slice(0, 30)}"`;
    if (image) { skipped.push(label); continue; }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const c of layers.reverse()) bg = over(c, bg);
    const fg = over(parse(getComputedStyle(el).color), bg);
    const cs = getComputedStyle(el);
    const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
    const r = ratio(fg, bg);
    out.push({ label, ratio: Math.round(r * 1000) / 1000, need: large ? 3 : 4.5, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` });
  }
  return { out, skipped };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  try {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', colorScheme: scheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE);
      await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
      const routes = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-route], [data-go]')].map((e) => e.dataset.route || e.dataset.go))]);
      const low = [];
      const skipped = new Set();
      let measured = 0;
      let min = { ratio: Infinity };
      for (const route of routes) {
        await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
        await page.waitForFunction((r) => location.hash === `#/${r}` && document.querySelectorAll('.panel:not([hidden])').length === 1, route);
        const { out, skipped: sk } = await page.evaluate(measure);
        measured += out.length;
        for (const s of sk) skipped.add(`${route} ${s}`);
        for (const x of out) { if (x.ratio < x.need) low.push({ route, ...x }); if (x.ratio < min.ratio) min = { route, ...x }; }
      }
      pass(`${scheme}: every text button outside a card reaches its contrast (4.5:1, large text 3:1)`, low.length === 0 && measured > 0,
        { measured, lowest: min, low, onImage: [...skipped] });
      await ctx.close();
    }
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    fs.writeFileSync(`${OUT}/contrast-browser.json`, JSON.stringify(results, null, 2));
    for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
    await browser.close();
    server.kill();
    process.exitCode = Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1;
  }
})();
