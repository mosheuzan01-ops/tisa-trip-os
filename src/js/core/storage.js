// The one storage layer. No screen touches localStorage; they all go through load / save / reset / replace.
// Rules: never delete user data silently, never overwrite data from a newer app version,
// keep a copy of anything unreadable, and keep working in memory when storage is blocked or full.
import { SCHEMA_VERSION, createDefaultState, migrate, validateState } from './schema.js';

function quota(error) {
  return error?.name === 'QuotaExceededError' || error?.code === 22 || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/**
 * @param {object} o
 * @param {Storage|null} o.backend  window.localStorage, or null when it cannot be reached
 * @param {string} o.key            the single data key, e.g. "tisa:v1"
 * @param {{trip?: string, theme?: string}} o.legacy  Stage 1 keys to migrate from (left in place)
 */
export function createStorage({ backend, key, legacy = {}, corruptPrefix = 'tisa:corrupt:', premigrationPrefix = 'tisa:premigration:', ...opts }) {
  // 'ok' = can write; 'readonly' = writing would destroy data the user has not agreed to lose; 'unavailable' = no storage.
  let mode = backend ? 'ok' : 'unavailable';
  const defaults = () => createDefaultState(opts);

  function read(k) {
    return backend.getItem(k);
  }

  function setAside(raw) {
    const corruptKey = `${corruptPrefix}${opts.now().toISOString()}`;
    try { backend.setItem(corruptKey, raw); } catch { /* full or blocked: the original key is still untouched */ }
    return corruptKey;
  }

  // Stage 9: before a version change, keep the exact old text once under its own key (never overwritten,
  // never read back on its own). A full or blocked storage is fine: the migration only adds fields.
  function keepCopy(raw, version) {
    const copyKey = `${premigrationPrefix}v${Number.isInteger(version) ? version : 0}`;
    try { if (read(copyKey) === null) backend.setItem(copyKey, raw); } catch { /* full or blocked: carry on */ }
  }

  function loadLegacy() {
    let tripRaw = null;
    let theme = null;
    if (legacy.trip) tripRaw = read(legacy.trip);
    if (legacy.theme) theme = read(legacy.theme);
    if (tripRaw === null && theme === null) return null;
    let trip;
    try { trip = JSON.parse(tripRaw ?? 'null')?.trip; } catch { trip = undefined; } // unreadable old trip: the old key stays as it is
    return migrate({ schemaVersion: 0, trip, theme }, opts);
  }

  return {
    get mode() { return mode; },

    load() {
      if (!backend) return { state: defaults(), status: 'unavailable' };
      let raw;
      try {
        raw = read(key);
        if (raw === null) {
          const migrated = loadLegacy();
          return migrated ? { state: migrated, status: 'migrated' } : { state: defaults(), status: 'new' };
        }
      } catch {
        mode = 'unavailable';
        return { state: defaults(), status: 'unavailable' };
      }
      let data;
      try { data = JSON.parse(raw); } catch {
        mode = 'readonly';
        return { state: defaults(), status: 'corrupt', corruptKey: setAside(raw) };
      }
      if (Number.isInteger(data?.schemaVersion) && data.schemaVersion > SCHEMA_VERSION) {
        mode = 'readonly';
        return { state: defaults(), status: 'future', foundVersion: data.schemaVersion };
      }
      let state;
      let status = 'ok';
      try {
        if (!Number.isInteger(data?.schemaVersion) || data.schemaVersion < SCHEMA_VERSION) {
          keepCopy(raw, data?.schemaVersion);
          state = migrate(data, opts);
          status = 'migrated';
        } else state = data;
      } catch { state = null; }
      if (!state || validateState(state).length) {
        mode = 'readonly';
        return { state: defaults(), status: 'corrupt', corruptKey: setAside(raw) };
      }
      return { state, status };
    },

    /** Write the state. Returns { ok: true } or { ok: false, reason: 'readonly' | 'unavailable' | 'quota' }. */
    save(state) {
      if (mode !== 'ok') return { ok: false, reason: mode };
      state.updatedAt = opts.now().toISOString();
      try {
        backend.setItem(key, JSON.stringify(state));
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: quota(error) ? 'quota' : 'unavailable' };
      }
    },

    /** Replace everything with the given state (import), after the user confirmed. */
    replace(state) {
      if (mode === 'readonly') mode = 'ok';
      return this.save(state);
    },

    /** Start over with defaults, after the user confirmed. Copies set aside earlier stay. */
    reset() {
      const state = defaults();
      return { state, result: this.replace(state) };
    },
  };
}

// ---------- Stage 14: two NEW keys under the "latisa:" prefix (owner, 2026-11-23). tisa:* keys never change. ----------
export const SYNC_KEY = 'latisa:sync:v1';
export const AUTH_KEY = 'latisa:auth:v1';
export const CLOUD_COPY_KEY = 'latisa:premigration:v1';

/** One small JSON value under one key (the sync state). Never throws; a failed write reports false. */
export function createKv({ backend, key }) {
  return {
    read() {
      try { const raw = backend?.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    write(value) {
      try { if (!backend) return false; backend.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
  };
}

/** The storage the Supabase client gets for its sign-in session. Only keys under latisa:auth: are read or written,
 *  so the client can never touch tisa:* data. Passwords are never stored (the client sends them once, over HTTPS). */
export function authStorage(backend, prefix = 'latisa:auth:') {
  const ok = (k) => typeof k === 'string' && k.startsWith(prefix);
  return {
    getItem(k) { if (!ok(k)) return null; try { return backend?.getItem(k) ?? null; } catch { return null; } },
    setItem(k, v) { if (!ok(k)) return; try { backend?.setItem(k, v); } catch { /* full or blocked: the session lives in memory */ } },
    removeItem(k) { if (!ok(k)) return; try { backend?.removeItem(k); } catch { /* blocked */ } },
  };
}

/** Before the first upload to the cloud: keep the exact text of the data key once (never overwritten). */
export function keepCloudCopy(backend, dataKey, copyKey = CLOUD_COPY_KEY) {
  try {
    if (!backend || backend.getItem(copyKey) !== null) return false;
    const raw = backend.getItem(dataKey);
    if (raw === null) return false;
    backend.setItem(copyKey, raw);
    return true;
  } catch { return false; }
}

/** True when a sign-in session was saved on this device (read without loading the Supabase library). */
export function hasSavedSession(backend, key = AUTH_KEY) {
  try { return Boolean(backend?.getItem(key)); } catch { return false; }
}

/** The browser's localStorage, or null when even touching it throws (some private modes, blocked site data). */
export function browserBackend() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Ask the browser not to clear this site's data on its own. Returns true, false, or null when unsupported. */
export async function requestPersistence(nav = globalThis.navigator) {
  try {
    if (!nav?.storage?.persist) return null;
    return await nav.storage.persist();
  } catch {
    return null;
  }
}

export async function isPersisted(nav = globalThis.navigator) {
  try {
    if (!nav?.storage?.persisted) return null;
    return await nav.storage.persisted();
  } catch {
    return null;
  }
}
