// Stage 7 photo backup (owner decision B, 2026-11-20): a separate ZIP, not part of the JSON backup.
// Inside: photos.json (the metadata) + photos/<id>.jpg + thumbs/<id>.jpg, so the photos open on any computer too.
// Restoring adds what is missing and never deletes. Pure functions; tested in tests/stage7-core.test.js.
import { unzipStore } from './zip.js';
import { cleanPhotos } from './photos.js';

export const PHOTO_FORMAT = 'tisa-photos';
export const PHOTO_FORMAT_VERSION = 1;
export const LARGE_BYTES = 100 * 1024 * 1024; // above this the download size is shown as a warning

export const photoBackupName = (now) => `tisa-photos-${now.toISOString().slice(0, 10)}.zip`;

export function buildPhotoManifest(trip, now) {
  return { format: PHOTO_FORMAT, version: PHOTO_FORMAT_VERSION, exportedAt: now.toISOString(), tripId: trip.id, photos: cleanPhotos(trip.photos) };
}

/** ZIP entries for the manifest and the files. A photo without a stored file is left out of the manifest. */
export function photoEntries(manifest, files) {
  const photos = manifest.photos.filter((p) => files.has(p.id));
  const entries = [{ name: 'photos.json', data: new TextEncoder().encode(JSON.stringify({ ...manifest, photos }, null, 2)) }];
  for (const p of photos) {
    const f = files.get(p.id);
    entries.push({ name: `photos/${p.id}.jpg`, data: f.full });
    if (f.thumb) entries.push({ name: `thumbs/${p.id}.jpg`, data: f.thumb });
  }
  return entries;
}

/** Read a photo backup. Never throws. { ok, manifest, files: Map(id -> { full, thumb }) } or { ok: false, error }. */
export function parsePhotoBackup(bytes) {
  const entries = unzipStore(bytes);
  if (!entries) return { ok: false, error: 'notZip' };
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(byName.get('photos.json'))); } catch { return { ok: false, error: 'format' }; }
  if (!manifest || manifest.format !== PHOTO_FORMAT || !Array.isArray(manifest.photos)) return { ok: false, error: 'format' };
  if (!(Number.isInteger(manifest.version) && manifest.version <= PHOTO_FORMAT_VERSION)) return { ok: false, error: 'future' };
  const files = new Map();
  const photos = [];
  for (const p of cleanPhotos(manifest.photos)) {
    if (!/^[\w-]+$/.test(p.id)) continue;
    const full = byName.get(`photos/${p.id}.jpg`);
    if (!full) continue; // listed but no file: skipped, not invented
    files.set(p.id, { full, thumb: byName.get(`thumbs/${p.id}.jpg`) ?? null });
    photos.push(p);
  }
  return { ok: true, manifest: { ...manifest, photos }, files };
}

/** Add incoming photo records that are not here yet. Existing ones stay as they are (the user may have edited them). */
export function mergePhotos(existing, incoming) {
  const have = new Set(existing.map((p) => p.id));
  const add = incoming.filter((p) => !have.has(p.id));
  return { photos: [...existing, ...add], added: add.length, skipped: incoming.length - add.length };
}
