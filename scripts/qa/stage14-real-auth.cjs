// Stage 14: REAL sign-in checks against the project's own Supabase (config/app.config.json -> cloud), in Chromium.
// The ones stage14-real-e2e.cjs did not cover: the server's sign-in settings, a session that survives a reload, a
// token refresh, signing out (this phone, and the server ending the session), the minimum password length on the
// server, the manual password reset of docs/BACKEND_HE.md section 6 followed by "change password", and what the
// app would send to sign up. Not part of the regular regression (it needs temporary test users):
//   E2E_PASS=<p0> E2E_PASS_RESET=<p1> E2E_PASS_NEW=<p2> QA_OUT=<dir> node scripts/qa/stage14-real-auth.cjs
// Two TEMPORARY sample users (example.com), created with SQL right before the run and deleted right after it:
//   e2e-session@example.com  approved, password p0 (only its bcrypt hash is sent to the database)
//   e2e-reset@example.com    approved, password set with the documented reset command to p1 just before the run
// No e-mail is sent: SQL-created users get no mail, "forgot password" is never pressed, and the sign-up request is
// stopped in the browser before it leaves (A9). Passwords are read from the environment, never printed or written.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { richState } = require('./lib/rich-trip.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage14/real-auth');
fs.mkdirSync(OUT, { recursive: true });
const { E2E_PASS: P0, E2E_PASS_RESET: P1, E2E_PASS_NEW: P2 } = process.env;
if (!P0 || !P1 || !P2) { console.log('SKIP: E2E_PASS, E2E_PASS_RESET and E2E_PASS_NEW are needed (temporary test users). Nothing was run.'); process.exit(2); }
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/app.config.json'), 'utf8'));
const PROJECT = CFG.cloud?.url;
const KEY = CFG.cloud?.publishableKey;
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(PROJECT ?? '') || !/^sb_publishable_/.test(KEY ?? '')) { console.log('SKIP: config.cloud is not set'); process.exit(2); }
const SESSION = 'e2e-session@example.com';
const RESET = 'e2e-reset@example.com';
const PORT = Number(process.env.PORT ?? 8197);
const BASE = `http://127.0.0.1:${PORT}/`;
const T = 30_000;
const results = {};
const info = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}`); };
const errors = [];
const outside = [];
const auth = []; // { who, method, path, status }

function watch(page, who) {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`${who}: ${m.text().slice(0, 300)}`); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith(PROJECT) && !/^(data|blob):/.test(u)) outside.push(u); });
  page.on('response', (r) => { const u = new URL(r.url()); if (r.url().startsWith(`${PROJECT}/auth/v1/`)) auth.push({ who, method: r.request().method(), path: `${u.pathname}${u.search}`, status: r.status() }); });
}
async function context(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  // Phone A holds the shared rich sample trip (rule 22), so "no local byte changed" is checked on real data.
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
/** Fill and send the sign-in form. Returns '' when the dialog closed (signed in), else the error shown. */
async function signIn(page, email, pw) {
  if (!await page.isVisible('#dlg-cloud-auth[open]')) {
    await page.click('[data-cloud="signin"]');
    await page.waitForSelector('#dlg-cloud-auth[open]');
  }
  await page.fill('#dlg-cloud-auth [name="email"]', email);
  await page.fill('#dlg-cloud-auth [name="pass"]', pw);
  await page.click('[data-slot="cloud-auth-submit"]');
  await page.waitForFunction(() => !document.querySelector('#dlg-cloud-auth').open || document.querySelector('[data-slot="cloud-auth-error"]').textContent.length > 0, null, { timeout: T });
  const err = await page.evaluate(() => (document.querySelector('#dlg-cloud-auth').open ? document.querySelector('[data-slot="cloud-auth-error"]').textContent : ''));
  if (!err) { // first sign-in of a phone with a trip: the "move to my account" offer is expected; not part of these checks
    await pill(page, 'מסונכרן');
    if (await page.isVisible('#dlg-cloud-migrate[open]')) await page.click('[data-cloud="migrate-no"]');
  }
  return err;
}
const pill = (page, text) => page.waitForFunction((t) => document.querySelector('[data-slot="cloud-pill-text"]')?.textContent === t, text, { timeout: T }).then(() => true, () => false);
const local = (page) => page.evaluate(() => localStorage.getItem('tisa:v1'));
const session = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('latisa:auth:v1') ?? 'null'));
const toast = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-slot="toast"]').textContent), re.source, { timeout: T }).then(() => true, () => false);
/** Make the saved session look expired, then reload: supabase-js must refresh it with the server before use. */
async function expireAndReload(page) {
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('latisa:auth:v1'));
    s.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem('latisa:auth:v1', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForSelector('#panel-settings:not([hidden])');
}
/** Wait until the saved session is a fresh one again (the refresh answer arrived; the pill alone can show the saved
 *  state before it: seen 2026-11-23). false when it did not come. */
const freshSession = (page) => page.waitForFunction(() => (JSON.parse(localStorage.getItem('latisa:auth:v1') ?? 'null')?.expires_at ?? 0) > Date.now() / 1000 + 60, null, { timeout: T }).then(() => true, () => false);
// Direct calls to the server, made from a browser page (the browser has the network this machine allows).
let apiPage = null;
const api = (p, { method = 'GET', token, body } = {}) => apiPage.evaluate(async ({ url, method: m, key, token: tk, body: b }) => {
  const r = await fetch(url, { method: m, headers: { apikey: key, 'content-type': 'application/json', ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, json };
}, { url: `${PROJECT}${p}`, method, key: KEY, token, body });
const count = (re, who) => auth.filter((x) => (!who || x.who === who) && re.test(`${x.method} ${x.path}`)).length;

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const browser = await chromium.launch();
  try {
    const ctxApi = await context(browser);
    apiPage = await open(ctxApi, 'api');
    // A1 the server's sign-in settings (public endpoint, read only)
    {
      const s = (await api('/auth/v1/settings')).json;
      pass('A1 the real server: e-mail sign-in on, phone off, sign-up open, no e-mail confirmation (mailer_autoconfirm)', s.external?.email === true && s.external?.phone === false && s.disable_signup === false && s.mailer_autoconfirm === true,
        { email: s.external?.email, phone: s.external?.phone, disable_signup: s.disable_signup, mailer_autoconfirm: s.mailer_autoconfirm });
    }

    const ctxA = await context(browser, await richState());
    const A = await open(ctxA, 'A');
    const err0 = await signIn(A, SESSION, P0);
    const synced0 = await pill(A, 'מסונכרן');
    const localA = await local(A);

    // A2 a reload keeps the session: no sign-in form, no password sent again
    {
      const before = count(/grant_type=password/, 'A');
      await A.reload(); await A.waitForSelector('#panel-settings:not([hidden])');
      const ok = await pill(A, 'מסונכרן');
      pass('A2 after a reload the saved session is used: synced again, no password sent, the sign-in button hidden', err0 === '' && synced0 && ok && count(/grant_type=password/, 'A') === before && await A.isHidden('[data-cloud="signin"]'), { err0 });
    }

    // A3 token refresh with the real server
    {
      const s1 = await session(A);
      const before = count(/grant_type=refresh_token/, 'A');
      await expireAndReload(A);
      const fresh = await freshSession(A);
      const ok = fresh && await pill(A, 'מסונכרן');
      const s2 = await session(A);
      const refreshed = auth.filter((x) => x.who === 'A' && /grant_type=refresh_token/.test(x.path)).slice(before);
      pass('A3 an expired session is refreshed by the server: new access and refresh tokens, synced, local data unchanged',
        ok && refreshed.some((x) => x.status === 200) && s2.access_token !== s1.access_token && s2.refresh_token !== s1.refresh_token && s2.expires_at > Date.now() / 1000 && (await local(A)) === localA,
        { refreshCalls: refreshed.map((x) => x.status) });
    }

    // A4 minimum password length on the server (7 characters must be refused; the app asks for 8 itself too)
    {
      const s = await session(A);
      const r = await api('/auth/v1/user', { method: 'PUT', token: s.access_token, body: { password: 'Ab1-xyz' } });
      const body = r.json ?? {};
      pass('A4 the server refuses a 7-character password (minimum 8 is set on the server)', r.status === 422 && /weak_password/.test(body.error_code ?? body.code ?? '') , { status: r.status, error_code: body.error_code, msg: String(body.msg ?? body.message ?? '').slice(0, 120) });
    }

    // A6 signing out on another phone (scope "local") does not sign this phone out
    const ctxB = await context(browser);
    const B = await open(ctxB, 'B');
    {
      const errB = await signIn(B, SESSION, P0);
      await pill(B, 'מסונכרן');
      await B.click('[data-cloud="signout"]');
      await B.waitForSelector('[data-cloud="signin"]:not([hidden])', { timeout: T });
      await expireAndReload(A);
      const ok = await freshSession(A) && await pill(A, 'מסונכרן');
      pass('A6 signing out on another phone ends only that phone\'s session: this phone still refreshes and syncs', errB === '' && ok);
    }

    // A7 the server ends every session (as after a password change or a removed user): "expired", nothing lost
    {
      await signIn(B, SESSION, P0);
      await pill(B, 'מסונכרן');
      const sB = await session(B);
      const out = await api('/auth/v1/logout?scope=global', { method: 'POST', token: sB.access_token });
      const before = await local(A);
      await expireAndReload(A);
      await A.waitForFunction(() => /החיבור לחשבון הסתיים/.test(document.querySelector('[data-slot="cloud-text"]')?.textContent ?? ''), null, { timeout: T }).catch(() => {});
      const text = await A.textContent('[data-slot="cloud-text"]');
      const signinShown = await A.isVisible('[data-cloud="signin"]');
      const kept = (await local(A)) === before;
      const errAgain = await signIn(A, SESSION, P0);
      const back = await pill(A, 'מסונכרן');
      pass('A7 when the server ends the session, the phone shows "the connection ended, sign in again", keeps every local byte, and a new sign-in works',
        out.status === 204 && /החיבור לחשבון הסתיים/.test(text) && signinShown && kept && errAgain === '' && back, { logoutStatus: out.status, text });
    }

    // A5 sign out on this phone, then what the server says about the old tokens
    {
      const s = await session(A);
      const before = await local(A);
      await A.click('[data-cloud="signout"]');
      const toastOk = await toast(A, /התנתקתם/);
      await A.waitForSelector('[data-cloud="signin"]:not([hidden])', { timeout: T });
      const logout = auth.filter((x) => x.who === 'A' && /\/logout/.test(x.path)).at(-1);
      const stored = await A.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('latisa:auth:')));
      const rt = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
      const user = await api('/auth/v1/user', { token: s.access_token });
      const rpc = await api('/rest/v1/rpc/my_profile', { method: 'POST', token: s.access_token, body: {} });
      info.afterSignOut = {
        refreshWithOldRefreshToken: rt.status,
        authUserWithOldAccessToken: user.status,
        rpcWithOldAccessToken: rpc.status,
        note: 'An access token is a signed JWT: the database accepts it until it expires (at most 1 hour, the project default). The refresh token and the session are gone at once.',
      };
      pass('A5 sign out on this phone: the server ends the session (logout 204, the old refresh token is refused), the session leaves the phone, the trip stays',
        toastOk && logout?.status === 204 && stored.length === 0 && rt.status >= 400 && rt.status < 500 && (await local(A)) === before, { logout: logout?.status, stored, ...info.afterSignOut });
    }
    await ctxB.close();

    // A8 the manual reset of BACKEND_HE.md section 6 (run with SQL just before this script), then "change password"
    {
      const ctxR = await context(browser);
      const r = await open(ctxR, 'R');
      const old = await signIn(r, RESET, P0);
      const withTemp = await signIn(r, RESET, P1);
      const ok1 = await pill(r, 'מסונכרן');
      await r.click('[data-cloud="password"]');
      await r.waitForSelector('#dlg-cloud-auth[open]');
      const onlyPass = await r.evaluate(() => [...document.querySelectorAll('#dlg-cloud-auth label:not([hidden]) input')].map((i) => i.name));
      await r.fill('#dlg-cloud-auth [name="pass"]', P2);
      await r.click('[data-slot="cloud-auth-submit"]');
      const changed = await toast(r, /הסיסמה עודכנה/);
      await r.click('[data-cloud="signout"]');
      await r.waitForSelector('[data-cloud="signin"]:not([hidden])', { timeout: T });
      const tempAgain = await signIn(r, RESET, P1);
      const withNew = await signIn(r, RESET, P2);
      const ok2 = await pill(r, 'מסונכרן');
      pass('A8 manual reset (the documented SQL command) then "change password" in the app: the old password is refused, the temporary one works, the new one replaces it',
        /לא נכונים/.test(old) && withTemp === '' && ok1 && onlyPass.join() === 'pass' && changed && /לא נכונים/.test(tempAgain) && withNew === '' && ok2, { old, tempAgain, onlyPass });
      await r.click('[data-cloud="signout"]');
      await ctxR.close();
    }
    await ctxA.close();

    // A9 sign-up: what the app sends, stopped in the browser before it leaves (no account is created, no e-mail)
    {
      const ctx = await context(browser);
      const sent = [];
      await ctx.route(`${PROJECT}/auth/v1/signup**`, (route) => { sent.push({ url: route.request().url(), headers: route.request().headers(), body: route.request().postDataJSON() }); return route.abort('blockedbyclient'); });
      const p = await open(ctx, 'S');
      await p.click('[data-cloud="signup"]');
      await p.waitForSelector('#dlg-cloud-auth[open]');
      const fields = await p.evaluate(() => [...document.querySelectorAll('#dlg-cloud-auth label:not([hidden]) input')].map((i) => i.name));
      const errOf = async () => p.textContent('[data-slot="cloud-auth-error"]');
      await p.fill('#dlg-cloud-auth [name="email"]', 'not-an-address');
      await p.fill('#dlg-cloud-auth [name="pass"]', 'Long-enough-1');
      await p.click('[data-slot="cloud-auth-submit"]');
      const badMail = await errOf();
      await p.fill('#dlg-cloud-auth [name="email"]', SESSION);
      await p.fill('#dlg-cloud-auth [name="pass"]', 'short');
      await p.click('[data-slot="cloud-auth-submit"]');
      const short = await errOf();
      const sentBefore = sent.length;
      await p.fill('#dlg-cloud-auth [name="pass"]', P2);
      await p.fill('#dlg-cloud-auth [name="name"]', 'Sample Name');
      await p.fill('#dlg-cloud-auth [name="phone"]', '000');
      await p.click('[data-slot="cloud-auth-submit"]');
      await p.waitForFunction(() => document.querySelector('[data-slot="cloud-auth-error"]').textContent.length > 0, null, { timeout: T });
      const stopped = await errOf();
      const req = sent[0];
      const u = req ? new URL(req.url) : null;
      pass('A9 sign-up in the app: bad address and short password stop in the phone; a good form sends one request to the project\'s /auth/v1/signup with the publishable key, the name and phone, PKCE and the site as the return address',
        fields.join() === 'email,pass,name,phone' && /תקינה/.test(badMail) && /8 תווים/.test(short) && sentBefore === 0 && sent.length === 1
          && u.origin === PROJECT && req.headers.apikey === KEY && req.body.email === SESSION && typeof req.body.password === 'string'
          && req.body.data?.display_name === 'Sample Name' && req.body.data?.phone === '000' && typeof req.body.code_challenge === 'string'
          && u.searchParams.get('redirect_to') === BASE && /אין חיבור/.test(stopped),
        { fields, bodyKeys: req ? Object.keys(req.body).sort() : null, redirect_to: u?.searchParams.get('redirect_to'), badMail, short, stopped });
      await ctx.close();
    }
  } catch (e) {
    pass('run', false, { error: String(e.stack ?? e).slice(0, 3000) });
  } finally {
    pass('only this site and the project were contacted', outside.length === 0, { outside });
    pass('no JS errors', errors.length === 0, { errors });
    await browser.close();
    server.kill();
  }
  const authCalls = auth.reduce((m, x) => { const k = `${x.method} ${x.path.split('?')[0]}${/grant_type=(\w+)/.exec(x.path)?.[1] ? `?${/grant_type=(\w+)/.exec(x.path)[1]}` : ''} ${x.status}`; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const text = JSON.stringify({ project: PROJECT, results, info, authCalls }, null, 2);
  for (const pw of [P0, P1, P2]) if (text.includes(pw)) { console.log('FAIL a password would be written to the evidence; nothing written'); process.exit(1); }
  fs.writeFileSync(path.join(OUT, 'stage14-real-auth.json'), text);
  const failed = Object.values(results).filter((v) => v.result !== 'PASS').length;
  for (const [k, v] of Object.entries(results)) if (v.result !== 'PASS') console.log(`  ${k}: ${JSON.stringify(v).slice(0, 800)}`);
  console.log(failed ? `FAIL ${failed}` : 'ALL PASS');
  process.exit(failed ? 1 : 0);
})();
