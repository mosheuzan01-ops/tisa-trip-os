// Stage 10, PR 1 (0.9.0): saved places (docs/GOALS_STAGE10.md, L1-L6, L11-L13). Sample data only (rule 16):
// made-up names, 2030 dates, round sample coordinates. Waits for UI state (rule 6). Run 3 times.
// QA_OUT (default docs/evidence/stage10/pr1/browser), PORT (default 8141), SHOTS=0 skips screenshots.
// SHOTS_ONLY=1 with APP_ROOT=<checkout> takes only the "before" screenshots (the itinerary on main).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { blankState } = require('./lib/blank-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.resolve(process.env.APP_ROOT ?? ROOT);
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage10/pr1/browser');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = Number(process.env.PORT ?? 8141);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];
const v5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v5-stage7.json'), 'utf8');
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const START = '2030-12-20';
const END = '2031-01-10';
const MAPS = 'https://www.google.com/maps/search/?api=1&query=';

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || /Service Worker registration blocked/.test(m.text())) return;
    // The airplane-mode context (G12) blocks the service worker, so a file not yet loaded cannot load. Expected there only;
    // real offline with the service worker is G15.
    if (page.__offline && /ERR_INTERNET_DISCONNECTED/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1') ?? 'null'); return s ? s.trips[s.activeTripId] : null; });
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tisa:v1') ?? 'null'));
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const cards = (page) => page.locator('#panel-places [data-slot="place-list"] .place-card');

// Counts every position request and every window.open, and keeps the page from leaving on a map tap.
const SPY = () => {
  window.__geoCalls = 0;
  window.__opened = [];
  window.open = (url, target, features) => { window.__opened.push({ url: String(url), target, features }); return null; };
  const g = navigator.geolocation;
  if (g) {
    const real = g.getCurrentPosition.bind(g);
    g.getCurrentPosition = (ok, fail, o) => { window.__geoCalls += 1; window.__geoOpts = o; return real(ok, fail, o); };
  }
};

async function open(browser, { seed = null, route = 'places', viewport = MOBILE, extra = {}, init = null } = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem', ...extra });
  if (seed) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, seed);
  await ctx.addInitScript(SPY);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2030-11-01T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}

async function setDates(page) {
  await page.goto(`${BASE}#/settings`);
  await page.locator('#panel-settings').waitFor();
  await page.fill('[data-form="settings-dates"] [name="start"]', START);
  await page.fill('[data-form="settings-dates"] [name="end"]', END);
  await page.click('[data-form="settings-dates"] [type="submit"]');
  await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId].destinations.length > 0; });
}

async function addPlace(page, f) {
  await page.click('#panel-places [data-action="place-add"]');
  await page.locator('#dlg-place[open]').waitFor();
  await page.fill('[data-form="place"] [name="name"]', f.name);
  if (f.category) await page.selectOption('[data-form="place"] [name="category"]', f.category);
  if (f.status) await page.selectOption('[data-form="place"] [name="status"]', f.status);
  if (f.coords !== undefined) await page.fill('[data-form="place"] [name="coords"]', f.coords);
  if (f.address) await page.fill('[data-form="place"] [name="address"]', f.address);
  if (f.stop) await page.selectOption('[data-form="place"] [name="stopId"]', { label: f.stop });
  if (f.planned) await page.fill('[data-form="place"] [name="plannedDate"]', f.planned);
  if (f.visited) await page.fill('[data-form="place"] [name="visitedDate"]', f.visited);
  if (f.note) await page.fill('[data-form="place"] [name="note"]', f.note);
  await page.click('[data-form="place"] [type="submit"]');
}

async function beforeShots(browser) {
  for (const [vp, name] of [[MOBILE, 'mobile'], [DESKTOP, 'desktop']]) {
    const o = await open(browser, { seed: v5, route: 'itinerary', viewport: vp });
    await o.page.screenshot({ path: `${OUT}/before-itinerary-${name}.png`, fullPage: true });
    await o.ctx.close();
  }
}

(async () => {
  const server = spawn(process.execPath, [path.join(APP, 'scripts/serve.js')], { cwd: APP, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  if (process.env.SHOTS_ONLY === '1') {
    try { await beforeShots(browser); console.log('before shots written'); } finally { await browser.close(); server.kill(); }
    return;
  }
  try {
    // ---------- G1: reachable from the itinerary; empty screen; nothing asked or loaded on its own ----------
    // Stage 13: a new install now starts with the shared dates and a route; G1 needs a trip with no dates yet
    // (as an older version left it), so its sample dates build the route here: lib/blank-trip.cjs.
    const a = await open(browser, { seed: await blankState(), route: 'itinerary' });
    await setDates(a.page);
    await a.page.goto(`${BASE}#/itinerary`);
    await a.page.locator('#panel-itinerary').waitFor();
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-itinerary-mobile.png`, fullPage: true });
    await a.page.click('[data-tab="tools"]'); // 1.1.4: the global tools moved to the tools tab
    await a.page.click('#panel-tools [data-go="places"]');
    await a.page.waitForFunction(() => location.hash === '#/places' && !document.querySelector('#panel-places').hidden);
    const tabLit = await a.page.locator('#tab-tools').getAttribute('aria-selected');
    pass('G1 tools -> saved places (1.1.4); the tools tab stays lit; empty state; no location asked and no map opened on load',
      tabLit === 'true' && await a.page.locator('[data-slot="place-empty"]').isVisible()
      && (await a.page.evaluate(() => window.__geoCalls)) === 0 && (await a.page.evaluate(() => window.__opened.length)) === 0,
      { tabLit });
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-places-empty-mobile.png`, fullPage: true });

    // ---------- G2 (L2, L5): every field saved exactly; the planned day shows as day N ----------
    const before2 = await trip(a.page);
    await addPlace(a.page, { name: 'שוק לילה לדוגמה', category: 'market', status: 'want', coords: '13.75630, 100.50180', address: 'רחוב לדוגמה 1', stop: 'בנגקוק', planned: '2030-12-22', note: 'לבוא בערב' });
    await closed(a.page, '#dlg-place');
    await a.page.waitForFunction(() => document.querySelectorAll('#panel-places .place-card').length === 1);
    const t2 = await trip(a.page);
    const p2 = t2.places[0];
    const bkk = t2.destinations.find((x) => x.name === 'בנגקוק');
    const card2 = await cards(a.page).first().innerText();
    pass('G2 add: name, category, status, exact coordinates, address, stop, planned day and note saved as typed; visit date empty',
      p2.name === 'שוק לילה לדוגמה' && p2.category === 'market' && p2.status === 'want' && p2.lat === '13.75630' && p2.lng === '100.50180'
      && p2.address === 'רחוב לדוגמה 1' && p2.stopId === bkk?.id && p2.plannedDate === '2030-12-22' && p2.visitedDate === null && p2.note === 'לבוא בערב'
      && /יום 3/.test(card2) && /13\.75630, 100\.50180/.test(card2),
      { place: p2, card: card2 });
    pass('G2b adding a place with a planned day changes no dates, stops, expenses or budget',
      ['startDate', 'endDate', 'destinations', 'expenses', 'budget', 'checklist'].every((k) => JSON.stringify(t2[k]) === JSON.stringify(before2[k])));

    // ---------- G3: validation ----------
    await a.page.click('#panel-places [data-action="place-add"]');
    await a.page.locator('#dlg-place[open]').waitFor();
    await a.page.fill('[data-form="place"] [name="coords"]', '100, 13');
    await a.page.click('[data-form="place"] [type="submit"]');
    const err3 = await a.page.locator('#place-error').innerText();
    const invalid3 = await a.page.locator('[data-form="place"] [aria-invalid="true"]').evaluateAll((els) => els.map((e) => e.name));
    await a.page.click('#dlg-place [data-close]');
    await closed(a.page, '#dlg-place');
    pass('G3 empty name and bad coordinates are refused with messages; nothing saved',
      /שם/.test(err3) && /קואורדינטות/.test(err3) && invalid3.includes('name') && invalid3.includes('coords') && (await trip(a.page)).places.length === 1,
      { err3, invalid3 });

    // ---------- G4 (L5): "visited" never fills the visit date ----------
    await a.page.click(`#panel-places [data-action="place-edit"][data-place-id="${p2.id}"]`);
    await a.page.locator('#dlg-place[open]').waitFor();
    await a.page.selectOption('[data-form="place"] [name="status"]', 'visited');
    await a.page.click('[data-form="place"] [type="submit"]');
    await closed(a.page, '#dlg-place');
    const p4 = (await trip(a.page)).places[0];
    await a.page.click(`#panel-places [data-action="place-edit"][data-place-id="${p2.id}"]`);
    await a.page.locator('#dlg-place[open]').waitFor();
    await a.page.selectOption('[data-form="place"] [name="status"]', 'loved');
    await a.page.fill('[data-form="place"] [name="visitedDate"]', '2030-12-23');
    await a.page.click('[data-form="place"] [type="submit"]');
    await closed(a.page, '#dlg-place');
    const p4b = (await trip(a.page)).places[0];
    pass('G4 edit to "visited": visit date stays empty and the planned day stays; a typed visit date is kept apart',
      p4.status === 'visited' && p4.visitedDate === null && p4.plannedDate === '2030-12-22' && p4.id === p2.id && p4.createdAt === p2.createdAt
      && p4b.status === 'loved' && p4b.visitedDate === '2030-12-23' && p4b.plannedDate === '2030-12-22',
      { p4: [p4.status, p4.visitedDate, p4.plannedDate], p4b: [p4b.status, p4b.visitedDate, p4b.plannedDate] });

    // ---------- G5 (L4): search, filters and the two views ----------
    await addPlace(a.page, { name: 'מקדש לדוגמה', category: 'temple', status: 'want' });
    await closed(a.page, '#dlg-place');
    await addPlace(a.page, { name: 'מסעדה לדוגמה', category: 'food', status: 'visited', note: 'פאד תאי' });
    await closed(a.page, '#dlg-place');
    await a.page.waitForFunction(() => document.querySelectorAll('#panel-places .place-card').length === 3);
    const names = () => cards(a.page).locator('.place-name').allInnerTexts();
    await a.page.click('[data-place-view="want"]');
    const vWant = await names();
    await a.page.click('[data-place-view="visited"]');
    const vVisited = await names();
    await a.page.click('[data-place-view="all"]');
    await a.page.selectOption('[data-place-filter="category"]', 'temple');
    const fCat = await names();
    await a.page.selectOption('[data-place-filter="category"]', '');
    await a.page.selectOption('[data-place-filter="stopId"]', { label: 'בנגקוק' });
    const fStop = await names();
    await a.page.selectOption('[data-place-filter="stopId"]', '');
    await a.page.selectOption('[data-place-filter="status"]', 'loved');
    const fStatus = await names();
    await a.page.selectOption('[data-place-filter="status"]', '');
    await a.page.fill('[data-search="places"] input', 'פאד');
    const fQ = await names();
    await a.page.fill('[data-search="places"] input', 'אין כזה');
    const none = await a.page.locator('[data-slot="place-none"]').isVisible();
    await a.page.click('[data-search="places"] [data-action="search-clear"]');
    const counts = await a.page.locator('.place-views').innerText();
    pass('G5 views "want" and "visited" (loved counts as visited), filters by category, stop and status, text search, "no results"',
      JSON.stringify(vWant) === JSON.stringify(['מקדש לדוגמה']) && JSON.stringify(vVisited) === JSON.stringify(['שוק לילה לדוגמה', 'מסעדה לדוגמה'])
      && JSON.stringify(fCat) === JSON.stringify(['מקדש לדוגמה']) && JSON.stringify(fStop) === JSON.stringify(['שוק לילה לדוגמה'])
      && JSON.stringify(fStatus) === JSON.stringify(['שוק לילה לדוגמה']) && JSON.stringify(fQ) === JSON.stringify(['מסעדה לדוגמה']) && none,
      { vWant, vVisited, fCat, fStop, fStatus, fQ, counts });
    pass('G6 390px: no sideways scroll on the places screen', !(await hScroll(a.page)));
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-places-list-mobile.png`, fullPage: true });

    // ---------- G7: the map opens only on a tap, from the coordinates; nothing loaded before ----------
    const outsideBefore = outside.length;
    const mapButtons = await cards(a.page).locator('[data-action="place-map"]').count();
    await a.page.click(`#panel-places [data-action="place-map"][data-place-id="${p2.id}"]`);
    const opened = await a.page.evaluate(() => window.__opened);
    pass('G7 Google Maps: only the place with coordinates has the button; one tap opens one link built from its coordinates; no outside request',
      mapButtons === 1 && opened.length === 1 && opened[0].url === `${MAPS}13.75630%2C100.50180` && opened[0].target === '_blank'
      && outside.length === outsideBefore && outside.length === 0, { mapButtons, opened, outside });

    // ---------- G8 (L1): delete only after a yes ----------
    const del = (await trip(a.page)).places.find((x) => x.name === 'מקדש לדוגמה');
    await a.page.click(`#panel-places [data-action="place-delete"][data-place-id="${del.id}"]`);
    await a.page.locator('#dlg-place-delete[open]').waitFor();
    if (SHOTS) await a.page.screenshot({ path: `${OUT}/after-place-delete-mobile.png` });
    await a.page.click('#dlg-place-delete [data-close]');
    await closed(a.page, '#dlg-place-delete');
    const afterCancel = (await trip(a.page)).places.length;
    await a.page.click(`#panel-places [data-action="place-delete"][data-place-id="${del.id}"]`);
    await a.page.locator('#dlg-place-delete[open]').waitFor();
    await a.page.click('[data-action="place-delete-yes"]');
    await closed(a.page, '#dlg-place-delete');
    const afterYes = (await trip(a.page)).places.map((x) => x.name);
    pass('G8 delete asks first: "cancel" keeps it, "yes" removes only that place', afterCancel === 3 && afterYes.length === 2 && !afterYes.includes('מקדש לדוגמה'), { afterCancel, afterYes });

    // ---------- G9: a reload keeps everything ----------
    await a.page.reload();
    await ready(a.page);
    await a.page.waitForFunction(() => document.querySelectorAll('#panel-places .place-card').length === 2);
    pass('G9 reload: the places are kept', (await trip(a.page)).places.length === 2);
    await a.ctx.close();

    // ---------- G10 (L6): location allowed: shown only after the tap, saved only after "save" ----------
    const g = await open(browser, { extra: { permissions: ['geolocation'], geolocation: { latitude: 13.7563, longitude: 100.5018, accuracy: 12 } } });
    const callsOnLoad = await g.page.evaluate(() => window.__geoCalls);
    await g.page.click('[data-action="place-here-locate"]');
    await g.page.waitForFunction(() => /13\.756300/.test(document.querySelector('[data-slot="place-here-text"]').textContent));
    const hereText = await g.page.locator('[data-slot="place-here-text"]').innerText();
    const geoOpts = await g.page.evaluate(() => window.__geoOpts);
    const placesAfterRead = (await trip(g.page)).places.length;
    if (SHOTS) await g.page.screenshot({ path: `${OUT}/after-here-found-mobile.png` });
    await g.page.click('[data-action="place-here-save"]');
    await g.page.locator('#dlg-place[open]').waitFor();
    const coordsField = await g.page.inputValue('[data-form="place"] [name="coords"]');
    await g.page.fill('[data-form="place"] [name="name"]', 'נקודה לדוגמה');
    await g.page.click('[data-form="place"] [type="submit"]');
    await closed(g.page, '#dlg-place');
    const p10 = (await trip(g.page)).places[0];
    await g.page.click('[data-action="place-here-map"]');
    const opened10 = await g.page.evaluate(() => window.__opened);
    pass('G10 location allowed: no reading on load; one reading per tap with a time limit; coordinates and accuracy shown; nothing saved until "save"; map from the reading',
      callsOnLoad === 0 && (await g.page.evaluate(() => window.__geoCalls)) === 1 && geoOpts?.timeout > 0 && /12/.test(hereText)
      && placesAfterRead === 0 && coordsField === '13.756300, 100.501800' && p10.lat === '13.756300' && p10.lng === '100.501800'
      && opened10.length === 1 && opened10[0].url === `${MAPS}13.756300%2C100.501800` && outside.length === 0,
      { hereText, geoOpts, coordsField, opened10 });
    // Inside the form: "my location" fills only the field
    await g.page.click('#panel-places [data-action="place-add"]');
    await g.page.locator('#dlg-place[open]').waitFor();
    await g.page.click('[data-action="place-locate"]');
    await g.page.waitForFunction(() => document.querySelector('[data-form="place"] [name="coords"]').value.length > 0);
    const hint = await g.page.locator('[data-slot="place-coords-hint"]').innerText();
    await g.page.click('#dlg-place [data-close]');
    await closed(g.page, '#dlg-place');
    pass('G10b "my location" in the form fills the field and says it is not saved yet; cancel saves nothing', /עוד לא נשמר/.test(hint) && (await trip(g.page)).places.length === 1, { hint });
    await g.ctx.close();

    // ---------- G11 (L6): permission refused ----------
    const d = await open(browser, { extra: { permissions: [] } });
    await d.page.click('[data-action="place-here-locate"]');
    await d.page.waitForFunction(() => /הרשאת מיקום/.test(document.querySelector('[data-slot="place-here-text"]').textContent), null, { timeout: 20000 });
    const deniedText = await d.page.locator('[data-slot="place-here-text"]').innerText();
    if (SHOTS) await d.page.screenshot({ path: `${OUT}/after-here-denied-mobile.png` });
    pass('G11 permission refused: a calm message with how to allow it and the typing option; no save button; nothing saved',
      /הגדרות/.test(deniedText) && /להקליד/.test(deniedText) && !(await d.page.locator('[data-action="place-here-save"]').isVisible()) && (await trip(d.page)).places.length === 0,
      { deniedText });
    await d.ctx.close();

    // ---------- G12 (L6, L12): airplane mode (no position), timeout, no support ----------
    const fail = (code) => `navigator.geolocation.getCurrentPosition = (ok, fail) => { window.__geoCalls = (window.__geoCalls || 0) + 1; setTimeout(() => fail({ code: ${code} }), 50); };`;
    const msgs = {};
    for (const [name, init] of [['unavailable', fail(2)], ['timeout', fail(3)], ['unsupported', 'Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });']]) {
      const o = await open(browser, { init, extra: { permissions: ['geolocation'] } });
      if (name === 'unavailable') { o.page.__offline = true; await o.ctx.setOffline(true); }
      await o.page.click('[data-action="place-here-locate"]');
      await o.page.waitForFunction(() => !/…/.test(document.querySelector('[data-slot="place-here-text"]').textContent));
      msgs[name] = await o.page.locator('[data-slot="place-here-text"]').innerText();
      if (name === 'unavailable') {
        // Airplane mode: the rest of the screen still works (add a place by hand, offline)
        await addPlace(o.page, { name: 'מקום בלי רשת', coords: '' });
        await closed(o.page, '#dlg-place');
        msgs.offlineSaved = (await trip(o.page)).places.length;
        if (SHOTS) await o.page.screenshot({ path: `${OUT}/after-here-airplane-mobile.png` });
      }
      await o.ctx.close();
    }
    pass('G12 no signal / airplane mode, timeout and no support each get their own calm message; offline a place can still be added by hand',
      /מצב טיסה/.test(msgs.unavailable) && /בזמן/.test(msgs.timeout) && /לא נותן מיקום/.test(msgs.unsupported) && msgs.offlineSaved === 1, msgs);

    // ---------- G13 (L11): old v5 data: migrates, nothing lost, places empty; backup has places ----------
    const m = await open(browser, { seed: v5 });
    const s13 = await state(m.page);
    const before = JSON.parse(v5);
    const t13 = s13.trips[s13.activeTripId];
    const tb = before.trips[before.activeTripId];
    const keep = ['expenses', 'transfers', 'checklist', 'tasks', 'checkins', 'photos', 'destinations', 'journal'];
    const copy = await m.page.evaluate(() => localStorage.getItem('tisa:premigration:v5'));
    pass('G13 v5 sample data: schema 7 or later (Stage 12: 8), places empty, every old list kept exactly, the old text kept once',
      s13.schemaVersion >= 7 && Array.isArray(t13.places) && t13.places.length === 0 && keep.every((k) => JSON.stringify(t13[k]) === JSON.stringify(tb[k])) && copy === v5,
      { schema: s13.schemaVersion });
    await m.ctx.close();

    // ---------- G14: desktop, and every field in the dialog has a name ----------
    const w = await open(browser, { viewport: DESKTOP });
    await addPlace(w.page, { name: 'אטרקציה לדוגמה', coords: '13.7, 100.5', address: 'כתובת לדוגמה' });
    await closed(w.page, '#dlg-place');
    await w.page.waitForFunction(() => document.querySelectorAll('#panel-places .place-card').length === 1);
    if (SHOTS) await w.page.screenshot({ path: `${OUT}/after-places-list-desktop.png`, fullPage: true });
    await w.page.click('#panel-places [data-action="place-add"]');
    await w.page.locator('#dlg-place[open]').waitFor();
    const unnamed = await w.page.evaluate(() => [...document.querySelectorAll('#dlg-place input, #dlg-place select, #dlg-place textarea, #panel-places input, #panel-places select')]
      .filter((e) => !(e.labels?.length || e.getAttribute('aria-label'))).map((e) => e.name || e.dataset.placeFilter || e.outerHTML.slice(0, 60)));
    if (SHOTS) await w.page.screenshot({ path: `${OUT}/after-place-dialog-desktop.png` });
    pass('G14 desktop: no sideways scroll; every field has a name', !(await hScroll(w.page)) && unnamed.length === 0, { unnamed });
    await w.ctx.close();

    const mob = await open(browser);
    await mob.page.click('#panel-places [data-action="place-add"]');
    await mob.page.locator('#dlg-place[open]').waitFor();
    if (SHOTS) await mob.page.screenshot({ path: `${OUT}/after-place-dialog-mobile.png`, fullPage: true });
    pass('G14b 390px: the dialog has no sideways scroll', !(await hScroll(mob.page)));
    await mob.ctx.close();

    // ---------- G15 (L12): real airplane mode with the service worker: the new files are cached; places work offline ----------
    {
      const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8')).appVersion;
      const ctx = await browser.newContext({ viewport: MOBILE, locale: 'he-IL', reducedMotion: 'reduce' });
      await ctx.addInitScript(SPY);
      const page = await ctx.newPage();
      watch(page);
      await page.goto(BASE);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
      const cached = await page.evaluate(async (v) => {
        const c = await caches.open(`tisa-${v}`);
        const out = {};
        for (const f of ['places-view.js', 'core/places.js', 'core/geo.js']) out[f] = !!(await c.match(`./src/js/${f}`));
        return out;
      }, version);
      await ctx.setOffline(true);
      await page.goto(`${BASE}#/places`);
      await page.reload();
      await ready(page);
      await addPlace(page, { name: 'מקום במצב טיסה', coords: '13.7, 100.5' });
      await closed(page, '#dlg-place');
      const t15 = await trip(page);
      const mapsBtn = await page.locator('#panel-places [data-action="place-map"]').count();
      pass('G15 airplane mode (service worker): places files cached; the screen opens offline and a place is saved; the map button is still there (it needs the network only when tapped)',
        Object.values(cached).every(Boolean) && t15.places.length === 1 && mapsBtn === 1, { cached, version });
      if (SHOTS) await page.screenshot({ path: `${OUT}/after-places-offline-mobile.png`, fullPage: true });
      await ctx.close();
    }
    if (SHOTS) {
      const it = await open(browser, { seed: v5, route: 'itinerary', viewport: DESKTOP });
      await it.page.screenshot({ path: `${OUT}/after-itinerary-desktop.png`, fullPage: true });
      await it.ctx.close();
      const it2 = await open(browser, { seed: v5, route: 'itinerary' });
      await it2.page.screenshot({ path: `${OUT}/after-itinerary-old-data-mobile.png`, fullPage: true });
      await it2.ctx.close();
    }
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors, no outside requests', errors.length === 0 && outside.length === 0, { errors, outside });
    fs.writeFileSync(`${OUT}/places-browser.json`, JSON.stringify(results, null, 2));
    for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
    await browser.close();
    server.kill();
    process.exitCode = Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1;
  }
})();
