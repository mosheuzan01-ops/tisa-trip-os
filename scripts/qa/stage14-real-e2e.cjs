// Stage 14: REAL end-to-end check against the project's own Supabase (config/app.config.json -> cloud), in Chromium.
// Not part of the regular regression (it needs the network to the project and temporary test users):
//   E2E_PASS=<temporary password> QA_OUT=<dir> node scripts/qa/stage14-real-e2e.cjs
// The four sample users (e2e-owner / e2e-friend / e2e-pending / e2e-admin @example.com) are created right before the
// run with a random password (only its bcrypt hash is sent to the database) and deleted right after it.
// The password is read from the environment and never printed or written. Sample trip data only (rule 16, lib/).
// Checks: R1 pending, R2 first move with backup, R3 second phone, R4 sharing and personal data, R5 owner-only dates,
// R6 airplane mode, R7 server unreachable, R8 admin approve/block, R9 no admin calls for regular users, R10 removing
// a member, R11 storage keys and no password, R12 CSP, R13 only this site and the project are contacted.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { richState } = require('./lib/rich-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage14/real-e2e');
fs.mkdirSync(OUT, { recursive: true });
const PASS = process.env.E2E_PASS;
if (!PASS) { console.log('SKIP: E2E_PASS not set (temporary test users are needed). Nothing was run.'); process.exit(2); }
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8'));
const PROJECT = CFG.cloud?.url;
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(PROJECT ?? '')) { console.log('SKIP: config.cloud.url is not set'); process.exit(2); }
const PORT = Number(process.env.PORT ?? 8196);
const BASE = `http://127.0.0.1:${PORT}/`;
const T = 30_000;
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}`); };
const errors = [];
const outside = [];
const rpc = []; // { who, fn }

function watch(page, who) {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`${who}: ${m.text().slice(0, 300)}`); });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(`${PROJECT}/rest/v1/rpc/`)) rpc.push({ who, fn: u.split('/rpc/')[1].split('?')[0] });
    if (!u.startsWith(BASE) && !u.startsWith(PROJECT) && !/^(data|blob):/.test(u)) outside.push(u);
  });
}
async function context(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  if (seed) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('e2e-seeded') && !localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); sessionStorage.setItem('e2e-seeded', '1'); }, JSON.stringify(seed));
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  return ctx;
}
async function open(ctx, who) {
  const page = await ctx.newPage();
  watch(page, who);
  await page.goto(`${BASE}#/settings`);
  await page.waitForSelector('#panel-settings:not([hidden])');
  return page;
}
async function signIn(page, email) {
  await page.click('[data-cloud="signin"]');
  await page.waitForSelector('#dlg-cloud-auth[open]');
  await page.fill('#dlg-cloud-auth [name="email"]', email);
  await page.fill('#dlg-cloud-auth [name="pass"]', PASS);
  await page.click('[data-slot="cloud-auth-submit"]');
  await page.waitForFunction(() => !document.querySelector('#dlg-cloud-auth')?.open, null, { timeout: T });
}
const pill = (page, text) => page.waitForFunction((t) => document.querySelector('[data-slot="cloud-pill-text"]')?.textContent === t, text, { timeout: T });
const data = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tisa:v1')));
const closed = (page, sel) => page.waitForFunction((s) => !document.querySelector(s)?.open, sel, { timeout: T });
const toast = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-slot="toast"]').textContent), re.source, { timeout: T });
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const kick = (page) => page.evaluate(() => dispatchEvent(new Event('online')));

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const browser = await chromium.launch();
  const rich = await richState();
  const tripId = rich.activeTripId;
  const pages = [];
  try {
    // R1 pending
    {
      const ctx = await context(browser, rich);
      const p = await open(ctx, 'pending'); pages.push(p);
      const before = JSON.stringify(await data(p));
      await signIn(p, 'e2e-pending@example.com');
      await pill(p, 'ממתין לאישור');
      await p.waitForTimeout(1500);
      const fns = rpc.filter((x) => x.who === 'pending').map((x) => x.fn);
      pass('R1 a pending user (real server): "waiting for approval", only my_profile is called, local data unchanged', fns.length >= 1 && fns.every((f) => f === 'my_profile') && before === JSON.stringify(await data(p)), { fns });
      await ctx.close();
    }

    // R2 owner: first move
    const ctxA = await context(browser, rich);
    const A = await open(ctxA, 'owner'); pages.push(A);
    const original = await data(A);
    await signIn(A, 'e2e-owner@example.com');
    await A.waitForSelector('#dlg-cloud-migrate[open]', { timeout: T });
    const [dl] = await Promise.all([A.waitForEvent('download'), A.click('[data-cloud="migrate-yes"]')]);
    // 1.1.1: the backup is step 1 only; the move starts with "move now" (step 2)
    await A.waitForSelector('[data-cloud="migrate-upload"]:not([hidden])', { timeout: T });
    await A.click('[data-cloud="migrate-upload"]');
    await A.waitForFunction(() => /\(שלי\)/.test(document.querySelector('[data-slot="cloud-trip-list"]').textContent), null, { timeout: T });
    await pill(A, 'מסונכרן');
    const afterMove = await data(A);
    const copy = await A.evaluate(() => localStorage.getItem('latisa:premigration:v1'));
    pass('R2 first sign-in on the real server: backup file first, the trip moves, nothing on the phone changes, the exact copy is kept',
      /^tisa-backup-/.test(dl.suggestedFilename()) && JSON.stringify(afterMove.trips) === JSON.stringify(original.trips) && JSON.parse(copy).activeTripId === tripId, { file: dl.suggestedFilename() });

    // R3 second phone of the owner
    {
      const ctx = await context(browser, null);
      const p = await open(ctx, 'owner-phone2'); pages.push(p);
      await signIn(p, 'e2e-owner@example.com');
      await p.waitForSelector(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`, { timeout: T });
      await p.check(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`);
      await p.waitForFunction((id) => JSON.parse(localStorage.getItem('tisa:v1')).activeTripId === id, tripId, { timeout: T });
      const t2 = (await data(p)).trips[tripId];
      const t1 = original.trips[tripId];
      // Compared as values (key order inside an object does not matter: a flight is rebuilt from its shared and personal parts).
      const fields = ['destinations', 'places', 'people', 'expenses', 'repayments', 'checklist', 'tasks', 'transfers', 'checkins', 'luggage', 'smartBag', 'journal', 'info', 'budget', 'rates', 'startDate', 'endDate', 'name'];
      const differ = fields.filter((f) => stable(t2[f]) !== stable(t1[f]));
      pass('R3 the owner\'s second phone downloads the same trip from the real server (every synced field, compared as values)', differ.length === 0, { differ });
      await ctx.close();
    }

    // R4 share with the friend
    await A.click('[data-cloud="share"]');
    await A.waitForSelector('#dlg-cloud-share[open]');
    await A.fill('#dlg-cloud-share [name="email"]', 'e2e-pending@example.com');
    await A.click('#dlg-cloud-share [type="submit"]');
    await A.waitForFunction(() => /לא נמצא/.test(document.querySelector('[data-slot="cloud-share-error"]').textContent), null, { timeout: T });
    await A.fill('#dlg-cloud-share [name="email"]', 'e2e-friend@example.com');
    await A.click('#dlg-cloud-share [type="submit"]');
    await closed(A, '#dlg-cloud-share');
    const ctxB = await context(browser, null);
    const B = await open(ctxB, 'friend'); pages.push(B);
    await signIn(B, 'e2e-friend@example.com');
    await B.waitForSelector(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`, { timeout: T });
    await B.check(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`);
    await B.waitForFunction((id) => JSON.parse(localStorage.getItem('tisa:v1')).activeTripId === id, tripId, { timeout: T });
    const tB = (await data(B)).trips[tripId];
    const tA = original.trips[tripId];
    const shared = tB.destinations.length === tA.destinations.length && tB.places.length === tA.places.length && tB.people.length === tA.people.length
      && tB.expenses.every((e) => e.paidBy || (e.sharedBy ?? []).length || e.split);
    const personal = !Number.isInteger(tB.budget.totalMinor) && tB.checklist.length === 0 && tB.luggage.bags.length === 0 && Object.keys(tB.journal).length === 0
      && tB.checkins.length === 0 && (tB.transfers ?? []).every((x) => x.priceMinor === undefined && x.booking === undefined);
    pass('R4 sharing on the real server: a pending address is refused; the friend sees route, places, people and shared expenses only', shared, { stops: tB.destinations.length });
    pass('R4b the friend gets none of the owner\'s personal data (budget, list, bags, journal, check-ins, flight price/booking)', personal);

    // R5 owner-only dates
    await B.fill('[data-form="settings-dates"] [name="start"]', '2031-01-01');
    await B.click('[data-form="settings-dates"] [type="submit"]');
    await toast(B, /רק בעל הטיול/);
    pass('R5 the friend cannot change the trip dates or share further', (await data(B)).trips[tripId].startDate === tA.startDate && await B.isHidden('[data-cloud="share"]'));

    // R6 airplane mode on the owner's phone
    await ctxA.setOffline(true);
    await A.goto(`${BASE}#/checklist`); await A.waitForSelector('#panel-checklist:not([hidden])');
    await A.click('[data-action="item-add"]');
    await A.waitForSelector('#dlg-item[open]');
    await A.fill('#dlg-item [name="name"]', 'E2E offline item');
    await A.click('#dlg-item [type="submit"]');
    await closed(A, '#dlg-item');
    await pill(A, 'לא מחובר');
    await ctxA.setOffline(false);
    await pill(A, 'מסונכרן');
    {
      const ctx = await context(browser, null);
      const p = await open(ctx, 'owner-phone3'); pages.push(p);
      await signIn(p, 'e2e-owner@example.com');
      await p.waitForSelector(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`, { timeout: T });
      await p.check(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`);
      await p.waitForFunction((id) => JSON.parse(localStorage.getItem('tisa:v1')).activeTripId === id, tripId, { timeout: T });
      const n = (await data(p)).trips[tripId].checklist.filter((x) => x.name === 'E2E offline item').length;
      pass('R6 airplane mode: the edit waits ("offline"), syncs when the network is back, and another phone gets it once', n === 1, { n });
      await ctx.close();
    }

    // R7 server unreachable (the project blocked for this phone): nothing local changes
    {
      await A.goto(`${BASE}#/settings`); await A.waitForSelector('#panel-settings:not([hidden])');
      const before = JSON.stringify(await data(A));
      await ctxA.route(`${PROJECT}/**`, (r) => r.abort('connectionrefused'));
      await kick(A);
      await pill(A, 'לא מחובר');
      const same = before === JSON.stringify(await data(A));
      await ctxA.unroute(`${PROJECT}/**`);
      await A.click('[data-cloud="retry"]');
      await pill(A, 'מסונכרן');
      pass('R7 the real server unreachable: "offline", no local byte changes, then it recovers by itself', same);
    }

    // R8 admin approves the pending user and blocks the friend, then lets the friend back
    {
      const ctx = await context(browser, null);
      const p = await open(ctx, 'admin'); pages.push(p);
      await signIn(p, 'e2e-admin@example.com');
      await p.waitForSelector('[data-cloud="admin"]:not([hidden])', { timeout: T });
      await pill(p, 'מסונכרן');
      if (await p.isVisible('#dlg-cloud-migrate[open]')) await p.click('[data-cloud="migrate-no"]');
      await p.click('[data-cloud="admin"]');
      await p.waitForSelector('#dlg-cloud-admin[open] [data-slot="cloud-admin-users"] li', { timeout: T });
      const rowP = p.locator('#dlg-cloud-admin [data-slot="cloud-admin-users"] li', { hasText: 'e2e-pending@example.com' });
      await rowP.getByRole('button', { name: 'אישור' }).click();
      // Rule 6: wait for the saved state (the list reloads from the server), not for a toast that may still be showing.
      await p.waitForFunction(() => [...document.querySelectorAll('#dlg-cloud-admin [data-slot="cloud-admin-users"] li')].some((li) => li.textContent.includes('e2e-pending@example.com') && li.textContent.includes('מאושר')), null, { timeout: T });
      const rowB = p.locator('#dlg-cloud-admin [data-slot="cloud-admin-users"] li', { hasText: 'e2e-friend@example.com' });
      await rowB.getByRole('button', { name: 'חסימה' }).click();
      await p.waitForSelector('#dlg-cloud-confirm[open]');
      await p.click('[data-slot="cloud-confirm-yes"]');
      await p.waitForFunction(() => [...document.querySelectorAll('#dlg-cloud-admin [data-slot="cloud-admin-users"] li')].some((li) => li.textContent.includes('e2e-friend@example.com') && li.textContent.includes('חסום')), null, { timeout: T });
      const keep = JSON.stringify((await data(B)).trips[tripId]);
      await kick(B);
      await pill(B, 'חסום');
      const kept = keep === JSON.stringify((await data(B)).trips[tripId]);
      await p.waitForSelector('#dlg-cloud-admin [data-slot="cloud-admin-users"] li >> text=e2e-friend@example.com', { timeout: T });
      const rowB2 = p.locator('#dlg-cloud-admin [data-slot="cloud-admin-users"] li', { hasText: 'e2e-friend@example.com' });
      await rowB2.getByRole('button', { name: 'אישור' }).click();
      await p.waitForFunction(() => [...document.querySelectorAll('#dlg-cloud-admin [data-slot="cloud-admin-users"] li')].some((li) => li.textContent.includes('e2e-friend@example.com') && li.textContent.includes('מאושר')), null, { timeout: T });
      await B.click('[data-cloud="signout"]').catch(() => {});
      pass('R8 the admin (real server) approves a pending user and blocks a friend; the blocked friend sees "blocked" and keeps the phone data', kept);
      await ctx.close();
    }

    // R9 regular users never call admin functions or load the admin screen
    {
      const adminCalls = rpc.filter((x) => x.who !== 'admin' && x.fn.startsWith('admin_'));
      let loaded = 0;
      for (const p of [A, B]) loaded += await p.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('admin-view.js')).length);
      pass('R9 regular users: no admin_* call and no admin-view.js', adminCalls.length === 0 && loaded === 0, { adminCalls: adminCalls.length, loaded });
    }

    // R10 the owner removes the friend; the friend's copy stays on the phone
    {
      await signIn(B, 'e2e-friend@example.com');
      await pill(B, 'מסונכרן');
      await A.click('[data-cloud="members"]');
      await A.waitForSelector('#dlg-cloud-members[open] [data-slot="cloud-members-list"] button', { timeout: T });
      await A.click('#dlg-cloud-members [data-slot="cloud-members-list"] button');
      await A.waitForSelector('#dlg-cloud-confirm[open]');
      await A.click('[data-slot="cloud-confirm-yes"]');
      await toast(A, /הוסר/);
      await A.keyboard.press('Escape');
      await kick(B);
      await B.waitForFunction(() => /במכשיר בלבד/.test(document.querySelector('[data-slot="cloud-trip-list"]').textContent), null, { timeout: T });
      pass('R10 removing the friend (real server): the trip stays on the friend\'s phone, unlinked', (await data(B)).trips[tripId].destinations.length === tA.destinations.length);
    }

    // R11 storage keys, no password
    {
      const all = [];
      for (const p of [A, B]) all.push(...await p.evaluate(() => Object.entries(localStorage)));
      const bad = all.map(([k]) => k).filter((k) => !/^(tisa:|latisa:)/.test(k));
      pass('R11 only tisa:* and latisa:* in storage; the password is stored nowhere', bad.length === 0 && !all.some(([, v]) => v.includes(PASS)), { bad });
    }
    // R12 CSP
    {
      const v = [];
      for (const p of [A, B]) v.push(...await p.evaluate(() => window.__csp));
      pass('R12 no Content-Security-Policy violation with the real server', v.length === 0, { v });
    }
    await ctxA.close(); await ctxB.close();
  } catch (e) {
    pass('run', false, { error: String(e.stack ?? e).slice(0, 3000) });
  } finally {
    pass('R13 only this site and the project were contacted', outside.length === 0, { outside });
    pass('no JS errors', errors.length === 0, { errors });
    await browser.close();
    server.kill();
  }
  const rpcCounts = rpc.reduce((m, x) => { m[x.fn] = (m[x.fn] ?? 0) + 1; return m; }, {});
  fs.writeFileSync(path.join(OUT, 'stage14-real-e2e.json'), JSON.stringify({ project: PROJECT, results, rpcCounts }, null, 2));
  const failed = Object.values(results).filter((v) => v.result !== 'PASS').length;
  for (const [k, v] of Object.entries(results)) if (v.result !== 'PASS') console.log(`  ${k}: ${JSON.stringify(v).slice(0, 800)}`);
  console.log(failed ? `FAIL ${failed}` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
