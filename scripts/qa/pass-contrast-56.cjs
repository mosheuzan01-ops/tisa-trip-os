// PR #56: the darker pass keeps its text readable. For the Latin name and the dates, the darkest background pixel
// under each (text hidden, shine settled) against the pass ink; WCAG: 4.5:1 for the dates, 3:1 for the large name.
const { chromium } = require('playwright');
const { richState } = require('./lib/rich-trip.cjs');
const { createFakeSupabase } = require('./lib/fake-supabase.cjs');
const { startServer, newContext } = require('./lib/cloud-owner.cjs');
const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
(async () => {
  const { server, base } = await startServer(8257);
  const browser = await chromium.launch(); const sb = await createFakeSupabase(); let fail = 0;
  try {
    for (const theme of ['light', 'dark']) {
      const seed = await richState(); seed.settings = { ...(seed.settings ?? {}), theme };
      const ctx = await newContext(browser, sb, { seed, scheme: theme, viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage(); await page.goto(`${base}#/home`); await page.waitForSelector('#panel-home:not([hidden])');
      await page.waitForTimeout(3200); // the shade lift and the one shine sweep are over
      for (const [sel, min] of [['.pass-latin', 3], ['.pass-dates', 4.5]]) {
        const ink = await page.$eval(sel, (el) => getComputedStyle(el).color.match(/\d+/g).slice(0, 3).map(Number));
        await page.$eval(sel, (el) => { el.style.color = 'transparent'; el.style.textShadow = 'none'; });
        const box = await page.locator(sel).boundingBox();
        const png = await page.screenshot({ clip: box });
        const px = await page.evaluate(async (b64) => {
          const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data; let best = null, bl = 9;
          for (let i = 0; i < d.length; i += 4) { const s = d[i] + d[i + 1] + d[i + 2]; if (s < bl * 1000) { bl = s / 1000; best = [d[i], d[i + 1], d[i + 2]]; } }
          return best;
        }, png.toString('base64'));
        const r = ratio(ink, px); const ok = r >= min; if (!ok) fail += 1;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${theme} ${sel}: ${r.toFixed(2)}:1 (min ${min}) ink rgb(${ink}) on darkest rgb(${px})`);
      }
      await ctx.close();
    }
    console.log(fail ? 'FAILED' : 'ALL PASS');
  } finally { await browser.close(); server.kill(); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
