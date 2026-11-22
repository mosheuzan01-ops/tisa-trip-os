// Stage 13 release checks (docs/GOALS_STAGE13.md), sample data only (rule 16, lib/rich-trip.cjs):
// R9  speed on this computer (not PageSpeed): first load at 390 px, LCP, CLS, bytes and requests
// R12 PWA: the manifest, its icons (real sizes), the service worker controls the page, apple-touch-icon
// R13 airplane mode: after one visit, every screen opens with no network, an edit survives a reload, no outside request
// R14 JSON backup: export, wipe, import: the whole trip comes back (places, info notes, smart suitcase, photo details)
// R16 backup reminder (S13-2): not before 7 days, shown at 7 days on the home screen only, gone after a backup
// R17 the version in settings = package.json = config = sw.js (S13-3)
// R18 privacy (S13-4): the privacy text in settings is visible, reachable from the keyboard, and says what 1.0.0 does
// R19 new install (docs/BUDGET_AND_START.md): the shared dates and the route, the checklist, no budget ("—"), no template card
// R20 the 20,000 template as a manual choice: free 15,000 with 5,000 set aside for the flight; a 5,000 flight is taken once
// R21 layout shift (CLS) under 0.1 on every screen, opened with saved data (owner-approved QA rule, 2026-11-22)
// Waits for UI state (rule 6). Run 3 times. QA_OUT (default docs/evidence/stage13/browser), PORT (default 8194).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { richState, putSamplePhoto } = require('./lib/rich-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage13/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8194);
const BASE = `http://127.0.0.1:${PORT}/`;
const SCREENS = ['home', 'itinerary', 'money', 'checklist', 'smart-bag', 'transfers', 'calendar', 'photos', 'places', 'summary', 'luggage', 'info', 'assistant', 'settings'];
const MOBILE = { width: 390, height: 844 };
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;

function watch(page, { offline = false } = {}) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
  if (offline) page.on('requestfailed', (r) => errors.push(`offline request failed: ${r.url()}`));
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tisa:v1')));
const go = async (page, screen) => {
  await page.goto(`${BASE}#/${screen}`);
  await page.waitForFunction((s) => !document.querySelector(`#panel-${s}`).hidden, screen);
};
async function context(browser, state, { sw = false, viewport = MOBILE, motion = 'reduce' } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: motion, timezoneId: 'Asia/Bangkok', acceptDownloads: true, ...(sw ? {} : { serviceWorkers: 'block' }) });
  if (state) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state));
  return ctx;
}
const pngSize = (buf) => (buf.readUInt32BE(0) === 0x89504e47 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null);

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const rich = await richState();
  try {
    // ---------- R9: speed on this computer (with and without reduced motion) ----------
    for (const motion of ['reduce', 'no-preference']) {
      const ctx = await context(browser, rich, { motion });
      const page = await ctx.newPage();
      watch(page);
      await page.addInitScript(() => {
        window.__lcp = 0; window.__cls = 0;
        new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
      });
      let bytes = 0;
      let requests = 0;
      page.on('response', async (r) => { requests += 1; try { bytes += (await r.body()).length; } catch { /* redirects */ } });
      await page.goto(`${BASE}#/home`, { waitUntil: 'load' });
      await ready(page);
      await page.waitForTimeout(1000); // let LCP and layout shifts settle before reading them (a measurement, not a UI wait)
      const m = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: Math.round(window.__cls * 1000) / 1000, dom: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd) }));
      pass(`R9 speed on this computer (local server, no throttling; not PageSpeed), reduced motion ${motion}: LCP under 2500 ms, CLS under 0.1`, m.lcp > 0 && m.lcp < 2500 && m.cls < 0.1,
        { ...m, kb: Math.round(bytes / 1024), requests });
      await ctx.close();
    }

    // ---------- R12, R13: installed app, then airplane mode ----------
    {
      const ctx = await context(browser, rich, { sw: true });
      const page = await ctx.newPage();
      watch(page);
      await page.goto(`${BASE}#/home`);
      await ready(page);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
      await putSamplePhoto(page);
      const man = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="manifest"]');
        const res = await fetch(link.href);
        return { type: res.headers.get('content-type'), body: await res.json(), apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null, theme: document.querySelector('meta[name="theme-color"]') !== null };
      });
      const icons = (man.body.icons ?? []).map((i) => {
        const file = path.join(ROOT, i.src.replace(/^\.?\//, ''));
        const real = fs.existsSync(file) ? pngSize(fs.readFileSync(file)) : null;
        return { src: i.src, sizes: i.sizes, purpose: i.purpose ?? 'any', ok: !!real && `${real[0]}x${real[1]}` === i.sizes };
      });
      const appleOk = man.apple && fs.existsSync(path.join(ROOT, man.apple.replace(/^\.?\//, '')));
      pass('R12 PWA: manifest (name, start_url, standalone, RTL, Hebrew), icons 192/512/maskable with their real sizes, apple-touch-icon, service worker in control',
        /manifest\+json/.test(man.type) && man.body.name && man.body.short_name && man.body.start_url && man.body.display === 'standalone' && man.body.dir === 'rtl' && /^he/.test(man.body.lang)
        && icons.every((i) => i.ok) && icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512') && icons.some((i) => /maskable/.test(i.purpose)) && appleOk,
        { themeColorMeta: man.theme ? 'present' : 'WARN: none in index.html (the manifest has theme_color); recorded, not added (no new features in stage 13)', name: man.body.name, start_url: man.body.start_url, display: man.body.display, dir: man.body.dir, lang: man.body.lang, icons, apple: man.apple });

      // Airplane mode: every screen, an edit, a reload.
      await ctx.setOffline(true);
      const bad = [];
      for (const s of SCREENS) {
        await go(page, s).catch((e) => bad.push(`${s}: ${e.message.split('\n')[0]}`));
      }
      await go(page, 'photos');
      const photoShown = await page.waitForFunction(() => document.querySelectorAll('#panel-photos .photo-thumb img[src]').length === 1, null, { timeout: 5000 }).then(() => true, () => false);
      await go(page, 'checklist');
      await page.click('#panel-checklist [data-action="item-add"]');
      await page.waitForSelector('#dlg-item[open]');
      await page.fill('#dlg-item [name="name"]', 'פריט במצב טיסה');
      await page.click('#dlg-item [type="submit"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-item[open]'));
      await page.reload();
      await ready(page);
      const kept = (await stored(page)).trips[rich.activeTripId].checklist.some((x) => x.name === 'פריט במצב טיסה');
      const shownVersion = await page.locator('[data-slot="version-app"]').textContent();
      if (SHOTS) { await go(page, 'home'); await page.screenshot({ path: `${OUT}/airplane-home-mobile.jpg`, type: 'jpeg', quality: 80 }); }
      pass('R13 airplane mode: all 14 screens open, the photo shows, a new list item survives a reload, this version',
        bad.length === 0 && photoShown && kept && shownVersion === version, { bad, photoShown, kept, shownVersion });
      await ctx.setOffline(false);
      await ctx.close();
    }

    // ---------- R14: JSON backup round trip ----------
    {
      const ctx = await context(browser, rich);
      const page = await ctx.newPage();
      watch(page);
      await go(page, 'settings');
      await ready(page);
      const before = await stored(page);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
      const file = path.join(os.tmpdir(), `tisa-r14-${process.pid}.json`);
      await dl.saveAs(file);
      const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Wipe through the app's own reset (type the confirm word, as a user would).
      await page.click('[data-action="reset-open"]');
      await page.waitForSelector('#dlg-reset[open]');
      await page.fill('#dlg-reset [data-slot="reset-input"]', 'איפוס'); // reset.word in locales/he.json
      await page.click('#dlg-reset [data-action="reset-confirm"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-reset[open]'));
      const wiped = await stored(page);
      await go(page, 'settings');
      await page.locator('#import-file').setInputFiles(file);
      await page.waitForSelector('#dlg-import[open]');
      await page.click('#dlg-import [data-action="import-confirm"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-import[open]'));
      const after = await stored(page);
      fs.rmSync(file, { force: true });
      const id = before.activeTripId;
      const tb = before.trips[id];
      const ta = after.trips[id];
      pass('R14 JSON backup: export, reset, import: the trip comes back whole (places, info notes, smart suitcase, photo details, money, route)',
        backup.format === 'tisa-backup' && Object.keys(wiped.trips[wiped.activeTripId].places ?? []).length === 0
        && JSON.stringify(after.trips) === JSON.stringify(before.trips) && ta.places.length === 1 && ta.info.notes.insurance && ta.smartBag.activities[0] === 'snorkel',
        { name: dl.suggestedFilename(), places: ta?.places?.length, info: ta?.info, smartBag: ta?.smartBag, photos: tb.photos.length });
      await ctx.close();
    }

    // ---------- R16: backup reminder (S13-2) ----------
    {
      const DAY = 86_400_000;
      const last = new Date('2030-12-01T10:00:00.000Z');
      const st = structuredClone(rich);
      st.settings.lastBackupAt = last.toISOString();
      const shown = async (at, screen = 'home') => {
        const ctx = await context(browser, st);
        const page = await ctx.newPage();
        watch(page);
        await page.clock.setFixedTime(at);
        await page.goto(`${BASE}#/${screen}`);
        await ready(page);
        await page.waitForFunction((s) => !document.querySelector(`#panel-${s}`).hidden, screen);
        const on = await page.locator('.banner-soft [data-action="export"]').isVisible();
        return { ctx, page, on };
      };
      const a = await shown(new Date(last.getTime() + 7 * DAY - 60_000));
      await a.ctx.close();
      const b = await shown(new Date(last.getTime() + 7 * DAY));
      if (SHOTS) await b.page.screenshot({ path: `${OUT}/backup-reminder-home-mobile.jpg`, type: 'jpeg', quality: 80 });
      const [dl] = await Promise.all([b.page.waitForEvent('download'), b.page.click('.banner-soft [data-action="export"]')]);
      const gone = await b.page.waitForFunction(() => !document.querySelector('.banner-soft'), null, { timeout: 3000 }).then(() => true, () => false);
      const stamped = (await stored(b.page)).settings.lastBackupAt;
      await b.ctx.close();
      const c = await shown(new Date(last.getTime() + 8 * DAY), 'money');
      await c.ctx.close();
      pass('R16 (S13-2) backup reminder: not 1 minute before 7 days, shown at 7 days on the home screen, not on other screens, gone after the backup',
        !a.on && b.on && gone && stamped !== last.toISOString() && !c.on && /\.json$/.test(dl.suggestedFilename()), { before7: a.on, at7: b.on, gone, onMoney: c.on });
    }

    // ---------- R19: a new install ----------
    {
      const ctx = await context(browser, null);
      const page = await ctx.newPage();
      watch(page);
      await page.clock.setFixedTime(new Date('2026-12-01T10:00:00+07:00'));
      await go(page, 'home');
      await ready(page);
      const st = await stored(page);
      const trip = st.trips[st.activeTripId];
      const home = await page.evaluate(() => ({ pass: document.querySelector('[data-slot="pass-dates"]').textContent, left: document.querySelector('[data-slot="kpi-left"]').textContent, empty: !document.querySelector('[data-slot="budget-empty"]').hidden }));
      await go(page, 'itinerary');
      const stops = await page.locator('#panel-itinerary [data-slot="stops"] [data-action="stop-edit"]').count();
      await go(page, 'money');
      const money = await page.evaluate(() => ({ free: document.querySelector('[data-slot="money-free"]').textContent, today: document.querySelector('[data-slot="money-today"]').textContent, card: !document.querySelector('[data-slot="template-card"]').hidden, cats: document.querySelectorAll('#panel-money [data-action="cat-edit"]').length }));
      if (SHOTS) await page.screenshot({ path: `${OUT}/new-install-money-mobile.jpg`, type: 'jpeg', quality: 80 });
      const zero = Object.values(trip.budget.categoriesMinor).every((v) => v === 0);
      pass('R19 new install: shared dates 20.12.2026-20.1.2027 and the route, the checklist, the category names at 0 ("—", no budget yet), no template card',
        trip.startDate === '2026-12-20' && trip.endDate === '2027-01-20' && trip.destinations.length > 0 && stops === trip.destinations.length && trip.checklist.length > 0
        && zero && trip.budget.profileId === null && /20 Dec/.test(home.pass) && home.left === '—' && home.empty && money.free === '—' && /עוד אין תקציב/.test(money.today) && !money.card && money.cats >= 7,
        { dates: [trip.startDate, trip.endDate], stops, checklist: trip.checklist.length, zero, home, money });

      // ---------- R20: the template as a manual choice, then a flight ----------
      await page.locator('#panel-money [data-action="profile-open"]:visible').click(); // the empty state's button is hidden while the category names show
      await page.waitForSelector('#dlg-profile[open]');
      const warn = await page.locator('[data-slot="profile-warn"]').textContent();
      const checked = await page.evaluate(() => document.querySelector('#dlg-profile input[name="profile"]:checked')?.value);
      await page.click('#dlg-profile [type="submit"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-profile[open]'));
      const read = () => page.evaluate(() => {
        const n = (slot) => document.querySelector(`[data-slot="${slot}"]`);
        return { free: n('money-free').textContent, today: n('money-today').textContent, reserved: !n('money-reserved-row') ? 'missing' : n('money-reserved-row').hidden ? null : n('money-reserved').textContent, planned: n('money-planned').textContent, total: n('money-total').textContent };
      });
      const tpl = await read();
      if (SHOTS) await page.screenshot({ path: `${OUT}/template-reserve-money-mobile.jpg`, type: 'jpeg', quality: 80 });
      await go(page, 'transfers');
      await page.click('[data-action="transfer-add"]');
      await page.waitForSelector('#dlg-transfer[open]');
      await page.selectOption('#dlg-transfer [name="kind"]', 'flight');
      await page.fill('#dlg-transfer [name="from"]', 'א');
      await page.fill('#dlg-transfer [name="to"]', 'ב');
      await page.fill('#dlg-transfer [name="date"]', '2026-12-20');
      await page.fill('#dlg-transfer [name="price"]', '5000');
      await page.selectOption('#dlg-transfer [name="currency"]', 'ILS');
      await page.click('#dlg-transfer [type="submit"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-transfer[open]'));
      await go(page, 'money');
      const flown = await read();
      const num = (x) => Number(String(x ?? '0').replace(/[^\d.-]/g, ''));
      pass('R20 the 20,000 template by hand: free 15,000, 5,000 set aside for the flight, 468 a day; after a 5,000 flight: free still 15,000, nothing set aside',
        warn === '' && checked === 'plan20k' && num(tpl.total) === 20000 && num(tpl.free) === 15000 && num(tpl.reserved) === 5000 && /468/.test(tpl.today)
        && num(flown.free) === 15000 && flown.reserved === null && num(flown.planned) === 5000,
        { warn, checked, tpl, flown });
      await ctx.close();
    }

    // ---------- R21: layout shift on every screen, with saved data ----------
    {
      const bad = {};
      for (const s of SCREENS) {
        const ctx = await context(browser, rich);
        const page = await ctx.newPage();
        watch(page);
        await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
        await go(page, s);
        await ready(page);
        await page.waitForTimeout(800); // let late shifts happen before reading them (a measurement, not a UI wait)
        const cls = await page.evaluate(() => Math.round(window.__cls * 1000) / 1000);
        if (cls >= 0.1) bad[s] = cls;
        await ctx.close();
      }
      pass('R21 every screen opened directly with saved data: layout shift (CLS) under 0.1', Object.keys(bad).length === 0, { bad, screens: SCREENS.length });
    }

    // ---------- R17, R18: version and privacy in settings ----------
    {
      const ctx = await context(browser, rich);
      const page = await ctx.newPage();
      watch(page);
      await go(page, 'settings');
      await ready(page);
      const shownVersion = await page.locator('[data-slot="version-app"]').textContent();
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
      const sw = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))[1];
      pass('R17 (S13-3) the version in settings = config = package.json = sw.js', shownVersion === version && pkg === version && sw === version, { shownVersion, version, pkg, sw });

      const privacy = page.locator('#panel-settings [data-slot="privacy"]');
      const has = await privacy.count();
      let detail = { has };
      let ok = false;
      if (has) {
        const sum = privacy.locator('summary');
        await sum.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('#panel-settings [data-slot="privacy"]').open);
        const text = await privacy.innerText();
        const must = { localStorage: /במכשיר/, photos: /IndexedDB|התמונות/, server: /אין שרת/, maps: /Google Maps/, passport: /דרכון/, card: /אשראי/, wipe: /מחיקת נתוני האתר|נתוני האתר/, backup: /גיבוי/ };
        const missing = Object.entries(must).filter(([, re]) => !re.test(text)).map(([k]) => k);
        const terms = await page.locator('#panel-settings [data-slot="terms"]').count();
        if (SHOTS) await privacy.screenshot({ path: `${OUT}/privacy-settings-mobile.jpg`, type: 'jpeg', quality: 80 });
        ok = missing.length === 0 && terms === 1;
        detail = { has, missing, terms };
      }
      pass('R18 (S13-4) privacy in settings: opens from the keyboard and says: on this device, photos in IndexedDB, no server, Google Maps only on tap, no passport or card numbers, clearing site data deletes, so back up; terms of use next to it', ok, detail);
      await ctx.close();
    }
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    pass('no requests outside the app', outside.length === 0, { outside });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'release-browser.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
