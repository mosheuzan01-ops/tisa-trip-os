// Stage 6.0a browser checks (docs/GOALS_STAGE6.md S6-1 data part, S6-2, S6-12), at 375px and 1280px.
// Real v3 data (as 0.5.4 saves it) is put in storage, the real app loads it, and every screen still shows it.
// Waits for UI state, not fixed sleeps (docs/RULES.md rule 6). Run 3 times before calling it PASS.
// Writes only to QA_OUT, default docs/evidence/stage6/6.0a (rule 10). Run from the repo root (port 8089).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/6.0a');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8089;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = {
  mobile: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
};
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const bag = { errors: [], external: [] };
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tisa:v1')));
const trip = async (page) => { const s = await stored(page); return s ? s.trips[s.activeTripId] : null; };
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The same v3 data as tests/stage6-data.test.js: itinerary, budget, expenses with a split, a priced flight, checklist, tasks. */
function v3State() {
  const at = '2026-11-19T10:00:00.000Z';
  return {
    schemaVersion: 3, appVersion: '0.5.4', createdAt: at, updatedAt: at,
    settings: { language: 'he', theme: null, lastBackupAt: at, assistantQuestionLimit: 50 },
    activeTripId: 'trip-1',
    trips: { 'trip-1': {
      id: 'trip-1', countryCode: 'TH', name: 'תאילנד', startDate: '2026-12-05', endDate: '2027-01-03',
      destinations: [
        { id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' },
        { id: 'd2', name: "צ'יאנג מאי", startDate: '2026-12-08', endDate: '2026-12-12', note: 'שוק לילה' },
      ],
      budget: { currency: 'ILS', totalMinor: 1527000, categoriesMinor: { food: 210000, emergency: 250000 }, profileId: 'realistic', estimate: true },
      rates: { ILS_THB: 11 },
      expenses: [
        { id: 'e1', amountMinor: 30000, currency: 'THB', rate: 0.1, baseMinor: 3000, category: 'food', date: '2026-12-06', destinationId: 'd1', description: 'פאד תאי', method: 'cash', status: 'paid', note: '', paidBy: 'p1', split: { mode: 'percent', shares: { p1: 7000, p2: 3000 } } },
        { id: 'e2', amountMinor: 250000, currency: 'ILS', rate: 1, baseMinor: 250000, category: 'flight', date: '2026-12-05', destinationId: null, description: 'טיסה', method: 'card', status: 'committed', note: '' },
      ],
      people: [{ id: 'p1', name: 'משה' }, { id: 'p2', name: 'דנה' }],
      repayments: [{ id: 'r1', from: 'p2', to: 'p1', minor: 900, date: '2026-12-07' }],
      transfers: [{ id: 't1', kind: 'flight', from: 'תל אביב', to: 'בנגקוק', date: '2026-12-05', time: '', company: '', booking: 'ABC123', priceMinor: 250000, currency: 'ILS', link: '', status: 'booked', note: '', expenseId: 'e2' }],
      checklist: [{ id: 'c1', group: 'documents', name: 'דרכון', qty: 1, note: '', done: true, verify: { source: '', checkedAt: '' } }],
      tasks: [{ id: 'k1', title: 'ביטוח', status: 'open', due: '2026-11-30', note: '' }],
      events: [], info: {}, assistant: {},
    } },
  };
}
const OLD_FIELDS = ['name', 'countryCode', 'startDate', 'endDate', 'destinations', 'budget', 'rates', 'expenses', 'people', 'repayments', 'transfers', 'checklist', 'tasks', 'events', 'info', 'assistant'];

function watch(page) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
}
/** A page whose storage holds `state` before the app starts. */
async function openWith(browser, view, state, route = 'home') {
  const ctx = await browser.newContext({ ...VIEWS[view], locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });
  if (state) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state));
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date('2026-12-06T10:00:00+07:00'));
  await page.goto(`${BASE}#/${route}`);
  await ready(page);
  return { ctx, page };
}
const textOf = (page, sel) => page.locator(sel).innerText();

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  for (const view of Object.keys(VIEWS)) {
    // ---------- S6-2: v3 data in storage -> the app saves v4, nothing lost, every screen still shows it ----------
    {
      const before = v3State();
      const { ctx, page } = await openWith(browser, view, before);
      const s = await stored(page);
      const t = s.trips['trip-1'];
      const kept = Object.fromEntries(OLD_FIELDS.map((k) => [k, same(t[k], before.trips['trip-1'][k])]));
      const added = same(t.journal, {}) && same(t.checkins, []) && same(t.luggage, { bags: [] });
      if (SHOTS) await page.screenshot({ path: `${OUT}/after-home-migrated-${view}.png`, fullPage: true });
      await page.goto(`${BASE}#/itinerary`); await ready(page);
      const itin = await textOf(page, '#panel-itinerary');
      await page.goto(`${BASE}#/transfers`); await ready(page);
      const transfers = await textOf(page, '#panel-transfers');
      await page.goto(`${BASE}#/money`); await ready(page);
      const money = await textOf(page, '#panel-money');
      await page.goto(`${BASE}#/checklist`); await ready(page);
      const lists = await textOf(page, '#panel-checklist');
      const shown = {
        itinerary: itin.includes('בנגקוק') && itin.includes("צ'יאנג מאי"),
        transfers: transfers.includes('ABC123'),
        money: money.includes('פאד תאי'),
        checklist: lists.includes('דרכון') && lists.includes('ביטוח'),
      };
      await page.reload(); await ready(page);
      const again = await stored(page);
      pass(`S6-2 ${view}`, s.schemaVersion === 4 && Object.values(kept).every(Boolean) && added && Object.values(shown).every(Boolean) && again.schemaVersion === 4 && same(again.trips['trip-1'].expenses, before.trips['trip-1'].expenses),
        { schemaVersion: s.schemaVersion, kept, added, shown });
      await ctx.close();
    }

    // ---------- S6-1 + S6-12: new fields survive a reload, and a backup round trip with everything ----------
    {
      const { ctx, page } = await openWith(browser, view, v3State());
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('tisa:v1'));
        const t = s.trips[s.activeTripId];
        t.journal = { '2026-12-05': { note: 'נחתנו', updatedAt: '2026-12-05T20:00:00Z' } };
        t.checkins = [{ id: 'ci1', kind: 'hotel', title: 'מלון בבנגקוק', transferId: null, stopId: 'd1', date: '2026-12-05', time: '14:00', zone: 'Asia/Bangkok', booking: '', link: 'https://example.com', note: '', done: true }];
        t.luggage = { bags: [{ id: 'b1', name: 'תיק גב', limitGrams: 7000, items: [{ id: 'i1', name: 'מחשב', grams: 1350 }] }] };
        localStorage.setItem('tisa:v1', JSON.stringify(s));
      });
      await page.reload(); await ready(page);
      const reloaded = await trip(page);
      const survived = reloaded.journal['2026-12-05']?.note === 'נחתנו' && reloaded.checkins[0]?.time === '14:00' && reloaded.luggage.bags[0]?.items[0]?.grams === 1350;
      const keysOk = (await page.evaluate(() => Object.keys(localStorage))).every((k) => k.startsWith('tisa:'));
      pass(`S6-1 ${view}`, survived && keysOk, { survived, keysOk });

      await page.click('.settings-btn');
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#panel-settings [data-action="export"]')]);
      if (!download) { pass(`S6-12 round trip ${view}`, false, { error: 'the settings export button gave no file' }); await ctx.close(); continue; }
      const file = path.join(OUT, `roundtrip-${view}.json`);
      await download.saveAs(file);
      const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
      const before = await trip(page);
      await page.click('[data-action="reset-open"]');
      await page.fill('[data-slot="reset-input"]', 'איפוס');
      await page.click('[data-action="reset-confirm"]');
      await closed(page, '#dlg-reset');
      const wiped = await trip(page);
      await page.setInputFiles('#import-file', file);
      await page.waitForSelector('#dlg-import[open]');
      await page.click('[data-action="import-confirm"]');
      await closed(page, '#dlg-import');
      const after = await trip(page);
      fs.unlinkSync(file);
      const match = Object.fromEntries([...OLD_FIELDS, 'journal', 'checkins', 'luggage'].map((k) => [k, same(before[k], after[k])]));
      const wipedOk = same(wiped.journal, {}) && wiped.checkins.length === 0 && wiped.luggage.bags.length === 0;
      pass(`S6-12 round trip ${view}`, exported.schemaVersion === 4 && wipedOk && Object.values(match).every(Boolean), { fileVersion: exported.schemaVersion, wipedOk, match });

      // A backup file written by 0.5.4 (schema 3) still imports.
      const v3file = path.join(OUT, `v3-backup-${view}.json`);
      fs.writeFileSync(v3file, JSON.stringify({ format: 'tisa-backup', schemaVersion: 3, exportedAt: '2026-11-19T10:00:00.000Z', data: v3State() }));
      await page.setInputFiles('#import-file', v3file);
      await page.waitForSelector('#dlg-import[open]');
      await page.click('[data-action="import-confirm"]');
      await closed(page, '#dlg-import');
      const fromV3 = await stored(page);
      fs.unlinkSync(v3file);
      const t3 = fromV3.trips[fromV3.activeTripId];
      const v3ok = fromV3.schemaVersion === 4 && same(t3.luggage, { bags: [] }) && t3.transfers[0]?.booking === 'ABC123' && t3.tasks[0]?.title === 'ביטוח';
      pass(`S6-12 v3 backup ${view}`, v3ok, { schemaVersion: fromV3.schemaVersion });
      await ctx.close();
    }
  }

  // ---------- Bug found in 6.0a (already in 0.5.4): while the "time to back up" banner shows, the settings
  // export button was not wired and the banner button downloaded twice. Each must download exactly once. ----------
  for (const view of Object.keys(VIEWS)) {
    const { ctx, page } = await openWith(browser, view, v3State()); // last backup 19.11, today 6.12: the banner shows
    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    const banner = page.locator('[data-slot="banners"] [data-action="export"]');
    await banner.waitFor();
    await banner.click();
    await page.waitForFunction(() => document.querySelector('[data-slot="toast"]').classList.contains('show'));
    const fromBanner = downloads;
    await page.reload(); await ready(page); // the reminder is gone now; open settings
    await page.click('.settings-btn');
    downloads = 0;
    await page.click('#panel-settings [data-action="export"]');
    await page.waitForFunction(() => document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
    const fromSettingsAfterBanner = downloads;
    await ctx.close();
    const second = await openWith(browser, view, v3State(), 'settings'); // banner rendered on boot, settings opened first
    let n2 = 0;
    second.page.on('download', () => { n2 += 1; });
    await second.page.click('#panel-settings [data-action="export"]');
    await second.page.waitForFunction(() => document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
    await second.ctx.close();
    pass(`export once with the reminder ${view}`, fromBanner === 1 && fromSettingsAfterBanner === 1 && n2 === 1, { fromBanner, fromSettingsAfterBanner, fromSettingsWhileReminderDue: n2 });
  }

  pass('no JS errors, no outside requests', bag.errors.length === 0 && bag.external.length === 0, bag);
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); console.error(JSON.stringify(bag)); process.exit(2); });
