// Stage 4 add-ons at 375px (docs/GOALS_STAGE4.md S4-14..S4-17): converter, ATM, split, scenarios.
// Stage 9 (owner, 2026-11-21): the old route and the 3 old profiles moved to the archive; this script uses them from there.
// Waits for UI state, not fixed sleeps (docs/RULES.md rule 6). Run 3 times before calling it PASS.
// Run from the repo root: node scripts/qa/stage4-tools-browser.cjs   (port 8099)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.QA_OUT ? path.resolve(process.env.QA_OUT) : path.join(ROOT, 'docs/evidence/stage4/tools'); // rule 10: reruns write elsewhere
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s ? s.trips[s.activeTripId] : null; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); };

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(m.text()); });
  await page.clock.setFixedTime(new Date('2026-12-12T09:00:00+07:00'));
  await page.goto(`${BASE}#/money`);
  await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);

  // ---------- S4-17: scenario names, explanations, emergency 2,500 ----------
  await page.click('[data-slot="money-empty"] [data-action="profile-open"]');
  await page.locator('#dlg-profile details.profile-archive').evaluate((d) => { d.open = true; });
  const options = await page.locator('#dlg-profile details.profile-archive .replan-mode').allTextContents();
  await shot(page, 'after-profile-dialog-375');
  await page.locator('#dlg-profile details.profile-archive').evaluate((d) => { d.open = true; }); await page.check('#dlg-profile input[value="comfort"]');
  await page.click('#dlg-profile [type="submit"]');
  await closed(page, '#dlg-profile');
  const b = (await trip(page)).budget;
  const em = await page.locator('[data-slot="cat-emergency"]').textContent();
  pass('S4-17', options.length === 3 && /חסכון/.test(options[0]) && /ממוצע/.test(options[1]) && /אופטימלי/.test(options[2])
    && options.every((o) => o.length > 20) && b.profileId === 'comfort' && b.categoriesMinor.emergency === 250000 && /2,500/.test(em),
  { options, emergency: b.categoriesMinor.emergency, emText: em.slice(0, 40) });

  // ---------- S4-14: converter ----------
  // Since 0.4.2 the calculators and the split start folded: open them as a user would.
  await page.click('[data-slot="tools-fold"] summary');
  await page.click('[data-slot="split-fold"] summary');
  await page.fill('[data-form="convert"] [name="amount"]', '100');
  const fromIls = await page.locator('[data-slot="convert-out"] li').allTextContents();
  await page.selectOption('[data-slot="convert-currency"]', 'THB');
  await page.fill('[data-form="convert"] [name="amount"]', '1,000');
  const fromThb = await page.locator('[data-slot="convert-out"] li').allTextContents();
  await page.fill('[data-form="convert"] [name="amount"]', 'abc');
  const bad = await page.locator('[data-slot="convert-out"] li').count();
  await page.fill('[data-form="convert"] [name="amount"]', '1,000');
  const n = (s) => Number(s.replace(/[^\d.]/g, ''));
  pass('S4-14', fromIls.map(n).join() === '100,1000,27.03' && fromThb.map(n).join() === '100,1000,27.03' && bad === 0, { fromIls, fromThb, badRows: bad });

  // ---------- S4-15: ATM ----------
  const feeDefault = await page.inputValue('[data-form="atm"] [name="fee"]');
  await page.fill('[data-form="atm"] [name="amount"]', '10000');
  const atm1 = (await page.locator('[data-slot="atm-out"]').textContent()).trim();
  await page.fill('[data-form="atm"] [name="fee"]', '250');
  const atm2 = (await page.locator('[data-slot="atm-out"]').textContent()).trim();
  await page.fill('[data-form="atm"] [name="fee"]', 'x');
  const atm3 = (await page.locator('[data-slot="atm-out"]').textContent()).trim();
  await page.fill('[data-form="atm"] [name="fee"]', '220');
  await page.locator('.money-tools').scrollIntoViewIfNeeded();
  await shot(page, 'after-calculators-375');
  pass('S4-15', feeDefault === '220' && /10,220/.test(atm1) && /1,022/.test(atm1) && /2\.2%/.test(atm1) && /10,250/.test(atm2) && /2\.5%/.test(atm2) && /במספרים/.test(atm3),
    { feeDefault, atm1, atm2, atm3 });

  // ---------- S4-16: split ----------
  const addPerson = async (name) => { await page.fill('[data-form="person"] [name="name"]', name); await page.click('[data-form="person"] [type="submit"]'); };
  const needBefore = (await page.locator('[data-slot="settle"]').textContent()).trim();
  for (const p of ['משה', 'דנה', 'יוסי']) { await addPerson(p); }
  await page.waitForFunction(() => document.querySelectorAll('.person').length === 3);
  await addPerson('משה');
  const dupErr = (await page.locator('#person-error').textContent()).trim();
  const ids = Object.fromEntries((await trip(page)).people.map((p) => [p.name, p.id]));
  const addExp = async (amount, payer, shared) => {
    await page.click('#panel-money [data-action="expense-add"]');
    await page.fill('#dlg-expense [name="amount"]', amount);
    await page.selectOption('#dlg-expense [name="paidBy"]', ids[payer]);
    for (const [name, id] of Object.entries(ids)) await page.setChecked(`#dlg-expense input[name="sharedBy"][value="${id}"]`, shared.includes(name));
    await page.click('#dlg-expense [type="submit"]');
    await closed(page, '#dlg-expense');
  };
  await addExp('300', 'משה', ['משה', 'דנה', 'יוסי']);
  await addExp('60', 'דנה', ['דנה', 'יוסי']);
  const moves = await page.locator('.settle-list li').allTextContents();
  const saved = (await trip(page)).expenses.map((e) => [e.paidBy, e.sharedBy?.length]);
  await page.locator('.money-split-card').scrollIntoViewIfNeeded();
  await shot(page, 'after-split-375');
  // remove a person: cancel keeps, yes removes
  await page.click(`.person:has-text("יוסי") [data-action="person-delete"]`);
  const ask = await page.locator('[data-slot="person-delete-text"]').textContent();
  await page.click('#dlg-person-delete [data-close]');
  await closed(page, '#dlg-person-delete');
  const afterNo = (await trip(page)).people.length;
  await page.click(`.person:has-text("יוסי") [data-action="person-delete"]`);
  await page.click('[data-action="person-delete-confirm"]');
  await closed(page, '#dlg-person-delete');
  const afterYes = (await trip(page)).people.length;
  const expensesKept = (await trip(page)).expenses.length;
  pass('S4-16', /לפחות שני/.test(needBefore) && /כבר ברשימה/.test(dupErr)
    && moves.length === 2 && /יוסי למשה: .*130/.test(moves[0]) && /דנה למשה: .*70/.test(moves[1])
    && saved.every(([p, nShared]) => p && nShared) && /להסיר את יוסי/.test(ask) && afterNo === 3 && afterYes === 2 && expensesKept === 2,
  { needBefore, dupErr, moves, saved, ask, afterNo, afterYes, expensesKept });

  // ---------- backup keeps people and split fields ----------
  await page.click('.settings-btn');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
  const file = path.join(OUT, 'roundtrip.json');
  await download.saveAs(file);
  const before = await trip(page);
  await page.click('[data-action="reset-open"]');
  await page.fill('[data-slot="reset-input"]', 'איפוס');
  await page.click('[data-action="reset-confirm"]');
  await closed(page, '#dlg-reset');
  await page.setInputFiles('#import-file', file);
  await page.waitForSelector('#dlg-import[open]');
  await page.click('[data-action="import-confirm"]');
  await closed(page, '#dlg-import');
  const after = await trip(page);
  fs.unlinkSync(file);
  pass('backup (people + split)', JSON.stringify(before.people) === JSON.stringify(after.people) && JSON.stringify(before.expenses) === JSON.stringify(after.expenses) && after.people.length === 2,
    { people: after.people.length });

  // ---------- layout of the new cards and the expense dialog with split ----------
  await page.click('[data-tab="budget"]');
  const audit = async () => page.evaluate(() => {
    const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]') && !n.closest('dialog:not([open])'); };
    const roots = document.querySelector('dialog[open]') ? [document.querySelector('dialog[open]')] : [...document.querySelectorAll('.money-tools, .money-split-card')];
    const all = roots.flatMap((r) => [...r.querySelectorAll('*')]);
    const small = all.filter((b) => b.matches('button, input:not([type="checkbox"]), select, label.split-check') && vis(b)).map((b) => ({ el: b.name ?? b.className, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
    const tiny = all.filter((n) => vis(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 14).map((n) => n.textContent.trim().slice(0, 20));
    const clipped = all.filter((b) => b.matches('button') && vis(b) && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
    return { hscroll: document.documentElement.scrollWidth > innerWidth, small, tiny, clipped };
  });
  const cards = await audit();
  await page.click('#panel-money [data-action="expense-add"]');
  const dialog = await audit();
  await shot(page, 'after-expense-dialog-split-375', true);
  await page.click('#dlg-expense [data-close]');
  pass('layout (375px)', [cards, dialog].every((a) => !a.hscroll && !a.small.length && !a.tiny.length && !a.clipped.length), { cards, dialog });
  await page.click('[data-tab="budget"]');
  await page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
  await shot(page, 'after-money-375-light', true);

  pass('no JS errors', errors.length === 0, { errors });
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
