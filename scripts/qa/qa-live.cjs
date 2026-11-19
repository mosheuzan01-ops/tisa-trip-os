// Pre-publish live QA (site-qa-before-publish, step 2): 360 / 390 / 768 / 1280 px, light and dark,
// on home, itinerary (with the suggested route, during the trip) and settings.
// Checks: sideways scroll, RTL, tap targets >= 44px, smallest text, body text size, computed contrast,
// keyboard focus order and visibility, dialog focus trap and Esc. Run: node scripts/qa/qa-live.cjs (port 8095)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, process.env.QA_OUT ?? 'docs/evidence/qa-live');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8095;
const BASE = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page: layout, size and contrast audit of what is visible on screen now.
function audit() {
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { rgb: p.slice(0, 3), a: p[3] ?? 1 }; };
  const blend = (top, under) => top.rgb.map((v, i) => v * top.a + under[i] * (1 - top.a));
  function background(node) {
    const layers = [];
    for (let n = node; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return { estimate: true };
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let rgb = [255, 255, 255];
    for (const l of layers.reverse()) rgb = blend(l, rgb);
    return { rgb };
  }
  const visible = (n) => { const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0' && n.closest('[hidden]') === null && n.closest('dialog:not([open])') === null; };
  const inMain = (n) => !n.closest('.tabbar, .toast');
  const small = [...document.querySelectorAll('button, a[href], input:not([type="file"]), select, label.choice, label.replan-mode')]
    .filter((n) => visible(n) && !n.disabled && n.type !== 'radio')
    .map((n) => { const r = n.getBoundingClientRect(); return { el: `${n.tagName.toLowerCase()}.${n.className}`.slice(0, 50), text: (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.w < 44 || x.h < 44);
  const texts = [...document.querySelectorAll('body *')].filter((n) => visible(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
  const sizes = texts.map((n) => parseFloat(getComputedStyle(n).fontSize));
  const lowContrast = [];
  let estimated = 0;
  for (const n of texts) {
    if (!inMain(n) && !n.closest('.tabbar')) continue;
    const cs = getComputedStyle(n);
    const fg = parse(cs.color);
    const bg = background(n);
    if (!fg || bg.estimate) { estimated += 1; continue; }
    const col = blend(fg, bg.rgb);
    const L1 = lum(col); const L2 = lum(bg.rgb);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    const faded = n.closest('[disabled], .is-disabled, .replan-was');
    if (ratio < need && !faded) lowContrast.push({ text: n.textContent.trim().slice(0, 24), ratio: Math.round(ratio * 100) / 100, need });
  }
  return {
    dir: document.documentElement.dir, width: innerWidth,
    hscroll: document.documentElement.scrollWidth > innerWidth,
    smallTargets: small, minText: Math.min(...sizes), bodyText: parseFloat(getComputedStyle(document.body).fontSize),
    lowContrast, contrastEstimated: estimated, checkedTexts: texts.length,
  };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const report = { widths: {}, keyboard: {}, errors: [] };

  for (const width of [360, 390, 768, 1280]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, locale: 'he-IL', colorScheme: scheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => report.errors.push(e.message));
      await page.clock.setFixedTime(new Date('2026-12-12T09:00:00+07:00'));
      await page.goto(`${BASE}#/itinerary`);
      await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
      await page.evaluate(() => document.fonts.ready);
      await page.click('[data-slot="itin-empty"] [data-action="seed-open"]');
      await page.click('[data-action="seed-confirm"]');
      await page.waitForFunction(() => document.querySelectorAll('.stop').length === 11);
      await sleep(2800); // toast gone
      for (const screen of ['home', 'itinerary', 'settings']) {
        await page.evaluate((s) => { location.hash = `#/${s}`; }, screen);
        await sleep(250);
        const a = await page.evaluate(audit);
        report.widths[`${width}-${scheme}-${screen}`] = a;
        if (scheme === 'light' || screen === 'itinerary') await page.screenshot({ path: `${OUT}/${width}-${scheme}-${screen}.png`, fullPage: false });
      }
      // a dialog, too
      await page.evaluate(() => { location.hash = '#/itinerary'; });
      await sleep(200);
      await page.click('[data-action="replan-open"]');
      await sleep(200);
      report.widths[`${width}-${scheme}-replan-dialog`] = await page.evaluate(audit);
      await ctx.close();
    }
  }

  // Keyboard: Tab order on the itinerary, focus always visible, dialog keeps focus inside, Esc closes and returns focus.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date('2026-12-12T09:00:00+07:00'));
    await page.goto(`${BASE}#/itinerary`);
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
    await page.click('[data-slot="itin-empty"] [data-action="seed-open"]');
    await page.click('[data-action="seed-confirm"]');
    await page.waitForFunction(() => document.querySelectorAll('.stop').length === 11);
    await page.evaluate(() => document.activeElement.blur());
    const steps = [];
    for (let i = 0; i < 70; i += 1) {
      await page.keyboard.press('Tab');
      steps.push(await page.evaluate(() => {
        const n = document.activeElement;
        const cs = getComputedStyle(n);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
        return { el: `${n.tagName.toLowerCase()}.${n.dataset.action ?? n.dataset.tab ?? n.className}`.slice(0, 30), ring, top: Math.round(n.getBoundingClientRect().top + scrollY) };
      }));
    }
    const noRing = steps.filter((s) => !s.ring);
    await page.click('.stop:first-child [data-action="stop-edit"]');
    const inside = [];
    for (let i = 0; i < 12; i += 1) { await page.keyboard.press('Tab'); inside.push(await page.evaluate(() => (document.activeElement.closest('#dlg-stop') ? 'in' : document.activeElement.tagName))); }
    await page.keyboard.press('Escape');
    await sleep(150);
    const back = await page.evaluate(() => ({ closed: !document.querySelector('#dlg-stop').open, focus: document.activeElement.dataset.action }));
    report.keyboard = { tabbed: steps.length, withoutVisibleFocus: noRing, uniqueStops: new Set(steps.map((s) => s.el)).size, dialogFocusSteps: inside, dialogKeepsFocus: inside.every((x) => x === 'in' || x === 'BODY'), escape: back };
    await ctx.close();
  }

  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, 'qa-live.json'), `${JSON.stringify(report, null, 2)}\n`);
  const rows = Object.entries(report.widths);
  const sum = {
    hscroll: rows.filter(([, a]) => a.hscroll).map(([k]) => k),
    notRtl: rows.filter(([, a]) => a.dir !== 'rtl').map(([k]) => k),
    smallTargets: rows.filter(([, a]) => a.smallTargets.length).map(([k, a]) => [k, a.smallTargets]),
    minText: Math.min(...rows.map(([, a]) => a.minText)),
    bodyText: [...new Set(rows.map(([, a]) => a.bodyText))],
    lowContrast: rows.filter(([, a]) => a.lowContrast.length).map(([k, a]) => [k, a.lowContrast]),
    contrastEstimated: Math.max(...rows.map(([, a]) => a.contrastEstimated)),
    keyboard: report.keyboard, errors: report.errors,
  };
  console.log(JSON.stringify(sum, null, 1));
})().catch((e) => { console.error(e); process.exit(2); });
