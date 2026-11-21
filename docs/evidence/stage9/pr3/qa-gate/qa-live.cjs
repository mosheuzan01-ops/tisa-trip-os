// QA gate (site-qa-before-publish step 2) for PR 3: branch vs main at 360/390/768/1280.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const [APP, PORT, OUT] = [process.argv[2], Number(process.argv[3]), process.argv[4]];
fs.mkdirSync(OUT, { recursive: true });
const v5 = fs.readFileSync('/home/user/tisa-trip-os/tests/fixtures/v5-stage7.json', 'utf8');
const BASE = `http://127.0.0.1:${PORT}/`;
const probe = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden],dialog:not([open])'); };
  const small = [...document.querySelectorAll('a[href],button,select,textarea,input:not([type=hidden]),[role=tab]')].filter(vis)
    .filter((e) => { const r = e.getBoundingClientRect(); return (r.width < 44 || r.height < 44) && !(e.type === 'file'); })
    .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
  const tiny = new Set();
  for (const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); w.nextNode();) {
    const el = w.currentNode.parentElement; if (!w.currentNode.textContent.trim() || !vis(el)) continue;
    const fs2 = parseFloat(getComputedStyle(el).fontSize); if (fs2 < 14) tiny.add(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}:${fs2}px`);
  }
  const noName = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
    .filter((i) => !(i.labels && i.labels.length) && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby') && !i.title)
    .map((i) => `${i.name || i.id || i.type}`);
  return { hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, small, tiny: [...tiny], noName };
};
(async () => {
  const server = spawn(process.execPath, [path.join(APP, 'scripts/serve.js')], { cwd: APP, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch(); const res = {}; const errors = [];
  try {
    for (const w of [360, 390, 768, 1280]) {
      for (const route of ['home', 'settings', 'brand']) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', deviceScaleFactor: 1 });
        await ctx.addInitScript((x) => { if (!sessionStorage.getItem('s')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('s', '1'); } }, v5);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(m.text()); });
        await page.goto(route === 'brand' ? `${BASE}brand.html` : `${BASE}#/${route}`);
        if (route !== 'brand') await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() => [...document.images].filter((i) => i.getBoundingClientRect().width && i.loading !== 'lazy').every((i) => i.complete));
        const r = await page.evaluate(probe);
        if (route === 'home') { // keyboard: first Tabs reach the brand link with a visible focus ring
          const seq = [];
          for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { el: `${a.tagName.toLowerCase()}.${a.className}`, ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== 'none' }; })); }
          r.tab = seq;
        }
        res[`${w}-${route}`] = r;
        await page.screenshot({ path: `${OUT}/${route}-${w}.png`, fullPage: route === 'brand' });
        await ctx.close();
      }
    }
  } finally { await browser.close(); server.kill(); }
  res.errors = errors;
  fs.writeFileSync(`${OUT}/live.json`, JSON.stringify(res, null, 1));
  for (const [k, v] of Object.entries(res)) if (k !== 'errors') console.log(k, 'hscroll', v.hscroll, 'small', v.small.length, 'tiny', v.tiny.length, 'noName', v.noName.length, v.tab ? JSON.stringify(v.tab) : '');
  console.log('errors', errors.length);
})();
