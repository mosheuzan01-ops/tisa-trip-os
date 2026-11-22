// Pre-publish live QA for 0.6.0 (site-qa-before-publish, step 2), on EVERY screen, Stage 6 included:
// home, itinerary, calendar, transfers + check-in, money, lists, luggage, assistant, settings, info ("future").
// 360 / 390 / 768 / 1280 px, light and dark, with real data during the trip. Also every Stage 6 dialog.
// Checks: sideways scroll, RTL, numbers kept LTR, tap targets >= 44px, smallest text and body text, computed contrast,
// every field and icon button has a name, keyboard focus visible, dialogs keep focus, Esc closes and returns focus.
// Waits for UI state, not fixed sleeps (rule 6). Writes only to QA_OUT, default docs/evidence/stage6/qa-060 (rule 10).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/qa-060');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8102;
const BASE = `http://127.0.0.1:${PORT}/`;
const ROUTES = ['home', 'itinerary', 'calendar', 'transfers', 'money', 'checklist', 'luggage', 'assistant', 'settings', 'info'];
const WIDTHS = [360, 390, 768, 1280];
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 6000 }).catch(() => {});

function state() {
  const at = '2026-12-01T10:00:00.000Z';
  const exp = (o) => ({ amountMinor: o.baseMinor, currency: 'ILS', rate: 1, method: 'card', description: '', note: '', destinationId: null, ...o });
  return {
    schemaVersion: 4, appVersion: '0.6.0', createdAt: at, updatedAt: at,
    settings: { language: 'he', theme: null, lastBackupAt: '2026-12-10T10:00:00.000Z', assistantQuestionLimit: 50 },
    activeTripId: 't',
    trips: { t: {
      id: 't', countryCode: 'TH', name: 'תאילנד', startDate: '2026-12-05', endDate: '2027-01-03',
      destinations: [
        { id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' },
        { id: 'd2', name: "צ'יאנג מאי", startDate: '2026-12-08', endDate: '2026-12-13', note: 'שוק לילה ביום ראשון' },
        { id: 'd3', name: 'קו טאו', startDate: '2026-12-13', endDate: '2026-12-20', note: '' },
      ],
      budget: { currency: 'ILS', totalMinor: 1527000, categoriesMinor: { food: 300000, lodging: 400000, flight: 450000, emergency: 250000 }, profileId: 'realistic', estimate: true },
      rates: {},
      expenses: [
        exp({ id: 'e1', baseMinor: 3000, category: 'food', date: '2026-12-11', status: 'paid', description: 'פאד תאי' }),
        exp({ id: 'e2', baseMinor: 12000, category: 'food', date: '2026-12-12', status: 'planned', description: 'שוק' }),
        exp({ id: 'e3', baseMinor: 250000, category: 'flight', date: '2026-12-05', status: 'committed', description: 'טיסה', transferId: 't1' }),
      ],
      people: [], repayments: [],
      transfers: [
        { id: 't1', kind: 'flight', from: 'תל אביב', to: 'בנגקוק', date: '2026-12-05', time: '', company: '', booking: 'ABC123', priceMinor: 250000, currency: 'ILS', link: 'https://airline.example/manage', status: 'booked', note: '', expenseId: 'e3' },
        { id: 't2', kind: 'bus', from: 'בנגקוק', to: "צ'יאנג מאי", date: '2026-12-08', time: '13:30', company: '', booking: '', priceMinor: null, currency: 'ILS', link: '', status: 'planned', note: '', expenseId: null },
      ],
      checklist: [
        { id: 'c1', group: 'documents', name: 'דרכון', qty: 1, note: '', done: true, verify: { source: '', checkedAt: '' } },
        { id: 'c2', group: 'clothing', name: 'נעלי הליכה', qty: 1, note: '', done: false },
      ],
      tasks: [
        { id: 'k1', title: 'להזמין טיסה לקו טאו', status: 'open', due: '2026-12-10', note: '' },
        { id: 'k2', title: 'לכבס', status: 'open', due: '2026-12-12', note: '' },
      ],
      events: [], info: {}, assistant: {},
      journal: { '2026-12-11': { note: 'שוק צף בבוקר, ואחר כך מסאז\'.', updatedAt: at } },
      checkins: [
        { id: 'ci1', kind: 'hotel', title: 'מלון בקו טאו', transferId: null, stopId: 'd3', date: '2026-12-13', time: '14:00', zone: 'Asia/Bangkok', booking: 'H-77', link: '', note: '', done: false },
        { id: 'ci2', kind: 'flight', title: "צ'ק-אין לטיסה הביתה", transferId: null, stopId: null, date: '2026-12-12', time: '', zone: 'Asia/Bangkok', booking: '', link: '', note: '', done: false },
      ],
      luggage: { bags: [
        { id: 'b1', name: 'מזוודה גדולה', limitGrams: 23000, items: [{ id: 'i1', name: 'בגדים', grams: 22500 }, { id: 'i2', name: 'מטען', grams: 800 }] },
        { id: 'b2', name: 'תיק גב', limitGrams: null, items: [{ id: 'i3', name: 'מחשב', grams: 1350 }] },
      ] },
    } },
  };
}

// Runs in the page: layout, size, names and contrast of everything rendered (same rules as qa-live.cjs).
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
  const scope = document.querySelector('dialog[open]') ?? document.body;
  const small = [...scope.querySelectorAll('button, a[href], input:not([type="file"]), select, textarea, label.choice, label.replan-mode')]
    .filter((n) => visible(n) && !n.disabled && n.type !== 'radio')
    .map((n) => { if (n.type !== 'checkbox') return n; const l = n.closest('label'); const r = l?.getBoundingClientRect(); return l && r.width >= 44 && r.height >= 44 ? null : n; })
    .filter(Boolean)
    .map((n) => { const r = n.getBoundingClientRect(); return { el: `${n.tagName.toLowerCase()}.${n.dataset.action ?? n.className}`.slice(0, 50), text: (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.w < 44 || x.h < 44);
  // Every field and control has a name a screen reader can say.
  const unnamed = [...scope.querySelectorAll('button, a[href], input:not([type="file"]), select, textarea')]
    .filter((n) => visible(n))
    .filter((n) => {
      const label = n.getAttribute('aria-label') || n.getAttribute('aria-labelledby') || (n.id && document.querySelector(`label[for="${n.id}"]`)) || n.closest('label');
      const text = (n.textContent || '').trim();
      return !(label || (n.matches('button, a') && text));
    })
    .map((n) => `${n.tagName.toLowerCase()}.${n.dataset.action ?? n.name ?? n.className}`.slice(0, 40));
  // Numbers, times and codes marked .ltr must read left to right inside the Hebrew page.
  const ltrWrong = [...scope.querySelectorAll('.ltr')].filter((n) => visible(n) && getComputedStyle(n).direction !== 'ltr').map((n) => n.textContent.trim().slice(0, 16));
  const texts = [...scope.querySelectorAll('*')].filter((n) => visible(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
  const sizes = texts.map((n) => parseFloat(getComputedStyle(n).fontSize));
  const lowContrast = [];
  let estimated = 0;
  for (const n of texts) {
    if (n.closest('.toast')) continue;
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
    dir: getComputedStyle(scope).direction, hscroll: document.documentElement.scrollWidth > innerWidth,
    smallTargets: small, unnamed, ltrWrong, minText: Math.min(...sizes), bodyText: parseFloat(getComputedStyle(document.body).fontSize),
    lowContrast, contrastEstimated: estimated, checkedTexts: texts.length,
  };
}

const DIALOGS = [
  { name: 'note', route: 'calendar', open: '#panel-calendar .cal-day.is-today [data-action="note-edit"]', dlg: '#dlg-note' },
  { name: 'note-delete', route: 'calendar', open: '#panel-calendar [data-date="2026-12-11"] [data-action="note-edit"]', then: '#dlg-note [data-action="note-delete"]', dlg: '#dlg-note-delete' },
  { name: 'checkin', route: 'transfers', open: '#panel-transfers [data-action="checkin-add"]', dlg: '#dlg-checkin' },
  { name: 'checkin-delete', route: 'transfers', open: '#panel-transfers [data-action="checkin-delete"]', dlg: '#dlg-checkin-delete' },
  { name: 'bag', route: 'luggage', open: '#panel-luggage [data-action="bag-add"]', dlg: '#dlg-bag' },
  { name: 'luggage-item', route: 'luggage', open: '#panel-luggage [data-action="luggage-item-add"]', dlg: '#dlg-luggage-item' },
  { name: 'luggage-delete', route: 'luggage', open: '#panel-luggage [data-action="bag-delete"]', dlg: '#dlg-luggage-delete' },
];

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const report = { screens: {}, dialogs: {}, keyboard: {}, errors: [], external: [] };
  const newCtx = async (width, scheme) => {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, locale: 'he-IL', colorScheme: scheme, reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state()));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => report.errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) report.errors.push(m.text()); });
    page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) report.external.push(r.url()); });
    await page.clock.setFixedTime(new Date('2026-12-12T09:00:00+07:00'));
    return { ctx, page };
  };

  // ---------- Every screen, 4 widths, light and dark ----------
  for (const width of WIDTHS) {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await newCtx(width, scheme);
      for (const route of ROUTES) {
        await page.goto(`${BASE}#/${route}`);
        await ready(page);
        await page.locator(`#panel-${route}`).waitFor(); // info is a real screen since 0.10.0 (stage 11)
        report.screens[`${route} ${width} ${scheme}`] = await page.evaluate(audit);
        if (SHOTS && ((width === 390) || (width === 1280 && scheme === 'light'))) {
          await page.screenshot({ path: `${OUT}/${route}-${width}-${scheme}.png`, fullPage: true });
        }
      }
      await ctx.close();
    }
  }

  // ---------- Every Stage 6 dialog: layout, contrast, names; focus stays inside; Esc closes and returns focus ----------
  for (const width of [360, 1280]) {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await newCtx(width, scheme);
      for (const d of DIALOGS) {
        await page.goto(`${BASE}#/${d.route}`);
        await ready(page);
        const opener = page.locator(d.open).first();
        await opener.scrollIntoViewIfNeeded();
        await opener.click();
        if (d.then) { await page.locator('#dlg-note[open]').waitFor(); await page.click(d.then); }
        await page.locator(`${d.dlg}[open]`).waitFor();
        const a = await page.evaluate(audit);
        const steps = [];
        for (let i = 0; i < 14; i += 1) {
          await page.keyboard.press('Tab');
          steps.push(await page.evaluate((sel) => {
            const n = document.activeElement;
            const cs = getComputedStyle(n);
            // A native modal dialog: after the last control one Tab goes to the browser frame (BODY), then back in.
            // The page behind stays inert, so BODY counts as inside, as in qa-live.cjs. BODY has no ring to show.
            const body = n === document.body;
            return { inside: body || !!n.closest(sel), ring: body || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' };
          }, d.dlg));
        }
        const openerKey = await opener.evaluate((n) => [n.dataset.action, n.dataset.id ?? n.dataset.day ?? '']);
        await page.keyboard.press('Escape');
        await page.waitForSelector(`${d.dlg}:not([open])`, { state: 'attached' });
        const focus = await page.evaluate(() => [document.activeElement.dataset.action, document.activeElement.dataset.id ?? document.activeElement.dataset.day ?? '']);
        if (SHOTS && width === 360) {
          await page.locator(d.open).first().click();
          if (d.then) { await page.locator('#dlg-note[open]').waitFor(); await page.click(d.then); }
          await page.locator(`${d.dlg}[open]`).waitFor();
          await toastGone(page);
          await page.screenshot({ path: `${OUT}/dialog-${d.name}-${width}-${scheme}.png` });
          await page.keyboard.press('Escape');
          await page.waitForSelector(`${d.dlg}:not([open])`, { state: 'attached' });
        }
        // After a delete dialog opened from the note dialog, focus goes back to the day's note button.
        const returned = d.then ? focus[0] === 'note-edit' : JSON.stringify(focus) === JSON.stringify(openerKey);
        report.dialogs[`${d.name} ${width} ${scheme}`] = { ...a, keepsFocus: steps.every((s) => s.inside), ringAlways: steps.every((s) => s.ring), escCloses: true, focusReturns: returned, focus, openerKey };
      }
      await ctx.close();
    }
  }

  // ---------- Keyboard on the three Stage 6 screens: every stop has a visible focus ring ----------
  {
    const { ctx, page } = await newCtx(390, 'light');
    for (const route of ['calendar', 'transfers', 'luggage']) {
      await page.goto(`${BASE}#/${route}`);
      await ready(page);
      await page.evaluate(() => document.activeElement.blur());
      const steps = [];
      for (let i = 0; i < 40; i += 1) {
        await page.keyboard.press('Tab');
        steps.push(await page.evaluate(() => {
          const n = document.activeElement;
          const cs = getComputedStyle(n);
          return { el: `${n.tagName.toLowerCase()}.${n.dataset.action ?? n.dataset.tab ?? n.className}`.slice(0, 30), ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' };
        }));
      }
      report.keyboard[route] = { tabbed: steps.length, withoutVisibleFocus: steps.filter((s) => !s.ring && s.el !== 'body.'), unique: new Set(steps.map((s) => s.el)).size };
    }
    await ctx.close();
  }

  // ---------- Summary ----------
  const all = { ...report.screens, ...report.dialogs };
  const bad = (pick) => Object.entries(all).filter(([, v]) => pick(v)).map(([k, v]) => [k, pick(v)]);
  report.summary = {
    hscroll: bad((v) => v.hscroll && true),
    notRtl: bad((v) => v.dir !== 'rtl' && v.dir),
    smallTargets: bad((v) => v.smallTargets.length && v.smallTargets),
    unnamed: bad((v) => v.unnamed.length && v.unnamed),
    ltrWrong: bad((v) => v.ltrWrong.length && v.ltrWrong),
    minTextUnder14: bad((v) => v.minText < 14 && v.minText),
    bodyTextUnder16: bad((v) => v.bodyText < 16 && v.bodyText),
    lowContrast: bad((v) => v.lowContrast.length && v.lowContrast),
    contrastEstimated: Object.values(all).reduce((s, v) => s + v.contrastEstimated, 0),
    checkedTexts: Object.values(all).reduce((s, v) => s + v.checkedTexts, 0),
    dialogsLoseFocus: Object.entries(report.dialogs).filter(([, v]) => !v.keepsFocus).map(([k]) => k),
    dialogsNoRing: Object.entries(report.dialogs).filter(([, v]) => !v.ringAlways).map(([k]) => k),
    dialogsFocusNotReturned: Object.entries(report.dialogs).filter(([, v]) => !v.focusReturns).map(([k, v]) => [k, v.focus, v.openerKey]),
    keyboardNoRing: Object.entries(report.keyboard).filter(([, v]) => v.withoutVisibleFocus.length).map(([k, v]) => [k, v.withoutVisibleFocus]),
    errors: report.errors, external: report.external,
    screensChecked: Object.keys(report.screens).length, dialogsChecked: Object.keys(report.dialogs).length,
  };
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `qa-live-060${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 1));
})().catch((e) => { console.error(e); process.exit(2); });
