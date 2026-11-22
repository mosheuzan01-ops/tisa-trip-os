// Stage 10 saved places screen (#/places, opened from the itinerary; that tab stays lit). Data: core/places.js.
// "My location" is read only when the user taps (core/geo.js): one reading, no tracking, nothing sent anywhere.
// Google Maps opens only when the user taps "open in Google Maps" (rule 5); nothing is loaded in the background.
// Own class names and data attributes (rule 14). All copy from locales.
import { interpolate } from './core/i18n.js';
import { formatDate, cleanStops, sortStops } from './core/itinerary.js';
import {
  PLACE_STATUSES, PLACE_CATEGORIES, validatePlace, makePlace, savePlace, removePlace, cleanPlaces, filterPlaces,
  placeCounts, mapsUrl, planDay, coordsText,
} from './core/places.js';
import { locate, geoPermission } from './core/geo.js';
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

  // My location
  $('[data-slot="place-here-text"]').textContent = hereText(ctx);
  $('[data-action="place-here-save"]').hidden = !ui.here;
  $('[data-action="place-here-map"]').hidden = !ui.here;

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
    dlg.showModal();
    form.name.focus();
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const trip = ctx.trip();
    const input = {
      name: form.name.value, category: form.category.value, status: form.status.value, coords: form.coords.value, address: form.address.value,
      stopId: form.stopId.value, plannedDate: form.plannedDate.value, visitedDate: form.visitedDate.value, note: form.note.value,
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
  });
}
