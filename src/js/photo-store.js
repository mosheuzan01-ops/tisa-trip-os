// Stage 7: the photo files, kept in IndexedDB on this device (never in the main data key, never on a server).
// One record per photo: { id, type, full: ArrayBuffer, thumb: ArrayBuffer }. ArrayBuffers rather than Blobs,
// because older iPhone Safari versions failed to store Blobs in IndexedDB. Also: canvas compression in the browser.
import { fitSize, MAX_SIDE, THUMB_SIDE, TARGET_BYTES } from './core/photos.js';

const DB = 'tisa-photos';
const STORE = 'photos';
let opening = null;

export const supported = () => typeof indexedDB !== 'undefined';

function db() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => {
        const d = r.result;
        d.onversionchange = () => { d.close(); opening = null; }; // another tab (or a test) deletes the database
        resolve(d);
      };
      r.onerror = () => { opening = null; reject(r.error); };
      r.onblocked = () => { opening = null; reject(new Error('blocked')); };
    });
  }
  return opening;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const putPhoto = (rec) => run('readwrite', (s) => s.put(rec));
export const getPhoto = (id) => run('readonly', (s) => s.get(id));
export const deletePhoto = (id) => run('readwrite', (s) => s.delete(id));
export const hasPhoto = async (id) => (await run('readonly', (s) => s.count(id))) > 0;

// ---------- object URLs for thumbnails and the big view, made once per photo ----------
const urls = new Map();
export async function photoUrl(id, kind = 'thumb') {
  const key = `${kind}:${id}`;
  if (urls.has(key)) return urls.get(key);
  const rec = await getPhoto(id).catch(() => null);
  if (!rec) return null;
  const url = URL.createObjectURL(new Blob([rec[kind] ?? rec.full], { type: rec.type ?? 'image/jpeg' }));
  urls.set(key, url);
  return url;
}
export function forgetUrls(id) {
  for (const kind of ['thumb', 'full']) {
    const key = `${kind}:${id}`;
    if (urls.has(key)) { URL.revokeObjectURL(urls.get(key)); urls.delete(key); }
  }
}

// ---------- compression: canvas, JPEG, long side 1280, under 600 KB ----------
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));

async function draw(source, w, h, max, qualities, limit) {
  const size = fitSize(w, h, max);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d');
  g.fillStyle = 'white'; // image content, not a UI colour: transparent PNGs become JPEG on white, not black
  g.fillRect(0, 0, size.width, size.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, size.width, size.height);
  let blob = null;
  for (const q of qualities) {
    blob = await toBlob(canvas, q);
    if (blob && blob.size <= limit) break;
  }
  canvas.width = 0; // free the memory right away (matters on phones)
  return { blob, ...size };
}

/** A picked file -> { full, thumb, width, height }. Throws when the image cannot be opened. */
export async function compress(file) {
  const source = await decode(file);
  const w = source.width;
  const h = source.height;
  if (!(w > 0 && h > 0)) throw new Error('decode');
  const full = await draw(source, w, h, MAX_SIDE, [0.8, 0.7, 0.6, 0.5, 0.4], TARGET_BYTES);
  const thumb = await draw(source, w, h, THUMB_SIDE, [0.7], Infinity);
  source.close?.();
  if (!full.blob || !thumb.blob) throw new Error('encode');
  return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
}
