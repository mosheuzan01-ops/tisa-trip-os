// Stage 7.0b photos screen (#/photos, opened from the itinerary) and the photo dialog, also used by the calendar.
// Files go to IndexedDB (photo-store.js); the data keeps only ids and details (core/photos.js). Nothing is uploaded.
import { interpolate } from './core/i18n.js';
import { formatDate } from './core/itinerary.js';
import {
  CAPTION_MAX, dateFromFile, exifDate, groupPhotos, makePhoto, placeOf, removePhoto, stopChoices, storageWarning,
  toggleFeatured, updatePhoto, validatePhotoEdit,
} from './core/photos.js';
import { compress, deletePhoto, forgetUrls, photoUrl, putPhoto, supported } from './photo-store.js';
import { makeId } from './core/ids.js';
import { cleanPhotos } from './core/photos.js';
import { zipParts } from './core/zip.js';
import { buildPhotoManifest, photoEntries, parsePhotoBackup, mergePhotos, photoBackupName, LARGE_BYTES } from './core/photo-backup.js';
import { getPhoto, hasPhoto } from './photo-store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const longDate = (iso, locale) => formatDate(iso, locale, { weekday: 'long', day: 'numeric', month: 'long' });

/** A thumbnail button. The image is filled in later from IndexedDB (fillThumbs). */
export function thumbButton(ctx, photo, className) {
  const { t, fmtLocale } = ctx;
  const place = placeOf(photo, ctx.trip());
  const btn = el('button', className);
  btn.type = 'button';
  btn.dataset.photoId = photo.id;
  btn.setAttribute('aria-label', photo.date
    ? interpolate(t('photo.thumbLabel'), { date: longDate(photo.date, fmtLocale), place: place.name ?? t('photo.outside') }) + (photo.caption ? `. ${photo.caption}` : '')
    : t('photo.thumbLabelNoDate'));
  const img = el('img');
  img.alt = '';
  img.dataset.thumbId = photo.id;
  img.width = photo.width >= photo.height ? 160 : Math.round((160 * photo.width) / photo.height) || 120;
  img.height = photo.width >= photo.height ? Math.round((160 * photo.height) / photo.width) || 120 : 160;
  btn.append(img);
  if (photo.featured) {
    const star = el('span', 'photo-star-mark');
    star.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}i-star"/></svg>`;
    star.append(el('span', 'sr-only', t('photo.featuredBadge')));
    btn.append(star);
  }
  return btn;
}

/** Load thumbnails under `root` from IndexedDB. A photo whose file is gone is marked, not hidden. */
export async function fillThumbs(ctx, root) {
  for (const img of root.querySelectorAll('img[data-thumb-id]:not([src])')) {
    const url = await photoUrl(img.dataset.thumbId).catch(() => null);
    if (!img.isConnected) continue;
    const btn = img.closest('button');
    if (url) { img.src = url; btn?.classList.remove('is-missing'); continue; }
    btn?.classList.add('is-missing');
    btn?.setAttribute('title', ctx.t('photo.missing'));
    img.removeAttribute('data-thumb-id');
    img.remove();
    if (btn && !btn.querySelector('.photo-missing')) btn.prepend(el('span', 'photo-missing', ctx.t('photo.missing')));
  }
}

async function renderStorageWarn(ctx) {
  const box = $('[data-slot="photo-storage-warn"]');
  let warn = null;
  try { warn = storageWarning(await navigator.storage?.estimate?.()); } catch { warn = null; }
  box.hidden = !warn;
  if (warn) box.textContent = interpolate(ctx.t('photo.storageWarn'), { pct: warn.pct });
}

export function renderPhotos(ctx) {
  const panel = $('#panel-photos');
  if (!panel) return;
  const { t, fmtLocale } = ctx;
  const trip = ctx.trip();
  const g = groupPhotos(trip);
  $('[data-slot="photo-empty"]').hidden = g.count > 0;
  $('[data-slot="photo-count"]').textContent = g.count === 1 ? t('photo.countOne') : g.count ? interpolate(t('photo.count'), { n: g.count }) : '';
  const box = $('[data-slot="photo-groups"]');
  const focusId = box.contains(document.activeElement) ? document.activeElement.dataset.photoId : null;
  const group = (key, title, place, photos, note) => {
    const sec = el('section', 'card surface photo-group');
    sec.dataset.photoGroup = key;
    const head = el('div', 'photo-group-head');
    const h = el('h2', 'tool-title', title);
    h.id = `photo-group-${key}`;
    sec.setAttribute('aria-labelledby', h.id);
    head.append(h);
    if (place) { const p = el('p', 'muted', place); p.dataset.slot = 'photo-group-place'; head.append(p); }
    sec.append(head);
    if (note) sec.append(el('p', 'muted', note));
    const grid = el('ul', 'photo-grid');
    for (const p of photos) { const li = el('li'); li.append(thumbButton(ctx, p, 'photo-thumb')); grid.append(li); }
    sec.append(grid);
    return sec;
  };
  const sections = g.days.map((d) => {
    const place = placeOf(d.photos[0], trip);
    const names = [...new Set(d.photos.map((p) => placeOf(p, trip).name).filter(Boolean))];
    return group(d.date, longDate(d.date, fmtLocale), names.join(', ') || place.name || '', d.photos);
  });
  if (g.unassigned.length) sections.push(group('unassigned', t('photo.unassigned'), '', g.unassigned, t('photo.unassignedText')));
  box.replaceChildren(...sections);
  fillThumbs(ctx, box);
  if (focusId) box.querySelector(`[data-photo-id="${CSS.escape(String(focusId))}"]`)?.focus();
  if (ctx.route === 'photos') renderStorageWarn(ctx);
}

/** Photos of one day for the calendar card: thumbnails (own class names, rule 14) and an add button. */
export function calendarPhotos(ctx, date) {
  const { t, fmtLocale } = ctx;
  const photos = groupPhotos(ctx.trip()).days.find((d) => d.date === date)?.photos ?? [];
  const wrap = el('div', 'cal-photos');
  wrap.dataset.photoDay = date;
  if (photos.length) {
    const list = el('ul', 'cal-photo-list');
    list.setAttribute('aria-label', t('cal.photosLabel'));
    for (const p of photos) { const li = el('li'); li.append(thumbButton(ctx, p, 'cal-photo')); list.append(li); }
    wrap.append(list);
  }
  const add = el('button', 'btn btn-ghost btn-small cal-photo-add');
  add.type = 'button';
  add.dataset.action = 'photo-add-day';
  add.dataset.photoDay = date;
  add.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}i-image"/></svg>`;
  add.append(el('span', '', t('photo.addDay')));
  add.setAttribute('aria-label', interpolate(t('photo.addDayLabel'), { date: longDate(date, fmtLocale) }));
  wrap.append(add);
  return wrap;
}

export function setupPhotos(ctx, { wireDialog, showFormErrors }) {
  const panel = $('#panel-photos');
  if (!panel) return;
  const { t } = ctx;
  const input = $('#photo-file');
  const busy = $('[data-slot="photo-busy"]');
  let forDay = null; // set when adding from a calendar day: that day becomes the photo's date
  let addOpener = null;

  const pick = (day, from) => {
    if (!supported()) { ctx.toast('photo.err.unsupported'); return; }
    forDay = day;
    addOpener = from;
    input.value = '';
    input.click();
  };
  $('[data-action="photo-add"]').addEventListener('click', (e) => pick(null, e.currentTarget));

  input.addEventListener('change', async () => {
    const files = [...(input.files ?? [])];
    if (!files.length) return;
    let ok = 0;
    let storeFailed = false;
    busy.hidden = false;
    for (const [i, file] of files.entries()) {
      busy.textContent = interpolate(t('photo.busy'), { done: i + 1, total: files.length });
      try {
        const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
        const when = forDay ? { date: forDay, dateSource: 'manual' } : dateFromFile({ exif: exifDate(head), lastModified: file.lastModified, timeZone: ctx.country.timeZone });
        const out = await compress(file);
        const id = makeId();
        try {
          await putPhoto({ id, type: 'image/jpeg', full: await out.full.arrayBuffer(), thumb: await out.thumb.arrayBuffer() });
        } catch { storeFailed = true; break; }
        const photo = makePhoto({ id, ...when, width: out.width, height: out.height, bytes: out.full.size, addedAt: new Date().toISOString() });
        ctx.change((s) => { const trip = s.trips[s.activeTripId]; trip.photos = [...(trip.photos ?? []), photo]; }, { now: true });
        ok += 1;
      } catch { /* this file could not be opened: skipped, the rest go on */ }
    }
    busy.hidden = true;
    input.value = '';
    if (storeFailed) ctx.toast('photo.err.store');
    else if (ok === files.length) ctx.toast('photo.saved');
    else if (ok === 0) ctx.toast('photo.err.read');
    else ctx.toast('photo.savedSome', { ok, total: files.length });
    if (addOpener?.isConnected) addOpener.focus();
    renderStorageWarn(ctx);
  });

  // ---------- the photo dialog ----------
  const dlg = $('#dlg-photo');
  const form = $('[data-form="photo"]');
  const dlgDel = $('#dlg-photo-delete');
  const big = $('[data-slot="photo-big"]');
  let current = null;
  let opener = null;
  const restore = () => {
    const btn = document.querySelector(`#${opener?.closest('.panel')?.id ?? 'panel-photos'} [data-photo-id="${CSS.escape(String(current))}"]`);
    (btn ?? (opener?.isConnected ? opener : null) ?? $('[data-action="photo-add"]'))?.focus();
  };
  wireDialog(dlg, () => { if (!dlgDel.open) restore(); big.removeAttribute('src'); });
  wireDialog(dlgDel, () => restore());
  const errors = (list) => {
    showFormErrors(t, form, list, 'photoErr');
    form.querySelector('.form-error').textContent = list.map((e) => interpolate(t(`photoErr.${e}`), { max: CAPTION_MAX })).join(' ');
  };
  const describe = () => {
    const trip = ctx.trip();
    const p = trip.photos.find((x) => x.id === current);
    const preview = { ...p, date: form.date.value || null, stopId: form.stopId.value || null };
    const place = placeOf(preview, trip);
    $('[data-slot="photo-place"]').textContent = place.kind === 'auto' || place.kind === 'manual'
      ? interpolate(t(`photo.place.${place.kind}`), { name: place.name }) : t(`photo.place.${place.kind}`);
    const auto = placeOf({ ...preview, stopId: null }, trip);
    form.stopId.options[0].textContent = auto.name ? interpolate(t('photo.stopAutoName'), { name: auto.name }) : t('photo.stopAuto');
    const src = form.date.value !== (p.date ?? '') ? 'manual' : (p.dateSource ?? 'none');
    $('[data-slot="photo-date-src"]').textContent = form.date.value ? t(`photo.src.${src}`) : t('photo.src.none');
  };

  async function open(id, from) {
    const trip = ctx.trip();
    const p = trip.photos.find((x) => x.id === id);
    if (!p) return;
    current = id;
    opener = from;
    form.reset();
    errors([]);
    const stops = stopChoices(trip);
    form.stopId.replaceChildren(el('option', '', t('photo.stopAuto')), ...stops.map((s) => Object.assign(el('option', '', s.name), { value: s.id })));
    form.stopId.options[0].value = '';
    form.date.value = p.date ?? '';
    form.stopId.value = stops.some((s) => s.id === p.stopId) ? p.stopId : '';
    form.caption.value = p.caption ?? '';
    form.featured.checked = p.featured === true;
    describe();
    big.alt = p.caption || '';
    big.removeAttribute('src');
    dlg.showModal();
    const url = await photoUrl(id, 'full').catch(() => null);
    if (current === id && dlg.open) {
      if (url) { big.src = url; big.hidden = false; } else big.hidden = true;
    }
  }
  form.date.addEventListener('input', describe);
  form.stopId.addEventListener('change', describe);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const edit = { date: form.date.value, stopId: form.stopId.value, caption: form.caption.value };
    const problems = validatePhotoEdit(edit);
    if (problems.length) { errors(problems); return; }
    const trip = ctx.trip();
    let next = updatePhoto(trip.photos, current, edit);
    const want = form.featured.checked;
    if (want !== (next.find((x) => x.id === current)?.featured === true)) {
      const r = toggleFeatured(next, current);
      if (r.error) { errors([r.error]); return; }
      next = r.photos;
    }
    const result = ctx.change((s) => { s.trips[s.activeTripId].photos = next; }, { now: true });
    ctx.toast(result?.ok ? 'photo.updated' : 'form.saveFailed');
    dlg.close();
  });

  $('[data-action="photo-delete"]').addEventListener('click', () => { dlg.close(); dlgDel.showModal(); });
  $('[data-action="photo-delete-yes"]').addEventListener('click', async () => {
    const id = current;
    try { await deletePhoto(id); } catch { /* the record is removed from the data anyway; an orphan file is harmless */ }
    forgetUrls(id);
    const result = ctx.change((s) => { const trip = s.trips[s.activeTripId]; trip.photos = removePhoto(trip.photos ?? [], id); }, { now: true });
    dlgDel.close();
    ctx.toast(result?.ok ? 'photo.deleted' : 'form.saveFailed');
  });

  // Thumbnails anywhere (photos screen, calendar) open the dialog; the calendar's add button picks for that day.
  document.addEventListener('click', (e) => {
    const thumb = e.target.closest('[data-photo-id]');
    if (thumb && thumb.closest('#panel-photos, #panel-calendar')) { open(thumb.dataset.photoId, thumb); return; }
    const add = e.target.closest('[data-action="photo-add-day"]');
    if (add) pick(add.dataset.photoDay, add);
  });
}

// ---------- 7.0d photo backup (settings): a separate ZIP, owner decision B ----------
function formatBytes(n, locale) {
  const mb = n / (1024 * 1024);
  const fmt = (v, unit) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} ${unit}`;
  return mb >= 1 ? fmt(mb, 'MB') : fmt(Math.max(1, Math.round(n / 1024)), 'KB');
}

/** The expected file size is the stored photos plus their thumbnails (about a tenth), shown before downloading. */
export function renderPhotoBackup(ctx) {
  const slot = $('[data-slot="photos-size"]');
  if (!slot) return;
  const photos = cleanPhotos(ctx.trip().photos);
  const bytes = photos.reduce((n, p) => n + (Number.isFinite(p.bytes) ? p.bytes : 0), 0);
  const size = formatBytes(Math.round(bytes * 1.1), ctx.fmtLocale);
  slot.textContent = !photos.length ? ctx.t('photoBackup.sizeNone')
    : interpolate(ctx.t(bytes > LARGE_BYTES ? 'photoBackup.big' : 'photoBackup.size'), { n: photos.length, size });
  slot.classList.toggle('is-warn', bytes > LARGE_BYTES);
  $('[data-action="photos-export"]').disabled = !photos.length;
}

export function setupPhotoBackup(ctx) {
  const exportBtn = $('[data-action="photos-export"]');
  if (!exportBtn) return;
  const { t, config } = ctx;
  const errorBox = $('[data-slot="photos-import-error"]');
  const input = $('#photos-import-file');

  exportBtn.addEventListener('click', async () => {
    errorBox.textContent = '';
    const trip = ctx.trip();
    const files = new Map();
    for (const p of cleanPhotos(trip.photos)) {
      const rec = await getPhoto(p.id).catch(() => null);
      if (rec) files.set(p.id, { full: new Uint8Array(rec.full), thumb: rec.thumb ? new Uint8Array(rec.thumb) : null });
    }
    if (!files.size) { errorBox.textContent = t('photoBackup.err.empty'); return; }
    const now = new Date();
    const blob = new Blob(zipParts(photoEntries(buildPhotoManifest(trip, now), files), now), { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: photoBackupName(now) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    ctx.toast('photoBackup.done');
  });

  $('[data-action="photos-import-pick"]').addEventListener('click', () => { errorBox.textContent = ''; input.value = ''; input.click(); });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { errorBox.textContent = t('photoBackup.err.read'); return; }
    const r = parsePhotoBackup(bytes);
    if (!r.ok) { errorBox.textContent = interpolate(t(`photoBackup.err.${r.error}`), { app: config.appName }); input.value = ''; return; }
    let restored = 0;
    try {
      for (const p of r.manifest.photos) {
        if (await hasPhoto(p.id)) continue; // already on this phone: never written twice
        const f = r.files.get(p.id);
        await putPhoto({ id: p.id, type: 'image/jpeg', full: f.full.buffer.slice(f.full.byteOffset, f.full.byteOffset + f.full.byteLength), thumb: f.thumb ? f.thumb.buffer.slice(f.thumb.byteOffset, f.thumb.byteOffset + f.thumb.byteLength) : null });
        forgetUrls(p.id);
        restored += 1;
      }
    } catch { errorBox.textContent = t('photoBackup.err.store'); }
    const merged = mergePhotos(cleanPhotos(ctx.trip().photos), r.manifest.photos);
    ctx.change((s) => { s.trips[s.activeTripId].photos = merged.photos; }, { now: true });
    input.value = '';
    const n = Math.max(restored, merged.added);
    ctx.toast(n ? 'photoBackup.restored' : 'photoBackup.nothing', { n });
  });
}
