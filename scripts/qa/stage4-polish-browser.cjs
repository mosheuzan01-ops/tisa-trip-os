// 0.4.2 browser checks at 375px (docs/GOALS_STAGE4.md S4-18..S4-24).
// Waits for UI state, not fixed sleeps (docs/RULES.md rule 6). Run 3 times before calling it PASS.
// Run from the repo root: node scripts/qa/stage4-polish-browser.cjs   (port 8089)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.QA_OUT ? path.resolve(process.env.QA_OUT) : path.join(ROOT, 'docs/evidence/stage4/polish'); // rule 10: reruns write elsewhere
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8089;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s ? s.trips[s.activeTripId] : null; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); };
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ''));
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});

async function setup(browser, when, scheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: 'he-IL', colorScheme: scheme, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(m.text()); });
  await page.clock.setFixedTime(new Date(when));
  await page.goto(`${BASE}#/home`);
  await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
  await page.click('[data-open="dates"]');
  await page.fill('#dlg-dates [name="start"]', '2026-12-05');
  await page.fill('#dlg-dates [name="end"]', '2027-01-03');
  await page.click('#dlg-dates [type="submit"]');
  await closed(page, '#dlg-dates');
  await page.click('[data-tab="budget"]');
  await page.click('[data-slot="money-empty"] [data-action="profile-open"]');
  await page.check('#dlg-profile input[value="saver"]');
  await page.click('#dlg-profile [type="submit"]');
  await closed(page, '#dlg-profile');
  return { ctx, page };
}

async function addExpense(page, o) {
  await page.click('#panel-money [data-action="expense-add"]');
  await page.fill('#dlg-expense [name="amount"]', o.amount);
  for (const k of ['currency', 'category', 'status']) if (o[k]) await page.selectOption(`#dlg-expense [name="${k}"]`, o[k]);
  if (o.description) await page.fill('#dlg-expense [name="description"]', o.description);
  if (o.paidBy) {
    await page.selectOption('#dlg-expense [name="paidBy"]', { label: o.paidBy });
    await page.selectOption('#dlg-expense [name="splitMode"]', o.mode ?? 'equal');
    for (const [name, value] of Object.entries(o.shares ?? {})) {
      const row = page.locator('#dlg-expense .split-row', { hasText: name });
      await row.locator('input[type="checkbox"]').setChecked(value !== null);
      if (value !== null && o.mode !== 'equal') await row.locator('.split-value').fill(String(value));
    }
  }
  await page.click('#dlg-expense [type="submit"]');
  if (o.expectError) return (await page.locator('#expense-error').textContent()).trim();
  await closed(page, '#dlg-expense');
  return '';
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  {
    const { ctx, page } = await setup(browser, '2026-12-20T09:00:00+07:00'); // 15 days left, saver: 9,800 running
    // S4-24: folded by default
    const folded = await page.evaluate(() => ['split-fold', 'tools-fold'].map((s) => document.querySelector(`[data-slot="${s}"]`).open));
    await toastGone(page);
    await shot(page, 'after-money-folded-375-light', true);

    // S4-18: two "free" figures
    await addExpense(page, { amount: '1000', category: 'food', status: 'paid', description: 'אוכל' });
    await addExpense(page, { amount: '2000', category: 'lodging', status: 'planned', description: 'מלון' });
    const big = num(await page.locator('[data-slot="money-free"]').textContent());
    const before = (await page.locator('[data-slot="money-free-before"]').textContent()).trim();
    const today = (await page.locator('[data-slot="money-today"]').textContent()).trim();
    pass('S4-18', big === 6800 && /פנוי לפני התכנון: .*8,800/.test(before) && /^פנוי היום: .*453/.test(today)
      && (await page.locator('#money-free-label').textContent()).trim() === 'פנוי אחרי התכנון', { big, before, today });

    // S4-19: is it worth it?
    await page.click('[data-slot="tools-fold"] summary');
    await page.fill('[data-form="afford"] [name="item"]', 'מתנה');
    await page.fill('[data-form="afford"] [name="price"]', '200');
    const ok = await page.locator('[data-slot="afford-out"] p').allTextContents();
    await page.locator('[data-form="afford"]').scrollIntoViewIfNeeded();
    await shot(page, 'after-afford-ok-375');
    await page.fill('[data-form="afford"] [name="price"]', '8000');
    const over = await page.locator('[data-slot="afford-out"] p').allTextContents();
    await shot(page, 'after-afford-over-375');
    await page.selectOption('[data-slot="afford-currency"]', 'THB');
    await page.fill('[data-form="afford"] [name="price"]', '2000');
    const thb = await page.locator('[data-slot="afford-out"] p').allTextContents();
    await page.click('[data-action="afford-add"]');
    const prefilled = [await page.inputValue('#dlg-expense [name="amount"]'), await page.inputValue('#dlg-expense [name="currency"]'), await page.inputValue('#dlg-expense [name="description"]')];
    await page.click('#dlg-expense [data-close]');
    await closed(page, '#dlg-expense');
    pass('S4-19', /בתוך התקציב/.test(ok[0]) && /6,800/.test(ok[1]) && /6,600/.test(ok[2]) && /453.*440/.test(ok[3])
      && /חריגה של .*1,200/.test(over[0]) && /-1,200|1,200-|‎-1,200/.test(over[2]) && /6,600/.test(thb[2]) && prefilled.join('|') === '2000|THB|מתנה',
    { ok, over, thb, prefilled });

    // S4-20: CSV
    await page.locator('[data-action="csv-export"]').scrollIntoViewIfNeeded();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="csv-export"]')]);
    const file = path.join(OUT, 'sample-expenses.csv');
    await download.saveAs(file);
    const csv = fs.readFileSync(file, 'utf8');
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    pass('S4-20', csv.startsWith('﻿') && lines.length === 3 && /^תאריך,תיאור,קטגוריה,סכום,מטבע/.test(lines[0]) && /,אוכל,.*1000\.00,ILS,1,1000\.00,שולם/.test(lines[1]) && download.suggestedFilename() === 'tisa-expenses-2026-12-20.csv',
      { file: download.suggestedFilename(), lines });

    // S4-21 + S4-22: uneven split and repayment
    await page.click('[data-slot="split-fold"] summary');
    for (const p of ['משה', 'דנה']) { await page.fill('[data-form="person"] [name="name"]', p); await page.click('[data-form="person"] [type="submit"]'); }
    await page.waitForFunction(() => document.querySelectorAll('.person').length === 2);
    const badPct = await addExpense(page, { amount: '100', category: 'food', status: 'paid', description: 'ארוחה', paidBy: 'משה', mode: 'percent', shares: { 'משה': 70, 'דנה': 20 }, expectError: true });
    await page.locator('#dlg-expense .split-row', { hasText: 'דנה' }).locator('.split-value').fill('30');
    await page.click('#dlg-expense [type="submit"]');
    await closed(page, '#dlg-expense');
    await shot(page, 'after-split-percent-375', true);
    await addExpense(page, { amount: '300', currency: 'THB', category: 'transport', status: 'paid', description: 'טוקטוק', paidBy: 'דנה', mode: 'amount', shares: { 'משה': 200, 'דנה': 100 } });
    const moves = await page.locator('.settle-list .settle-item').allTextContents();
    const saved = (await trip(page)).expenses.filter((e) => e.paidBy).map((e) => [e.description, e.split?.mode, JSON.stringify(e.split?.shares)]);
    await page.locator('.settle-list').first().scrollIntoViewIfNeeded();
    await shot(page, 'after-settle-375');
    await page.click('[data-action="repay"]');
    const ask = (await page.locator('[data-slot="confirm-text"]').textContent()).trim();
    await page.click('#dlg-confirm [data-close]');
    await closed(page, '#dlg-confirm');
    const afterNo = ((await trip(page)).repayments ?? []).length;
    await page.click('[data-action="repay"]');
    await page.click('[data-action="confirm-yes"]');
    await closed(page, '#dlg-confirm');
    const settled = (await page.locator('[data-slot="settle"]').textContent()).trim();
    const repaid = await page.locator('[data-slot="repaid"] li').allTextContents();
    await page.click('[data-action="unrepay"]');
    await page.click('[data-action="confirm-yes"]');
    await closed(page, '#dlg-confirm');
    const back = await page.locator('.settle-list .settle-item').count();
    pass('S4-21', /100/.test(badPct) && saved.length === 2 && saved[0][1] === 'percent' && saved[0][2] === '{"' + (await trip(page)).people[0].id + '":7000,"' + (await trip(page)).people[1].id + '":3000}' && saved[1][1] === 'amount',
      { badPct, saved });
    pass('S4-22', moves.length === 1 && /דנה למשה: .*10/.test(moves[0]) && /דנה .*משה .*10/.test(ask) && afterNo === 0 && /הכול מאוזן/.test(settled) && repaid.length === 1 && back === 1,
      { moves, ask, afterNo, settled, repaid, backAfterUndo: back });

    // layout audit with everything open
    const audit = await page.evaluate(() => {
      const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]') && !n.closest('dialog:not([open])') && !n.closest('details:not([open]) > :not(summary)'); };
      const root = document.querySelector('#panel-money');
      const small = [...root.querySelectorAll('button, summary, input:not([type="checkbox"]), select')].filter((b) => vis(b) && !b.disabled).map((b) => ({ el: b.dataset.action ?? b.name ?? b.tagName, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
      const tiny = [...root.querySelectorAll('*')].filter((n) => vis(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 14).map((n) => n.textContent.trim().slice(0, 20));
      const clipped = [...root.querySelectorAll('button')].filter((b) => vis(b) && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
      return { hscroll: document.documentElement.scrollWidth > innerWidth, small, tiny, clipped };
    });
    await page.click('#panel-money [data-action="expense-add"]');
    await page.selectOption('#dlg-expense [name="paidBy"]', { label: 'משה' });
    await page.selectOption('#dlg-expense [name="splitMode"]', 'percent');
    await shot(page, 'after-expense-split-dialog-375', true);
    const dlgAudit = await page.evaluate(() => {
      const d = document.querySelector('#dlg-expense');
      const small = [...d.querySelectorAll('button, input:not([type="checkbox"]), select, label.split-check')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('[hidden]') && !b.hidden).map((b) => ({ el: b.name ?? b.className, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
      return { small };
    });
    await page.click('#dlg-expense [data-close]');
    pass('S4-24', folded.every((o) => o === false) && !audit.hscroll && !audit.small.length && !audit.tiny.length && !audit.clipped.length && !dlgAudit.small.length, { folded, audit, dlgAudit });
    fs.unlinkSync(file);
    await ctx.close();
  }

  // ---------- S4-23: soft over-budget alert at home ----------
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await setup(browser, '2026-12-20T09:00:00+07:00', scheme);
    await addExpense(page, { amount: '9900', category: 'lodging', status: 'committed', description: 'מלונות' });
    await page.click('[data-tab="home"]');
    const card = await page.evaluate(() => {
      const c = document.querySelector('.today');
      const cs = getComputedStyle(c);
      return { over: c.classList.contains('is-over'), bg: cs.backgroundColor, border: cs.borderInlineStartWidth, text: document.querySelector('[data-slot="today-money"]').textContent, color: getComputedStyle(document.querySelector('[data-slot="today-money"]')).color };
    });
    await toastGone(page);
    await shot(page, `after-home-over-375-${scheme}`, true);
    results[`S4-23 ${scheme}`] = { result: card.over && card.border === '3px' && /חרגתם/.test(card.text) ? 'PASS' : 'FAIL', ...card };
    await ctx.close();
  }

  pass('no JS errors', errors.length === 0, { errors });
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
