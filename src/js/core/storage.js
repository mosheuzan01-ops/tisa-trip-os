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
export function createStorage({ backend, key, legacy = {}, corruptPrefix = 'tisa:corrupt:', ...opts }) {
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
