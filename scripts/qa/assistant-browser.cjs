// 0.5.4 assistant screen (docs/GOALS_STAGE5.md AB-1..AB-6), mobile 375 and desktop 1280.
// Stage 9 (owner, 2026-11-21): the old route and the 3 old profiles moved to the archive; this script uses them from there.
// Waits for UI state (rule 6). Run 3 times before PASS. QA_OUT for reruns (rule 10).
// Run from the repo root: node scripts/qa/assistant-browser.cjs   (port 8078)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage5/assistant-0.5.4');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8078;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const closed = (page, sel) => page.waitForSelector(`${sel}:not([open])`, { state: 'attached' });
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); };
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
const txt = async (page, sel) => (await page.locator(sel).textContent()).trim();
const ready = (page) => page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);

async function context(browser, w, h, tag) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  await page.clock.setFixedTime(new Date('2026-12-12T09:00:00+07:00'));
  return { ctx, page };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  for (const [w, h, tag] of [[375, 812, 'mobile'], [1280, 900, 'desktop']]) {
    // ---------- AB-1: no data yet: says so, guesses nothing ----------
    {
      const { ctx, page } = await context(browser, w, h, tag);
      await page.goto(`${BASE}#/home`);
      await ready(page);
      await page.click('[data-go="assistant"]');
      await page.waitForSelector('#panel-assistant', { state: 'visible' });
      const money = await txt(page, '[data-slot="ast-money"]');
      const today = await txt(page, '[data-slot="ast-today"]');
      const future = await txt(page, '[data-slot="ast-future"]');
      await shot(page, `after-assistant-empty-${tag}`);
      pass(`AB-1 no data (${tag})`, /עוד אין תקציב/.test(money) && !/₪/.test(money) && /אין משהו מתוכנן להיום/.test(today) && /בגרסה עתידית/.test(future) && !/\d/.test(future),
        { money, today, future });
      await ctx.close();
    }

    // ---------- AB-2..AB-5 with real data ----------
    const { ctx, page } = await context(browser, w, h, tag);
    await page.goto(`${BASE}#/itinerary`);
    await ready(page);
    await page.click('[data-slot="itin-empty"] [data-action="seed-archive-open"]');
    await page.click('[data-action="seed-confirm"]');
    await closed(page, '#dlg-seed');
    await page.click('[data-tab="budget"]');
    await page.click('[data-slot="money-empty"] [data-action="profile-open"]');
    await page.locator('#dlg-profile details.profile-archive').evaluate((d) => { d.open = true; }); await page.check('#dlg-profile input[value="realistic"]');
    await page.click('#dlg-profile [type="submit"]');
    await closed(page, '#dlg-profile');
    const add = async (amount, category, status) => {
      await page.click('#panel-money [data-action="expense-add"]');
      await page.fill('#dlg-expense [name="amount"]', amount);
      await page.selectOption('#dlg-expense [name="category"]', category);
      await page.selectOption('#dlg-expense [name="status"]', status);
      await page.click('#dlg-expense [type="submit"]');
      await closed(page, '#dlg-expense');
    };
    await add('3000', 'food', 'paid'); // food plan is 2,100: over
    await add('2000', 'lodging', 'planned');
    const fromMoney = { before: await txt(page, '[data-slot="money-free-before"]'), after: await txt(page, '[data-slot="money-free"]'), today: await txt(page, '[data-slot="money-today"]') };
    await page.click('[data-tab="lists"]');
    const task = async (title, due) => {
      await page.click('#panel-checklist [data-action="task-add"]');
      await page.fill('#dlg-task [name="title"]', title);
      if (due) await page.fill('#dlg-task [name="due"]', due);
      await page.click('#dlg-task [type="submit"]');
      await closed(page, '#dlg-task');
    };
    await task('לשלם על הלינה', '2026-12-10');
    await task('לקנות כרטיס לאוטובוס', '2026-12-12');
    await task('לארוז לאיים', '2026-12-15');
    await task('משהו בעוד שבועיים', '2026-12-26');
    await page.click('[data-tab="itinerary"]');
    await page.click('#panel-itinerary [data-go="transfers"]');
    await page.click('#panel-transfers [data-action="transfer-add"]');
    await page.selectOption('#dlg-transfer [name="kind"]', 'bus');
    await page.fill('#dlg-transfer [name="from"]', 'פאי');
    await page.fill('#dlg-transfer [name="to"]', "צ'יאנג מאי");
    await page.fill('#dlg-transfer [name="date"]', '2026-12-12');
    await page.fill('#dlg-transfer [name="time"]', '13:30');
    await page.click('#dlg-transfer [type="submit"]');
    await closed(page, '#dlg-transfer');
    await page.click('[data-tab="home"]');
    await page.click('[data-go="assistant"]');
    await page.waitForSelector('#panel-assistant', { state: 'visible' });
    await toastGone(page);

    const money = await txt(page, '[data-slot="ast-money"]');
    const n = (s) => (s.match(/[\d,]+(?:\.\d+)?/g) ?? []).map((x) => x.replace(/,/g, ''));
    const sameNumbers = n(fromMoney.before).every((x) => money.includes(Number(x).toLocaleString('en-US')) || money.includes(x))
      && n(fromMoney.after).every((x) => money.includes(Number(x).toLocaleString('en-US')) || money.includes(x));
    const warn = await txt(page, '[data-slot="ast-warn"]');
    const howHidden = await page.locator('[data-slot="ast-how"] .how-body').isHidden();
    await page.click('[data-slot="ast-how"] summary');
    const how = await txt(page, '[data-slot="ast-how"]');
    pass(`AB-2 money (${tag})`, sameNumbers && /פנוי לפני התכנון/.test(money) && /פנוי אחרי התכנון/.test(money) && /פנוי היום/.test(money)
      && /אוכל/.test(warn) && howHidden && /15,270/.test(how) && /3,000/.test(how) && /2,000/.test(how) && /23 ימים/.test(how) && /בנגקוק/.test(how),
    { fromMoney, money: money.slice(0, 200), warn, how: how.slice(0, 300) });

    const today = await txt(page, '[data-slot="ast-today"]');
    pass(`AB-3 today (${tag})`, /פאי/.test(today) && /13:30/.test(today) && /צ'יאנג מאי/.test(today) && /לשלם על הלינה/.test(today) && /לקנות כרטיס לאוטובוס/.test(today), { today });

    const due = await txt(page, '[data-slot="ast-due"]');
    pass(`AB-4 tasks due (${tag})`, /לשלם על הלינה/.test(due) && /לארוז לאיים/.test(due) && !/משהו בעוד שבועיים/.test(due) && /7/.test(due), { due });
    await shot(page, `after-assistant-${tag}`);

    const audit = await page.evaluate(() => {
      const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]'); };
      const root = document.querySelector('#panel-assistant');
      const small = [...root.querySelectorAll('button, a, summary')].filter(vis).map((b) => ({ el: b.dataset.go ?? b.tagName, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
      const tiny = [...root.querySelectorAll('*')].filter((x) => vis(x) && [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 14).map((x) => x.textContent.trim().slice(0, 20));
      return { hscroll: document.documentElement.scrollWidth > innerWidth, small, tiny, homeTabSelected: document.querySelector('[data-tab="home"]').getAttribute('aria-selected') };
    });
    pass(`AB-5 layout (${tag})`, !audit.hscroll && !audit.small.length && !audit.tiny.length && audit.homeTabSelected === 'true', audit);
    await ctx.close();
  }

  pass('no JS errors', errors.length === 0, { errors });
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [k, r] of Object.entries(results)) console.log(`${r.result}  ${k}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
