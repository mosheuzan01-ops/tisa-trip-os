// 0.5.1 search + sticky filter bar (docs/GOALS_STAGE5.md S51-4..S51-9), at 375px (mobile) and 1280px (desktop).
// Stage 9 (owner, 2026-11-21): the old route and the 3 old profiles moved to the archive; this script uses them from there.
// Waits for UI state, not fixed sleeps (rule 6). Run 3 times before calling it PASS. QA_OUT for reruns (rule 10).
// Run from the repo root: node scripts/qa/search-browser.cjs   (port 8085)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage5/search-0.5.1');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8085;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const shot = async (page, name, full = false) => { if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); };
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
const texts = (page, sel) => page.locator(sel).allTextContents();
const typeSearch = async (page, screen, q) => {
  await page.fill(`[data-search="${screen}"] [data-slot="search-input"]`, q);
  await page.waitForFunction(([s, v]) => document.querySelector(`[data-search="${s}"]`).dataset.query === v, [screen, q.trim()]);
};

async function setup(browser, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${w}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) errors.push(`${w}: ${m.text()}`); });
  await page.clock.setFixedTime(new Date('2026-12-12T09:00:00+07:00'));
  await page.goto(`${BASE}#/itinerary`);
  await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
  await page.click('[data-slot="itin-empty"] [data-action="seed-archive-open"]');
  await page.click('[data-action="seed-confirm"]');
  await closed(page, '#dlg-seed');
  await page.click('[data-tab="budget"]');
  await page.click('[data-slot="money-empty"] [data-action="profile-open"]');
  await page.locator('#dlg-profile details.profile-archive').evaluate((d) => { d.open = true; }); await page.check('#dlg-profile input[value="realistic"]');
  await page.click('#dlg-profile [type="submit"]');
  await closed(page, '#dlg-profile');
  const add = async (amount, category, description, stop, note = '') => {
    await page.click('#panel-money [data-action="expense-add"]');
    await page.fill('#dlg-expense [name="amount"]', amount);
    await page.selectOption('#dlg-expense [name="category"]', category);
    await page.selectOption('#dlg-expense [name="destinationId"]', { label: stop });
    await page.fill('#dlg-expense [name="description"]', description);
    if (note) await page.fill('#dlg-expense [name="note"]', note);
    await page.click('#dlg-expense [type="submit"]');
    await closed(page, '#dlg-expense');
  };
  await add('1200', 'lodging', 'מלון בבנגקוק', 'בנגקוק');
  await add('80', 'food', 'פאד תאי', 'בנגקוק');
  await add('300', 'transport', 'טוקטוק', 'פאי');
  await add('950', 'lodging', 'מלון בצ׳יאנג מאי', "צ'יאנג מאי");
  await add('45', 'food', 'קפה', 'פאי', 'ליד המלון');
  for (let i = 0; i < 6; i += 1) await add('20', 'misc', `מים ${i + 1}`, 'פאי'); // a long list to scroll
  await page.click('[data-tab="lists"]');
  for (const which of ['list-seed', 'tasks-seed']) {
    await page.click(`[data-action="${which}"]`);
    await page.click('[data-action="list-confirm-yes"]');
    await closed(page, '#dlg-list-confirm');
  }
  await page.click('#panel-checklist [data-action="task-add"]');
  await page.fill('#dlg-task [name="title"]', 'לאשר מלון בבנגקוק');
  await page.click('#dlg-task [type="submit"]');
  await closed(page, '#dlg-task');
  await page.click('.item:has-text("מטען לטלפון") [data-action="item-edit"]');
  await page.fill('#dlg-item [name="note"]', 'לקנות בבנגקוק');
  await page.click('#dlg-item [type="submit"]');
  await closed(page, '#dlg-item');
  await toastGone(page);
  return { ctx, page };
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  for (const [w, h, tag] of [[375, 812, 'mobile'], [1280, 900, 'desktop']]) {
    const { ctx, page } = await setup(browser, w, h);

    // ---------- money ----------
    await page.click('[data-tab="budget"]');
    const totals = async () => ({ after: (await page.locator('[data-slot="money-free"]').textContent()).trim(), before: (await page.locator('[data-slot="money-free-before"]').textContent()).trim() });
    const t0 = await totals();
    const all = await page.locator('#panel-money .exp').count();
    const filteredHiddenAtStart = await page.locator('[data-slot="money-filtered"]').isHidden();
    await typeSearch(page, 'money', 'בנגקוק');
    const bkk = await texts(page, '#panel-money .exp-name');
    const bkkSummary = (await page.locator('[data-slot="money-filtered"]').textContent()).trim();
    await typeSearch(page, 'money', 'מלון');
    const hotel = await texts(page, '#panel-money .exp-name');
    const hotelSummary = (await page.locator('[data-slot="money-filtered"]').textContent()).trim();
    const t1 = await totals();
    await typeSearch(page, 'money', 'מזומן'); // payment method (all are cash by default)
    const byMethod = await page.locator('#panel-money .exp').count();
    await typeSearch(page, 'money', 'MLN-none');
    const empty = (await page.locator('[data-slot="exp-empty"]').textContent()).trim();
    await page.click('[data-search="money"] [data-action="search-clear"]');
    await page.waitForFunction(() => document.querySelector('[data-search="money"]').dataset.query === '');
    const cleared = { count: await page.locator('#panel-money .exp').count(), value: await page.inputValue('[data-search="money"] [data-slot="search-input"]'), summaryHidden: await page.locator('[data-slot="money-filtered"]').isHidden() };
    pass(`S51-4 money (${tag})`, all === 11 && filteredHiddenAtStart
      && bkk.length === 2 && bkk.includes('מלון בבנגקוק') && bkk.includes('פאד תאי') && /2 הוצאות/.test(bkkSummary) && /1,280/.test(bkkSummary)
      && hotel.length === 3 && ['מלון בבנגקוק', 'מלון בצ׳יאנג מאי', 'קפה'].every((x) => hotel.includes(x)) && /3 הוצאות/.test(hotelSummary) && /2,195/.test(hotelSummary)
      && byMethod === 11 && empty === 'אין תוצאות' && cleared.count === 11 && cleared.value === '' && cleared.summaryHidden,
    { all, bkk, bkkSummary, hotel, hotelSummary, byMethod, empty, cleared });
    pass(`S51-5 totals unchanged (${tag})`, JSON.stringify(t0) === JSON.stringify(t1), { t0, t1 });

    // sticky bar on money: type, scroll the long list, still visible and working; folds stay closed
    await typeSearch(page, 'money', 'מ');
    await page.locator('#panel-money .exp').last().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    const moneySticky = await page.evaluate(() => {
      const bar = document.querySelector('[data-slot="money-filter-bar"]').getBoundingClientRect();
      const nav = document.querySelector('.tabbar').getBoundingClientRect();
      const hero = document.querySelector('.money-hero').getBoundingClientRect();
      const firstShown = [...document.querySelectorAll('#panel-money .exp')].map((e) => e.getBoundingClientRect()).find((r) => r.bottom > bar.bottom);
      return {
        scrollY: Math.round(scrollY), barTop: Math.round(bar.top), barBottom: Math.round(bar.bottom), inView: bar.top >= 0 && bar.bottom <= innerHeight,
        heroCovered: hero.bottom > bar.top && hero.top < bar.bottom,
        navCovered: nav.width < innerWidth / 2 ? false : bar.bottom > nav.top, // desktop nav is a side rail
        value: document.querySelector('[data-search="money"] [data-slot="search-input"]').value,
        hscroll: document.documentElement.scrollWidth > innerWidth,
        foldsOpen: [...document.querySelectorAll('#panel-money details')].filter((d) => d.open).length,
        listVisibleUnderBar: Boolean(firstShown),
      };
    });
    await shot(page, `after-money-scrolled-${tag}`);
    await page.selectOption('[data-filter="category"]', 'lodging'); // filters still work while stuck
    const stuckFilter = await page.locator('#panel-money .exp').count();
    await page.selectOption('[data-filter="category"]', '');
    await page.click('[data-search="money"] [data-action="search-clear"]');
    await page.evaluate(() => window.scrollTo(0, 0));
    const atTop = await page.evaluate(() => {
      const bar = document.querySelector('[data-slot="money-filter-bar"]').getBoundingClientRect();
      const hero = document.querySelector('.money-hero').getBoundingClientRect();
      return { heroAboveBar: hero.bottom <= bar.top };
    });
    await shot(page, `after-money-${tag}`, true);
    pass(`S51-6 money sticky (${tag})`, moneySticky.scrollY > 300 && moneySticky.inView && moneySticky.barTop <= 1 && !moneySticky.heroCovered && !moneySticky.navCovered
      && moneySticky.value === 'מ' && !moneySticky.hscroll && moneySticky.foldsOpen === 0 && moneySticky.listVisibleUnderBar && stuckFilter === 2 && atTop.heroAboveBar,
    { moneySticky, stuckFilter, atTop });

    // ---------- lists ----------
    await page.click('[data-tab="lists"]');
    const bars0 = (await page.locator('[data-slot="prep-num"]').textContent()).trim();
    await typeSearch(page, 'lists', 'בנגקוק');
    const li = { items: await texts(page, '#panel-checklist .item .item-name'), tasks: await texts(page, '#panel-checklist .task .item-name'), summary: (await page.locator('[data-slot="lists-filtered"]').textContent()).trim() };
    await typeSearch(page, 'lists', 'מלון');
    const lh = { items: await page.locator('#panel-checklist .item').count(), tasks: await texts(page, '#panel-checklist .task .item-name') };
    await typeSearch(page, 'lists', 'ESIM');
    const esim = await texts(page, '#panel-checklist .item .item-name');
    await typeSearch(page, 'lists', 'MLN-none');
    const lEmpty = { text: (await page.locator('[data-slot="lists-no-results"]').textContent()).trim(), visible: await page.locator('[data-slot="lists-no-results"]').isVisible() };
    const bars1 = (await page.locator('[data-slot="prep-num"]').textContent()).trim();
    await page.click('[data-search="lists"] [data-action="search-clear"]');
    await page.waitForFunction(() => document.querySelector('[data-search="lists"]').dataset.query === '');
    const lCleared = { items: await page.locator('#panel-checklist .item').count(), tasks: await page.locator('#panel-checklist .task').count(), noResultsHidden: await page.locator('[data-slot="lists-no-results"]').isHidden() };
    pass(`S51-4 lists (${tag})`, li.items.length === 1 && li.items[0] === 'מטען לטלפון' && li.tasks.length === 1 && li.tasks[0] === 'לאשר מלון בבנגקוק' && /1 פריטים.*1 משימות|פריט אחד.*משימה אחת/.test(li.summary)
      && lh.items === 0 && lh.tasks.length === 1 && esim.length === 1 && /eSIM/.test(esim[0])
      && lEmpty.text === 'אין תוצאות' && lEmpty.visible && bars1 === bars0 && lCleared.items === 21 && lCleared.tasks === 8 && lCleared.noResultsHidden,
    { li, lh, esim, lEmpty, bars0, bars1, lCleared });

    // sticky on lists: search + both hide toggles stay at the top while scrolling to the tasks
    await typeSearch(page, 'lists', 'ה');
    await page.check('[data-filter="hide-done-items"]');
    await page.locator('#panel-checklist .task').last().scrollIntoViewIfNeeded();
    const listsSticky = await page.evaluate(() => {
      const bar = document.querySelector('[data-slot="lists-bar"]').getBoundingClientRect();
      const prog = document.querySelector('.lists-progress').getBoundingClientRect();
      return {
        scrollY: Math.round(scrollY), barTop: Math.round(bar.top), inView: bar.top >= 0 && bar.bottom <= innerHeight,
        progressCovered: prog.bottom > bar.top && prog.top < bar.bottom,
        value: document.querySelector('[data-search="lists"] [data-slot="search-input"]').value,
        toggle: document.querySelector('[data-filter="hide-done-items"]').checked,
        toggleInBar: Boolean(document.querySelector('[data-slot="lists-bar"] [data-filter="hide-done-tasks"]')),
        hscroll: document.documentElement.scrollWidth > innerWidth,
      };
    });
    await shot(page, `after-lists-scrolled-${tag}`);
    await page.uncheck('[data-filter="hide-done-items"]');
    await page.click('[data-search="lists"] [data-action="search-clear"]');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `after-lists-${tag}`, true);
    pass(`S51-6 lists sticky (${tag})`, listsSticky.scrollY > 300 && listsSticky.inView && listsSticky.barTop <= 1 && !listsSticky.progressCovered
      && listsSticky.value === 'ה' && listsSticky.toggle && listsSticky.toggleInBar && !listsSticky.hscroll, { listsSticky });
    await ctx.close();
  }

  pass('no JS errors', errors.length === 0, { errors });
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
