// Backup file = a contract (docs/BACKUP_FORMAT.md). A file from this version must import into later versions.
import { SCHEMA_VERSION, migrate, validateState } from './schema.js';

export const BACKUP_FORMAT = 'tisa-backup';

export function exportBackup(state, now) {
  return { format: BACKUP_FORMAT, schemaVersion: state.schemaVersion, exportedAt: now.toISOString(), data: state };
}

export function backupFileName(now) {
  return `tisa-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** What an import would bring in, for the confirmation step. */
export function summarize(state) {
  const trip = state.trips[state.activeTripId];
  return {
    trips: Object.keys(state.trips).length,
    tripName: trip.name,
    startDate: trip.startDate,
    endDate: trip.endDate,
    updatedAt: state.updatedAt,
    schemaVersion: state.schemaVersion,
  };
}

/**
 * Check a backup file's text. Never throws.
 * @returns {{ ok: true, state, summary } | { ok: false, error: 'empty'|'notJson'|'format'|'structure'|'future' }}
 */
export function parseBackup(text, opts) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'empty' };
  let file;
  try { file = JSON.parse(text); } catch { return { ok: false, error: 'notJson' }; }
  if (!file || typeof file !== 'object' || Array.isArray(file) || file.format !== BACKUP_FORMAT) return { ok: false, error: 'format' };
  if (!Number.isInteger(file.schemaVersion) || typeof file.exportedAt !== 'string' || !file.data || typeof file.data !== 'object') {
    return { ok: false, error: 'structure' };
  }
  if (file.schemaVersion > SCHEMA_VERSION || (file.data.schemaVersion ?? 0) > SCHEMA_VERSION) return { ok: false, error: 'future' };
  let state;
  try { state = migrate(structuredClone(file.data), opts); } catch { return { ok: false, error: 'structure' }; }
  if (validateState(state).length) return { ok: false, error: 'structure' };
  return { ok: true, state, summary: summarize(state) };
}
