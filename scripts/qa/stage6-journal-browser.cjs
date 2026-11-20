// Stage 6.0c browser checks: the journal inside the calendar (docs/GOALS_STAGE6.md S6-5, S6-10 for notes, S6-1, S6-12, S6-13, S6-14).
// 375px and 1280px, real app. Waits for UI state, not fixed sleeps (rule 6). Run 3 times before calling it PASS.
// Writes only to QA_OUT, default docs/evidence/stage6/6.0c (rule 10). Run from the repo root (port 8097).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/6.0c');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8097;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = { mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const bag = { errors: [], external: [] };
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const stored = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 6000 }).catch(() => {});

function state() {
  const at = '2026-12-01T10:00:00.000Z';
  return {
    schemaVersion: 4, appVersion: '0.5.5', createdAt: at, updatedAt: at,
    settings: { language: 'he', theme: null, lastBackupAt: '2026-12-05T10:00:00.000Z', assistantQuestionLimit: 50 },
    activeTripId: 'trip-1',
    trips: { 'trip-1': {
      id: 'trip-1', countryCode: 'TH', name: 'תאילנד', startDate: '2026-12-05', endDate: '2027-01-03',
      destinations: [
        { id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' },
        { id: 'd2', name: "צ'יאנג מאי", startDate: '2026-12-08', endDate: '2026-12-12', note: '' },
      ],
      budget: { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false },
      rates: {}, expenses: [], transfers: [], checklist: [], tasks: [],
      events: [], info: {}, assistant: {}, journal: {}, checkins: [], luggage: { bags: [] },
    } },
  };
}
function watch(page) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
}
async function open(browser, view, extra = {}) {
  const ctx = await browser.newContext({ viewport: VIEWS[view], deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem', ...extra });
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state()));
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2026-12-06T10:00:00+07:00'));
  await page.goto(`${BASE}#/calendar`);
  await ready(page);
  return { ctx, page };
}
const day = (page, iso) => page.locator(`#panel-calendar [data-date="${iso}"]`);
async function openNote(page, iso) {
  await day(page, iso).locator('[data-action="note-edit"]').click();
  await page.locator('#dlg-note[open]').waitFor();
}
async function save(page) {
  await page.click('#dlg-note [type="submit"]');
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await open(browser, view);

    // JB-1: write a note. The dialog names the date and that day's destination; the note shows on the day.
    const addLabel = await day(page, '2026-12-06').locator('[data-action="note-edit"]').innerText();
    await openNote(page, '2026-12-06');
    const head = await page.locator('#dlg-note').innerText();
    if (SHOTS && view === 'mobile') await page.screenshot({ path: `${OUT}/after-note-dialog-${view}.png` });
    await page.fill('#dlg-note [name="note"]', '  שוק צף בבוקר\nלחזור לדוכן המנגו  ');
    await save(page);
    await closed(page, '#dlg-note');
    const shown = await day(page, '2026-12-06').locator('.cal-note').innerText();
    const editLabel = await day(page, '2026-12-06').locator('[data-action="note-edit"]').innerText();
    const t1 = await stored(page);
    pass(`JB-1 write ${view}`, /6 בדצמבר/.test(head) && /בנגקוק/.test(head) && shown === 'שוק צף בבוקר\nלחזור לדוכן המנגו'
      && t1.journal['2026-12-06']?.note === 'שוק צף בבוקר\nלחזור לדוכן המנגו' && /הערה ליום/.test(addLabel) && /עריכת/.test(editLabel),
      { head, shown, addLabel, editLabel, journal: t1.journal });

    // JB-2: a travel day names both stops in the dialog.
    await openNote(page, '2026-12-08');
    const travel = await page.locator('#dlg-note [data-slot="note-where"]').innerText();
    await page.click('#dlg-note [data-close]');
    await closed(page, '#dlg-note');
    pass(`JB-2 travel day ${view}`, /בנגקוק/.test(travel) && /צ'יאנג מאי/.test(travel), { travel });

    // JB-3: an empty note is not saved, and an empty save never deletes an existing note.
    await openNote(page, '2026-12-07');
    await page.fill('#dlg-note [name="note"]', '   ');
    await save(page);
    await closed(page, '#dlg-note');
    const t3 = await stored(page);
    await openNote(page, '2026-12-06');
    await page.fill('#dlg-note [name="note"]', '');
    await save(page);
    const err = await page.locator('#note-error').innerText();
    const stillOpen = await page.locator('#dlg-note[open]').count();
    await page.click('#dlg-note [data-close]');
    await closed(page, '#dlg-note');
    const t3b = await stored(page);
    pass(`JB-3 empty ${view}`, !('2026-12-07' in t3.journal) && stillOpen === 1 && err.length > 0 && t3b.journal['2026-12-06']?.note === 'שוק צף בבוקר\nלחזור לדוכן המנגו',
      { journal7: '2026-12-07' in t3.journal, err, stillOpen });

    // JB-4: too long is refused with a message (the field allows typing it; the check is ours).
    await openNote(page, '2026-12-09');
    await page.locator('#dlg-note [name="note"]').evaluate((n) => { n.removeAttribute('maxlength'); n.value = 'x'.repeat(1001); });
    await save(page);
    const longErr = await page.locator('#note-error').innerText();
    await page.click('#dlg-note [data-close]');
    await closed(page, '#dlg-note');
    const t4 = await stored(page);
    pass(`JB-4 too long ${view}`, longErr.length > 0 && !('2026-12-09' in t4.journal), { longErr });

    // JB-5: edit keeps one note for the day and updates it.
    await openNote(page, '2026-12-06');
    const prefilled = await page.inputValue('#dlg-note [name="note"]');
    await page.fill('#dlg-note [name="note"]', 'שוק צף, ואז מסאז\'');
    await save(page);
    await closed(page, '#dlg-note');
    const t5 = await stored(page);
    pass(`JB-5 edit ${view}`, prefilled === 'שוק צף בבוקר\nלחזור לדוכן המנגו' && t5.journal['2026-12-06'].note === 'שוק צף, ואז מסאז\'' && Object.keys(t5.journal).length === 1, { prefilled, journal: t5.journal });

    // JB-6: delete asks first. Cancel keeps it; yes removes it, and the day offers "add" again.
    await toastGone(page);
    if (SHOTS) {
      await day(page, '2026-12-06').evaluate((n) => n.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `${OUT}/after-calendar-note-${view}.png` });
    }
    const noDeleteOnEmpty = await (async () => { await openNote(page, '2026-12-10'); const n = await page.locator('#dlg-note [data-action="note-delete"]').isVisible(); await page.click('#dlg-note [data-close]'); await closed(page, '#dlg-note'); return !n; })();
    await openNote(page, '2026-12-06');
    await page.click('#dlg-note [data-action="note-delete"]');
    await page.locator('#dlg-note-delete[open]').waitFor();
    const ask = await page.locator('#dlg-note-delete').innerText();
    if (SHOTS && view === 'mobile') await page.screenshot({ path: `${OUT}/after-note-delete-${view}.png` });
    await page.click('#dlg-note-delete [data-close]');
    await closed(page, '#dlg-note-delete');
    const afterNo = (await stored(page)).journal['2026-12-06']?.note;
    await openNote(page, '2026-12-06');
    await page.click('#dlg-note [data-action="note-delete"]');
    await page.locator('#dlg-note-delete[open]').waitFor();
    await page.click('#dlg-note-delete [data-action="note-delete-yes"]');
    await closed(page, '#dlg-note-delete');
    const t6 = await stored(page);
    const gone = await day(page, '2026-12-06').locator('.cal-note').count();
    const label = await day(page, '2026-12-06').locator('[data-action="note-edit"]').innerText();
    pass(`JB-6 delete asks first ${view}`, /למחוק/.test(ask) && afterNo === 'שוק צף, ואז מסאז\'' && !('2026-12-06' in t6.journal) && gone === 0 && /הערה ליום/.test(label) && noDeleteOnEmpty,
      { ask, afterNo, journal: t6.journal, gone, label, noDeleteOnEmpty });

    // JB-7: a note survives a reload, and the destination next to it follows the itinerary.
    await openNote(page, '2026-12-07');
    await page.fill('#dlg-note [name="note"]', 'יום מנוחה');
    await save(page);
    await closed(page, '#dlg-note');
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); s.trips[s.activeTripId].destinations[0].name = 'קרבי'; localStorage.setItem('tisa:v1', JSON.stringify(s)); });
    await page.reload(); await ready(page);
    const after = await day(page, '2026-12-07').innerText();
    pass(`JB-7 reload and destination ${view}`, /יום מנוחה/.test(after) && /קרבי/.test(after) && !/בנגקוק/.test(after), { after });

    // JB-8: layout of the screen and the dialog.
    await openNote(page, '2026-12-07');
    const audit = await page.evaluate(() => {
      const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]') && !n.closest('dialog:not([open])'); };
      const all = [...document.querySelector('#panel-calendar').querySelectorAll('*'), ...document.querySelector('#dlg-note').querySelectorAll('*')];
      const small = all.filter((b) => b.matches('button, input, select, textarea, a') && vis(b)).map((b) => ({ el: b.dataset.action ?? b.name ?? b.tagName, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
      const tiny = all.filter((n) => vis(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 14).map((n) => n.textContent.trim().slice(0, 20));
      const clipped = all.filter((b) => b.matches('button') && vis(b) && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
      const ta = document.querySelector('#dlg-note textarea');
      return { hscroll: document.documentElement.scrollWidth > innerWidth, small, tiny, clipped, labelled: !!ta.closest('label') || !!ta.getAttribute('aria-label'), dir: getComputedStyle(ta).direction };
    });
    await page.keyboard.press('Escape');
    await closed(page, '#dlg-note');
    pass(`JB-8 layout ${view}`, !audit.hscroll && !audit.small.length && !audit.tiny.length && !audit.clipped.length && audit.labelled && audit.dir === 'rtl', audit);

    // JB-9: backup round trip keeps the note.
    await page.click('.settings-btn');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#panel-settings [data-action="export"]')]);
    let rt = false;
    if (download) {
      const file = path.join(OUT, `roundtrip-${view}.json`);
      await download.saveAs(file);
      await page.click('[data-action="reset-open"]');
      await page.fill('[data-slot="reset-input"]', 'איפוס');
      await page.click('[data-action="reset-confirm"]');
      await closed(page, '#dlg-reset');
      const wiped = await stored(page);
      await page.setInputFiles('#import-file', file);
      await page.waitForSelector('#dlg-import[open]');
      await page.click('[data-action="import-confirm"]');
      await closed(page, '#dlg-import');
      fs.unlinkSync(file);
      rt = Object.keys(wiped.journal).length === 0 && (await stored(page)).journal['2026-12-07']?.note === 'יום מנוחה';
    }
    pass(`JB-9 backup ${view}`, rt, { download: !!download });
    await ctx.close();
  }

  // JB-10: offline: the journal code is cached, and a note can be written with no connection.
  {
    const ctx = await browser.newContext({ viewport: VIEWS.mobile, locale: 'he-IL', reducedMotion: 'reduce' });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state()));
    const page = await ctx.newPage();
    watch(page);
    await page.clock.setFixedTime(new Date('2026-12-06T10:00:00+07:00'));
    await page.goto(`${BASE}#/calendar`);
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('tisa-')));
      return (await c.keys()).map((r) => new URL(r.url).pathname).filter((u) => /journal/.test(u));
    });
    await ctx.setOffline(true);
    await page.reload(); await ready(page);
    await openNote(page, '2026-12-06');
    await page.fill('#dlg-note [name="note"]', 'בלי קליטה');
    await save(page);
    await closed(page, '#dlg-note');
    const t = await stored(page);
    await ctx.setOffline(false);
    pass('JB-10 offline', cached.length === 1 && t.journal['2026-12-06']?.note === 'בלי קליטה', { cached });
    await ctx.close();
  }

  pass('no JS errors, no outside requests', bag.errors.length === 0 && bag.external.length === 0, bag);
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); console.error(JSON.stringify(bag)); process.exit(2); });
