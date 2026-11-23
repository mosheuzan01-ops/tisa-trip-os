// Stage 14: local-first sync. The phone stays the working copy (tisa:v1, unchanged); this module only works out
// what to send and what to take, and returns new trip objects for the app to save. It never deletes the app's data:
//  - a failure (offline, server down, paused or restricted project, session ended) throws a CloudError BEFORE anything
//    is returned, so the caller keeps both the data and the waiting changes exactly as they were;
//  - a change that loses a conflict, and a record a friend deleted, are kept as copies in sync.conflicts;
//  - the trip header (name, country, dates) is changed only by the owner; a member's local change is kept as a copy.
// Sync state lives under latisa:sync:v1 (src/js/core/storage.js). Pure apart from the api calls; tests in
// tests/stage14-sync.test.js. Conflict rule: the later edit time wins (edited_at, the phone's clock when edited).
import { tripToRecords, recordsToTrip, hashValue, recKey, parseKey, stableJson } from './sync-map.js';
import { createTrip } from './schema.js';
import { CloudError } from './cloud-api.js';

const PULL_OVERLAP_MS = 120_000;
const PAGE = 1000;
const BATCH = 500;
const KEEP_COPIES = 300;
const MAX_RECORD_CHARS = 900_000; // the server refuses a record over 1 MB; a bigger one stays on the phone only
const SETTINGS_FIELDS = ['language', 'assistantQuestionLimit'];
const EPOCH = '1970-01-01T00:00:00.000Z';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const later = (a, b) => Date.parse(a) > Date.parse(b);

export const emptySyncState = () => ({
  v: 1, userId: null, profile: null, trips: {}, declined: {}, restorePending: false,
  conflicts: [], cloudTrips: [], settings: { shadow: null, lastLocal: null, dirtyAt: null },
  lastSyncAt: null, lastError: null,
});

const newEntry = (role) => ({ linked: true, role, cursor: null, shadow: {}, lastLocal: {}, dirtyAt: {}, meta: { shadow: null, lastLocal: null, dirtyAt: null } });
const metaOfServer = (st) => ({ name: st?.name ?? '', countryCode: st?.country_code ?? '', startDate: st?.start_date ?? null, endDate: st?.end_date ?? null });
const settingsOf = (state) => Object.fromEntries(SETTINGS_FIELDS.map((k) => [k, state?.settings?.[k] ?? null]));

/** Mark what changed on the phone since the last look, with the time it was noticed (the edit time for LWW).
 *  Called after every save, and at the start of each sync. Mutates and returns `sync`. */
export function noteLocalChanges(sync, state, nowIso) {
  for (const [id, entry] of Object.entries(sync.trips ?? {})) {
    const trip = state?.trips?.[id];
    if (!entry.linked || !trip) continue;
    const { meta, records } = tripToRecords(trip);
    const cur = {};
    for (const [k, r] of records) cur[k] = hashValue(r.data);
    for (const [k, h] of Object.entries(cur)) if (entry.lastLocal[k] !== h) entry.dirtyAt[k] = nowIso;
    for (const k of Object.keys(entry.lastLocal)) if (!(k in cur)) entry.dirtyAt[k] = nowIso;
    entry.lastLocal = cur;
    const mh = hashValue(meta);
    if (entry.meta.lastLocal !== mh) { entry.meta.dirtyAt = nowIso; entry.meta.lastLocal = mh; }
  }
  const sh = hashValue(settingsOf(state));
  sync.settings ??= { shadow: null, lastLocal: null, dirtyAt: null };
  // The first look at a phone's settings is not an edit: a new phone takes the account's settings.
  if (sync.settings.lastLocal === null) sync.settings.lastLocal = sh;
  else if (sync.settings.lastLocal !== sh) { sync.settings.lastLocal = sh; sync.settings.dirtyAt = nowIso; }
  return sync;
}

/** How many records wait to be sent (for the "waiting to sync" indicator). */
export function pendingCount(sync, state) {
  let n = 0;
  for (const [id, entry] of Object.entries(sync.trips ?? {})) {
    const trip = state?.trips?.[id];
    if (!entry.linked || !trip) continue;
    const { meta, records } = tripToRecords(trip);
    const seen = new Set();
    for (const [k, r] of records) { seen.add(k); if (entry.shadow[k] !== hashValue(r.data)) n += 1; }
    for (const k of Object.keys(entry.shadow)) if (!seen.has(k)) n += 1;
    if (entry.role === 'owner' && hashValue(meta) !== entry.meta.shadow) n += 1;
  }
  return n;
}

async function pullAll(api, tripId, cursor) {
  const out = [];
  let since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
  for (;;) {
    const rows = await api.pull(tripId, since);
    out.push(...rows);
    if (rows.length < PAGE) break;
    since = rows[rows.length - 1].server_at;
  }
  return out;
}

/** Sync one linked trip. Returns { trip (or null when nothing changed here), entry, copies, notices }. Throws on failure. */
export async function syncTrip({ api, entry: entryIn, trip, userId, serverTrip, nowIso }) {
  const e = clone(entryIn);
  const tripId = trip.id;
  let { meta, records } = tripToRecords(trip);
  const copies = [];
  const notices = [];
  let changed = false;
  const setShadow = (k, h) => { if (h === null) delete e.shadow[k]; else e.shadow[k] = h; };

  // ---------- the trip header: only the owner sends it ----------
  const server = metaOfServer(serverTrip);
  const sh = hashValue(server);
  const lh = hashValue(meta);
  if (e.role === 'owner') {
    if (lh !== e.meta.shadow && lh !== sh) {
      if (await api.updateTrip(tripId, meta)) e.meta.shadow = lh;
    } else if (sh !== lh) { meta = server; changed = true; e.meta.shadow = sh; } else e.meta.shadow = sh;
  } else {
    if (sh !== lh) {
      if (e.meta.shadow !== null && lh !== e.meta.shadow) {
        copies.push({ type: 'datesOwnerOnly', tripId, key: 'meta', local: meta, remote: server, at: nowIso });
        notices.push({ type: 'datesOwnerOnly', tripId });
      }
      meta = server; changed = true;
    }
    e.meta.shadow = sh;
  }

  // ---------- take what changed in the cloud ----------
  const apply = (rows) => {
    for (const row of rows) {
      if (!e.cursor || later(row.server_at, e.cursor)) e.cursor = row.server_at;
      if (row.scope !== 'shared' && row.scope !== userId) continue; // an admin may read others' personal rows: never take them
      const scope = row.scope === 'shared' ? 'shared' : 'personal';
      const k = recKey(scope, row.kind, row.rec_id);
      const rh = row.deleted ? null : hashValue(row.data);
      const local = records.get(k);
      const lhash = local ? hashValue(local.data) : null;
      const shadow = e.shadow[k] ?? null;
      if (rh === shadow) continue;                      // nothing new in the cloud for this record
      if (rh === lhash) { setShadow(k, rh); continue; } // the phone already has it
      const localDirty = lhash !== shadow;
      if (!localDirty || later(row.edited_at, e.dirtyAt[k] ?? EPOCH)) {
        if (localDirty) {
          copies.push({ type: 'replaced', tripId, key: k, local: local?.data ?? null, remote: row.deleted ? null : row.data, at: nowIso });
          notices.push({ type: 'replaced', tripId, kind: row.kind });
        }
        if (row.deleted) {
          if (local) { copies.push({ type: 'removed', tripId, key: k, local: local.data, at: nowIso }); records.delete(k); }
        } else records.set(k, { scope, kind: row.kind, rec_id: row.rec_id, data: row.data });
        setShadow(k, rh);
        delete e.dirtyAt[k];
        changed = true;
      } else {
        // The phone's edit is newer: keep it (it is sent below) and keep the older cloud version as a copy.
        copies.push({ type: 'kept-local', tripId, key: k, remote: row.deleted ? null : row.data, at: nowIso });
        setShadow(k, rh);
      }
    }
  };
  apply(await pullAll(api, tripId, e.cursor));

  // ---------- send what changed on the phone ----------
  const pushOnce = async () => {
    const rows = [];
    const sent = new Map();
    for (const [k, r] of records) {
      const h = hashValue(r.data);
      if (e.shadow[k] === h) continue;
      if (stableJson(r.data).length > MAX_RECORD_CHARS) { if (!notices.some((x) => x.type === 'tooBig')) notices.push({ type: 'tooBig', tripId, kind: r.kind }); continue; }
      rows.push({ trip_id: tripId, scope: r.scope === 'shared' ? 'shared' : userId, kind: r.kind, rec_id: r.rec_id, data: r.data, deleted: false, edited_at: e.dirtyAt[k] ?? nowIso });
      sent.set(k, h);
    }
    for (const k of Object.keys(e.shadow)) {
      if (records.has(k)) continue;
      const p = parseKey(k);
      rows.push({ trip_id: tripId, scope: p.scope === 'shared' ? 'shared' : userId, kind: p.kind, rec_id: p.rec_id, data: {}, deleted: true, edited_at: e.dirtyAt[k] ?? nowIso });
      sent.set(k, null);
    }
    let rejected = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const res = await api.push(rows.slice(i, i + BATCH));
      for (const r of res) {
        const k = recKey(r.scope === 'shared' ? 'shared' : 'personal', r.kind, r.rec_id);
        if (r.accepted) { setShadow(k, sent.get(k) ?? null); delete e.dirtyAt[k]; } else rejected += 1;
      }
    }
    return rejected;
  };
  if (await pushOnce()) {
    apply(await pullAll(api, tripId, e.cursor)); // the cloud had something newer: take it, then send what is left
    await pushOnce();
  }

  // What the phone holds after this sync is the new baseline for noticing local edits.
  e.lastLocal = {};
  for (const [k, r] of records) e.lastLocal[k] = hashValue(r.data);
  e.meta.lastLocal = hashValue(meta);
  return { trip: changed ? recordsToTrip(trip, meta, records) : null, entry: e, copies, notices };
}

function keepCopies(sync, copies) {
  if (!copies.length) return;
  sync.conflicts = [...(sync.conflicts ?? []), ...copies].slice(-KEEP_COPIES);
}

/** One full sync for the signed-in user. Returns { sync, trips: { id: trip }, notices, status, settings }.
 *  status: 'approved' | 'pending' | 'blocked' | 'restore'. Throws a CloudError on any failure (nothing is returned
 *  then, so nothing changes on the phone). */
export async function runSync({ api, sync: syncIn, state, nowIso }) {
  const sync = clone(syncIn ?? emptySyncState());
  const profile = await api.profile();
  if (!profile) throw new CloudError('auth', 'no profile');
  if (sync.userId && sync.userId !== profile.id) Object.assign(sync, emptySyncState()); // another account on this phone
  sync.userId = profile.id;
  sync.profile = { id: profile.id, email: profile.email, displayName: profile.display_name ?? '', role: profile.role, status: profile.status };
  const out = { sync, trips: {}, notices: [], status: profile.status, settings: null };
  if (profile.status !== 'approved') return out;
  if (sync.restorePending) { out.status = 'restore'; return out; }

  noteLocalChanges(sync, state, nowIso);
  const server = await api.myTrips();
  const byId = new Map(server.map((x) => [x.id, x]));
  sync.cloudTrips = server.map((x) => ({ id: x.id, name: x.name, role: x.my_role, startDate: x.start_date ?? null, endDate: x.end_date ?? null, countryCode: x.country_code ?? '' }));
  for (const [id, entry] of Object.entries(sync.trips)) {
    if (!entry.linked) continue;
    const st = byId.get(id);
    if (!st) {
      entry.linked = false; entry.lost = nowIso;
      out.notices.push({ type: 'lost', tripId: id });
      continue;
    }
    entry.role = st.my_role === 'owner' ? 'owner' : 'member';
    const trip = state?.trips?.[id];
    if (!trip) continue; // in the cloud, not on this phone (e.g. after a reset): offered again in "My trips"
    const r = await syncTrip({ api, entry, trip, userId: profile.id, serverTrip: st, nowIso });
    sync.trips[id] = r.entry;
    if (r.trip) out.trips[id] = r.trip;
    keepCopies(sync, r.copies);
    out.notices.push(...r.notices);
  }

  // Settings that follow the account: language and the assistant limit (theme and backup date stay on the phone).
  const local = settingsOf(state);
  const lh = hashValue(local);
  const remote = await api.getSettings();
  const s = sync.settings;
  if (lh !== s.shadow && (!remote || !later(remote.edited_at, s.dirtyAt ?? EPOCH))) {
    if (await api.saveSettings(local, s.dirtyAt ?? nowIso)) s.shadow = lh;
  } else if (remote && hashValue(remote.data) !== lh) {
    const patch = {};
    for (const k of SETTINGS_FIELDS) if (remote.data?.[k] !== undefined && remote.data[k] !== null) patch[k] = remote.data[k];
    if (Object.keys(patch).length) out.settings = patch;
    s.shadow = hashValue({ ...local, ...patch });
    s.lastLocal = s.shadow;
  }
  sync.lastSyncAt = nowIso;
  sync.lastError = null;
  return out;
}

/** Put a trip from the phone into the account (the first upload, after a backup and the user's yes). Idempotent:
 *  uploading the same trip again answers 'exists' and the next sync sends only what differs. 'taken' = the id
 *  belongs to someone else's trip (not expected with random ids); nothing is linked then. */
export async function uploadTrip({ api, sync: syncIn, trip, nowIso }) {
  const sync = clone(syncIn ?? emptySyncState());
  const { meta } = tripToRecords(trip);
  const result = await api.createTrip(trip.id, meta);
  if (result === 'created' || result === 'exists') {
    const entry = newEntry('owner');
    entry.meta.shadow = result === 'created' ? hashValue(meta) : null;
    entry.meta.lastLocal = hashValue(meta);
    entry.meta.dirtyAt = nowIso;
    sync.trips[trip.id] = entry;
    delete sync.declined[trip.id];
  }
  return { sync, result };
}

/** Bring a trip that is in the account but not on this phone (shared with me, or mine from another phone).
 *  The phone's other trips are not touched. Returns { sync, trip }. */
export async function downloadTrip({ api, sync: syncIn, serverTrip, nowIso }) {
  const sync = clone(syncIn ?? emptySyncState());
  if (!sync.userId) throw new CloudError('auth', 'not signed in');
  const shell = createTrip({ makeId: () => serverTrip.id, countryCode: serverTrip.countryCode ?? serverTrip.country_code ?? '', tripName: serverTrip.name ?? '' });
  const entry = newEntry(serverTrip.role ?? serverTrip.my_role ?? 'member');
  // The empty shell is not an edit: mark it as already known, so the cloud's records simply fill it.
  const { meta, records } = tripToRecords(shell);
  for (const [k, r] of records) { entry.shadow[k] = hashValue(r.data); entry.lastLocal[k] = entry.shadow[k]; }
  entry.meta.shadow = hashValue(meta);
  entry.meta.lastLocal = entry.meta.shadow;
  const full = { id: serverTrip.id, name: serverTrip.name, country_code: serverTrip.countryCode ?? serverTrip.country_code, start_date: serverTrip.startDate ?? serverTrip.start_date ?? null, end_date: serverTrip.endDate ?? serverTrip.end_date ?? null };
  const r = await syncTrip({ api, entry, trip: shell, userId: sync.userId, serverTrip: full, nowIso });
  sync.trips[serverTrip.id] = r.entry;
  keepCopies(sync, r.copies);
  return { sync, trip: r.trip ?? shell };
}

/** Stop syncing a trip on this phone (the "restore to this phone only" choice). The phone keeps its data; the cloud
 *  copy is not touched. */
export function unlinkAll(syncIn) {
  const sync = clone(syncIn);
  for (const e of Object.values(sync.trips)) e.linked = false;
  sync.restorePending = false;
  return sync;
}

/** "Restore and update the cloud too": everything on the phone is sent as the newest version (nothing in the cloud
 *  is deleted by this: records the backup does not have stay there and come back on the next sync).
 *  lastLocal is cleared, so the next noteLocalChanges() marks every record as edited now, and the phone wins. */
export function resendAll(syncIn) {
  const sync = clone(syncIn);
  for (const e of Object.values(sync.trips)) {
    if (!e.linked) continue;
    e.shadow = {}; e.dirtyAt = {}; e.lastLocal = {}; e.meta.shadow = null; e.meta.dirtyAt = null; e.meta.lastLocal = null;
  }
  sync.restorePending = false;
  return sync;
}
