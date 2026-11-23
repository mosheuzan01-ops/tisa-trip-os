// Review fixes on 1.1.0 (2026-11-23), browser side. Node side: tests/review-fixes.test.js.
// RF-1: a sheet (native <dialog>) on a phone closes only on a tap outside it. A tap on its own top strip (the grab
//       handle drawn by .sheet::before) used to close it and lose what was typed. Escape and the backdrop still close.
// RF-2: an expense typed with a decimal comma (12,50) is saved as 12.50 shekels, not 1,250.
// RF-3: a places file from a friend with an id that is not a plain word (here: a quote) can be edited and deleted.
// Shared sample data (rule 22, lib/rich-trip.cjs). Waits for UI state (rule 6). Run 3 times.
// QA_OUT (default docs/evidence/review-fixes/browser), PORT (default 8197).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { richState } = require('./lib/rich-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/review-fixes/browser');
fs.mkdirSync(OUT, { recursive: true });
const RUN = process.env.RUN ?? '1';
const PORT = Number(process.env.PORT ?? 8197);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];

function watch(page) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob):/.test(r.url())) outside.push(r.url()); });
}
const ready = (page) => page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
const go = async (page, screen) => { await page.goto(`${BASE}#/${screen}`); await ready(page); await page.waitForFunction((s) => !document.querySelector(`#panel-${s}`).hidden, screen); };
const isOpen = (page, sel) => page.locator(sel).evaluate((d) => d.open);
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s.trips[s.activeTripId]; });

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  const browser = await chromium.launch();
  const seed = JSON.stringify(await richState());
  try {
    await new Promise((r) => setTimeout(r, 400));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript((x) => { if (!localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); }, seed);
    const page = await ctx.newPage();
    watch(page);

    // ---------- RF-1 ----------
    await go(page, 'money');
    const openExpense = async () => {
      await page.click('#panel-money [data-action="expense-add"]');
      await page.waitForFunction(() => document.querySelector('#dlg-expense').open);
      // measure only after the slide-in animation ends (it moves the sheet 24px)
      await page.waitForFunction(() => document.querySelector('#dlg-expense').getAnimations().length === 0);
      await page.fill('#dlg-expense [name="amount"]', '123');
    };
    await openExpense();
    const box = await page.locator('#dlg-expense').boundingBox();
    const form = await page.locator('#dlg-expense form').boundingBox();
    const stripY = box.y + Math.max(2, (form.y - box.y) / 2); // inside the sheet, above its form: the grab handle
    await page.mouse.click(box.x + box.width / 2, stripY);
    const afterStrip = await isOpen(page, '#dlg-expense');
    const kept = await page.inputValue('#dlg-expense [name="amount"]');
    pass('RF-1a tap on the sheet top strip keeps it open with the typed amount', afterStrip && kept === '123', { strip: Math.round(form.y - box.y), afterStrip, kept });
    const above = box.y / 2; // the backdrop above the sheet (the sheet sits at the bottom of a phone screen)
    await page.mouse.click(box.x + box.width / 2, above);
    const backdropClosed = await page.waitForFunction(() => !document.querySelector('#dlg-expense').open, null, { timeout: 4000 }).then(() => true, () => false);
    pass('RF-1b tap on the backdrop still closes the sheet', box.y >= 4 && backdropClosed, { sheetTop: Math.round(box.y), tapY: Math.round(above) });
    if (!backdropClosed) await page.keyboard.press('Escape');
    await openExpense();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#dlg-expense').open);
    pass('RF-1c Escape still closes the sheet', !(await isOpen(page, '#dlg-expense')));
    const focusBack = await page.evaluate(() => document.activeElement?.dataset.action);
    pass('RF-1d focus returns to the button that opened the sheet', focusBack === 'expense-add', { focusBack });

    // ---------- RF-2 ----------
    const before = (await trip(page)).expenses.length;
    await page.click('#panel-money [data-action="expense-add"]');
    await page.waitForFunction(() => document.querySelector('#dlg-expense').open);
    await page.fill('#dlg-expense [name="amount"]', '12,50');
    await page.fill('#dlg-expense [name="description"]', 'קפה דוגמה');
    await page.locator('#dlg-expense [type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('#dlg-expense').open);
    const exps = (await trip(page)).expenses;
    const added = exps.find((e) => e.description === 'קפה דוגמה');
    pass('RF-2 an expense typed as 12,50 is saved as 1250 agorot (12.50 shekels)', exps.length === before + 1 && added?.amountMinor === 1250 && added?.currency === 'ILS', { amountMinor: added?.amountMinor });

    // ---------- RF-3 ----------
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-places-')), 'friend-places.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'tisa-places', version: 1, exportedAt: '2030-01-01T00:00:00.000Z', places: [
      { id: 'friend"1', name: 'מקום מחבר', category: 'food', lat: null, lng: null, address: 'רחוב דוגמה 1', note: '' },
    ] }));
    await go(page, 'places');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-action="places-import"]')]);
    await chooser.setFiles(file);
    await page.waitForFunction(() => document.querySelector('#dlg-places-import')?.open);
    await page.click('[data-action="places-import-yes"]');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    const card = page.locator('#panel-places [data-action="place-edit"][data-place-id="friend\\"1"]');
    pass('RF-3a the imported place is listed', (await card.count()) === 1);
    await card.click();
    await page.waitForFunction(() => document.querySelector('#dlg-place')?.open);
    await page.fill('#dlg-place [name="note"]', 'הערת דוגמה');
    await page.locator('#dlg-place [type="submit"]').click();
    const closed = await page.waitForFunction(() => !document.querySelector('#dlg-place').open, null, { timeout: 4000 }).then(() => true, () => false);
    const saved = (await trip(page)).places.find((p) => p.id === 'friend"1');
    pass('RF-3b editing the imported place saves and closes the sheet', closed && saved?.note === 'הערת דוגמה', { closed, note: saved?.note });
    if (!closed) await page.keyboard.press('Escape');
    await card.click(); // delete from inside the edit sheet: that button looks the card up by the place id
    await page.waitForFunction(() => document.querySelector('#dlg-place')?.open);
    await page.click('#dlg-place [data-action="place-delete-from-form"]');
    await page.waitForFunction(() => document.querySelector('#dlg-place-delete')?.open, null, { timeout: 4000 }).catch(() => {});
    const askOpen = await page.evaluate(() => Boolean(document.querySelector('#dlg-place-delete')?.open));
    if (askOpen) {
      await page.click('[data-action="place-delete-yes"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-place-delete').open);
    }
    const gone = !(await trip(page)).places.some((p) => p.id === 'friend"1');
    pass('RF-3c deleting the imported place from its edit sheet asks first, then removes it', askOpen && gone, { askOpen, gone });

    pass('RF-E no page errors', errors.length === 0, { errors });
    pass('RF-N no request leaves the app', outside.length === 0, { outside });
    await ctx.close();
  } catch (e) {
    pass('RF-X script finished', false, { error: e.message });
  } finally {
    await browser.close();
    server.kill();
  }
  const fails = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  fs.writeFileSync(path.join(OUT, `review-fixes-run${RUN}.json`), JSON.stringify(results, null, 2));
  for (const [k, v] of Object.entries(results)) console.log(`${v.result} ${k}`);
  console.log(fails.length ? `FAIL ${fails.length}` : 'ALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
