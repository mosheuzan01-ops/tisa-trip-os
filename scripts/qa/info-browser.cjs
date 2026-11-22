// Stage 11 (0.10.0): info and emergency (docs/GOALS_STAGE11.md, M1-M8). Public facts from data/info/th.json; notes typed
// here are samples (rule 16). Waits for UI state (rule 6). Run 3 times.
// QA_OUT (default docs/evidence/stage11/browser), PORT (default 8161), SHOTS=0 skips screenshots.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage11/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8161);
const BASE = `http://127.0.0.1:${PORT}/`;
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const MAPS = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).mapsSearchUrl;
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/info/th.json'), 'utf8'));
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
}
const SPY = () => { window.__opened = []; window.open = (url, target, features) => { window.__opened.push({ url: String(url), target, features }); return null; }; };
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1') ?? 'null'); return s ? s.trips[s.activeTripId] : null; });
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const sosRows = (page) => page.locator('#panel-info [data-slot="info-sos"] .info-row');

async function open(browser, { route = 'home', viewport = MOBILE, extra = {}, sw = false } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', ...(sw ? {} : { serviceWorkers: 'block' }), ...extra });
  await ctx.addInitScript(SPY);
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  try {
    // ---------- J1 (M4): one tap from home; the emergency button is on the first screen at 390px ----------
    const a = await open(browser, { extra: { permissions: ['clipboard-read', 'clipboard-write'] } });
    const box = await a.page.locator('[data-action="home-emergency"]').boundingBox();
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-home-mobile.png` });
    await a.page.click('[data-action="home-emergency"]');
    await a.page.waitForFunction(() => location.hash === '#/info' && !document.querySelector('#panel-info').hidden);
    const homeLit = await a.page.locator('#tab-home').getAttribute('aria-selected');
    pass('J1 home: the emergency button is on the first screen; one tap opens info and emergency; the home tab stays lit',
      box && box.y + box.height <= MOBILE.height && homeLit === 'true', { box, homeLit });

    // ---------- J2 (M1, M2, M3): verified numbers only, each with source, date, call and copy ----------
    const rows = await sosRows(a.page).evaluateAll((els) => els.map((li) => ({
      status: li.dataset.status, href: li.querySelector('a.info-call')?.getAttribute('href'), src: li.querySelector('.info-src')?.textContent ?? '',
      copy: !!li.querySelector('[data-action="info-copy"]'), value: li.querySelector('.info-value')?.textContent,
    })));
    const want = ['tel:1669', 'tel:191', 'tel:199', 'tel:1155', 'tel:1672'];
    pass('J2 emergency: exactly the five verified numbers, each with a tel: link, a copy button, its source and check date; 1155 (not 1151)',
      rows.length === 5 && rows.every((r) => r.status === 'verified-official' && r.copy && /מקור:/.test(r.src) && /22\.11\.2026/.test(r.src) && /https:\/\//.test(r.src))
      && JSON.stringify(rows.map((r) => r.href)) === JSON.stringify(want) && !(await a.page.locator('#panel-info').innerText()).includes('1151'), { rows }); // visible text only: random ids in the HTML can hold "1151" (Stage 12)
    const dialNote = await a.page.locator('#panel-info .info-dial-note').innerText();
    pass('J3 the screen explains that calling needs a phone signal and is not guaranteed in airplane mode', /קליטה/.test(dialNote) && /מצב טיסה/.test(dialNote), { dialNote });
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-info-mobile-light-top.png` });

    // ---------- J4 (M1, M2): every detail shows its status; unverified ones keep no value ----------
    const st = await a.page.evaluate(() => {
      const all = [...document.querySelectorAll('#panel-info .info-row')];
      return {
        total: all.length,
        badgeless: all.filter((li) => !li.querySelector('.info-badge')).length,
        unverifiedWithValue: all.filter((li) => li.dataset.status === 'unverified' && li.querySelector('.info-value')).length,
        unverifiedNoHow: all.filter((li) => li.dataset.status === 'unverified' && !li.querySelector('.info-how')?.textContent.trim()).length,
        verifiedNoSource: all.filter((li) => li.dataset.status === 'verified-official' && !/מקור:/.test(li.querySelector('.info-src')?.textContent ?? '')).length,
        pendingBadges: [...document.querySelectorAll('#panel-info .info-badge.is-pending')].map((b) => b.textContent),
        embassyAddr: document.querySelector('[data-info-key="embassy-israel.address"]')?.textContent ?? '',
        insurance: [...document.querySelectorAll('[data-info-key$=".insurance"], [data-info-key$=".preapproval"], [data-info-key$=".payment"]')].map((li) => li.dataset.status),
        draft: document.querySelector('[data-slot="info-draft"]')?.textContent ?? '',
        chiangMai: document.querySelector('[data-info-card="hospital-chiang-mai"] .info-prio')?.textContent ?? '',
        huaHin: /הואה הין|Hua Hin/i.test(document.querySelector('#panel-info').textContent),
        emergencyMobile: !!document.querySelector('[data-info-key="embassy-israel.emergencyPhone"]'),
      };
    });
    pass('J4 every detail has a status; verified ones show a source; "not verified" ones show how to check and no value; insurance stays not verified',
      st.total >= 40 && st.badgeless === 0 && st.unverifiedWithValue === 0 && st.unverifiedNoHow === 0 && st.verifiedNoSource === 0
      && st.pendingBadges.every((x) => x === 'טרם אומת') && st.insurance.length === DATA.hospitals.list.length * 3 && st.insurance.every((x) => x === 'unverified'), st);
    pass('J5 embassy address marked "given by the user"; no embassy emergency mobile; hospital list marked draft; Chiang Mai low; no Hua Hin',
      /נמסר על ידי המשתמש/.test(st.embassyAddr) && !st.emergencyMobile && /טיוטה/.test(st.draft) && /נמוכה/.test(st.chiangMai) && !st.huaHin, st);

    // ---------- J6 (M3): copy puts the number on the clipboard ----------
    await sosRows(a.page).nth(3).locator('[data-action="info-copy"]').click();
    await a.page.waitForFunction(() => document.querySelector('[data-slot="toast"]').textContent === 'הועתק.');
    const clip = await a.page.evaluate(() => navigator.clipboard.readText());
    pass('J6 copy: the tourist police number is copied and a short message says so', clip === '1155', { clip });

    // ---------- J7 (M5): maps only on tap, only from a verified address ----------
    const openedBefore = await a.page.evaluate(() => window.__opened.length);
    const embassyMap = await a.page.locator('[data-info-card="embassy-israel"] [data-action="info-map"]').count();
    const kohTaoMap = await a.page.locator('[data-info-card="hospital-koh-tao"] [data-action="info-map"]').count();
    await a.page.click('[data-info-card="chabad-bangkok"] [data-action="info-map"]');
    const opened = await a.page.evaluate(() => window.__opened);
    const chabad = DATA.contacts.find((c) => c.key === 'chabad-bangkok').fields.find((f) => f.key === 'address').value;
    pass('J7 maps: nothing opened before a tap; the Chabad map opens from its verified address; no map for the user-given embassy address or for Koh Tao',
      openedBefore === 0 && embassyMap === 0 && kohTaoMap === 0 && opened.length === 1 && opened[0].url === `${MAPS}${encodeURIComponent(chabad)}` && opened[0].target === '_blank',
      { opened, embassyMap, kohTaoMap });

    // ---------- J8 (M6): notes saved in the trip (so in the backup) and kept after reload ----------
    await a.page.fill('[data-note-for="insurance"]', 'פוליסה לדוגמה 123');
    await a.page.click('[data-action="info-note-save"][data-note-key="insurance"]');
    await a.page.waitForFunction(() => document.querySelector('[data-slot="toast"]').textContent === 'ההערה נשמרה.');
    await a.page.locator('[data-info-card="hospital-samui"] .info-note').evaluate((d) => { d.open = true; });
    await a.page.fill('[data-note-for="hospital-samui"]', 'הסדר: לבדוק בפוליסה (דוגמה)');
    await a.page.click('[data-action="info-note-save"][data-note-key="hospital-samui"]');
    await a.page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId].info?.notes?.['hospital-samui']; });
    await a.page.reload();
    await ready(a.page);
    const t8 = await trip(a.page);
    const shown8 = await a.page.inputValue('[data-note-for="insurance"]');
    pass('J8 notes: insurance and hospital notes saved in trip.info.notes (part of the backup) and shown again after reload',
      t8.info.notes.insurance === 'פוליסה לדוגמה 123' && t8.info.notes['hospital-samui'] === 'הסדר: לבדוק בפוליסה (דוגמה)' && shown8 === 'פוליסה לדוגמה 123', { notes: t8.info.notes });
    await a.ctx.close();

    // ---------- J9 (M8): 390px light and dark, desktop; no sideways scroll; every field has a name ----------
    const shots = {};
    for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
      for (const scheme of ['light', 'dark']) {
        const o = await open(browser, { route: 'info', viewport: vp, extra: { colorScheme: scheme } });
        shots[`${name}-${scheme}`] = !(await hScroll(o.page));
        if (SHOTS) await o.page.screenshot({ path: `${OUT}/after-info-${name}-${scheme}.png`, fullPage: true });
        if (name === 'mobile' && scheme === 'dark') {
          shots.unnamed = await o.page.evaluate(() => [...document.querySelectorAll('#panel-info textarea, #panel-info button, #panel-info a')]
            .filter((x) => !(x.labels?.[0]?.textContent.trim() || x.getAttribute('aria-label') || x.textContent.trim())).length);
        }
        await o.ctx.close();
      }
    }
    pass('J9 390px and desktop, light and dark: no sideways scroll; every field and button has a name',
      Object.entries(shots).every(([k, v]) => (k === 'unnamed' ? v === 0 : v === true)), shots);

    // ---------- J10 (M6, M7): airplane mode with the service worker; close and reopen while still offline ----------
    {
      const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;
      const o = await open(browser, { sw: true });
      await o.page.evaluate(() => navigator.serviceWorker.ready);
      await o.page.reload();
      await o.page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
      const cached = await o.page.evaluate(async (v) => {
        const c = await caches.open(`tisa-${v}`);
        const out = {};
        for (const f of ['./data/info/th.json', './src/js/info-view.js', './src/js/core/info.js']) out[f] = !!(await c.match(f));
        return out;
      }, version);
      await o.ctx.setOffline(true);
      await o.page.goto(`${BASE}#/info`);
      await o.page.reload();
      await ready(o.page);
      const n1 = await sosRows(o.page).count();
      if (SHOTS) await o.page.screenshot({ path: `${OUT}/after-info-airplane-mobile.png` });
      await o.page.close(); // "close the app"
      const p2 = await o.ctx.newPage(); // "open it again", still offline
      watch(p2);
      await p2.goto(`${BASE}#/info`);
      await ready(p2);
      const again = await p2.evaluate(() => ({
        sos: document.querySelectorAll('[data-slot="info-sos"] .info-row').length,
        chabad: document.querySelector('[data-info-key="chabad-bangkok.address"] .info-value')?.textContent ?? '',
        samuiEr: document.querySelector('[data-info-key="hospital-samui.er"] .info-value')?.textContent ?? '',
        offline: navigator.onLine === false,
      }));
      if (SHOTS) await p2.screenshot({ path: `${OUT}/after-info-airplane-reopen-mobile.png`, fullPage: true });
      pass('J10 airplane mode: the info files are cached; the screen opens offline; closed and opened again offline, numbers, addresses and medical details are all there',
        Object.values(cached).every(Boolean) && n1 === 5 && again.sos === 5 && /Phra Athit/.test(again.chabad) && /24/.test(again.samuiEr) && again.offline,
        { cached, version, n1, again });
      await o.ctx.close();
    }
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors, no outside requests', errors.length === 0 && outside.length === 0, { errors, outside });
    fs.writeFileSync(`${OUT}/info-browser.json`, JSON.stringify(results, null, 2));
    for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
    const ok = Object.values(results).every((r) => r.result === 'PASS');
    console.log(ok ? 'ALL PASS' : 'SOME FAIL');
    await browser.close();
    server.kill();
    process.exitCode = ok ? 0 : 1;
  }
})();
