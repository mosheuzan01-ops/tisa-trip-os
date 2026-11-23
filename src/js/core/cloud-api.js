// Stage 14: the only place that talks to Supabase. A thin layer over the supabase-js client (passed in, so Node
// tests use a fake one). Data calls go only through the functions in supabase/migrations/0001_stage14_init.sql;
// admin calls are NOT here (src/js/admin-view.js, loaded only for an admin). Every failure becomes a CloudError
// with a plain kind, so the caller can stay calm: 'offline' (no network, server down, paused or restricted project),
// 'auth' (signed out or session ended), 'denied' (not allowed), 'bad' (anything else).

export class CloudError extends Error {
  constructor(kind, message, status = null) { super(message || kind); this.kind = kind; this.status = status; }
}

/** Map a supabase-js error object (or a thrown error) to a CloudError. */
export function toCloudError(error) {
  if (error instanceof CloudError) return error;
  const status = Number(error?.status) || 0;
  const msg = String(error?.message ?? error ?? '');
  const code = String(error?.code ?? '');
  if (!status && /fetch|network|load failed|timed? ?out|abort/i.test(msg)) return new CloudError('offline', msg, status);
  if (status === 0 && !code) return new CloudError('offline', msg, status);
  if (status >= 500 || status === 402 || status === 408 || status === 429 || status === 540) return new CloudError('offline', msg, status);
  if (status === 401 || /jwt|session|refresh token/i.test(msg)) return new CloudError('auth', msg, status);
  if (status === 403 || code === '42501' || /not_allowed|row-level security|permission denied/i.test(msg)) return new CloudError('denied', msg, status);
  return new CloudError('bad', msg, status);
}

const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function createCloudApi(client) {
  async function rpc(fn, args = {}) {
    let res;
    try { res = await client.rpc(fn, args); } catch (e) { throw toCloudError(e); }
    if (res?.error) throw toCloudError(res.error);
    return res?.data ?? null;
  }
  async function auth(promise) {
    let res;
    try { res = await promise; } catch (e) { throw toCloudError(e); }
    if (res?.error) throw toCloudError(res.error);
    return res?.data ?? null;
  }
  const tripArgs = (id, meta) => ({ t: id, p_name: meta.name ?? '', p_cc: meta.countryCode ?? '', p_start: day(meta.startDate), p_end: day(meta.endDate) });

  return {
    // ---------- sign-in (Supabase Auth, email and password) ----------
    signUp: ({ email, password, displayName = '', phone = '', redirectTo }) => auth(client.auth.signUp({
      email, password, options: { data: { display_name: displayName, phone }, emailRedirectTo: redirectTo },
    })),
    signIn: ({ email, password }) => auth(client.auth.signInWithPassword({ email, password })),
    signOut: () => auth(client.auth.signOut({ scope: 'local' })),
    requestReset: (email, redirectTo) => auth(client.auth.resetPasswordForEmail(email, { redirectTo })),
    setNewPassword: (password) => auth(client.auth.updateUser({ password })),
    async session() { const d = await auth(client.auth.getSession()); return d?.session ?? null; },
    onAuth: (cb) => client.auth.onAuthStateChange(cb),

    // ---------- profile ----------
    async profile() { const rows = await rpc('my_profile'); return Array.isArray(rows) ? rows[0] ?? null : null; },
    updateProfile: ({ displayName, phone }) => rpc('update_my_profile', { p_name: displayName ?? '', p_phone: phone ?? '' }),

    // ---------- trips and records ----------
    async myTrips() { return (await rpc('my_trips')) ?? []; },
    createTrip: (id, meta) => rpc('create_trip', tripArgs(id, meta)),
    updateTrip: (id, meta) => rpc('update_trip', tripArgs(id, meta)),
    async pull(id, since) { return (await rpc('pull_records', { t: id, since: since ?? null })) ?? []; },
    async push(rows) { return (await rpc('push_records', { rows })) ?? []; },

    // ---------- settings that follow the account ----------
    async getSettings() { const rows = await rpc('get_settings'); return Array.isArray(rows) ? rows[0] ?? null : null; },
    saveSettings: (data, editedAt) => rpc('save_settings', { p_data: data, p_edited: editedAt }),

    // ---------- sharing ----------
    share: (id, email) => rpc('share_trip', { t: id, friend_email: String(email ?? '').trim() }),
    unshare: (id, userId) => rpc('unshare_trip', { t: id, friend: userId }),
    leave: (id) => rpc('leave_trip', { t: id }),
    async people(id) { return (await rpc('trip_people', { t: id })) ?? []; },
  };
}
