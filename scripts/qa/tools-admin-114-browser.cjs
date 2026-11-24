// 1.1.4 browser checks: a new trip, the fifth tab "Tools", the home "Shortcuts" and the admin's users area. The real
// app in Chromium; the account parts run against a FAKE Supabase behind Playwright routes (lib/fake-supabase.cjs):
// no network, sample users and sample trips only (rule 16). Never the real project, never a real trip.
// NT1 no account, one trip: "New trip" opens a dialog; an empty name is refused; a name creates a second trip, "on
//     this device only", shown in the trip choice; the old trip is unchanged byte for byte
// NT2 no account: the trip choice switches back to the old trip, and a reload keeps both trips
// NAV1 five tabs: each one shows its own screen, lit (aria-selected), and arrow keys move between all five
// NAV2 #/tools: title, lead and the five global tools; each opens its own screen with the tools tab lit; the itinerary
//      no longer lists them
// LAY  360, 390 and 1440: no sideways scroll, the five tab labels fit (not cut), each tab at least 44px tall
// HOME four shortcuts, the title "קיצורי דרך", no admin notice without an account
// AD1 a regular approved user: no notice, no admin_* call, admin-view.js never loaded
// AD2 the admin: home notice and the "Admin" button show the number of pending users; a reload uses the cache (no
//     second admin_list_users)
// AD3 a pending user: an explanation to approve first, no "add to a trip"
// AD4 "add to a trip": offered only with the admin's own trips (not a trip of someone else), after a confirm, through
//     share_trip; then not offered again for that trip
// AD5 block: the confirm says the account and data are not deleted; the blocked user moves to a closed "blocked (N)"
//     group; it opens; "unblock" there brings the user back
// AD6 approving the last pending users hides the notice (0 = nothing shown)
// SH1 the share dialog explains that an account alone does not add anyone to a trip
// Waits for UI state (rule 6). QA_OUT (default docs/evidence/1.1.4/browser), PORT (default 8214), RUN.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { sampleState } = require('./lib/sample-trip.cjs');
const { createFakeSupabase } = require('./lib/fake-supabase.cjs');
const { ROOT, PASS, startServer, newContext, signIn, signInAndMove, waitPill } = require('./lib/cloud-owner.cjs');

const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/1.1.4/browser');
const SHOTS = process.env.SHOTS !== '0';
const SHOT_DIR = path.join(OUT, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PORT = Number(process.env.PORT ?? 8214);
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const GLOBAL = ['transfers', 'calendar', 'photos', 'places', 'summary'];

function watch(page, name) {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
}
async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts?.ready);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.jpg`), type: 'jpeg', quality: 70, fullPage: false }).catch(() => {});
}
const data = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tisa:v1')));
async function go(page, base, screen) {
  await page.goto(`${base}#/${screen}`);
  await page.waitForSelector(`#panel-${screen}:not([hidden])`, { timeout: 8000 });
}
const tryStep = async (id, fn) => { try { await fn(); } catch (e) { if (!results[id]) pass(id, false, { error: String(e.message).split('\n')[0] }); } };

async function run() {
  const { server, base } = await startServer(PORT);
  const browser = await chromium.launch();
  const sb = await createFakeSupabase();
  const { fake } = sb;
  const seed = await sampleState();
  try {
    // ---------------- NT: a new trip, with no account ----------------
    await tryStep('NT1', async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
      await sb.install(ctx, { configured: false });
      await ctx.addInitScript((x) => { if (!sessionStorage.getItem('qa-seeded') && !localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); sessionStorage.setItem('qa-seeded', '1'); }, JSON.stringify(seed));
      const page = await ctx.newPage();
      watch(page, 'no-account');
      await go(page, base, 'settings');
      await shot(page, 'settings-card-390');
      const before = await data(page);
      const oldId = before.activeTripId;
      const oldTrip = JSON.stringify(before.trips[oldId]);
      const choiceHiddenBefore = await page.isHidden('[data-slot="cloud-trips"]');
      await page.click('[data-action="trip-new"]', { timeout: 4000 });
      await page.waitForSelector('#dlg-new-trip[open]');
      await page.click('#dlg-new-trip [type="submit"]');
      const err = (await page.textContent('[data-slot="new-trip-error"]')).trim();
      const stillOne = Object.keys((await data(page)).trips).length === 1;
      await page.fill('#dlg-new-trip [name="name"]', 'טיול לדוגמה שני');
      await shot(page, 'new-trip-dialog-390');
      await page.click('#dlg-new-trip [type="submit"]');
      await page.waitForFunction(() => !document.querySelector('#dlg-new-trip').open);
      await page.waitForFunction(() => Object.keys(JSON.parse(localStorage.getItem('tisa:v1')).trips).length === 2);
      const after = await data(page);
      const newId = Object.keys(after.trips).find((id) => id !== oldId);
      const labels = await page.$$eval('[data-slot="cloud-trip-list"] label', (ls) => ls.map((l) => l.textContent));
      await shot(page, 'settings-two-trips-390');
      pass('NT1 no account: an empty name is refused; "New trip" adds a second trip on this device only, shown in the choice; the old trip is unchanged',
        Boolean(err) && stillOne && choiceHiddenBefore && JSON.stringify(after.trips[oldId]) === oldTrip && after.activeTripId === newId
          && after.trips[newId].name === 'טיול לדוגמה שני' && labels.length === 2 && labels.some((l) => /טיול לדוגמה שני \(במכשיר בלבד\)/.test(l)) && await page.isVisible('[data-slot="cloud-trips"]'),
        { err, labels, active: after.activeTripId === newId });
      // NT2: switch back with no account, then reload
      await page.check(`[data-slot="cloud-trip-list"] input[value="${oldId}"]`);
      await page.waitForFunction((id) => JSON.parse(localStorage.getItem('tisa:v1')).activeTripId === id, oldId, { timeout: 5000 });
      await page.reload();
      await page.waitForSelector('#panel-settings:not([hidden])');
      const re = await data(page);
      pass('NT2 no account: the trip choice switches back to the old trip, and a reload keeps both trips and the old trip as it was',
        re.activeTripId === oldId && Object.keys(re.trips).length === 2 && JSON.stringify(re.trips[oldId]) === oldTrip);

      // ---------------- NAV, LAY, HOME (no account) ----------------
      await go(page, base, 'home');
      const homeInfo = await page.evaluate(() => ({
        title: document.querySelector('#tools-title')?.textContent.trim(),
        tiles: [...document.querySelectorAll('#panel-home .tile')].map((t) => t.dataset.go),
        admin: document.querySelector('[data-slot="home-admin"]')?.hidden ?? true,
      }));
      await shot(page, 'home-390');
      pass('HOME four shortcuts kept, titled "קיצורי דרך"; no admin notice without an account',
        homeInfo.title === 'קיצורי דרך' && JSON.stringify(homeInfo.tiles) === JSON.stringify(['itinerary', 'money', 'checklist', 'info']) && homeInfo.admin === true, homeInfo);

      const nav = [];
      const tabs = await page.$$eval('[role="tab"]', (ts) => ts.map((t) => [t.dataset.tab, t.dataset.route]));
      for (const [tab, route] of tabs) {
        await page.click(`[role="tab"][data-tab="${tab}"]`);
        await page.waitForSelector(`#panel-${route}:not([hidden])`, { timeout: 4000 }).catch(() => {});
        nav.push(await page.evaluate(([tb, r]) => ({ tab: tb, shown: !document.querySelector(`#panel-${r}`)?.hidden, lit: document.querySelector(`[data-tab="${tb}"]`).getAttribute('aria-selected') === 'true', hash: location.hash }), [tab, route]));
      }
      await page.focus('[role="tab"][data-tab="home"]');
      const keys = [];
      for (let i = 0; i < 5; i += 1) { await page.keyboard.press('ArrowLeft'); keys.push(await page.evaluate(() => document.activeElement.dataset.tab)); }
      pass('NAV1 five tabs (home, itinerary, budget, lists, tools): each shows its screen and is lit; arrow keys reach all five',
        tabs.length === 5 && tabs[4][0] === 'tools' && tabs[4][1] === 'tools' && nav.every((x) => x.shown && x.lit) && new Set(keys).size === 5, { tabs, nav, keys });

      await go(page, base, 'tools');
      const tools = await page.evaluate(() => ({
        title: document.querySelector('#panel-tools h1')?.textContent.trim(),
        lead: document.querySelector('#panel-tools [data-i18n="toolsTab.lead"]')?.textContent.trim(),
        links: [...document.querySelectorAll('#panel-tools [data-go]')].map((b) => b.dataset.go),
        itin: [...document.querySelectorAll('#panel-itinerary [data-go]')].map((b) => b.dataset.go),
      }));
      await shot(page, 'tools-390');
      const opened = [];
      for (const g of GLOBAL) {
        await go(page, base, 'tools');
        await page.click(`#panel-tools [data-go="${g}"]`);
        await page.waitForSelector(`#panel-${g}:not([hidden])`, { timeout: 4000 }).catch(() => {});
        opened.push(await page.evaluate((x) => ({ g: x, shown: !document.querySelector(`#panel-${x}`).hidden, toolsLit: document.querySelector('[data-tab="tools"]')?.getAttribute('aria-selected') === 'true' }), g));
      }
      pass('NAV2 #/tools: "כלים", "מבט על כל הטיול", the five global tools; each opens its own screen with the tools tab lit; the itinerary no longer lists them',
        tools.title === 'כלים' && tools.lead === 'מבט על כל הטיול' && JSON.stringify(tools.links) === JSON.stringify(GLOBAL)
          && opened.every((x) => x.shown && x.toolsLit) && GLOBAL.every((g) => !tools.itin.includes(g)), { tools, opened });

      const lay = [];
      for (const [w, h] of [[360, 740], [390, 844], [1440, 900]]) {
        await page.setViewportSize({ width: w, height: h });
        await go(page, base, 'tools');
        lay.push(await page.evaluate((width) => {
          const tabsEl = [...document.querySelectorAll('[role="tab"]')];
          return {
            width,
            sideScroll: document.documentElement.scrollWidth > window.innerWidth,
            cut: tabsEl.filter((t) => { const s = t.querySelector('span:not(.tab-chip)'); return !s || s.scrollWidth > s.clientWidth + 1 || s.getBoundingClientRect().width < 8; }).map((t) => t.dataset.tab),
            minH: Math.min(...tabsEl.map((t) => t.getBoundingClientRect().height)),
            minW: Math.min(...tabsEl.map((t) => t.getBoundingClientRect().width)),
            count: tabsEl.length,
          };
        }, w));
        await shot(page, `tools-${w}`);
        await go(page, base, 'itinerary');
        await shot(page, `itinerary-${w}`);
        await go(page, base, 'home');
        await shot(page, `home-${w}`);
      }
      pass('LAY 360, 390 and 1440: five tabs, no sideways scroll, no label cut, each tab at least 44px tall and wide',
        lay.every((x) => x.count === 5 && !x.sideScroll && !x.cut.length && x.minH >= 44 && x.minW >= 44), { lay });
      await ctx.close();
    });

    // ---------------- AD: the admin area (fake server, sample users only) ----------------
    await tryStep('AD', async () => {
      const M = fake.addUser({ email: 'admin-m@example.com', password: PASS, status: 'approved', role: 'admin' });
      const O = fake.addUser({ email: 'owner-o@example.com', password: PASS, status: 'approved' });
      const F = fake.addUser({ email: 'friend-f@example.com', password: PASS, status: 'approved' });
      const P1 = fake.addUser({ email: 'pending-p1@example.com', password: PASS, status: 'pending' });
      const P2 = fake.addUser({ email: 'pending-p2@example.com', password: PASS, status: 'pending' });
      fake.addUser({ email: 'blocked-x@example.com', password: PASS, status: 'blocked' });
      fake.rpc(O, 'create_trip', { t: 'sample-trip-of-o', p_name: 'טיול של משתמש אחר', p_cc: 'TH', p_start: null, p_end: null });

      // AD1: a regular approved user (F) sees nothing of this
      const ctxF = await newContext(browser, sb, { seed: null });
      const pf = await ctxF.newPage();
      watch(pf, 'regular-f');
      await go(pf, base, 'settings');
      await signIn(pf, 'friend-f@example.com');
      await waitPill(pf, 'מסונכרן');
      await go(pf, base, 'home');
      const fAdmin = sb.log.filter((x) => x.uid === F && x.fn?.startsWith('admin_')).length;
      const fFile = await pf.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('admin-view.js')).length);
      pass('AD1 a regular user: no pending notice, no admin_* call, admin-view.js never loaded',
        await pf.isHidden('[data-slot="home-admin"]') && fAdmin === 0 && fFile === 0, { fAdmin, fFile });
      await ctxF.close();

      // AD2: the admin, with a trip of their own moved into the account
      const ctxM = await newContext(browser, sb, { seed });
      const pm = await ctxM.newPage();
      watch(pm, 'admin-m');
      await go(pm, base, 'settings');
      await signInAndMove(pm, 'admin-m@example.com');
      const adminTrip = (await data(pm)).activeTripId;
      await go(pm, base, 'home');
      await pm.waitForSelector('[data-slot="home-admin"]:not([hidden])', { timeout: 10000 });
      const homeText = (await pm.textContent('[data-slot="home-admin"]')).trim();
      await shot(pm, 'home-admin-390');
      await pm.setViewportSize({ width: 1440, height: 900 }); await shot(pm, 'home-admin-1440'); await pm.setViewportSize({ width: 390, height: 844 });
      const listCalls = () => sb.log.filter((x) => x.uid === M && x.fn === 'admin_list_users').length;
      const callsBefore = listCalls();
      await pm.reload();
      await pm.waitForSelector('#panel-home:not([hidden])');
      await waitPill(pm, 'מסונכרן');
      await pm.waitForSelector('[data-slot="home-admin"]:not([hidden])', { timeout: 5000 });
      const callsAfter = listCalls();
      await go(pm, base, 'settings');
      const badge = (await pm.textContent('[data-slot="admin-badge"]')).trim();
      pass('AD2 the admin: the home notice and the "Admin" button show 2 pending; a reload uses the cache (no second admin_list_users)',
        /2/.test(homeText) && badge === '2' && await pm.isVisible('[data-slot="admin-badge"]') && callsBefore === 1 && callsAfter === 1, { homeText, badge, callsBefore, callsAfter });

      // the home notice opens the admin area
      await go(pm, base, 'home');
      await pm.click('[data-slot="home-admin"]');
      await pm.waitForSelector('#dlg-cloud-admin[open] [data-slot="cloud-admin-users"] li', { timeout: 8000 });
      await shot(pm, 'admin-dialog-390');
      const row = (email) => pm.locator('#dlg-cloud-admin li', { hasText: email });
      // AD3
      const p1Note = await row('pending-p1@example.com').locator('.cloud-admin-note').textContent().catch(() => '');
      const p1Add = await row('pending-p1@example.com').locator('[data-admin="add"]').count();
      pass('AD3 a pending user: an explanation to approve first, and no "add to a trip"', /לאשר/.test(p1Note) && p1Add === 0, { p1Note, p1Add });
      // AD4
      await row('friend-f@example.com').locator('[data-admin="add"]').click();
      const options = await row('friend-f@example.com').locator('select option').evaluateAll((os) => os.map((o) => o.value));
      await shot(pm, 'admin-add-390');
      await row('friend-f@example.com').locator('[data-admin="add-yes"]').click();
      await pm.waitForSelector('#dlg-cloud-confirm[open]');
      const confirmText = await pm.textContent('[data-slot="cloud-confirm-text"]');
      await pm.click('[data-slot="cloud-confirm-yes"]');
      await pm.waitForFunction(() => /נוסף לטיול/.test(document.querySelector('[data-slot="toast"]').textContent), null, { timeout: 8000 });
      const shareCalls = sb.log.filter((x) => x.uid === M && x.fn === 'share_trip').length;
      await pm.waitForFunction(() => document.querySelector('#dlg-cloud-admin[open] [data-slot="cloud-admin-users"] li'));
      await pm.waitForFunction(() => ![...document.querySelectorAll('#dlg-cloud-admin li')].find((l) => l.textContent.includes('friend-f@example.com'))?.querySelector('[data-admin="add"]'), null, { timeout: 8000 });
      const fOnTrip = fake.rpc(M, 'admin_list_trips').find((x) => x.id === adminTrip)?.members.some((m) => m.user_id === F);
      const oTripUntouched = fake.rpc(M, 'admin_list_trips').find((x) => x.id === 'sample-trip-of-o').members.length === 1;
      pass('AD4 "add to a trip": only the admin\'s own trip is offered (not another user\'s), after a confirm, through share_trip; then not offered again',
        JSON.stringify(options) === JSON.stringify([adminTrip]) && /friend-f@example\.com/.test(confirmText) && shareCalls === 1 && fOnTrip && oTripUntouched, { options, confirmText, shareCalls });
      // AD5
      await row('pending-p2@example.com').getByRole('button', { name: 'חסימה' }).click();
      await pm.waitForSelector('#dlg-cloud-confirm[open]');
      const blockText = await pm.textContent('[data-slot="cloud-confirm-text"]');
      await pm.click('[data-slot="cloud-confirm-yes"]');
      await pm.waitForFunction(() => /\(2\)/.test(document.querySelector('[data-slot="cloud-admin-blocked-title"]')?.textContent ?? ''), null, { timeout: 8000 });
      const group = await pm.evaluate(() => {
        const d = document.querySelector('[data-slot="cloud-admin-blocked"]');
        return { tag: d.tagName, open: d.open, hidden: d.hidden, title: d.querySelector('summary').textContent.trim(), inMain: [...document.querySelectorAll('[data-slot="cloud-admin-users"] li')].some((l) => /blocked-x|pending-p2/.test(l.textContent)) };
      });
      await shot(pm, 'admin-blocked-closed-390');
      await pm.click('[data-slot="cloud-admin-blocked"] summary');
      await pm.waitForSelector('[data-slot="cloud-admin-blocked"][open] li');
      await shot(pm, 'admin-blocked-open-390');
      await pm.locator('[data-slot="cloud-admin-blocked"] li', { hasText: 'pending-p2@example.com' }).getByRole('button', { name: 'ביטול חסימה' }).click();
      await pm.waitForFunction(() => /\(1\)/.test(document.querySelector('[data-slot="cloud-admin-blocked-title"]')?.textContent ?? ''), null, { timeout: 8000 });
      pass('AD5 block: the confirm says the account and data stay; blocked users are in a closed "חסומים (N)" group that opens; unblock brings the user back',
        /לא מוחקת/.test(blockText) && group.tag === 'DETAILS' && !group.open && !group.hidden && group.title === 'חסומים (2)' && !group.inMain
          && fake.users.get(P2).status === 'approved', { blockText, group, p2: fake.users.get(P2).status });
      // AD6: approve the last pending user: 0 = no notice, no badge
      await row('pending-p1@example.com').getByRole('button', { name: 'אישור', exact: true }).click();
      await pm.waitForFunction(() => document.querySelector('[data-slot="admin-badge"]')?.hidden === true, null, { timeout: 8000 });
      await pm.keyboard.press('Escape');
      await go(pm, base, 'home');
      pass('AD6 no pending users left: the notice and the badge are hidden', await pm.isHidden('[data-slot="home-admin"]') && fake.users.get(P1).status === 'approved');
      // SH1
      await go(pm, base, 'settings');
      await pm.click('[data-cloud="share"]');
      await pm.waitForSelector('#dlg-cloud-share[open]');
      const shareHint = await pm.$$eval('#dlg-cloud-share .sheet-hint', (ps) => ps.map((x) => x.textContent).join(' '));
      await shot(pm, 'share-dialog-390');
      pass('SH1 the share dialog: an account alone does not add anyone to a trip', /לא מוסיפה/.test(shareHint), { shareHint });
      await ctxM.close();
    });
  } finally {
    await browser.close();
    server.kill();
  }
  pass('ERRORS no page error', errors.length === 0, { errors });
  const fail = Object.values(results).filter((r) => r.result === 'FAIL').length;
  const out = { run: process.env.RUN ?? '1', total: Object.keys(results).length, fail, results };
  fs.writeFileSync(path.join(OUT, `tools-admin-114${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), JSON.stringify(out, null, 2));
  for (const [id, r] of Object.entries(results)) console.log(`${r.result} ${id}${r.result === 'FAIL' ? ` ${JSON.stringify(r).slice(0, 400)}` : ''}`);
  console.log(`${out.total - fail}/${out.total} pass`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
