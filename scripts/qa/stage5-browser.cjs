// Stage 5 browser checks at 375px (docs/GOALS_STAGE5.md S5-1, S5-3..S5-11).
// Waits for UI state, not fixed sleeps (docs/RULES.md rule 6). Run 3 times before calling it PASS.
// Writes only to docs/evidence/stage5 (rule 10). Run from the repo root: node scripts/qa/stage5-browser.cjs (port 8088)
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage5');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PORT = 8088;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEW = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce' };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const bag = { errors: [], external: [] };
const trip = (page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('tisa:v1')); return s ? s.trips[s.activeTripId] : null; });
const closed = (page, id) => page.waitForSelector(`${id}:not([open])`, { state: 'attached' });
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };
const shot = async (page, name, full = true) => { if (SHOTS) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); };
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});

function watch(page) {
  page.on('pageerror', (e) => bag.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Service Worker registration blocked/.test(m.text())) bag.errors.push(`console: ${m.text()}`); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(blob|data):/.test(u.protocol)) bag.external.push(r.url()); });
}
async function fresh(browser, when, extra = {}) {
  const ctx = await browser.newContext({ ...VIEW, serviceWorkers: 'block', ...extra });
  const page = await ctx.newPage();
  watch(page);
  await page.clock.setFixedTime(new Date(when));
  await page.goto(`${BASE}#/checklist`);
  await ready(page);
  return { ctx, page };
}
async function seed(page, which) {
  await page.click(`[data-action="${which}"]`);
  await page.click('[data-action="list-confirm-yes"]');
  await closed(page, '#dlg-list-confirm');
}
async function addTask(page, { title, due, status }) {
  await page.click('#panel-checklist [data-action="task-add"]');
  await page.fill('#dlg-task [name="title"]', title);
  if (due) await page.fill('#dlg-task [name="due"]', due);
  if (status) await page.selectOption('#dlg-task [name="status"]', status);
  await page.click('#dlg-task [type="submit"]');
  await closed(page, '#dlg-task');
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();

  {
    const { ctx, page } = await fresh(browser, '2026-11-25T09:00:00+07:00');
    await shot(page, 'after-checklist-empty-375-light');

    // S5-3: cancel loads nothing; yes loads once; a double tap does not duplicate; the button then goes away
    await page.click('[data-action="list-seed"]');
    await page.click('#dlg-list-confirm [data-close]');
    await closed(page, '#dlg-list-confirm');
    const afterNo = ((await trip(page))?.checklist ?? []).length;
    await page.click('[data-action="list-seed"]');
    await page.locator('[data-action="list-confirm-yes"]').evaluate((b) => { b.click(); b.click(); }); // two taps on the same button
    await closed(page, '#dlg-list-confirm');
    const items = (await trip(page)).checklist.length;
    const emptyHidden = await page.locator('[data-slot="list-empty"]').isHidden();
    await page.click('[data-action="tasks-seed"]');
    await page.locator('[data-action="list-confirm-yes"]').evaluate((b) => { b.click(); b.click(); }); // two taps on the same button
    await closed(page, '#dlg-list-confirm');
    const tasks = (await trip(page)).tasks.length;
    pass('S5-3', afterNo === 0 && items === 21 && emptyHidden && tasks === 7, { afterNo, items, emptyHidden, tasks });

    // S5-8: rule-dependent items show "to check"; after writing source + date they show when
    const toCheck = await page.locator('.item-verify.is-open').count();
    const verifyItems = (await trip(page)).checklist.filter((x) => x.verify).length;
    await page.click('.item:has-text("אשרה ודרישות כניסה") [data-action="item-edit"]');
    const boxShown = await page.locator('[data-slot="verify-box"]').isVisible();
    await page.fill('#dlg-item [name="source"]', 'אתר רשמי');
    await page.fill('#dlg-item [name="checkedAt"]', '2026-11-24');
    await page.click('#dlg-item [type="submit"]');
    await closed(page, '#dlg-item');
    const checkedText = (await page.locator('.item:has-text("אשרה ודרישות כניסה") .item-verify').textContent()).trim();
    const bodyText = await page.locator('#panel-checklist').textContent();
    pass('S5-8', toCheck === verifyItems && verifyItems === 5 && boxShown && /נבדק ב-.*אתר רשמי/.test(checkedText) && !/\d+\s*(ימים|חודשים|יום|חודש|days|months)/.test(bodyText),
      { toCheck, verifyItems, checkedText });

    // S5-4: tick / untick and the two bars
    const bars = async () => ({ prep: (await page.locator('[data-slot="prep-num"]').textContent()).trim(), pack: (await page.locator('[data-slot="pack-num"]').textContent()).trim() });
    const b0 = await bars();
    await page.locator('.item:has-text("דרכון") [data-action="item-toggle"]').first().check();
    await page.locator('.item:has-text("בגד ים") [data-action="item-toggle"]').check();
    await page.locator('.item:has-text("מטען לטלפון") [data-action="item-toggle"]').check();
    const b1 = await bars();
    await page.locator('.item:has-text("בגד ים") [data-action="item-toggle"]').uncheck();
    const b2 = await bars();
    pass('S5-4', /0 מתוך 10.*\(0%\)/.test(b0.prep) && /0 מתוך 11/.test(b0.pack) && /1 מתוך 10.*\(10%\)/.test(b1.prep) && /2 מתוך 11.*\(18%\)/.test(b1.pack) && /1 מתוך 11.*\(9%\)/.test(b2.pack) && b2.prep === b1.prep,
      { b0, b1, b2 });

    // S5-5: edit an item; delete asks (cancel keeps, yes removes); same for a task
    await page.click('.item:has-text("סוללה ניידת") [data-action="item-edit"]');
    await page.fill('#dlg-item [name="qty"]', '0');
    await page.click('#dlg-item [type="submit"]');
    const qtyErr = (await page.locator('#item-error').textContent()).trim();
    await page.fill('#dlg-item [name="qty"]', '2');
    await page.fill('#dlg-item [name="note"]', 'אחת קטנה');
    await page.click('#dlg-item [type="submit"]');
    await closed(page, '#dlg-item');
    const edited = (await trip(page)).checklist.find((x) => x.name === 'סוללה ניידת');
    await page.click('.item:has-text("סוללה ניידת") [data-action="item-delete"]');
    const askItem = (await page.locator('[data-slot="list-confirm-text"]').textContent()).trim();
    await shot(page, 'after-delete-confirm-375', false);
    await page.click('#dlg-list-confirm [data-close]');
    await closed(page, '#dlg-list-confirm');
    const keptItem = (await trip(page)).checklist.length;
    await page.click('.item:has-text("סוללה ניידת") [data-action="item-delete"]');
    await page.click('[data-action="list-confirm-yes"]');
    await closed(page, '#dlg-list-confirm');
    const afterDelItem = (await trip(page)).checklist.length;
    await page.click('.task:has-text("תכנון מעברים") [data-action="task-delete"]');
    await page.click('#dlg-list-confirm [data-close]');
    await closed(page, '#dlg-list-confirm');
    const keptTask = (await trip(page)).tasks.length;
    await page.click('.task:has-text("תכנון מעברים") [data-action="task-delete"]');
    await page.click('[data-action="list-confirm-yes"]');
    await closed(page, '#dlg-list-confirm');
    const afterDelTask = (await trip(page)).tasks.length;
    pass('S5-5', /כמות/.test(qtyErr) && edited.qty === 2 && edited.note === 'אחת קטנה' && /למחוק את סוללה ניידת/.test(askItem)
      && keptItem === 21 && afterDelItem === 20 && keptTask === 7 && afterDelTask === 6, { qtyErr, edited: { qty: edited.qty, note: edited.note }, askItem, keptItem, afterDelItem, keptTask, afterDelTask });

    // S5-6 (screen) + S5-7: overdue mark, home card matches, quick action
    await page.click('.task:has-text("הזמנת טיסות") [data-action="task-edit"]');
    await page.fill('#dlg-task [name="due"]', '2026-11-20');
    await page.click('#dlg-task [type="submit"]');
    await closed(page, '#dlg-task');
    await page.click('.task:has-text("ביטוח נסיעות") [data-action="task-edit"]');
    await page.fill('#dlg-task [name="due"]', '2026-11-25');
    await page.selectOption('#dlg-task [name="status"]', 'doing');
    await page.click('#dlg-task [type="submit"]');
    await closed(page, '#dlg-task');
    await page.locator('.task:has-text("בדיקת מסמכים") [data-action="task-toggle"]').check();
    const overdue = await page.locator('.task.is-overdue .item-name').allTextContents();
    const todayDue = (await page.locator('.task:has-text("ביטוח נסיעות") .task-due').textContent()).trim();
    const screen = { open: (await trip(page)).tasks.filter((x) => x.status !== 'done').length, prep: (await page.locator('[data-slot="prep-num"]').textContent()).trim(), pack: (await page.locator('[data-slot="pack-num"]').textContent()).trim() };
    await toastGone(page);
    await shot(page, 'after-checklist-full-375-light');
    await page.click('[data-tab="home"]');
    const home = {
      open: (await page.locator('[data-slot="home-tasks-open"]').textContent()).trim(),
      next: (await page.locator('[data-slot="home-tasks-next"]').textContent()).trim(),
      prep: (await page.locator('[data-slot="home-prep-label"]').textContent()).trim(),
      pack: (await page.locator('[data-slot="home-pack-label"]').textContent()).trim(),
    };
    await shot(page, 'after-home-375-light');
    await page.click('[data-action="task-quick"]');
    const quickOpen = await page.locator('#dlg-task').evaluate((d) => d.open);
    const quickTitle = (await page.locator('[data-slot="task-title"]').textContent()).trim();
    await page.fill('#dlg-task [name="title"]', 'להזמין מונית לשדה');
    await page.click('#dlg-task [type="submit"]');
    await closed(page, '#dlg-task');
    const afterQuick = (await page.locator('[data-slot="home-tasks-open"]').textContent()).trim();
    await page.click('.home-lists-link');
    await page.waitForFunction(() => location.hash === '#/checklist');
    const pctOf = (s) => (s.match(/(\d+)%/) ?? [])[1];
    pass('S5-6 (screen)', overdue.length === 1 && overdue[0] === 'הזמנת טיסות' && todayDue === 'היום', { overdue, todayDue });
    pass('S5-7', home.open === `${screen.open} משימות פתוחות.` && /הבאה: הזמנת טיסות, באיחור/.test(home.next) && pctOf(home.prep) === pctOf(screen.prep) && pctOf(home.pack) === pctOf(screen.pack)
      && quickOpen && quickTitle === 'משימה חדשה' && afterQuick === `${screen.open + 1} משימות פתוחות.`, { screen, home, quickOpen, afterQuick });

    // S5-1: survives a reload
    await page.reload();
    await ready(page);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    const reloaded = await trip(page);
    pass('S5-1', reloaded.checklist.length === 20 && reloaded.tasks.length === 7 && reloaded.checklist.some((x) => x.done) && keys.every((k) => k.startsWith('tisa:')),
      { items: reloaded.checklist.length, tasks: reloaded.tasks.length, keys });

    // S5-11 (layout): screen and both dialogs
    const audit = async () => page.evaluate(() => {
      const vis = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !n.closest('[hidden]') && !n.closest('dialog:not([open])'); };
      const root = document.querySelector('dialog[open]') ?? document.querySelector('#panel-checklist');
      const small = [...root.querySelectorAll('button, input:not([type="checkbox"]), select, label.item-check, label.split-check')].filter((b) => vis(b) && !b.disabled)
        .map((b) => ({ el: b.dataset.action ?? b.name ?? b.className, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })).filter((x) => x.w < 44 || x.h < 44);
      const clipped = [...root.querySelectorAll('button')].filter((b) => vis(b) && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
      const tiny = [...root.querySelectorAll('*')].filter((n) => vis(n) && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(n).fontSize) < 14).map((n) => n.textContent.trim().slice(0, 20));
      return { hscroll: document.documentElement.scrollWidth > innerWidth, dir: document.documentElement.dir, small, clipped, tiny };
    });
    const a1 = await audit();
    await page.click('#panel-checklist [data-action="item-add"]');
    await page.check('#dlg-item [name="verify"]');
    const a2 = await audit();
    await shot(page, 'after-item-dialog-375', false);
    await page.click('#dlg-item [data-close]');
    await closed(page, '#dlg-item');
    await page.click('#panel-checklist [data-action="task-add"]');
    const a3 = await audit();
    await shot(page, 'after-task-dialog-375', false);
    await page.click('#dlg-task [data-close]');
    await closed(page, '#dlg-task');
    pass('S5-11 (layout)', [a1, a2, a3].every((a) => !a.hscroll && a.dir === 'rtl' && !a.small.length && !a.clipped.length && !a.tiny.length), { a1, a2, a3 });

    // S5-9: backup round trip with itinerary, money, checklist and tasks
    await page.click('[data-tab="itinerary"]');
    await page.click('[data-slot="itin-empty"] [data-action="seed-open"]');
    await page.click('[data-action="seed-confirm"]');
    await closed(page, '#dlg-seed');
    await page.click('[data-tab="budget"]');
    await page.click('[data-slot="money-empty"] [data-action="profile-open"]');
    await page.click('#dlg-profile [type="submit"]');
    await closed(page, '#dlg-profile');
    await page.click('#panel-money [data-action="expense-add"]');
    await page.fill('#dlg-expense [name="amount"]', '120');
    await page.click('#dlg-expense [type="submit"]');
    await closed(page, '#dlg-expense');
    await page.click('.settings-btn');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
    const file = path.join(OUT, 'roundtrip.json');
    await download.saveAs(file);
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
    const same = Object.fromEntries(['destinations', 'budget', 'expenses', 'checklist', 'tasks'].map((k) => [k, JSON.stringify(before[k]) === JSON.stringify(after[k])]));
    pass('S5-9', wiped.checklist.length === 0 && wiped.tasks.length === 0 && Object.values(same).every(Boolean) && after.checklist.length === 20 && after.expenses.length === 1, { same });
    await ctx.close();
  }

  // ---------- S5-6: overdue by the Bangkok calendar, fake dates (device on Israel time) ----------
  {
    const got = {};
    for (const [label, when, want] of [
      ['before', '2026-11-30T09:00:00+07:00', 'upcoming'],
      ['due-day', '2026-12-01T09:00:00+07:00', 'today'],
      ['after', '2026-12-02T09:00:00+07:00', 'overdue'],
      ['bangkok-midnight', '2026-12-01T17:30:00Z', 'overdue'], // 00:30 on 2.12 in Bangkok, still 1.12 in Israel
    ]) {
      const { ctx, page } = await fresh(browser, when, { timezoneId: 'Asia/Jerusalem' });
      await addTask(page, { title: 'משימה', due: '2026-12-01' });
      await addTask(page, { title: 'שבוצעה', due: '2026-11-01', status: 'done' });
      const state = await page.locator('.task:has-text("משימה")').first().getAttribute('class');
      const doneState = await page.locator('.task:has-text("שבוצעה")').getAttribute('class');
      got[label] = { state, doneState, ok: state.includes(`is-${want}`) && doneState.includes('is-done') };
      if (label === 'after') { await toastGone(page); await shot(page, 'after-task-overdue-375-dark-check', false); }
      await ctx.close();
    }
    pass('S5-6', Object.values(got).every((g) => g.ok), got);
  }

  // ---------- S5-10: offline ----------
  {
    const ctx = await browser.newContext({ ...VIEW });
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${BASE}#/checklist`);
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await ready(page);
    const caches = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys.find((k) => k.startsWith('tisa-')));
      const urls = (await c.keys()).map((r) => new URL(r.url).pathname);
      return { keys, files: ['/src/js/checklist-view.js', '/src/js/core/checklist.js', '/data/packs/th.js'].filter((f) => urls.includes(f)) };
    });
    await ctx.setOffline(true);
    await page.reload();
    await ready(page);
    await seed(page, 'list-seed');
    await page.locator('[data-action="item-toggle"]').first().check();
    await addTask(page, { title: 'בלי קליטה' });
    const t = await trip(page);
    const version = await page.locator('[data-slot="version-app"]').textContent();
    await toastGone(page);
    await shot(page, 'after-offline-375', false);
    pass('S5-10', caches.keys.includes(`tisa-${version}`) && caches.files.length === 3 && t.checklist.some((x) => x.done) && t.tasks.length === 1, { caches, version });
    await ctx.close();
  }

  if (SHOTS) {
    const { ctx, page } = await fresh(browser, '2026-11-25T09:00:00+07:00', { colorScheme: 'dark' });
    await seed(page, 'list-seed');
    await seed(page, 'tasks-seed');
    await page.locator('[data-action="item-toggle"]').nth(0).check();
    await page.click('.task:has-text("הזמנת טיסות") [data-action="task-edit"]');
    await page.fill('#dlg-task [name="due"]', '2026-11-20');
    await page.click('#dlg-task [type="submit"]');
    await closed(page, '#dlg-task');
    await toastGone(page);
    await shot(page, 'after-checklist-full-375-dark');
    await page.click('[data-tab="home"]');
    await shot(page, 'after-home-375-dark');
    await ctx.close();
  }

  pass('S5-11 (no JS errors, no outside requests)', bag.errors.length === 0 && bag.external.length === 0, bag);
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
