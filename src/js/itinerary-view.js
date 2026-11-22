// Itinerary screen (feature 1, Stage 3): list of stops, nights, "you are here today", add / edit / delete / reorder,
// the suggested route (only on request) and replanning for new trip dates (before and after shown, saved only on yes).
// Logic lives in core/itinerary.js; this file only draws and wires. All copy comes from the locale files.
import { interpolate } from './core/i18n.js';
import { todayIn, isIsoDate, validateDates } from './core/trip.js';
import { needsTemplateOffer, declineTemplate, rebuildRoute } from './core/template.js';
import {
  sortStops, cleanStops, stopNights, totalNights, validateStop, findOverlaps, stopsOutsideTrip,
  whereToday, moveStop, replan, seedFromPack, formatDate, formatRange,
} from './core/itinerary.js';
import { makeId } from './core/ids.js';
import { transfersForStop } from './core/transfers.js';
import { planRoute } from './core/route-plan.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function nightsText(t, n) {
  if (n === 0) return t('itin.nights.zero');
  return n === 1 ? t('itin.nights.one') : interpolate(t('itin.nights.other'), { n });
}
const stopsText = (t, n) => (n === 1 ? t('itin.stops.one') : interpolate(t('itin.stops.other'), { n }));

const tripDates = (trip) => (isIsoDate(trip.startDate) && isIsoDate(trip.endDate) ? { start: trip.startDate, end: trip.endDate } : null);
const visibleStops = (trip) => sortStops(cleanStops(trip.destinations));

/** The night of 31.12 inside the trip dates, or null. */
function newYearNight(trip) {
  if (!isIsoDate(trip.startDate) || !isIsoDate(trip.endDate)) return null;
  for (let y = Number(trip.startDate.slice(0, 4)); y <= Number(trip.endDate.slice(0, 4)); y += 1) {
    const ny = `${y}-12-31`;
    if (trip.startDate <= ny && ny < trip.endDate) return ny;
  }
  return null;
}

/** Put changed stops back by id. Entries the screen cannot show stay in the data untouched. */
function writeStops(trip, next) {
  const byId = new Map(next.map((x) => [x.id, x]));
  const kept = trip.destinations.filter((x) => !(x && byId.has(x.id)));
  const broken = kept.filter((x) => !cleanStops([x]).length);
  trip.destinations = [...sortStops(next), ...broken];
}

function iconButton(icon, label, action, id) {
  const b = el('button', 'icon-btn stop-btn');
  b.type = 'button';
  b.dataset.action = action;
  b.dataset.id = id;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${icon}"/></svg>`;
  return b;
}

export function renderItinerary(ctx) {
  const panel = $('#panel-itinerary');
  if (!panel) return;
  const { t, fmtLocale, country, locale } = ctx;
  const trip = ctx.trip();
  const stops = visibleStops(trip);
  const nights = totalNights(stops);
  const today = todayIn(country.timeZone);
  const where = whereToday(stops, today);
  const names = new Map(stops.map((x) => [x.id, x.name]));
  // Pre-stage-10 PR B: the one-time template offer, here too (a route only after the preview and a yes).
  $('[data-slot="itin-template-card"]').hidden = !(stops.length > 0 && needsTemplateOffer(trip));

  $('[data-slot="itin-summary"]').textContent = stops.length
    ? interpolate(t('itin.summary'), { stops: stopsText(t, stops.length), nights: nightsText(t, nights) }) : '';
  $('[data-slot="itin-empty"]').hidden = stops.length > 0;
  $('[data-slot="itin-actions"]').hidden = stops.length === 0;

  // "Where am I today", by the destination's clock.
  const now = $('[data-slot="itin-now"]');
  now.hidden = where.phase === 'empty';
  if (!now.hidden) {
    const city = country.timeZoneCity?.[locale] ?? country.timeZone;
    const id = where.currentId ?? where.nextId;
    const stop = stops.find((x) => x.id === id);
    $('[data-slot="itin-now-label"]').textContent = t(`itin.now.${where.phase}`);
    $('[data-slot="itin-now-place"]').textContent = stop ? stop.name : '';
    $('[data-slot="itin-now-place"]').hidden = !stop;
    let sub = where.phase === 'after' ? t('itin.now.afterText') : '';
    if (where.phase === 'during') sub = interpolate(t('itin.now.leave'), { date: formatDate(stop.endDate, fmtLocale) });
    if (where.daysToGo) sub = where.daysToGo === 1 ? t('itin.now.in.one') : interpolate(t('itin.now.in.other'), { n: where.daysToGo });
    $('[data-slot="itin-now-sub"]').textContent = `${sub} ${interpolate(t('itin.now.clock'), { city })}`;
    now.dataset.phase = where.phase;
  }

  // Warnings: overlapping stays and stops outside the trip dates. Shown, never fixed silently.
  const warns = [
    ...findOverlaps(stops).map(([a, b]) => interpolate(t('itin.warn.overlap'), { a: names.get(a), b: names.get(b) })),
    ...stopsOutsideTrip(stops, tripDates(trip)).map((id) => interpolate(t('itin.warn.outside'), { name: names.get(id) })),
  ];
  const warnBox = $('[data-slot="itin-warn"]');
  warnBox.replaceChildren(...warns.map((w) => el('p', '', w)));
  warnBox.hidden = warns.length === 0;
  const flagged = new Set([...findOverlaps(stops).flat(), ...stopsOutsideTrip(stops, tripDates(trip))]);

  // The list. Rebuilt each time; focus is put back on the same control by data-action + data-id.
  // 9.0b: a suggested route says so, and says when 31.12 is not on Koh Samui (checked live, after any edit).
  const note = $('[data-slot="route-note"]');
  const suggested = stops.some((x) => x.suggested);
  note.hidden = !suggested;
  if (suggested) {
    const lines = [t('route.note')];
    const ny = newYearNight(trip);
    const samui = ctx.pack?.routeTemplate?.clusters?.flat().find((x) => x.newYear);
    const samuiName = samui ? (samui.name[ctx.locale] ?? samui.name.en) : null;
    if (ny && samuiName && !stops.some((x) => x.name === samuiName && x.startDate <= ny && ny < x.endDate)) lines.push(t('routeWarn.newYear.notOnIsland'));
    note.replaceChildren(...lines.map((x, k) => el('p', k ? 'route-note-warn' : '', x)));
  }

  const list = $('[data-slot="stops"]');
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused ? [focused.dataset.action, focused.dataset.id] : null;
  list.replaceChildren(...stops.map((stop, i) => {
    const li = el('li', 'stop surface');
    li.dataset.id = stop.id;
    if (stop.id === where.currentId) { li.classList.add('is-today'); li.setAttribute('aria-current', 'date'); }
    if (flagged.has(stop.id)) li.classList.add('has-warning');
    const head = el('div', 'stop-head');
    head.append(el('span', 'stop-num ltr', String(i + 1).padStart(2, '0')), el('h3', 'stop-name', stop.name));
    if (stop.id === where.currentId) head.append(el('span', 'badge stop-badge-today', t('itin.badge.today')));
    if (stop.flexible) head.append(el('span', 'badge', t('itin.badge.flex')));
    const meta = el('p', 'stop-meta');
    meta.append(el('span', 'stop-dates', formatRange(stop, fmtLocale)), el('span', 'stop-nights', nightsText(t, stopNights(stop))));
    li.append(head, meta);
    // 0.5.3: transfers on this stop's days (arrival and departure days included). Display only, no date changes.
    for (const x of transfersForStop(Array.isArray(trip.transfers) ? trip.transfers.filter((y) => y && y.date) : [], stop)) {
      const line = el('p', 'stop-transfer');
      line.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${x.kind === 'flight' ? 'i-plane' : 'i-route'}"/></svg>`;
      line.append(el('span', '', interpolate(t('transfer.route'), { from: x.from, to: x.to })), el('span', 'muted', formatDate(x.date, fmtLocale)));
      if (x.time) line.append(el('span', 'ltr muted', x.time));
      li.append(line);
    }
    // 9.0b: between suggested stops, say plainly that the transfer is not entered (no times are invented).
    if (stop.suggested && i > 0 && !(trip.transfers ?? []).some((y) => y?.date === stop.startDate)) {
      li.append(el('p', 'stop-transfer-missing muted', interpolate(t('route.transferMissing'), { from: stops[i - 1].name })));
    }
    if (stop.note) li.append(el('p', 'stop-note', stop.note));
    const actions = el('div', 'stop-actions');
    const up = iconButton('i-up', interpolate(t('stop.upLabel'), { name: stop.name }), 'stop-up', stop.id);
    const down = iconButton('i-down', interpolate(t('stop.downLabel'), { name: stop.name }), 'stop-down', stop.id);
    up.disabled = i === 0;
    down.disabled = i === stops.length - 1;
    actions.append(
      iconButton('i-edit', interpolate(t('stop.editLabel'), { name: stop.name }), 'stop-edit', stop.id),
      up, down,
      iconButton('i-trash', interpolate(t('stop.deleteLabel'), { name: stop.name }), 'stop-delete', stop.id),
    );
    li.append(actions);
    return li;
  }));
  if (focusKey) {
    const again = list.querySelector(`[data-action="${focusKey[0]}"][data-id="${focusKey[1]}"]`);
    (again && !again.disabled ? again : list.querySelector(`[data-id="${focusKey[1]}"] [data-action="stop-edit"]`))?.focus();
  }

  // Home "today" card: the stop of the day (or the next one), linked to this screen.
  const homeStop = $('[data-slot="today-stop"]');
  if (homeStop) {
    const id = where.currentId ?? where.nextId;
    const stop = stops.find((x) => x.id === id);
    homeStop.hidden = !stop;
    if (stop) {
      const link = el('a', 'today-stop-link', stop.name);
      link.href = '#/itinerary';
      homeStop.replaceChildren(el('span', 'today-stop-label', t(where.currentId ? 'today.stop.during' : 'today.stop.next')), link);
    }
  }

  const dates = tripDates(trip);
  $('[data-slot="itin-trip-dates"]').textContent = dates
    ? interpolate(t('itin.trip.range'), { start: formatDate(dates.start, fmtLocale), end: formatDate(dates.end, fmtLocale) })
    : t('itin.trip.none');
}

export function setupItinerary(ctx, { wireDialog, showFormErrors }) {
  const { t, fmtLocale } = ctx;
  const panel = $('#panel-itinerary');
  if (!panel) return;
  let opener = null;
  const restore = () => { if (opener?.isConnected) opener.focus(); };
  const commit = (fn, message) => {
    const result = ctx.change(fn, { now: true });
    ctx.toast(result?.ok ? message : 'form.saveFailed');
  };
  const findStop = (id) => visibleStops(ctx.trip()).find((x) => x.id === id);

  // ---------- Add / edit ----------
  const dlgStop = $('#dlg-stop');
  const form = $('[data-form="stop"]');
  const warn = $('[data-slot="stop-warn"]');
  const saveBtn = $('[data-slot="stop-save"]');
  let editing = null;
  let overlapOk = false;
  wireDialog(dlgStop, restore);

  const draft = () => ({ id: editing ?? '', name: form.name.value.trim(), startDate: form.start.value, endDate: form.end.value, note: form.note.value.trim() });
  const resetWarn = () => { overlapOk = false; warn.textContent = ''; saveBtn.textContent = t('form.save'); };
  const showNights = () => {
    const d = draft();
    $('[data-slot="stop-nights"]').textContent = validateStop({ ...d, name: 'x', note: '' }).length ? '' : nightsText(t, stopNights(d));
  };

  function openStop(stop, from) {
    opener = from;
    editing = stop?.id ?? null;
    form.reset();
    showFormErrors(t, form, [], 'stopErr');
    resetWarn();
    $('[data-slot="stop-title"]').textContent = t(stop ? 'stop.editTitle' : 'stop.addTitle');
    if (stop) {
      form.name.value = stop.name;
      form.start.value = stop.startDate;
      form.end.value = stop.endDate;
      form.note.value = stop.note ?? '';
    }
    showNights();
    dlgStop.showModal();
    form.name.focus();
  }

  form.addEventListener('input', () => { resetWarn(); showNights(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = draft();
    const errors = validateStop(d);
    if (errors.length) { showFormErrors(t, form, errors, 'stopErr'); return; }
    showFormErrors(t, form, [], 'stopErr');
    const id = editing ?? makeId();
    const others = visibleStops(ctx.trip()).filter((x) => x.id !== id);
    const clash = findOverlaps([...others, { ...d, id }]).find((pair) => pair.includes(id));
    if (clash && !overlapOk) {
      const other = others.find((x) => x.id === clash.find((x) => x !== id));
      warn.textContent = interpolate(t('stop.warn.overlap'), { name: other.name });
      saveBtn.textContent = t('stop.saveAnyway');
      overlapOk = true;
      return;
    }
    commit((s) => {
      const trip = s.trips[s.activeTripId];
      const old = trip.destinations.find((x) => x?.id === id);
      const stop = { ...(old ?? {}), id, name: d.name, startDate: d.startDate, endDate: d.endDate, note: d.note };
      writeStops(trip, [...visibleStops(trip).filter((x) => x.id !== id), stop]);
    }, 'stop.saved');
    opener = $(`[data-slot="stops"] [data-id="${id}"] [data-action="stop-edit"]`) ?? opener;
    dlgStop.close();
  });

  // ---------- Delete (after a yes) ----------
  const dlgDelete = $('#dlg-stop-delete');
  let deleting = null;
  wireDialog(dlgDelete, () => { deleting = null; restore(); });
  $('[data-action="stop-delete-confirm"]').addEventListener('click', () => {
    const id = deleting;
    if (!id) return;
    const list = visibleStops(ctx.trip());
    const i = list.findIndex((x) => x.id === id);
    const neighbour = list[i + 1] ?? list[i - 1];
    commit((s) => {
      const trip = s.trips[s.activeTripId];
      trip.destinations = trip.destinations.filter((x) => x?.id !== id);
    }, 'stop.deleted');
    opener = (neighbour && $(`[data-slot="stops"] [data-id="${neighbour.id}"] [data-action="stop-edit"]`))
      ?? $('#panel-itinerary [data-action="stop-add"]:not([hidden])');
    dlgDelete.close();
  });

  // ---------- List buttons (one delegated handler) ----------
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const { action, id } = btn.dataset;
    if (action === 'stop-add') openStop(null, btn);
    if (action === 'stop-edit') openStop(findStop(id), btn);
    if (action === 'stop-delete') {
      opener = btn;
      deleting = id;
      $('[data-slot="stop-delete-text"]').textContent = interpolate(t('stop.delete.text'), { name: findStop(id)?.name ?? '' });
      dlgDelete.showModal();
      dlgDelete.querySelector('[data-close]').focus(); // the safe choice has focus
    }
    if (action === 'stop-up' || action === 'stop-down') {
      const next = moveStop(visibleStops(ctx.trip()), id, action === 'stop-up' ? -1 : 1);
      if (!next) return;
      commit((s) => writeStops(s.trips[s.activeTripId], next), 'stop.moved');
    }
    if (action === 'seed-open') openSeed(btn);
    if (action === 'seed-archive-open') openSeed(btn, 'archive');
    if (action === 'replan-open') openReplan(btn);
    if (action === 'itin-template-open') openReplan(btn, null, null, 'template');
    if (action === 'itin-template-decline') {
      commit((s) => declineTemplate(s.trips[s.activeTripId]), 'tpl.declined');
      $('[data-action="replan-open"]')?.focus();
    }
  });

  // ---------- Suggested route from the country pack (only on request, only into an empty list) ----------
  const dlgSeed = $('#dlg-seed');
  let seed = null;
  wireDialog(dlgSeed, () => { seed = null; restore(); });
  async function openSeed(from, mode = 'plan') {
    opener = from;
    let pack;
    try {
      const mod = await import(`../../data/packs/${ctx.config.activeCountry}.js`);
      pack = Object.values(mod)[0];
    } catch { ctx.toast('form.saveFailed'); return; }
    const confirm = $('[data-action="seed-confirm"]');
    const dates = tripDates(ctx.trip());
    let stops = [];
    let text = '';
    if (mode === 'archive') { // 9.0b: the old route, only on request, marked as an old estimate
      stops = seedFromPack(pack.archive, ctx.locale, () => makeId());
      text = `${pack.archive.staleLabel?.[ctx.locale] ?? pack.archive.staleLabel?.en ?? ''}. `;
    } else if (dates) { // 9.0b: the suggestion built from the trip dates
      const plan = planRoute(dates.start, dates.end, pack.routeTemplate, ctx.locale, () => makeId());
      stops = plan.stops;
      text = plan.warnings.map((w) => t(`routeWarn.${w}`)).join(' ');
      if (text) text += ' ';
    }
    seed = stops.length ? { pack, stops, mode } : null;
    confirm.disabled = !seed;
    if (seed) {
      const first = stops[0];
      const last = stops[stops.length - 1];
      text += interpolate(t(mode === 'archive' ? 'itin.seed.text' : 'itin.seed.planText'), {
        stops: stopsText(t, stops.length), nights: nightsText(t, totalNights(stops)),
        start: formatDate(first.startDate, fmtLocale), end: formatDate(last.endDate, fmtLocale),
      });
      if (mode === 'archive' && !dates) text += ` ${t('itin.seed.tripDates')}`;
    } else if (!dates) text = t('itin.seed.needDates');
    $('[data-slot="seed-text"]').textContent = text.trim();
    dlgSeed.showModal();
    (confirm.disabled ? dlgSeed.querySelector('[data-close]') : confirm).focus();
  }
  $('[data-action="seed-confirm"]').addEventListener('click', () => {
    if (!seed) return;
    const { pack, stops, mode } = seed;
    commit((s) => {
      const trip = s.trips[s.activeTripId];
      if (visibleStops(trip).length) return; // never replace stops the user already has
      writeStops(trip, stops);
      if (mode === 'archive' && !tripDates(trip) && pack.archive?.defaultDates) { trip.startDate = pack.archive.defaultDates.start; trip.endDate = pack.archive.defaultDates.end; }
    }, 'itin.seed.done');
    opener = $('[data-slot="stops"] [data-action="stop-edit"]') ?? opener;
    dlgSeed.close();
  });

  // ---------- Replan for new trip dates: preview first, save only on yes ----------
  const dlgReplan = $('#dlg-replan');
  const rForm = $('[data-form="replan"]');
  const preview = $('[data-slot="replan-preview"]');
  const rSave = $('[data-slot="replan-save"]');
  let plan = null;
  let onCancel = null;
  let saved = false;
  wireDialog(dlgReplan, () => {
    plan = null;
    if (!saved) onCancel?.();
    onCancel = null;
    restore();
  });

  function computePlan() {
    const trip = ctx.trip();
    const stops = visibleStops(trip);
    const next = { start: rForm.start.value, end: rForm.end.value };
    const mode = rForm.mode.value;
    preview.replaceChildren();
    plan = null;
    if (mode === 'template') { previewTemplate(next); return; }
    const result = replan(stops, tripDates(trip), next, mode);
    if (!result.ok) {
      const flex = stops.find((x) => x.flexible);
      const key = result.error.startsWith('flex.') ? `replanErr.${result.error}` : `err.${result.error}`;
      showFormErrors(t, rForm, [], 'err');
      rForm.querySelector('.form-error').textContent = interpolate(t(key), { min: flex?.nightsRange?.[0], max: flex?.nightsRange?.[1] });
      rSave.disabled = true;
      return;
    }
    rForm.querySelector('.form-error').textContent = '';
    for (const input of rForm.querySelectorAll('input[type="date"]')) input.setAttribute('aria-invalid', 'false');
    plan = { dates: next, result };
    preview.append(el('h3', 'replan-preview-title', t('replan.preview.title')));
    if (!result.changes.length) preview.append(el('p', 'sheet-hint', t('replan.preview.none')));
    else {
      const ul = el('ul', 'replan-changes');
      for (const c of result.changes) {
        const li = el('li');
        li.append(
          el('span', 'replan-name', c.name),
          el('span', 'replan-was', `${t('replan.preview.was')}: ${formatRange(c.before, fmtLocale)}`),
          el('span', 'replan-will', `${t('replan.preview.will')}: ${formatRange(c.after, fmtLocale)}`),
        );
        ul.append(li);
      }
      preview.append(ul);
    }
    const names = new Map(result.stops.map((x) => [x.id, x.name]));
    if (result.warnings.includes('length.differs')) preview.append(el('p', 'form-warn', t('replan.warn.length')));
    if (result.warnings.includes('outside')) {
      preview.append(el('p', 'form-warn', interpolate(t('replan.warn.outside'), { names: result.outside.map((id) => names.get(id)).join(', ') })));
    }
    const old = tripDates(trip);
    rSave.disabled = Boolean(old && old.start === next.start && old.end === next.end && !result.changes.length);
  }

  // Pre-stage-10 PR B: "new route from the template": the new stops are listed and the old route goes to the
  // archive. Nothing is saved before the yes.
  function previewTemplate(next) {
    const bad = validateDates(next);
    rForm.querySelector('.form-error').textContent = bad.length ? t(`err.${bad[0]}`) : '';
    if (bad.length) { rSave.disabled = true; return; }
    const route = planRoute(next.start, next.end, ctx.pack?.routeTemplate, ctx.locale, () => 'preview');
    preview.append(el('h3', 'replan-preview-title', t('replan.template.title')));
    for (const w of route.warnings) preview.append(el('p', 'form-warn', t(`routeWarn.${w}`)));
    if (!route.stops.length) { rSave.disabled = true; return; }
    const ul = el('ul', 'replan-changes replan-new');
    for (const x of route.stops) {
      const li = el('li');
      li.append(el('span', 'replan-name', x.name), el('span', 'replan-will', formatRange(x, fmtLocale)));
      ul.append(li);
    }
    preview.append(ul);
    if (visibleStops(ctx.trip()).length) preview.append(el('p', 'sheet-hint', t('replan.template.archive')));
    plan = { dates: next, template: true };
    rSave.disabled = false;
  }

  function openReplan(from, preset = null, cancel = null, mode = null) {
    opener = from;
    onCancel = cancel;
    saved = false;
    const trip = ctx.trip();
    const stops = visibleStops(trip);
    rForm.reset();
    $('[data-slot="replan-from"]').hidden = !preset;
    const dates = preset ?? tripDates(trip) ?? (stops.length ? { start: stops[0].startDate, end: stops[stops.length - 1].endDate } : { start: '', end: '' });
    rForm.start.value = dates.start;
    rForm.end.value = dates.end;
    if (mode) rForm.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
    const flexInput = rForm.querySelector('input[value="flex"]');
    flexInput.disabled = !stops.some((x) => x.flexible);
    flexInput.closest('.replan-mode').classList.toggle('is-disabled', flexInput.disabled);
    computePlan();
    dlgReplan.showModal();
    (preset ? rForm.querySelector('input[name="mode"]:checked') : rForm.start).focus();
  }

  // Trip dates changed from home or settings: when there are stops, the same preview opens first.
  ctx.needsReplan = (dates) => {
    const old = tripDates(ctx.trip());
    return visibleStops(ctx.trip()).length > 0 && !(old && old.start === dates.start && old.end === dates.end);
  };
  ctx.openReplan = (dates, from, cancel) => openReplan(from, dates, cancel);

  rForm.addEventListener('input', computePlan);
  rForm.addEventListener('change', computePlan);
  rForm.addEventListener('submit', (e) => {
    e.preventDefault();
    computePlan();
    if (!plan) return;
    const { dates, result } = plan;
    if (plan.template) {
      commit((s) => { rebuildRoute(s.trips[s.activeTripId], dates, ctx.pack, ctx.locale, () => makeId(), new Date().toISOString()); }, 'replan.template.done');
      saved = true;
      dlgReplan.close();
      return;
    }
    commit((s) => {
      const trip = s.trips[s.activeTripId];
      trip.startDate = dates.start;
      trip.endDate = dates.end;
      if (result.changes.length) writeStops(trip, result.stops);
    }, 'replan.done');
    saved = true;
    dlgReplan.close();
  });
}
