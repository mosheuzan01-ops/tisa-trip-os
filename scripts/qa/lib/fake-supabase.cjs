// Stage 14 browser tests: a FAKE Supabase reached through Playwright routes, so the real app and the real supabase-js
// file run with no network at all. Behind it is tests/fakes/fake-cloud.js (the migration's rules in memory).
// It answers only what the app uses: the Auth endpoints for email + password, and POST /rest/v1/rpc/<function>.
// This makes the app's behaviour testable; it is NOT evidence that a real Supabase project is secure (that is
// supabase/tests/rls_check.sql in the real project, and scripts/qa/stage14-rls-local.cjs on local PostgreSQL).
// Sample users and data only (rule 16).
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..', '..');
const PROJECT = 'https://abcdefghijklmnopqrst.supabase.co'; // a made-up project address, never contacted
const PUBLISHABLE = 'sb_publishable_sample_only';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function createFakeSupabase() {
  const { createFakeCloud } = await import(pathToFileURL(path.join(ROOT, 'tests/fakes/fake-cloud.js')).href);
  const fake = createFakeCloud({ startMs: Date.now() - 60_000 });
  const access = new Map(); // jwt -> uid
  const refresh = new Map(); // refresh token -> uid
  const log = []; // { method, path, fn, uid }
  let n = 0;

  function session(uid) {
    n += 1;
    const now = Math.floor(Date.now() / 1000);
    const u = fake.users.get(uid);
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', email: u.email, exp: now + 3600, iat: now, session_id: `s${n}` })}.c2FtcGxl`;
    const rt = `sample-refresh-${n}`;
    access.set(jwt, uid); refresh.set(rt, uid);
    return { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: rt, user: userJson(uid) };
  }
  function userJson(uid) {
    const u = fake.users.get(uid);
    return { id: uid, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: { display_name: u.display_name }, created_at: u.created_at, updated_at: u.created_at };
  }
  const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const bearer = (req.headers().authorization ?? '').replace(/^Bearer\s+/i, '');
    const uid = access.get(bearer) ?? null;
    let body = {};
    try { body = req.postData() ? JSON.parse(req.postData()) : {}; } catch { body = {}; }
    const entry = { method: req.method(), path: url.pathname, fn: null, uid };
    log.push(entry);
    if (fake.fail === 'network') return route.abort('internetdisconnected');
    if (Number.isInteger(fake.fail)) return json(route, fake.fail, { message: `HTTP ${fake.fail}`, code: String(fake.fail) });

    const p = url.pathname;
    if (p === '/auth/v1/signup' && req.method() === 'POST') {
      try {
        const id = fake.addUser({ email: body.email, password: body.password, display_name: body.data?.display_name ?? '', phone: body.data?.phone || null });
        return json(route, 200, session(id));
      } catch (e) { return json(route, 422, { code: 422, error_code: 'user_already_exists', msg: e.message, message: e.message }); }
    }
    if (p === '/auth/v1/token' && req.method() === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const u = [...fake.users.values()].find((x) => x.email === String(body.email ?? '').trim().toLowerCase());
        if (!u || u.password !== body.password) return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
        return json(route, 200, session(u.id));
      }
      if (grant === 'refresh_token') {
        const id = refresh.get(body.refresh_token);
        if (!id) return json(route, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token', message: 'Invalid Refresh Token' });
        return json(route, 200, session(id));
      }
    }
    if (p === '/auth/v1/logout') { if (uid) for (const [k, v] of access) if (v === uid) access.delete(k); return route.fulfill({ status: 204, headers: CORS }); }
    if (p === '/auth/v1/user' && req.method() === 'GET') return uid ? json(route, 200, userJson(uid)) : json(route, 401, { message: 'invalid JWT' });
    if (p === '/auth/v1/user' && req.method() === 'PUT') {
      if (!uid) return json(route, 401, { message: 'invalid JWT' });
      if (body.password) fake.users.get(uid).password = body.password;
      return json(route, 200, userJson(uid));
    }
    if (p === '/auth/v1/recover') return json(route, 200, {});
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(p);
    if (m && req.method() === 'POST') {
      entry.fn = m[1];
      // fake.loseAnswer = '<rpc name>': the fake server does the call, then the connection drops before the answer
      // reaches the app (the case of M1 and B: the records are in the cloud, the phone does not know it).
      if (fake.loseAnswer === m[1]) { try { fake.rpc(uid, m[1], body); } catch { /* as if it failed */ } return route.abort('connectionreset'); }
      try {
        const data = fake.rpc(uid, m[1], body);
        return json(route, 200, data === undefined ? null : data);
      } catch (e) {
        return json(route, e.status || 400, { message: e.message, code: e.code || 'P0001', details: null, hint: null });
      }
    }
    return json(route, 404, { message: `fake: no route for ${req.method()} ${p}` });
  }

  /** Route Supabase and serve a config with the cloud set up (the real file has it empty). */
  /** Route Supabase and serve a config pointing at the fake project. configured: false serves the cloud block empty
   *  (the 1.0.x-like app with no account part), whatever the real config file holds. Never the real project. */
  async function install(context, { configured = true } = {}) {
    await context.route(`${PROJECT}/**`, handle);
    await context.route(/^https:\/\/[a-z0-9]{20}\.supabase\.co\//, (route) => (route.request().url().startsWith(PROJECT) ? route.fallback() : route.abort('blockedbyclient')));
    await context.route(/\/config\/app\.config\.json(\?.*)?$/, async (route) => {
      const res = await route.fetch();
      const cfg = await res.json();
      cfg.cloud = configured ? { url: PROJECT, publishableKey: PUBLISHABLE } : { url: '', publishableKey: '' };
      await route.fulfill({ response: res, body: JSON.stringify(cfg), headers: { ...res.headers(), 'content-type': 'application/json' } });
    });
  }
  return { fake, log, install, PROJECT, PUBLISHABLE };
}

module.exports = { createFakeSupabase, PROJECT, PUBLISHABLE };
