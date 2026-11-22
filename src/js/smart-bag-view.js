// Stage 12 PR 2 (0.11.1): smart suitcase screen (#/smart-bag), opened from the lists; the lists tab stays lit.
// Shows suggestions in three groups (must / nice / avoid) from data/packing/<country>.json and core/smart-bag.js.
// A suggestion is added to the checklist only on a tap ("add" or "add all the musts"); nothing is added, edited or
// removed on its own. The weather hook gets null for now (no network). All copy from locales.
import { interpolate } from './core/i18n.js';
import { suggestions, setActivities, smartActivities, acceptSuggestion, acceptAll, destinationKind } from './core/smart-bag.js';
import { cleanStops } from './core/itinerary.js';
import { makeId } from './core/ids.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const current = (ctx) => suggestions(ctx.trip(), ctx.packing, ctx.locale, { forecast: null });

function row(t, s) {
  const li = el('li', `sbag-item is-${s.category}`);
  li.dataset.key = s.key;
  const top = el('div', 'sbag-item-top');
  top.append(el('span', 'sbag-item-name', s.name));
  if (s.qty > 1) top.append(el('span', 'badge', interpolate(t('sbag.qty'), { n: s.qty })));
  if (s.verify) top.append(el('span', 'badge sbag-check', t('sbag.toCheck')));
  li.append(top);
  if (s.category === 'avoid') li.append(el('p', 'sbag-item-note', s.reason));
  else {
    if (s.note) li.append(el('p', 'sbag-item-note', s.note));
    const add = el('button', 'btn btn-ghost btn-small sbag-add');
    add.type = 'button';
    add.dataset.action = 'sbag-add';
    add.dataset.key = s.key;
    add.setAttribute('aria-label', interpolate(t('sbag.addLabel'), { name: s.name }));
    add.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}i-plus"/></svg>`;
    add.append(el('span', '', t('sbag.add')));
    li.append(add);
  }
  return li;
}

export function renderSmartBag(ctx) {
  const panel = $('#panel-smart-bag');
  if (!panel || !ctx.packing) return;
  const { t, locale } = ctx;
  const data = ctx.packing;
  const trip = ctx.trip();
  const r = current(ctx);

  $('[data-slot="sbag-days"]').textContent = r.days === null
    ? interpolate(t('sbag.noDates'), { cap: r.cap })
    : interpolate(t('sbag.days'), { days: r.days, cap: r.cap });
  const byKind = r.kinds.map((k) => {
    const names = [...new Set(cleanStops(trip.destinations).filter((s) => destinationKind(s.name, data) === k).map((s) => s.name.trim()))];
    return `${data.kinds[k]?.[locale] ?? k}: ${names.join(', ')}`;
  });
  const kindsEl = $('[data-slot="sbag-kinds"]');
  kindsEl.hidden = !byKind.length;
  kindsEl.textContent = byKind.length ? interpolate(t('sbag.kinds'), { list: byKind.join(' · ') }) : '';
  const un = $('[data-slot="sbag-unclassified"]');
  un.hidden = !r.unclassified.length;
  un.textContent = r.unclassified.length ? interpolate(t('sbag.unclassified'), { list: r.unclassified.join(', ') }) : '';

  const chosen = new Set(smartActivities(trip, data));
  for (const box of panel.querySelectorAll('input[data-activity]')) box.checked = chosen.has(box.dataset.activity);

  const focused = panel.contains(document.activeElement) ? document.activeElement : null;
  const where = focused?.dataset.action === 'sbag-add' ? { group: focused.closest('[data-slot]')?.dataset.slot, index: [...focused.closest('ul').children].indexOf(focused.closest('li')) } : null;
  for (const group of ['must', 'nice', 'avoid']) {
    const ul = $(`[data-slot="sbag-${group}"]`);
    ul.replaceChildren(...r[group].map((s) => row(t, s)));
    $(`[data-slot="sbag-${group}-none"]`).hidden = r[group].length > 0;
  }
  $('[data-action="sbag-add-all"]').hidden = r.must.length === 0;
  // The row just added leaves: focus goes to the next row of the same group (or its heading), without scrolling,
  // so the page stays where the finger is.
  if (focused && !focused.isConnected) {
    const rows = where ? [...panel.querySelectorAll(`[data-slot="${where.group}"] [data-action="sbag-add"]`)] : [];
    const next = rows[Math.min(where?.index ?? 0, rows.length - 1)] ?? panel.querySelector(`#${where?.group ?? 'sbag-must'}-title`) ?? $('#smart-bag-title');
    next?.focus({ preventScroll: true });
  }
}

export function setupSmartBag(ctx) {
  const panel = $('#panel-smart-bag');
  if (!panel || !ctx.packing) return;
  const { t, locale } = ctx;
  const data = ctx.packing;

  // The activity choices come from the rules file: drawn once, ticked on every render.
  const box = $('[data-slot="sbag-activities"]');
  box.replaceChildren(...data.activities.map((a) => {
    const label = el('label', 'sbag-chip');
    const input = el('input');
    input.type = 'checkbox';
    input.dataset.activity = a.id;
    label.append(input, el('span', '', a.name?.[locale] ?? a.name?.en ?? a.id));
    return label;
  }));
  box.addEventListener('change', (e) => {
    if (!e.target.matches('input[data-activity]')) return;
    const ids = [...box.querySelectorAll('input[data-activity]:checked')].map((x) => x.dataset.activity);
    ctx.change((st) => setActivities(st.trips[st.activeTripId], ids, data), { now: true });
  });

  const commit = (fn) => {
    let added = 0;
    const result = ctx.change((st) => {
      const trip = st.trips[st.activeTripId];
      const r = fn(trip);
      trip.checklist = r.items;
      added = r.added;
    }, { now: true });
    return result?.ok === false ? -1 : added;
  };

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    if (e.detail > 1) return; // the second tap of a double tap: the first one already did the work
    if (btn.dataset.action === 'sbag-add') {
      const s = [...current(ctx).must, ...current(ctx).nice].find((x) => x.key === btn.dataset.key);
      if (!s) return; // already added (a second tap): nothing
      const n = commit((trip) => acceptSuggestion(trip.checklist, s, () => makeId()));
      if (n < 0) ctx.toast('form.saveFailed');
      else if (n > 0) ctx.toast('sbag.added', { name: s.name });
    }
    if (btn.dataset.action === 'sbag-add-all') {
      const must = current(ctx).must;
      const n = commit((trip) => acceptAll(trip.checklist, must, () => makeId()));
      if (n < 0) ctx.toast('form.saveFailed');
      else if (n > 0) ctx.toast('sbag.addedAll', { n });
    }
  });
  void t;
}
