// Stage 10 saved places screen (#/places, opened from the itinerary; that tab stays lit). Data: core/places.js.
// "My location" is read only when the user taps (core/geo.js): one reading, no tracking, nothing sent anywhere.
// Google Maps opens only when the user taps "open in Google Maps" (rule 5); nothing is loaded in the background.
// PR 2: sharing goes through the phone's share sheet (WhatsApp is one of its targets) or the clipboard, with only the
// fields the user ticked; places files are imported without overwriting and without duplicates.
// Own class names and data attributes (rule 14). All copy from locales.
import { interpolate } from './core/i18n.js';
import { formatDate, cleanStops, sortStops } from './core/itinerary.js';
import {
  PLACE_STATUSES, PLACE_CATEGORIES, validatePlace, makePlace, savePlace, removePlace, cleanPlaces, filterPlaces,
  placeCounts, mapsUrl, planDay, coordsText,
} from './core/places.js';
import { locate, geoPermission } from './core/geo.js';
import {
  SHARE_FIELDS, DEFAULT_SHARE_FIELDS, shareText, exportPlaces, placesFileName, parsePlaces, mergePlaces,
} from './core/place-share.js';
import { cleanPhotos, FEATURE_MAX } from './core/photos.js';
import { fillThumbs } from './photos-view.js';
import { makeId } from './core/ids.js';
import { setupSearch } from './search-view.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
const iconButton = (icon, label, action, id) => {
  const b = el('button', 'icon-btn place-btn');
  b.type = 'button';
  b.dataset.action = action;
  b.dataset.placeId = id;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${icon}"/></svg>`;
  return b;
};

// Screen state that is not saved: the view, filters and the last location reading.
const ui = { view: 'all', q: '', category: '', stopId: '', status: '', here: null, hereMsg: null };

const stopsOf = (trip) => sortStops(cleanStops(trip?.destinations));


/** The location line: what was read, or why there is no reading, in calm words. */
function hereText(ctx) {
  const { t } = ctx;
  if (ui.hereMsg === 'busy') return t('place.here.busy');
  if (ui.hereMsg) return t(`place.geo.${ui.hereMsg}`);
  if (ui.here) return interpolate(t('place.here.found'), { coords: `⁦${ui.here.lat}, ${ui.here.lng}⁩`, m: ui.here.accuracy });
  return t('place.here.idle');
}

export function renderPlaces(ctx) {
  const panel = $('#panel-places');
  if (!panel) return;
  const { t, fmtLocale } = ctx;
  const trip = ctx.trip();
  const all = cleanPlaces(trip.places);
  const stops = stopsOf(trip);
  const counts = placeCounts(all);
  const photoIds = new Set(cleanPhotos(trip.photos).map((x) => x.id));

  // My location
  $('[data-slot="place-here-text"]').textContent = hereText(ctx);
  $('[data-action="place-here-save"]').hidden = !ui.here;
  $('[data-action="place-here-map"]').hidden = !ui.here;
  $('[data-action="place-here-share"]').hidden = !ui.here;

  // Views and filters
  for (const b of panel.querySelectorAll('[data-place-view]')) b.setAttribute('aria-pressed', String(b.dataset.placeView === ui.view));
  for (const k of ['all', 'want', 'visited']) $(`[data-slot="place-n-${k}"]`).textContent = String(counts[k]);
  const fill = (sel, items, value) => {
    const s = panel.querySelector(`[data-place-filter="${sel}"]`);
    const key = JSON.stringify(items);
    if (s.dataset.key !== key) { s.replaceChildren(...items.map(([v, l]) => option(v, l))); s.dataset.key = key; }
    s.value = items.some(([v]) => v === value) ? value : '';
    return s.value;
  };
  ui.category = fill('category', [['', t('place.f.all')], ...PLACE_CATEGORIES.map((c) => [c, t(`place.cat.${c}`)])], ui.category);
  ui.stopId = fill('stopId', [['', t('place.f.all')], ...stops.map((s) => [s.id, s.name])], ui.stopId);
  ui.status = fill('status', [['', t('place.f.all')], ...PLACE_STATUSES.map((s) => [s, t(`place.st.${s}`)])], ui.status);

  const shown = filterPlaces(all, ui);
  $('[data-action="places-export"]').hidden = shown.length === 0;
  $('[data-slot="places-export-label"]').textContent = interpolate(t('place.file.export'), { n: shown.length });
  $('[data-slot="place-count"]').textContent = !all.length ? '' : all.length === 1 ? t('place.count.one') : interpolate(t('place.count.other'), { n: all.length });
  $('[data-slot="place-empty"]').hidden = all.length > 0;
  $('[data-slot="place-filter-bar"]').hidden = all.length === 0;
  panel.querySelector('.place-views').hidden = all.length === 0;
  $('[data-slot="place-none"]').hidden = all.length === 0 || shown.length > 0;

  const box = $('[data-slot="place-list"]');
  const focused = box.contains(document.activeElement) ? [document.activeElement.dataset.action, document.activeElement.dataset.placeId] : null;
  box.replaceChildren(...shown.map((p) => {
    const li = el('li', `card surface place-card is-${p.status}`);
    li.dataset.placeId = p.id;
    const head = el('div', 'place-top');
    const title = el('h2', 'place-name', p.name);
    title.id = `place-${p.id}`;
    li.setAttribute('aria-labelledby', title.id);
    const actions = el('div', 'place-actions');
    actions.append(
      iconButton('i-share', interpolate(t('place.shareLabel'), { name: p.name }), 'place-share', p.id),
      iconButton('i-edit', interpolate(t('place.editLabel'), { name: p.name }), 'place-edit', p.id),
      iconButton('i-trash', interpolate(t('place.deleteLabel'), { name: p.name }), 'place-delete', p.id),
    );
    head.append(title, actions);
    li.append(head);

    const tags = el('p', 'place-tags');
    tags.append(el('span', `badge place-status is-${p.status}`, t(`place.st.${p.status}`)), el('span', 'badge', t(`place.cat.${p.category}`)));
    li.append(tags);

    const stop = stops.find((s) => s.id === p.stopId);
    if (stop) li.append(el('p', 'place-line', interpolate(t('place.line.stop'), { name: stop.name })));
    if (p.plannedDate) {
      const d = planDay(p.plannedDate, trip);
      const date = formatDate(p.plannedDate, fmtLocale, { day: 'numeric', month: 'long' });
      const line = el('p', 'place-line place-planned', d?.n ? interpolate(t('place.line.plannedDay'), { n: d.n, date }) : interpolate(t('place.line.planned'), { date }));
      line.dataset.plannedDate = p.plannedDate;
      li.append(line);
    }
    if (p.visitedDate) {
      const line = el('p', 'place-line place-visited', interpolate(t('place.line.visited'), { date: formatDate(p.visitedDate, fmtLocale, { day: 'numeric', month: 'long' }) }));
      line.dataset.visitedDate = p.visitedDate;
      li.append(line);
    }
    if (p.address) li.append(el('p', 'place-line', p.address));
    if (p.lat && p.lng) li.append(el('p', 'place-line place-coords ltr', coordsText(p)));
    if (p.note) li.append(el('p', 'place-line muted', p.note));
    const linked = Array.isArray(p.photoIds) ? p.photoIds.filter((id) => photoIds.has(id)).length : 0;
    if (linked) li.append(el('p', 'place-line place-photo-count', linked === 1 ? t('place.photos.one') : interpolate(t('place.photos.other'), { n: linked })));
    if (mapsUrl(p, ctx.config.mapsSearchUrl)) {
      const map = el('button', 'btn btn-ghost btn-small place-map-btn');
      map.type = 'button';
      map.dataset.action = 'place-map';
      map.dataset.placeId = p.id;
      map.setAttribute('aria-label', interpolate(t('place.mapLabel'), { name: p.name }));
      map.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}i-pin"/></svg>`;
      map.append(el('span', '', t('place.map')));
      li.append(map);
    }
    return li;
  }));
  if (focused) box.querySelector(`[data-action="${focused[0]}"][data-place-id="${focused[1]}"]`)?.focus();
}

/** Copy text: the clipboard API, or the older copy command where it is missing or refused. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the older way */ }
  // Older way (iOS Safari needs the field focused and the range set). Focus goes back where it was.
  const back = document.activeElement;
  const area = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
  area.className = 'sr-only';
  (back?.closest('dialog') ?? document.body).append(area);
  area.focus({ preventScroll: true });
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  if (back?.isConnected) back.focus({ preventScroll: true });
  return ok;
}

/** Download a JSON file made on the phone (same way as the backup). */
function downloadJson(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function setupPlaces(ctx, { wireDialog, showFormErrors }) {
  const panel = $('#panel-places');
  if (!panel) return;
  const { t, config } = ctx;
  let opener = null;
  const restore = () => { (opener?.isConnected ? opener : panel.querySelector('[data-action="place-add"]')).focus(); };
  const places = () => cleanPlaces(ctx.trip().places);
  const commit = (fn, message) => {
    const result = ctx.change((st) => { const trip = st.trips[st.activeTripId]; trip.places = fn(Array.isArray(trip.places) ? trip.places : []); }, { now: true });
    ctx.toast(result?.ok ? message : 'form.saveFailed');
  };

  // ---------- Search, views, filters ----------
  setupSearch($('[data-search="places"]'), (q) => { ui.q = q; renderPlaces(ctx); });
  for (const b of panel.querySelectorAll('[data-place-view]')) b.addEventListener('click', () => { ui.view = b.dataset.placeView; renderPlaces(ctx); });
  for (const s of panel.querySelectorAll('[data-place-filter]')) s.addEventListener('change', () => { ui[s.dataset.placeFilter] = s.value; renderPlaces(ctx); });

  // ---------- Location: one reading per tap ----------
  async function readLocation() {
    ui.here = null;
    ui.hereMsg = 'busy';
    renderPlaces(ctx);
    const before = await geoPermission();
    if (before === 'denied') { ui.hereMsg = 'denied'; renderPlaces(ctx); return null; }
    const r = await locate();
    ui.hereMsg = r.ok ? null : r.error;
    ui.here = r.ok ? r : null;
    renderPlaces(ctx);
    return r;
  }

  // ---------- Add or edit ----------
  const dlg = $('#dlg-place');
  const form = $('[data-form="place"]');
  let editing = null;
  wireDialog(dlg, restore);
  function open(p, from, preset = {}) {
    opener = from;
    editing = p;
    form.reset();
    showFormErrors(t, form, [], 'placeErr');
    const trip = ctx.trip();
    $('[data-slot="place-dlg-title"]').textContent = t(p ? 'place.editTitle' : 'place.addTitle');
    $('[data-slot="place-category"]').replaceChildren(...PLACE_CATEGORIES.map((c) => option(c, t(`place.cat.${c}`))));
    $('[data-slot="place-status"]').replaceChildren(...PLACE_STATUSES.map((s) => option(s, t(`place.st.${s}`))));
    $('[data-slot="place-stop"]').replaceChildren(option('', t('place.noStop')), ...stopsOf(trip).map((s) => option(s.id, s.name)));
    form.plannedDate.min = trip.startDate ?? '';
    form.plannedDate.max = trip.endDate ?? '';
    const v = p ?? { category: 'sight', status: 'want', ...preset };
    form.name.value = v.name ?? '';
    form.category.value = v.category;
    form.status.value = v.status;
    form.coords.value = coordsText(v);
    form.address.value = v.address ?? '';
    form.stopId.value = v.stopId && stopsOf(trip).some((s) => s.id === v.stopId) ? v.stopId : '';
    form.plannedDate.value = v.plannedDate ?? '';
    form.visitedDate.value = v.visitedDate ?? '';
    form.note.value = v.note ?? '';
    $('[data-slot="place-coords-hint"]').textContent = t('place.coordsHint');
    $('[data-action="place-delete-from-form"]').hidden = !p;
    fillPhotoPick(trip, v.photoIds ?? []);
    dlg.showModal();
    form.name.focus();
  }
  // Photos of the place: existing photos, linked by id (no copy). Stars are not touched here.
  function fillPhotoPick(trip, chosen) {
    const photos = cleanPhotos(trip.photos);
    const list = $('[data-slot="place-photo-pick"]');
    $('[data-slot="place-photos-hint"]').textContent = photos.length ? interpolate(t('place.photos.hint'), { max: FEATURE_MAX }) : t('place.photos.none');
    list.replaceChildren(...photos.map((ph, i) => {
      const li = el('li');
      const label = el('label', 'place-photo-opt');
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', name: 'photoIds', value: ph.id, checked: chosen.includes(ph.id) });
      box.setAttribute('aria-label', ph.date
        ? interpolate(t('place.photos.label'), { n: i + 1, date: formatDate(ph.date, ctx.fmtLocale, { day: 'numeric', month: 'long' }) })
        : interpolate(t('place.photos.labelNoDate'), { n: i + 1 }));
      const img = el('img');
      img.alt = '';
      img.dataset.thumbId = ph.id;
      label.append(box, img);
      li.append(label);
      return li;
    }));
    fillThumbs(ctx, list);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const trip = ctx.trip();
    const input = {
      name: form.name.value, category: form.category.value, status: form.status.value, coords: form.coords.value, address: form.address.value,
      stopId: form.stopId.value, plannedDate: form.plannedDate.value, visitedDate: form.visitedDate.value, note: form.note.value,
      // Links to existing photos by id. Links to photos that are not on this phone (deleted) are kept as they were.
      photoIds: [...form.querySelectorAll('[name="photoIds"]:checked')].map((x) => x.value)
        .concat((editing?.photoIds ?? []).filter((id) => !cleanPhotos(trip.photos).some((x) => x.id === id))),
    };
    const errors = validatePlace(input, { stopIds: stopsOf(trip).map((s) => s.id), trip });
    if (errors.length) { showFormErrors(t, form, errors, 'placeErr'); return; }
    const next = makePlace(input, () => makeId(), new Date().toISOString(), editing);
    commit((list) => savePlace(list, next), 'place.saved');
    opener = panel.querySelector(`[data-action="place-edit"][data-place-id="${next.id}"]`) ?? opener;
    dlg.close();
  });
  // "My location" inside the form fills only the coordinates field; the user still saves.
  $('[data-action="place-locate"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const hint = $('[data-slot="place-coords-hint"]');
    btn.disabled = true;
    hint.textContent = t('place.here.busy');
    const r = await readLocation();
    btn.disabled = false;
    if (r?.ok) { form.coords.value = `${r.lat}, ${r.lng}`; hint.textContent = interpolate(t('place.here.filled'), { m: r.accuracy }); } else hint.textContent = hereText(ctx);
  });

  // ---------- Delete, after a yes ----------
  const dlgDel = $('#dlg-place-delete');
  let onYes = null;
  wireDialog(dlgDel, () => { onYes = null; restore(); });
  $('[data-action="place-delete-yes"]').addEventListener('click', () => {
    if (onYes) onYes();
    opener = panel.querySelector('[data-action="place-add"]');
    dlgDel.close();
  });
  function askDelete(p, from) {
    opener = from;
    onYes = () => commit((list) => removePlace(list, p.id), 'place.deleted');
    $('[data-slot="place-delete-text"]').textContent = interpolate(t('place.deleteText'), { name: p.name });
    dlgDel.showModal();
    dlgDel.querySelector('[data-close]').focus();
  }
  $('[data-action="place-delete-from-form"]').addEventListener('click', () => {
    const p = editing;
    if (!p) return;
    dlg.close();
    askDelete(p, panel.querySelector(`[data-action="place-edit"][data-place-id="${p.id}"]`));
  });

  // ---------- Share: only the ticked fields; the phone's share sheet, else copy ----------
  const dlgShare = $('#dlg-place-share');
  const checks = $('[data-slot="place-share-checks"]');
  const preview = $('[data-slot="place-share-preview"]');
  const shareStatus = $('[data-slot="place-share-status"]');
  let subject = null; // { place, isHere }
  wireDialog(dlgShare, () => { subject = null; restore(); });
  const fmtDate = (iso) => formatDate(iso, ctx.fmtLocale, { day: 'numeric', month: 'long' });
  const chosenFields = () => [...checks.querySelectorAll('input:checked')].map((x) => x.value);
  const currentText = () => shareText(subject.place, chosenFields(), { t, mapsBase: config.mapsSearchUrl, fmtDate });
  const updatePreview = () => {
    const text = currentText();
    preview.textContent = text || t('place.share.empty');
    for (const b of dlgShare.querySelectorAll('[data-action="place-share-send"], [data-action="place-share-copy"]')) b.disabled = !text;
  };
  function openShare(place, isHere, from) {
    opener = from;
    subject = { place, isHere };
    // Only fields that have a value can be ticked; the note and dates start unticked (personal).
    const has = (f) => shareText(place, [f], { t, mapsBase: config.mapsSearchUrl, fmtDate }) !== '';
    checks.replaceChildren(...SHARE_FIELDS.filter(has).map((f) => {
      const label = el('label', 'place-share-check');
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', value: f, checked: DEFAULT_SHARE_FIELDS.includes(f) || (isHere && f === 'coords') });
      label.append(box, el('span', '', t(`place.share.f.${f}`)));
      return label;
    }));
    $('[data-slot="place-share-title"]').textContent = isHere ? t('place.here.share') : interpolate(t('place.share.title'), { name: place.name });
    $('[data-action="place-share-file"]').hidden = isHere;
    shareStatus.textContent = isHere ? t('place.share.hereNote') : '';
    updatePreview();
    dlgShare.showModal();
    dlgShare.querySelector('[data-action="place-share-send"]').focus();
  }
  checks.addEventListener('change', updatePreview);
  $('[data-action="place-share-copy"]').addEventListener('click', async () => {
    const ok = await copyText(currentText());
    shareStatus.textContent = t(ok ? 'place.share.copied' : 'place.share.copyFailed');
  });
  $('[data-action="place-share-send"]').addEventListener('click', async () => {
    const text = currentText();
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: subject.place.name, text });
        shareStatus.textContent = t('place.share.sent');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') { shareStatus.textContent = t('place.share.cancelled'); return; }
      }
    }
    // No share sheet here (most computers): copy instead, and say so.
    const ok = await copyText(text);
    shareStatus.textContent = t(ok ? 'place.share.noSheetCopied' : 'place.share.copyFailed');
  });
  $('[data-action="place-share-file"]').addEventListener('click', () => {
    if (!subject || subject.isHere) return;
    downloadJson(exportPlaces([subject.place], new Date()), placesFileName(new Date()));
    shareStatus.textContent = t('place.file.saved');
  });

  // ---------- Places file: export what is shown; import adds only new places, after a yes ----------
  const fileInput = $('#places-file');
  const importError = $('[data-slot="places-import-error"]');
  const dlgImport = $('#dlg-places-import');
  let pending = null;
  wireDialog(dlgImport, () => { pending = null; fileInput.value = ''; restore(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    let text;
    try { text = await file.text(); } catch { importError.textContent = t('place.import.err.read'); return; }
    const r = parsePlaces(text);
    if (!r.ok) { importError.textContent = t(`place.import.err.${r.error}`); fileInput.value = ''; return; }
    importError.textContent = '';
    const preview2 = mergePlaces(places(), r.places, () => makeId(), new Date().toISOString());
    pending = r.places;
    $('[data-slot="places-import-text"]').textContent = interpolate(t('place.import.text'), {
      total: r.places.length + r.invalid, added: preview2.added, dup: preview2.duplicates, invalid: r.invalid,
    });
    const yes = $('[data-action="places-import-yes"]');
    yes.hidden = preview2.added === 0;
    opener = panel.querySelector('[data-action="places-import"]');
    dlgImport.showModal();
    (yes.hidden ? dlgImport.querySelector('[data-close]') : yes).focus();
  });
  $('[data-action="places-import-yes"]').addEventListener('click', () => {
    if (!pending) return;
    let added = 0;
    const incoming = pending;
    const result = ctx.change((st) => {
      const trip = st.trips[st.activeTripId];
      const r = mergePlaces(Array.isArray(trip.places) ? trip.places : [], incoming, () => makeId(), new Date().toISOString());
      trip.places = r.places;
      added = r.added;
    }, { now: true });
    dlgImport.close();
    ctx.toast(result?.ok ? 'place.import.done' : 'form.saveFailed', { n: added });
  });

  // ---------- Taps on the screen ----------
  panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, placeId } = btn.dataset;
    const p = placeId ? places().find((x) => x.id === placeId) : null;
    if (action === 'place-add') open(null, btn);
    if (action === 'place-edit' && p) open(p, btn);
    if (action === 'place-delete' && p) askDelete(p, btn);
    // The map link opens only here, on the user's tap. Offline, it still opens (the maps app may have offline maps).
    const url = action === 'place-map' && p ? mapsUrl(p, config.mapsSearchUrl) : action === 'place-here-map' && ui.here ? mapsUrl(ui.here, config.mapsSearchUrl) : null;
    if (url) { if (navigator.onLine === false) ctx.toast('place.map.offline'); window.open(url, '_blank', 'noopener'); }
    if (action === 'place-here-locate') { btn.disabled = true; await readLocation(); btn.disabled = false; }
    if (action === 'place-here-save' && ui.here) open(null, btn, { lat: ui.here.lat, lng: ui.here.lng });
    if (action === 'place-share' && p) openShare(p, false, btn);
    if (action === 'place-here-share' && ui.here) openShare({ name: t('place.share.hereName'), lat: ui.here.lat, lng: ui.here.lng }, true, btn);
    if (action === 'places-import') { importError.textContent = ''; fileInput.click(); }
    if (action === 'places-export') { downloadJson(exportPlaces(filterPlaces(places(), ui), new Date()), placesFileName(new Date())); ctx.toast('place.file.saved'); }
  });
}
