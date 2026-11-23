// A FAKE Supabase backend for tests only: an in-memory copy of the rules in supabase/migrations/0001_stage14_init.sql
// (statuses, membership, shared/personal scopes, owner-only trip facts, last-write-wins, no deletes of records;
// a whole trip only through delete_trip, 0003_delete_trip.sql).
// Used by the Node tests (through a fake client) and by the browser tests (through page.route). It makes the app's
// behaviour testable without any network. It proves NOTHING about a real project's security: that is what
// supabase/tests/rls_check.sql (real project) and scripts/qa/stage14-rls-local.cjs (local PostgreSQL) are for.
// Sample data only.

export class FakeCloudError extends Error {
  constructor(message, { status = 400, code = '' } = {}) { super(message); this.status = status; this.code = code; }
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const lower = (s) => String(s ?? '').trim().toLowerCase();
const recKey = (r) => `${r.trip_id}|${r.scope}|${r.kind}|${r.rec_id}`;

export function createFakeCloud({ startMs = Date.parse('2026-11-23T10:00:00Z') } = {}) {
  let clock = startMs;
  const tick = () => { clock += 1; return new Date(clock).toISOString(); };
  let seq = 0;
  const users = new Map();       // id -> { id, email, password, display_name, phone, role, status, created_at }
  const trips = new Map();       // id -> { id, owner_id, name, country_code, start_date, end_date, updated_at, created_at }
  const members = new Map();     // trip id -> Map(user id -> role)
  const records = new Map();     // key -> row
  const settings = new Map();    // user id -> { data, edited_at }
  const tokens = new Map();      // access token -> user id
  const calls = [];              // [{ uid, fn }]
  const fake = { users, trips, members, records, settings, calls, fail: null, delayMs: 0 };

  const user = (uid) => users.get(uid) ?? null;
  const approved = (uid) => user(uid)?.status === 'approved';
  const admin = (uid) => approved(uid) && user(uid)?.role === 'admin';
  const member = (t, uid) => Boolean(members.get(t)?.has(uid));
  const owner = (t, uid) => trips.get(t)?.owner_id === uid;
  const deny = () => { throw new FakeCloudError('not_allowed', { status: 403, code: 'P0001' }); };

  fake.addUser = ({ email, password = 'Sample-Passw0rd!', display_name = '', phone = null, status = 'pending', role = 'user' }) => {
    if ([...users.values()].some((u) => u.email === lower(email))) throw new FakeCloudError('User already registered', { status: 422 });
    seq += 1;
    const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
    users.set(id, { id, email: lower(email), password, display_name: String(display_name).slice(0, 30), phone: phone ? String(phone).slice(0, 20) : null, role, status, created_at: tick() });
    return id;
  };
  fake.setStatus = (uid, status) => { users.get(uid).status = status; };
  fake.setRole = (uid, role) => { users.get(uid).role = role; };
  fake.issueToken = (uid) => { seq += 1; const tok = `fake-access-${seq}`; tokens.set(tok, uid); return tok; };
  fake.uidOfToken = (tok) => tokens.get(tok) ?? null;
  fake.revokeTokens = (uid) => { for (const [k, v] of tokens) if (v === uid) tokens.delete(k); };

  const fns = {
    my_profile(uid) {
      const u = user(uid);
      return u ? [{ id: u.id, email: u.email, display_name: u.display_name, phone: u.phone, role: u.role, status: u.status }] : [];
    },
    update_my_profile(uid, { p_name, p_phone }) {
      const u = user(uid); if (!u) return null;
      u.display_name = String(p_name ?? '').trim().slice(0, 30);
      u.phone = String(p_phone ?? '').trim().slice(0, 20) || null;
      return null;
    },
    my_trips(uid) {
      if (!approved(uid)) return [];
      return [...trips.values()].filter((x) => member(x.id, uid)).map((x) => ({ ...clone(x), my_role: members.get(x.id).get(uid) }));
    },
    create_trip(uid, { t, p_name, p_cc, p_start, p_end }) {
      if (!approved(uid)) deny();
      if (trips.has(t)) return owner(t, uid) ? 'exists' : 'taken';
      const at = tick();
      trips.set(t, { id: t, owner_id: uid, name: String(p_name ?? '').slice(0, 80), country_code: String(p_cc ?? '').slice(0, 8), start_date: p_start ?? null, end_date: p_end ?? null, created_at: at, updated_at: at });
      members.set(t, new Map([[uid, 'owner']]));
      return 'created';
    },
    update_trip(uid, { t, p_name, p_cc, p_start, p_end }) {
      if (!approved(uid) || !owner(t, uid)) return false;
      Object.assign(trips.get(t), { name: String(p_name ?? '').slice(0, 80), country_code: String(p_cc ?? '').slice(0, 8), start_date: p_start ?? null, end_date: p_end ?? null, updated_at: tick() });
      return true;
    },
    pull_records(uid, { t, since }) {
      if (!(admin(uid) || (approved(uid) && member(t, uid)))) return [];
      const after = since ? Date.parse(since) : -Infinity;
      return [...records.values()]
        .filter((r) => r.trip_id === t && Date.parse(r.server_at) > after && (admin(uid) || r.scope === 'shared' || r.scope === uid))
        .sort((a, b) => a.server_at.localeCompare(b.server_at) || a.kind.localeCompare(b.kind) || a.rec_id.localeCompare(b.rec_id))
        .slice(0, 1000).map(clone);
    },
    push_records(uid, { rows }) {
      if (!Array.isArray(rows) || rows.length > 500) throw new FakeCloudError('bad_batch');
      // One statement in the real function: any row that fails RLS fails the whole call (nothing is stored).
      for (const r of rows) {
        if (!(approved(uid) && member(r.trip_id, uid) && (r.scope === 'shared' || r.scope === uid))) {
          throw new FakeCloudError('new row violates row-level security policy for table "trip_records"', { status: 403, code: '42501' });
        }
      }
      return rows.map((r) => {
        const key = recKey(r);
        const old = records.get(key);
        const accepted = !old || Date.parse(old.edited_at) <= Date.parse(r.edited_at);
        if (accepted) {
          records.set(key, { trip_id: r.trip_id, scope: r.scope, kind: r.kind, rec_id: r.rec_id, data: clone(r.data ?? {}), deleted: Boolean(r.deleted), edited_at: new Date(r.edited_at).toISOString(), server_at: tick(), updated_by: uid });
        }
        return { trip_id: r.trip_id, scope: r.scope, kind: r.kind, rec_id: r.rec_id, accepted };
      });
    },
    get_settings(uid) {
      if (!approved(uid)) return [];
      const s = settings.get(uid);
      return s ? [clone(s)] : [];
    },
    save_settings(uid, { p_data, p_edited }) {
      if (!approved(uid)) throw new FakeCloudError('new row violates row-level security policy', { status: 403, code: '42501' });
      const old = settings.get(uid);
      if (old && Date.parse(old.edited_at) > Date.parse(p_edited)) return false;
      settings.set(uid, { data: clone(p_data ?? {}), edited_at: new Date(p_edited).toISOString() });
      return true;
    },
    share_trip(uid, { t, friend_email }) {
      if (!approved(uid) || !owner(t, uid)) deny();
      const f = [...users.values()].find((u) => u.email === lower(friend_email) && u.status === 'approved');
      if (!f) return 'not_found';
      if (!members.get(t).has(f.id)) members.get(t).set(f.id, 'member');
      return 'ok';
    },
    unshare_trip(uid, { t, friend }) {
      if (!(admin(uid) || (approved(uid) && owner(t, uid)))) deny();
      if (members.get(t)?.get(friend) !== 'member') throw new FakeCloudError('not_a_member');
      members.get(t).delete(friend);
      return null;
    },
    leave_trip(uid, { t }) {
      if (members.get(t)?.get(uid) === 'member') members.get(t).delete(uid);
      return null;
    },
    trip_people(uid, { t }) {
      if (!(admin(uid) || (approved(uid) && member(t, uid)))) return [];
      return [...members.get(t).entries()].map(([id, role]) => ({
        user_id: id, display_name: user(id)?.display_name ?? '', role,
        email: admin(uid) || owner(t, uid) || id === uid ? user(id)?.email ?? null : null,
      }));
    },
    delete_trip(uid, { t }) {
      // 0003_delete_trip.sql: approved owner only; the trip's records and members go with it; 'missing' when gone
      if (!approved(uid)) deny();
      if (!trips.has(t)) return 'missing';
      if (!owner(t, uid)) deny();
      trips.delete(t);
      members.delete(t);
      for (const [k, r] of records) if (r.trip_id === t) records.delete(k);
      return 'deleted';
    },
    admin_list_users(uid) {
      if (!admin(uid)) deny();
      return [...users.values()].map(({ password, ...u }) => clone(u));
    },
    admin_list_trips(uid) {
      if (!admin(uid)) deny();
      return [...trips.values()].map((x) => ({
        id: x.id, name: x.name, owner_email: user(x.owner_id)?.email ?? '', start_date: x.start_date, end_date: x.end_date,
        members: [...members.get(x.id).entries()].map(([id, role]) => ({ user_id: id, email: user(id)?.email ?? '', role })),
      }));
    },
    admin_set_status(uid, { target, new_status }) {
      if (!admin(uid)) deny();
      if (target === uid) throw new FakeCloudError('not_self');
      if (!['pending', 'approved', 'blocked'].includes(new_status)) throw new FakeCloudError('bad_status');
      const u = user(target);
      if (u && u.role === 'user') u.status = new_status;
      return null;
    },
  };

  /** Call a function as a signed-in user (uid null = anon, which may call nothing). */
  fake.rpc = (uid, fn, args = {}) => {
    calls.push({ uid, fn });
    if (fake.fail === 'network') throw new FakeCloudError('TypeError: Failed to fetch', { status: 0 });
    if (Number.isInteger(fake.fail)) throw new FakeCloudError(`HTTP ${fake.fail}`, { status: fake.fail });
    if (!uid) throw new FakeCloudError('permission denied', { status: 401, code: '42501' });
    if (!Object.hasOwn(fns, fn)) throw new FakeCloudError(`Could not find the function public.${fn}`, { status: 404, code: 'PGRST202' });
    return clone(fns[fn](uid, args));
  };
  fake.now = () => new Date(clock).toISOString();
  return fake;
}

/** A stand-in for the supabase-js client, enough for src/js/core/cloud-api.js: rpc() and the auth calls it uses. */
export function fakeClient(fake) {
  let session = null;
  const listeners = new Set();
  const emit = (ev) => { for (const cb of listeners) cb(ev, session); };
  const ok = (data) => ({ data, error: null });
  const err = (e) => ({ data: null, error: { message: e.message, status: e.status, code: e.code } });
  const sessionFor = (uid) => ({ access_token: fake.issueToken(uid), refresh_token: 'fake-refresh', user: { id: uid, email: fake.users.get(uid).email } });
  return {
    fake,
    async rpc(fn, args) {
      try { return ok(fake.rpc(session ? fake.uidOfToken(session.access_token) : null, fn, args)); } catch (e) { return err(e); }
    },
    auth: {
      async signUp({ email, password, options }) {
        if (fake.fail) return err(new FakeCloudError('Failed to fetch', { status: 0 }));
        try {
          const uid = fake.addUser({ email, password, display_name: options?.data?.display_name ?? '', phone: options?.data?.phone ?? null });
          session = sessionFor(uid); emit('SIGNED_IN');
          return ok({ user: session.user, session });
        } catch (e) { return err(e); }
      },
      async signInWithPassword({ email, password }) {
        if (fake.fail) return err(new FakeCloudError('Failed to fetch', { status: 0 }));
        const u = [...fake.users.values()].find((x) => x.email === lower(email));
        if (!u || u.password !== password) return err(new FakeCloudError('Invalid login credentials', { status: 400, code: 'invalid_credentials' }));
        session = sessionFor(u.id); emit('SIGNED_IN');
        return ok({ user: session.user, session });
      },
      async signOut() { session = null; emit('SIGNED_OUT'); return { error: null }; },
      async getSession() { return ok({ session }); },
      async resetPasswordForEmail() { return ok({}); },
      async updateUser({ password }) {
        if (!session) return err(new FakeCloudError('Auth session missing', { status: 401 }));
        fake.users.get(fake.uidOfToken(session.access_token)).password = password; return ok({ user: session.user });
      },
      onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
    },
  };
}
