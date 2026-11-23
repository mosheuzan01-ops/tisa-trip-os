// Stage 14 browser checks (docs/GOALS_STAGE14.md), the real app and the real supabase-js file in Chromium, with a
// FAKE Supabase behind Playwright routes (lib/fake-supabase.cjs): no network, sample users and data only (rule 16).
// What this shows: the app's behaviour (sign-in, pending, sync, offline, failures, sharing UI, admin UI, restore,
// CSP, storage keys). What it does NOT show: that a real Supabase project is secure (rls_check.sql does that).
// S14-1 no account and no session: nothing loads from the cloud, the app works as 1.0.x; signed in and no network:
//       the app opens from the offline copy with the last data and says "offline"
// S14-2 sign-up starts "pending": only the profile is read, nothing is sent; sign-out keeps the data; wrong password; reset
// S14-6 first sign-in after approval: backup file first, then the trip moves once; a reload makes no duplicate
// S14-4 airplane mode: an edit made offline waits, then syncs when the network is back; a second phone gets it once
// S14-5 server down (500, 402 paused/restricted, no network): no local byte changes, the pill says offline, no error
// S14-3 sharing in the UI: a friend sees the shared trip, not the owner's budget; dates are owner-only; removal unlinks
// S14-7 admin: a regular user never loads admin-view.js nor calls admin_*; the admin approves and blocks
// RST   restoring a backup while signed in waits for "this phone only" / "the cloud too", and sends nothing before
// CSP / KEYS / LAYOUT / KEYBOARD, and screenshots of the new card (390 and 1440, light and dark).
// Waits for UI state (rule 6). QA_OUT (default docs/evidence/stage14/browser), PORT (default 8195), RUN.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { richState } = require('./lib/rich-trip.cjs');
const { createFakeSupabase, PROJECT } = require('./lib/fake-supabase.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage14/browser');
const SHOTS = process.env.SHOTS !== '0';
const SHOT_DIR = path.join(OUT, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PORT = Number(process.env.PORT ?? 8195);
const BASE = `http://127.0.0.1:${PORT}/`;
const PASS = 'Sample-Passw0rd!';
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];
const csp = [];

function watch(page, name) {
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    const tx = m.text();
    if (/Content Security Policy|Refused to/i.test(tx)) csp.push(`${name}: ${tx}`);
    else if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(tx)) errors.push(`${name}: ${tx}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith(PROJECT) && !/^(data|blob):/.test(u)) outside.push(u);
  });
}

async function context(browser, sb, { seed = null, viewport = { width: 390, height: 844 }, scheme = 'light', configured = true } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, serviceWorkers: 'block', acceptDownloads: true });
  await sb.install(ctx, { configured });
  if (seed) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('s14-seeded') && !localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); sessionStorage.setItem('s14-seeded', '1'); }, JSON.stringify(seed));
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  return ctx;
}
async function open(ctx, name, screen = 'settings') {
  const page = await ctx.newPage();
  watch(page, name);
  await page.goto(`${BASE}#/${screen}`);
  await page.waitForSelector(`#panel-${screen}:not([hidden])`);
  return page;
}
const pillText = (page) => page.textContent('[data-slot="cloud-pill-text"]');
const waitPill = (page, text, timeout = 15000) => page.waitForFunction((t) => document.querySelector('[data-slot="cloud-pill-text"]')?.textContent === t && !document.querySelector('[data-slot="cloud-pill"]').hidden, text, { timeout });
const data = (page) => page.evaluate(() => localStorage.getItem('tisa:v1'));
const tripsOf = (raw) => JSON.parse(raw).trips;
async function signIn(page, email, pass = PASS) {
  await page.click('[data-cloud="signin"]');
  await page.waitForSelector('#dlg-cloud-auth[open]');
  await page.fill('#dlg-cloud-auth [name="email"]', email);
  await page.fill('#dlg-cloud-auth [name="pass"]', pass);
  await page.click('[data-slot="cloud-auth-submit"]');
}
async function closed(page, sel) { await page.waitForFunction((s) => !document.querySelector(s)?.open, sel); }
const rpcBy = (sb, uid) => sb.log.filter((x) => x.uid === uid && x.fn).map((x) => x.fn);
/** Keyboard rules of one dialog, as K2 of scripts/qa/stage13-keyboard-browser.cjs: Enter on its opener opens it,
 *  focus starts inside, Tab and Shift+Tab stay inside (BODY = the browser frame, allowed), each stop inside shows a
 *  focus mark, Esc closes it, focus goes back to the opener. Returns a list of problems (empty = all good). */
async function kbDialog(page, openerSel, id) {
  const bad = [];
  await page.focus(openerSel);
  await page.keyboard.press('Enter');
  const opened = await page.waitForSelector(`#${id}[open]`, { timeout: 5000 }).then(() => true, () => false);
  if (!opened) { console.log(`  kb ${id}: did not open`); return [`${id}: did not open`]; }
  const where = () => page.evaluate((d) => {
    const a = document.activeElement;
    if (a === document.body) return 'frame';
    if (!document.getElementById(d).contains(a)) return `out:${a.tagName}.${a.className}`;
    const s = getComputedStyle(a);
    const mark = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
    return mark ? 'in' : `no-mark:${a.tagName}`;
  }, id);
  const start = await where();
  if (start !== 'in' && !start.startsWith('no-mark')) bad.push(`${id}: focus not inside (${start})`);
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    const w = await where();
    if (w.startsWith('out') || w.startsWith('no-mark')) { bad.push(`${id}: ${key} -> ${w}`); break; }
  }
  // The app moves focus back in the dialog's "close" event, which the browser fires one task after "open" turns
  // false. A listener added now runs after the app's own, so when it has run, the app has finished (rule 6: wait
  // for the event, not for a fixed time; seen 2026-11-23: checking earlier raced it, and the next Enter then went to
  // the previous dialog's button).
  await page.evaluate((d) => { window.__kbClosed = false; document.getElementById(d).addEventListener('close', () => { window.__kbClosed = true; }, { once: true }); }, id);
  await page.keyboard.press('Escape');
  const shut = await page.waitForFunction(() => window.__kbClosed === true, null, { timeout: 5000 }).then(() => true, () => false);
  if (!shut) bad.push(`${id}: Esc did not close`);
  const sel = openerSel;
  const focusAt = await page.evaluate((x) => {
    const a = document.activeElement;
    const o = document.querySelector(x);
    if (a === o) return 'opener';
    return `${a.tagName}${a.id ? `#${a.id}` : ''}.${a.className}${a.dataset?.cloud ? `[${a.dataset.cloud}]` : ''}; opener ${o ? (o.hidden ? 'hidden' : 'shown') : 'gone'}`;
  }, sel);
  if (focusAt !== 'opener') bad.push(`${id}: focus did not return to its button (${focusAt})`);
  const stillOpen = await page.evaluate((x) => { // the dialog the opener sits in (confirm opens from members) stays open
    const home = document.querySelector(x)?.closest('dialog');
    return [...document.querySelectorAll('dialog[open]')].filter((d) => d !== home).map((d) => d.id);
  }, sel);
  if (stillOpen.length) bad.push(`${id}: still open afterwards: ${stillOpen.join(', ')}`);
  console.log(`  kb ${id}: ${bad.length ? bad.join(' | ') : 'ok'}`);
  return bad;
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, `${name}.jpg`), type: 'jpeg', quality: 70, fullPage: false }); };

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const browser = await chromium.launch();
  const sb = await createFakeSupabase();
  const { fake } = sb;
  const A = fake.addUser({ email: 'owner-a@example.com', password: PASS, display_name: 'Sample A', status: 'approved' });
  const B = fake.addUser({ email: 'friend-b@example.com', password: PASS, display_name: 'Sample B', status: 'approved' });
  const C = fake.addUser({ email: 'stranger-c@example.com', password: PASS, status: 'approved' });
  const M = fake.addUser({ email: 'admin-m@example.com', password: PASS, status: 'approved', role: 'admin' });
  const rich = await richState();
  let backupPath = null;
  try {
    // ---------------- S14-1 ----------------
    {
      const ctx = await context(browser, sb, { seed: rich, configured: false });
      const page = await open(ctx, 's1-off', 'home');
      const before = await data(page);
      await page.goto(`${BASE}#/settings`); await page.waitForSelector('#panel-settings:not([hidden])');
      const text = await page.textContent('[data-slot="cloud-text"]');
      const buttons = await page.$$eval('[data-slot="cloud-card"] [data-cloud]', (bs) => bs.filter((b) => !b.hidden && !b.closest('[hidden]')).length);
      const dialogs = await page.$$eval('[id^="dlg-cloud"]', (d) => d.length);
      const lib = sb.log.length + (await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('vendor/supabase')).length));
      pass('S14-1a no cloud set up: the card says so, no buttons, no account dialogs, nothing requested from the cloud or the library', /עוד לא הוגדר/.test(text) && buttons === 0 && dialogs === 0 && lib === 0, { text, buttons, dialogs, lib });
      pass('S14-1b data unchanged by opening (1.0.x behaviour)', before === await data(page));
      await ctx.close();
    }
    {
      const ctx = await context(browser, sb, { seed: rich });
      const page = await open(ctx, 's1-nosession', 'home');
      const before = await data(page);
      await page.goto(`${BASE}#/settings`); await page.waitForSelector('#panel-settings:not([hidden])');
      const lib = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('vendor/supabase')).length);
      const visible = await page.$$eval('[data-slot="cloud-card"] [data-cloud]', (bs) => bs.filter((b) => !b.hidden && !b.closest('[hidden]')).map((b) => b.dataset.cloud));
      pass('S14-1c cloud set up but no session: no library, no request to Supabase, only "sign in" and "sign up"; pill hidden', lib === 0 && sb.log.length === 0 && JSON.stringify(visible) === '["signin","signup"]' && await page.isHidden('[data-slot="cloud-pill"]'), { lib, calls: sb.log.length, visible });
      pass('S14-1d the app works without signing in: home and data as before', before === await data(page) && JSON.parse(before).trips[JSON.parse(before).activeTripId].destinations.length > 0);
      await shot(page, 'settings-signed-out-390-light');
      // keyboard: the sign-in dialog from the keyboard, focus inside, Esc closes, focus back
      await page.focus('[data-cloud="signin"]'); await page.keyboard.press('Enter');
      await page.waitForSelector('#dlg-cloud-auth[open]');
      const inside = await page.evaluate(() => document.querySelector('#dlg-cloud-auth').contains(document.activeElement) && document.activeElement.name === 'email');
      await page.keyboard.press('Escape'); await closed(page, '#dlg-cloud-auth');
      const back = await page.evaluate(() => document.activeElement?.dataset.cloud === 'signin');
      pass('KEYBOARD sign-in dialog: Enter opens it, focus on the email field, Esc closes, focus returns to the button', inside && back, { inside, back });
      // Rule 7: fields wrapped in <label> are a known scanner false alarm only when the browser gives each a name.
      const unnamed = await page.$$eval('dialog[id^="dlg-cloud"] input', (is) => is.filter((i) => !(i.labels?.[0]?.textContent ?? '').trim()).map((i) => `${i.closest('dialog').id} ${i.name}`));
      const total = await page.$$eval('dialog[id^="dlg-cloud"] input', (is) => is.length);
      pass('A11Y every field in the account dialogs has an accessible name (its wrapping label)', unnamed.length === 0 && total >= 5, { unnamed, total });
      await ctx.close();
    }

    // ---------------- S14-2 ----------------
    {
      const ctx = await context(browser, sb, { seed: rich });
      const page = await open(ctx, 's2-pending');
      const before = await data(page);
      await page.click('[data-cloud="signup"]');
      await page.waitForSelector('#dlg-cloud-auth[open]');
      await page.fill('#dlg-cloud-auth [name="email"]', 'new-p@example.com');
      await page.fill('#dlg-cloud-auth [name="pass"]', 'short');
      await page.click('[data-slot="cloud-auth-submit"]');
      const shortErr = await page.textContent('[data-slot="cloud-auth-error"]');
      await page.fill('#dlg-cloud-auth [name="pass"]', PASS);
      await page.fill('#dlg-cloud-auth [name="name"]', 'Sample P');
      await page.click('[data-slot="cloud-auth-submit"]');
      await closed(page, '#dlg-cloud-auth');
      await waitPill(page, 'ממתין לאישור');
      const P = [...fake.users.values()].find((u) => u.email === 'new-p@example.com');
      await page.waitForTimeout(300);
      const calls = rpcBy(sb, P.id);
      const text = await page.textContent('[data-slot="cloud-text"]');
      pass('S14-2a sign-up: account is "waiting for approval", the name is saved, too-short password refused first', P.status === 'pending' && P.display_name === 'Sample P' && /ממתין לאישור/.test(text) && /8 תווים/.test(shortErr), { status: P.status, text, shortErr });
      pass('S14-2b a pending user reads only its own profile and sends no trip data', calls.every((f) => f === 'my_profile') && calls.length >= 1 && fake.records.size === 0 && fake.trips.size === 0, { calls });
      pass('S14-2c local data unchanged while pending', before === await data(page));
      await shot(page, 'settings-pending-390-light');
      await page.click('[data-cloud="signout"]');
      await page.waitForFunction(() => !document.querySelector('[data-cloud="signin"]').hidden);
      const keys = await page.evaluate(() => Object.keys(localStorage));
      pass('S14-2d sign-out: back to "sign in", the session key is gone, the data stays', before === await data(page) && !keys.includes('latisa:auth:v1') && await page.isHidden('[data-slot="cloud-pill"]'), { keys });
      await signIn(page, 'new-p@example.com', 'Wrong-Passw0rd!');
      await page.waitForFunction(() => document.querySelector('[data-slot="cloud-auth-error"]').textContent.length > 0);
      const wrong = await page.textContent('[data-slot="cloud-auth-error"]');
      await page.click('#dlg-cloud-auth [data-mode="reset"]');
      await page.fill('#dlg-cloud-auth [name="email"]', 'new-p@example.com');
      await page.click('[data-slot="cloud-auth-submit"]');
      await page.waitForFunction(() => /נשלח/.test(document.querySelector('[data-slot="cloud-auth-error"]').textContent));
      pass('S14-2e wrong password says so; "forgot password" sends the request and explains the manual reset for friends', /לא נכונים/.test(wrong) && sb.log.some((x) => x.path === '/auth/v1/recover'), { wrong });
      await page.keyboard.press('Escape');
      // admin approves P later (S14-7); a blocked user (X) reads nothing either
      const X = fake.addUser({ email: 'blocked-x@example.com', password: PASS, status: 'blocked' });
      await signIn(page, 'blocked-x@example.com');
      await closed(page, '#dlg-cloud-auth');
      await waitPill(page, 'חסום');
      await page.waitForTimeout(300);
      const xcalls = rpcBy(sb, X);
      pass('S14-2f a blocked user sees "blocked", reads only its profile, sends nothing, keeps the local data', xcalls.every((f) => f === 'my_profile') && before === await data(page), { xcalls });
      await page.click('[data-cloud="signout"]');
      await ctx.close();
    }

    // ---------------- S14-6 + S14-4 + S14-5 (owner A) ----------------
    const ctxA = await context(browser, sb, { seed: rich });
    const pageA = await open(ctxA, 'owner-a');
    const original = await data(pageA);
    await signIn(pageA, 'owner-a@example.com');
    await pageA.waitForSelector('#dlg-cloud-migrate[open]', { timeout: 15000 });
    const migrateText = await pageA.textContent('[data-slot="cloud-migrate-text"]');
    await shot(pageA, 'migrate-dialog-390-light');
    const [download] = await Promise.all([pageA.waitForEvent('download'), pageA.click('[data-cloud="migrate-yes"]')]);
    backupPath = path.join(OUT, `backup-run.json`);
    await download.saveAs(backupPath);
    // Rule 6: wait for the real state (the records are in the cloud and the pill says so), not for a pill that was
    // already "synced" from the sign-in before the upload started (run 2 of the first final regression caught this).
    for (let i = 0; i < 150 && !(fake.records.size > 10 && fake.trips.size === 1); i += 1) await pageA.waitForTimeout(100);
    await waitPill(pageA, 'מסונכרן');
    const count1 = fake.records.size;
    const copy = await pageA.evaluate(() => localStorage.getItem('latisa:premigration:v1'));
    const after = await data(pageA);
    const sameTrips = JSON.stringify(tripsOf(after)) === JSON.stringify(tripsOf(original));
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    pass('S14-6a first sign-in offers the move, with counts; a backup file downloads first; the exact data text is kept once', /תחנות/.test(migrateText) && backup.format === 'tisa-backup' && copy === original, { migrateText, file: download.suggestedFilename() });
    pass('S14-6b the trip moved to the account and nothing on the phone changed', count1 > 10 && fake.trips.size === 1 && sameTrips, { records: count1 });
    await pageA.reload(); await pageA.waitForSelector('#panel-settings:not([hidden])');
    await waitPill(pageA, 'מסונכרן');
    await pageA.waitForTimeout(500);
    pass('S14-6c a reload syncs again with no duplicate and no second offer', fake.records.size === count1 && !(await pageA.isVisible('#dlg-cloud-migrate[open]')) && JSON.stringify(tripsOf(await data(pageA))) === JSON.stringify(tripsOf(original)), { records: fake.records.size });
    await shot(pageA, 'settings-approved-390-light');

    // S14-4 airplane mode
    await ctxA.setOffline(true);
    await pageA.goto(`${BASE}#/checklist`); await pageA.waitForSelector('#panel-checklist:not([hidden])');
    await pageA.click('[data-action="item-add"]');
    await pageA.waitForSelector('#dlg-item[open]');
    await pageA.fill('#dlg-item [name="name"]', 'Offline sample item');
    await pageA.click('#dlg-item [type="submit"]');
    await closed(pageA, '#dlg-item');
    await waitPill(pageA, 'לא מחובר');
    const offlineSaved = JSON.stringify(tripsOf(await data(pageA))).includes('Offline sample item');
    await pageA.evaluate(() => scrollTo(0, 0));
    await shot(pageA, 'checklist-pill-offline-390-light');
    await ctxA.setOffline(false);
    await pageA.waitForFunction(() => true);
    await pageA.waitForFunction(() => document.querySelector('[data-slot="cloud-pill-text"]').textContent === 'מסונכרן', null, { timeout: 20000 });
    const inCloud = [...fake.records.values()].filter((r) => JSON.stringify(r.data).includes('Offline sample item'));
    pass('S14-4a an edit in airplane mode is saved on the phone, the pill says offline, and it syncs once the network is back', offlineSaved && inCloud.length === 1, { inCloud: inCloud.length });
    // a second phone of the same owner gets it once
    {
      const ctx2 = await context(browser, sb, {});
      const p2 = await open(ctx2, 'owner-a-phone2');
      await signIn(p2, 'owner-a@example.com');
      await closed(p2, '#dlg-cloud-auth');
      await p2.waitForFunction(() => [...document.querySelectorAll('[data-slot="cloud-trip-list"] input')].length >= 2, null, { timeout: 15000 });
      const tripId = JSON.parse(original).activeTripId;
      await p2.check(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`);
      await p2.waitForFunction((id) => JSON.parse(localStorage.getItem('tisa:v1')).activeTripId === id, tripId, { timeout: 15000 });
      const t2 = JSON.parse(await data(p2)).trips[tripId];
      const items = t2.checklist.filter((x) => x.name === 'Offline sample item').length;
      const stops = t2.destinations.length === JSON.parse(original).trips[tripId].destinations.length;
      pass('S14-4b a second phone of the owner gets the trip and the offline edit, once, and keeps its own trip too', items === 1 && stops && Object.keys(JSON.parse(await data(p2)).trips).length === 2, { items });
      await ctx2.close();
    }

    // S14-5 server failures
    {
      const fails = {};
      for (const f of [500, 402, 'network']) {
        await pageA.goto(`${BASE}#/settings`); await pageA.waitForSelector('#panel-settings:not([hidden])');
        const before = await data(pageA);
        const beforeSync = await pageA.evaluate(() => localStorage.getItem('latisa:sync:v1'));
        fake.fail = f;
        await pageA.evaluate(() => dispatchEvent(new Event('online')));
        await waitPill(pageA, 'לא מחובר');
        const same = before === await data(pageA);
        const syncKept = JSON.parse(beforeSync).trips && JSON.stringify(JSON.parse(await pageA.evaluate(() => localStorage.getItem('latisa:sync:v1'))).trips) === JSON.stringify(JSON.parse(beforeSync).trips);
        fails[f] = { same, syncKept, line: await pageA.textContent('[data-slot="cloud-sync"]') };
        fake.fail = null;
      }
      await pageA.click('[data-cloud="retry"]');
      await waitPill(pageA, 'מסונכרן');
      pass('S14-5 server error 500, 402 (paused or restricted) and no network: no local byte changes, the waiting changes stay, "offline" shown, then it recovers', Object.values(fails).every((x) => x.same && x.syncKept && /לא מחובר/.test(x.line)), { fails });
    }

    // ---------------- S14-3 sharing ----------------
    await pageA.click('[data-cloud="share"]');
    await pageA.waitForSelector('#dlg-cloud-share[open]');
    await pageA.fill('#dlg-cloud-share [name="email"]', 'nobody@example.com');
    await pageA.click('#dlg-cloud-share [type="submit"]');
    await pageA.waitForFunction(() => document.querySelector('[data-slot="cloud-share-error"]').textContent.length > 0);
    const notFound = await pageA.textContent('[data-slot="cloud-share-error"]');
    await pageA.fill('#dlg-cloud-share [name="email"]', 'friend-b@example.com');
    await pageA.click('#dlg-cloud-share [type="submit"]');
    await closed(pageA, '#dlg-cloud-share');
    const tripId = JSON.parse(original).activeTripId;
    // KEYBOARD-2: the account dialogs that need a sign-in (the keyboard crawler of stage 13 cannot reach them)
    const kb = [];
    await pageA.goto(`${BASE}#/settings`); await pageA.waitForSelector('#panel-settings:not([hidden])');
    kb.push(...await kbDialog(pageA, '[data-cloud="share"]', 'dlg-cloud-share'));
    kb.push(...await kbDialog(pageA, '[data-cloud="members"]', 'dlg-cloud-members'));
    const ctxB = await context(browser, sb, {});
    const pageB = await open(ctxB, 'friend-b');
    await signIn(pageB, 'friend-b@example.com');
    await closed(pageB, '#dlg-cloud-auth');
    await pageB.waitForSelector(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`, { timeout: 15000 });
    await pageB.check(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`);
    await pageB.waitForFunction((id) => JSON.parse(localStorage.getItem('tisa:v1')).activeTripId === id, tripId, { timeout: 15000 });
    const tB = JSON.parse(await data(pageB)).trips[tripId];
    const tA = JSON.parse(original).trips[tripId];
    const sharedOk = tB.destinations.length === tA.destinations.length && tB.places.length === tA.places.length && tB.people.length === tA.people.length;
    const privateOk = !Number.isInteger(tB.budget.totalMinor) && tB.checklist.length === 0 && tB.luggage.bags.length === 0 && Object.keys(tB.journal).length === 0;
    pass('S14-3a sharing by email: an unknown address is refused, the friend sees the shared trip (route, places, people)', /לא נמצא/.test(notFound) && sharedOk, { notFound });
    pass('S14-3b the friend gets none of the owner\'s personal data (budget, checklist, bags, journal)', privateOk);
    await shot(pageB, 'settings-member-390-light');
    // owner-only dates
    const beforeDates = [tB.startDate, tB.endDate];
    await pageB.fill('[data-form="settings-dates"] [name="start"]', '2031-01-01');
    await pageB.click('[data-form="settings-dates"] [type="submit"]');
    await pageB.waitForFunction(() => /רק בעל הטיול/.test(document.querySelector('[data-slot="toast"]').textContent));
    const tB2 = JSON.parse(await data(pageB)).trips[tripId];
    const shareHidden = await pageB.isHidden('[data-cloud="share"]');
    pass('S14-3c a friend cannot change the trip dates or share it further (owner only)', tB2.startDate === beforeDates[0] && shareHidden, { start: tB2.startDate });
    // a stranger does not see it
    {
      const ctxC = await context(browser, sb, {});
      const pc = await open(ctxC, 'stranger-c');
      await signIn(pc, 'stranger-c@example.com');
      await closed(pc, '#dlg-cloud-auth');
      await waitPill(pc, 'מסונכרן');
      const listed = await pc.$$eval('[data-slot="cloud-trip-list"] input', (is) => is.map((i) => i.value));
      pass('S14-3d a user the trip was not shared with does not see it', !listed.includes(tripId) && !rpcBy(sb, C).includes('pull_records'), { listed });
      await ctxC.close();
    }
    // owner removes the friend: the friend's copy stays, unlinked
    await pageA.click('[data-cloud="members"]');
    await pageA.waitForSelector('#dlg-cloud-members[open] [data-slot="cloud-members-list"] button');
    await shot(pageA, 'members-dialog-390-light');
    kb.push(...await kbDialog(pageA, '#dlg-cloud-members [data-slot="cloud-members-list"] button', 'dlg-cloud-confirm')); // Esc = no removal
    await pageA.click('#dlg-cloud-members [data-slot="cloud-members-list"] button');
    await pageA.waitForSelector('#dlg-cloud-confirm[open]');
    await pageA.click('[data-slot="cloud-confirm-yes"]');
    await pageA.waitForFunction(() => /הוסר/.test(document.querySelector('[data-slot="toast"]').textContent));
    await pageA.keyboard.press('Escape');
    await pageB.evaluate(() => dispatchEvent(new Event('online')));
    await pageB.waitForFunction(() => /במכשיר בלבד/.test(document.querySelector('[data-slot="cloud-trip-list"]').textContent), null, { timeout: 15000 });
    const tB3 = JSON.parse(await data(pageB)).trips[tripId];
    pass('S14-3e removing a friend: their copy stays on their phone, unlinked, nothing deleted', tB3 && tB3.destinations.length === tA.destinations.length);

    // ---------------- S14-7 admin ----------------
    const regularAdmin = sb.log.filter((x) => (x.uid === A || x.uid === B) && x.fn?.startsWith('admin_')).length;
    const adminFileRegular = [pageA, pageB].map((p) => p.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('admin-view.js')).length));
    const loaded = (await Promise.all(adminFileRegular)).reduce((a, b) => a + b, 0);
    pass('S14-7a regular users: no admin button, admin-view.js never loaded, no admin_* call sent', regularAdmin === 0 && loaded === 0 && await pageA.isHidden('[data-cloud="admin"]') && await pageB.isHidden('[data-cloud="admin"]'), { regularAdmin, loaded });
    {
      const ctxM = await context(browser, sb, {});
      const pm = await open(ctxM, 'admin-m');
      await signIn(pm, 'admin-m@example.com');
      await closed(pm, '#dlg-cloud-auth');
      await pm.waitForSelector('[data-cloud="admin"]:not([hidden])', { timeout: 15000 });
      await waitPill(pm, 'מסונכרן');
      if (await pm.isVisible('#dlg-cloud-migrate[open]')) await pm.click('[data-cloud="migrate-no"]'); // first phone of this account: the offer is expected
      kb.push(...await kbDialog(pm, '[data-cloud="upload"]', 'dlg-cloud-migrate'));
      kb.push(...await kbDialog(pm, '[data-cloud="admin"]', 'dlg-cloud-admin'));
      pass('KEYBOARD-2 the account dialogs after sign-in (share, members, confirm, move to account, admin): focus inside, Tab stays inside, Esc closes, focus back', kb.length === 0, { kb });
      await pm.click('[data-cloud="admin"]');
      await pm.waitForSelector('#dlg-cloud-admin[open] [data-slot="cloud-admin-users"] li');
      const P = [...fake.users.values()].find((u) => u.email === 'new-p@example.com');
      const row = pm.locator('#dlg-cloud-admin [data-slot="cloud-admin-users"] li', { hasText: 'new-p@example.com' });
      await row.getByRole('button', { name: 'אישור' }).click();
      await pm.waitForFunction(() => /נשמר/.test(document.querySelector('[data-slot="toast"]').textContent));
      const approved = P.status === 'approved';
      await shot(pm, 'admin-dialog-390-light');
      const rowB = pm.locator('#dlg-cloud-admin [data-slot="cloud-admin-users"] li', { hasText: 'stranger-c@example.com' });
      await rowB.getByRole('button', { name: 'חסימה' }).click();
      await pm.waitForSelector('#dlg-cloud-confirm[open]');
      await pm.click('[data-slot="cloud-confirm-yes"]');
      await pm.waitForFunction((id) => true, null);
      await pm.waitForTimeout(400);
      const blocked = fake.users.get(C).status === 'blocked';
      const adminLoaded = await pm.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('admin-view.js')).length);
      pass('S14-7b the admin sees users and trips, approves a pending user and blocks another (after a confirm)', approved && blocked && adminLoaded === 1, { approved, blocked });
      // change password (after a manual temporary one, docs/BACKEND_HE.md section 6)
      await pm.keyboard.press('Escape');
      await pm.click('[data-cloud="password"]');
      await pm.waitForSelector('#dlg-cloud-auth[open]');
      const emailHidden = await pm.isHidden('#dlg-cloud-auth [name="email"]');
      await pm.fill('#dlg-cloud-auth [name="pass"]', 'New-Sample-Passw0rd!');
      await pm.click('[data-slot="cloud-auth-submit"]');
      await closed(pm, '#dlg-cloud-auth');
      pass('PASSWORD a signed-in user changes the password (only a new password is asked)', emailHidden && fake.users.get(M).password === 'New-Sample-Passw0rd!');
      await ctxM.close();
    }

    // ---------------- RST: restore while signed in ----------------
    {
      const pushesBefore = sb.log.filter((x) => x.uid === A && x.fn === 'push_records').length;
      await pageA.goto(`${BASE}#/settings`); await pageA.waitForSelector('#panel-settings:not([hidden])');
      await pageA.setInputFiles('#import-file', backupPath);
      await pageA.waitForSelector('#dlg-import[open]');
      await pageA.click('[data-action="import-confirm"]');
      await pageA.waitForSelector('[data-slot="cloud-restore"]:not([hidden])');
      await pageA.evaluate(() => dispatchEvent(new Event('online')));
      await pageA.waitForTimeout(800);
      const pushesAfterImport = sb.log.filter((x) => x.uid === A && x.fn === 'push_records').length;
      await shot(pageA, 'restore-choice-390-light');
      await pageA.click('[data-cloud="restore-device"]');
      await pageA.waitForFunction(() => /במכשיר בלבד/.test(document.querySelector('[data-slot="cloud-trip-list"]').textContent));
      const cloudKept = [...fake.records.values()].some((r) => JSON.stringify(r.data).includes('Offline sample item'));
      pass('RST a backup restored while signed in asks "this phone only / the cloud too" and sends nothing until then; "this phone only" leaves the cloud as it was', pushesAfterImport === pushesBefore && cloudKept, { pushesBefore, pushesAfterImport });
    }

    // ---------------- S14-1e: signed in, then no network: opens from the offline copy (service worker on) ----------------
    {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await sb.install(c);
      await c.addInitScript((x) => { if (!sessionStorage.getItem('s14-seeded') && !localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); sessionStorage.setItem('s14-seeded', '1'); }, JSON.stringify(rich));
      const p = await c.newPage();
      watch(p, 'offline-sw');
      await p.goto(`${BASE}#/settings`);
      await p.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 }).catch(() => p.reload());
      await p.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
      await signIn(p, 'friend-b@example.com');
      await closed(p, '#dlg-cloud-auth');
      await waitPill(p, 'מסונכרן');
      if (await p.isVisible('#dlg-cloud-migrate[open]')) await p.click('[data-cloud="migrate-no"]');
      const before = await data(p);
      await c.setOffline(true);
      await p.reload();
      await p.waitForSelector('#panel-settings:not([hidden])', { timeout: 15000 });
      await waitPill(p, 'לא מחובר');
      const who = await p.textContent('[data-slot="cloud-who"]');
      await p.goto(`${BASE}#/home`); await p.waitForSelector('#panel-home:not([hidden])');
      pass('S14-1e signed in and no network: the app opens from its offline copy with the last data, says "offline", asks nothing', before === await data(p) && /friend-b/.test(who) && !(await p.isVisible('#dlg-cloud-auth[open]')), { who });
      await c.close();
    }

    // ---------------- KEYS ----------------
    {
      const all = [];
      for (const p of [pageA, pageB]) all.push(...await p.evaluate(() => Object.entries(localStorage)));
      const badKeys = all.map(([k]) => k).filter((k) => !/^(tisa:|latisa:)/.test(k));
      const leaked = all.some(([, v]) => v.includes(PASS));
      pass('KEYS only tisa:* (unchanged keys) and latisa:* (new) in storage; no password stored anywhere', badKeys.length === 0 && !leaked, { badKeys, leaked });
    }

    // ---------------- LAYOUT + shots in both themes and widths ----------------
    {
      const bad = [];
      for (const [w, h] of [[390, 844], [1440, 900]]) {
        for (const scheme of ['light', 'dark']) {
          const ctx = await context(browser, sb, { seed: rich, viewport: { width: w, height: h }, scheme });
          const p = await open(ctx, `layout-${w}-${scheme}`);
          await signIn(p, 'friend-b@example.com');
          await closed(p, '#dlg-cloud-auth');
          await waitPill(p, 'מסונכרן').catch(() => {});
          if (await p.isVisible('#dlg-cloud-migrate[open]')) await p.click('[data-cloud="migrate-no"]');
          for (const screen of ['settings', 'home']) {
            await p.goto(`${BASE}#/${screen}`); await p.waitForSelector(`#panel-${screen}:not([hidden])`);
            const over = await p.evaluate(() => document.scrollingElement.scrollWidth > innerWidth + 1);
            if (over) bad.push(`${screen} ${w} ${scheme}`);
            if (screen === 'settings' || w === 390) await shot(p, `${screen}-signed-in-${w}-${scheme}`);
          }
          await ctx.close();
        }
      }
      pass('LAYOUT the account card and the pill: no horizontal scroll at 390 and 1440, light and dark', bad.length === 0, { bad });
    }

    // ---------------- CSP ----------------
    {
      const v = [];
      for (const p of [pageA, pageB]) v.push(...await p.evaluate(() => window.__csp));
      pass('CSP no policy violation in any flow (sign-in, sync, sharing, admin, import, offline)', v.length === 0 && csp.length === 0, { v, csp });
    }
    await ctxA.close(); await ctxB.close();
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    pass('no requests outside the app and the (fake) Supabase project', outside.length === 0, { outside });
    await browser.close();
    server.kill();
    if (backupPath) fs.rmSync(backupPath, { force: true });
  }
  fs.writeFileSync(path.join(OUT, 'stage14-browser.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}${v.result === 'PASS' ? '' : `  ${JSON.stringify(v).slice(0, 600)}`}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exit(failed.length ? 1 : 0);
})();
