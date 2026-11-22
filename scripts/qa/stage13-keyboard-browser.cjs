// Stage 13, check 6 (docs/GOALS_STAGE13.md): keyboard on every screen and every dialog, sample trip (rule 16).
// Each button on each screen is pressed with Enter, from a fresh copy of the sample data. When it opens a dialog:
//   focus is inside; Tab and Shift+Tab stay inside (BODY = the browser frame, allowed); the focused control has a
//   visible focus mark; Esc closes it; focus goes back to the button that opened it.
// The same is done one level down (a button inside a dialog that opens another dialog), and for the three
// dialogs that a chosen file opens. On each screen, the first 25 Tab stops each show a visible focus mark.
// Waits for UI state (rule 6). Run 3 times. QA_OUT (default docs/evidence/stage13/browser), PORT (default 8193).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { sampleState } = require('./lib/sample-trip.cjs');
const { blankState } = require('./lib/blank-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage13/browser');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8193);
const BASE = `http://127.0.0.1:${PORT}/`;
const SCREENS = ['home', 'itinerary', 'money', 'checklist', 'smart-bag', 'transfers', 'calendar', 'photos', 'places', 'summary', 'luggage', 'info', 'assistant', 'settings'];
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];

function watch(page, { closePickers = true } = {}) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked|Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('popup', (p) => p.close().catch(() => {}));
  if (closePickers) page.on('filechooser', (fc) => fc.setFiles([]).catch(() => {})); // the crawl presses "import" buttons too: close their pickers at once
}
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const openIds = (page) => page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map((d) => d.id));

const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
/** The sample trip with one of everything, so every edit and delete dialog has something to open (sample data only). */
async function richState() {
  const st = await sampleState();
  const trip = st.trips[st.activeTripId];
  const [money, places, jr, ci, lg, tr, { TH }] = await Promise.all(['src/js/core/money.js', 'src/js/core/places.js', 'src/js/core/journal.js',
    'src/js/core/checkins.js', 'src/js/core/luggage.js', 'src/js/core/transfers.js', 'data/packs/th.js'].map(mod));
  let n = 0;
  const makeId = () => `kb-${++n}`;
  const at = '2030-11-01T10:00:00.000Z';
  const stop = trip.destinations[0];
  const rates = money.effectiveRates(trip.rates, TH.planningRates);
  trip.people = [{ id: 'kb-p1', name: 'חבר א' }, { id: 'kb-p2', name: 'חבר ב' }];
  const cat = Object.keys(trip.budget.categoriesMinor)[0];
  trip.expenses = [money.makeExpense({ amount: '50', currency: 'ILS', category: cat, date: stop.startDate, destinationId: stop.id, description: 'הוצאת דוגמה', method: 'card', status: 'paid', note: '' }, rates, makeId)];
  trip.places = [places.makePlace({ name: 'מקום דוגמה', category: 'food', status: 'want', coords: '13.75, 100.5', stopId: stop.id }, makeId, at)];
  trip.journal = jr.setNote(trip.journal, stop.startDate, 'הערת דוגמה', at);
  trip.checkins = [ci.makeCheckin({ kind: 'hotel', title: 'מלון דוגמה', stopId: stop.id, date: stop.startDate, time: '14:00', zone: 'Asia/Bangkok', booking: '', link: '', note: '' }, makeId)];
  const bag = lg.makeBag({ name: 'תיק דוגמה', limit: '23' }, makeId);
  trip.luggage = lg.saveItem(lg.saveBag(trip.luggage, bag), lg.makeLuggageItem({ name: 'פריט דוגמה', weight: '1' }, makeId), bag.id);
  trip.transfers = [tr.makeTransfer({ kind: 'bus', from: 'א', to: 'ב', date: stop.endDate, time: '09:00', company: '', booking: '', price: '', currency: 'THB', link: '', status: 'planned', note: '' }, makeId)];
  trip.photos = [{ id: 'kb-photo-1', date: stop.startDate, dateSource: 'manual', stopId: null, caption: 'דוגמה', featured: true, width: 40, height: 30, bytes: 100, addedAt: at }];
  return st;
}

/** A sample photo: details in the trip, the file in IndexedDB, so the photo dialogs can open. */
async function putPhoto(page) {
  await page.evaluate(async () => {
    const { putPhoto: put } = await import('/src/js/photo-store.js');
    const c = new OffscreenCanvas(40, 30);
    c.getContext('2d').fillRect(0, 0, 40, 30);
    const buf = await (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer();
    await put({ id: 'kb-photo-1', type: 'image/jpeg', full: buf, thumb: buf.slice(0) });
  });
}

/** Reset to the sample data and open a screen. */
async function fresh(page, seed, screen) {
  await page.evaluate((x) => localStorage.setItem('tisa:v1', x), seed);
  await putPhoto(page);
  await page.goto(`${BASE}#/${screen}`);
  await page.reload();
  await ready(page);
  await page.waitForFunction((s) => !document.querySelector(`#panel-${s}`).hidden, screen);
  // Open the folds, so the buttons inside them are reached too (the fold itself is a summary: K1 and the crawl press it).
  await page.evaluate((s) => { for (const d of document.querySelectorAll(`#panel-${s} details`)) d.open = true; }, screen);
}

/** Visible buttons in a scope (a screen or a dialog), as stable handles: index among the matches. */
const buttonsIn = (page, scope) => page.evaluate((sc) => {
  const root = document.querySelector(sc);
  return [...root.querySelectorAll('button, [role="button"], summary, a[href^="#"]')]
    .map((el, i) => ({ i, el }))
    .filter(({ el }) => { const r = el.getBoundingClientRect(); return r.width && r.height && !el.disabled && !el.closest('[hidden]') && (sc.startsWith('dialog') || !el.closest('dialog')); })
    .map(({ i, el }) => ({ i, label: `${el.tagName.toLowerCase()}[${el.dataset.action ?? el.dataset.go ?? el.dataset.tip ?? el.getAttribute('href') ?? ''}] ${(el.getAttribute('aria-label') ?? el.textContent).trim().replace(/\s+/g, ' ').slice(0, 30)}` }));
}, scope);
const press = (page, scope, i) => page.evaluate(([sc, k]) => {
  const el = document.querySelector(sc).querySelectorAll('button, [role="button"], summary, a[href^="#"]')[k];
  el.scrollIntoView({ block: 'center' });
  el.focus();
  window.__opener = el;
  return document.activeElement === el;
}, [scope, i]);

/** Keyboard checks on the dialog that just opened. */
async function checkDialog(page, id) {
  const inside = () => page.evaluate((d) => { const a = document.activeElement; return a === document.body ? 'frame' : document.getElementById(d).contains(a) ? 'in' : `out:${a.tagName}.${a.className}`; }, id);
  const start = await inside();
  const steps = [];
  let ring = true;
  const noRing = [];
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    const where = await inside();
    steps.push(where);
    if (where === 'in') {
      const r = await page.evaluate(() => {
        const a = document.activeElement;
        const s = getComputedStyle(a);
        const mark = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
        return { mark, what: `${a.tagName.toLowerCase()}[${a.dataset.action ?? a.id ?? a.name ?? ''}]` };
      });
      if (!r.mark) { ring = false; noRing.push(r.what); }
    }
  }
  const escaped = steps.filter((s) => s.startsWith('out'));
  await page.keyboard.press('Escape');
  const closed = await page.waitForFunction((d) => !document.getElementById(d).open, id, { timeout: 2000 }).then(() => true, () => false);
  const back = await page.evaluate(() => {
    const a = document.activeElement;
    if (a === window.__opener) return 'opener';
    if (!window.__opener?.isConnected) return a === document.body ? 'body (opener removed)' : 'moved (opener removed)';
    return `${a.tagName}.${a.className}`;
  });
  return { start, escaped, ring, noRing: [...new Set(noRing)], closed, back };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const reached = new Map(); // dialog id -> first result
  const problems = [];
  const allDialogs = [];
  try {
    const st = await richState();
    const seedRich = JSON.stringify(st);
    const seed = seedRich;
    const blank = await blankState(); // a trip with no budget, dates or route: the dialogs that only such a trip shows
    const olderTrip = structuredClone(st); // a trip from before the template (stage 9): money shows the template offer
    Object.assign(olderTrip.trips[olderTrip.activeTripId], { templateOffer: null });
    olderTrip.trips[olderTrip.activeTripId].budget.profileId = null;
    const older = JSON.stringify(olderTrip);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', serviceWorkers: 'block', acceptDownloads: true });
    const page = await ctx.newPage();
    watch(page);
    await page.clock.setFixedTime(new Date('2030-12-24T10:00:00+07:00'));
    await page.goto(`${BASE}#/home`);
    await ready(page);
    allDialogs.push(...await page.evaluate(() => [...document.querySelectorAll('dialog')].map((d) => d.id)));

    const record = (id, where, r) => {
      const ok = (r.start === 'in') && r.escaped.length === 0 && r.ring && r.closed && (r.back === 'opener' || r.back === 'moved (opener removed)');
      if (!reached.has(id)) reached.set(id, { where, ...r, ok });
      if (!ok) problems.push({ dialog: id, where, ...r });
    };

    // ---------- dialogs opened by choosing a file (first: before the crawl presses the same buttons) ----------
    const files = [
      ['settings', 'import-pick', '#import-file', 'dlg-import', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'tisa-backup', schemaVersion: 8, exportedAt: '2030-11-01T10:00:00.000Z', data: st })) }],
      ['places', 'places-import', '#places-file', 'dlg-places-import', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'tisa-places', version: 1, places: [] })) }],
      ['transfers', 'flights-import', '#flights-import-file', 'dlg-flights-import', { name: 'f.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'latisa-flights', version: 1, flights: [] })) }],
    ];
    for (const [s, action, input, id, file] of files) {
      // A new browser context each time: a file picker left open (the crawl above presses these buttons too)
      // blocks the next picker in the same context (seen in headless Chromium).
      const fctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', timezoneId: 'Asia/Bangkok', serviceWorkers: 'block' });
      const page = await fctx.newPage();
      watch(page, { closePickers: false });
      await page.clock.setFixedTime(new Date('2030-12-24T10:00:00+07:00'));
      await page.goto(`${BASE}#/home`);
      await ready(page);
      await fresh(page, seed, s);
      // Enter on the button opens the file picker, as a tap does; the file is chosen in the picker.
      const trigger = await page.evaluate((a) => { const b = document.querySelector(`#panel-${a[0]} [data-action="${a[1]}"]`); if (b) { b.focus(); window.__opener = b; } return !!b; }, [s, action]);
      // The app must ask for the picker: the file field gets a click while the user's key press still counts
      // (user activation). Playwright misses the picker event now and then (about 1 in 6 in a test of 6 tries on
      // 2026-11-22), so when the app asked and the event was missed, the file is set on the field directly.
      await page.evaluate((inp) => { window.__asked = null; document.querySelector(inp).addEventListener('click', () => { window.__asked = navigator.userActivation.isActive; }, { once: true }); }, input);
      const chooser = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), page.keyboard.press('Enter')]).then(([x]) => x, () => null);
      const asked = await page.evaluate(() => window.__asked);
      if (!chooser && asked !== true) { problems.push({ dialog: id, where: `${s}: Enter on ${action} did not ask for the file picker`, asked }); await fctx.close(); continue; }
      if (chooser) await chooser.setFiles(file); else await page.locator(input).setInputFiles(file);
      const opened = await page.waitForSelector(`#${id}[open]`, { timeout: 2000 }).then(() => true, () => false);
      if (!trigger || !opened) { problems.push({ dialog: id, where: `${s}: ${action} -> ${input}`, trigger, opened }); await fctx.close(); continue; }
      record(id, `${s} > ${action} (file chosen)`, await checkDialog(page, id));
      await fctx.close();
    }

    // ---------- screen buttons, and one level down ----------
    const ringMiss = {};
    const ONLY_FILES = process.env.ONLY_FILES === '1'; // a quick check of the file dialogs alone (not a full run)
    for (const [seed, s] of ONLY_FILES ? [] : [...SCREENS.map((x) => [seedRich, x]), ...['home', 'itinerary', 'money'].map((x) => [blank, x]), [older, 'money']]) {
      await fresh(page, seed, s);
      // Tab order on the screen: every stop shows a focus mark.
      await page.evaluate(() => document.activeElement?.blur());
      await page.focus('body');
      const miss = [];
      for (let k = 0; k < 25; k++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return null;
          const st2 = getComputedStyle(a);
          const mark = (st2.outlineStyle !== 'none' && parseFloat(st2.outlineWidth) > 0) || (st2.boxShadow && st2.boxShadow !== 'none');
          const r2 = a.getBoundingClientRect();
          return { mark, shown: r2.width > 0 && r2.height > 0, what: `${a.tagName.toLowerCase()}[${a.dataset.action ?? a.dataset.go ?? a.id ?? ''}]` };
        });
        if (r && (!r.mark || !r.shown)) miss.push(r.what);
      }
      if (miss.length) ringMiss[s] = [...new Set(miss)];

      const list = await buttonsIn(page, `#panel-${s}`);
      for (const b of list) {
        await fresh(page, seed, s);
        if (!await press(page, `#panel-${s}`, b.i)) continue;
        const before = await openIds(page);
        await page.keyboard.press('Enter');
        const opened = await page.waitForFunction((n) => document.querySelectorAll('dialog[open]').length > n, before.length, { timeout: 400 }).then(() => true, () => false);
        if (!opened) continue;
        const id = (await openIds(page)).find((x) => !before.includes(x));
        const r = await checkDialog(page, id);
        record(id, `${s} > ${b.label}`, r);
        // One level down: buttons inside this dialog that open another dialog.
        if (reached.get(id).where !== `${s} > ${b.label}`) continue; // each dialog is explored from its first opener only
        const inner = await (async () => { await fresh(page, seed, s); await press(page, `#panel-${s}`, b.i); await page.keyboard.press('Enter'); await page.waitForSelector(`#${id}[open]`); return buttonsIn(page, `dialog#${id}`); })();
        for (const c of inner) {
          await fresh(page, seed, s);
          await press(page, `#panel-${s}`, b.i);
          await page.keyboard.press('Enter');
          await page.waitForSelector(`#${id}[open]`);
          if (!await press(page, `dialog#${id}`, c.i)) continue;
          const before2 = await openIds(page);
          await page.keyboard.press('Enter');
          const opened2 = await page.waitForFunction((ids) => [...document.querySelectorAll('dialog[open]')].some((d) => !ids.includes(d.id)), before2, { timeout: 400 }).then(() => true, () => false);
          if (!opened2) continue;
          const id2 = (await openIds(page)).find((x) => !before2.includes(x));
          if (reached.has(id2)) continue;
          // The opener may have been closed with its dialog (a "delete" that closes the edit sheet first).
          await page.evaluate((o) => { if (!document.getElementById(o).open) window.__opener = null; }, id);
          const r2 = await checkDialog(page, id2);
          record(id2, `${s} > ${b.label} > ${c.label}`, r2);
        }
      }
    }
    // A dialog two steps away that the crawl explores only from its first opener: the note of the day that has one.
    if (!reached.has('dlg-note-delete')) {
      const day = st.trips[st.activeTripId].destinations[0].startDate;
      await fresh(page, seedRich, 'calendar');
      const sel = `#panel-calendar [data-action="note-edit"][data-day="${day}"]`;
      await page.evaluate((x) => { const b = document.querySelector(x); b.scrollIntoView({ block: 'center' }); b.focus(); }, sel);
      await page.keyboard.press('Enter');
      await page.waitForSelector('#dlg-note[open]');
      await page.evaluate(() => { const b = document.querySelector('#dlg-note [data-action="note-delete"]'); b.focus(); window.__opener = null; });
      await page.keyboard.press('Enter');
      const ok = await page.waitForSelector('#dlg-note-delete[open]', { timeout: 2000 }).then(() => true, () => false);
      if (ok) record('dlg-note-delete', `calendar > note-edit ${day} > note-delete`, await checkDialog(page, 'dlg-note-delete'));
    }
    pass('K1 every screen: the first 25 Tab stops are visible and show a focus mark', Object.keys(ringMiss).length === 0, { ringMiss });

    const notReached = allDialogs.filter((d) => !reached.has(d));
    pass('K2 every dialog: focus starts inside, Tab and Shift+Tab stay inside, a visible focus mark, Esc closes, focus goes back to its button',
      problems.length === 0, { problems, reached: [...reached].map(([d, v]) => `${d}: ${v.where}`) });
    pass('K3 every dialog in the app was reached from the keyboard', notReached.length === 0, { notReached, total: allDialogs.length });
    await ctx.close();
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'keyboard-browser.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exitCode = failed.length ? 1 : 0;
})();
