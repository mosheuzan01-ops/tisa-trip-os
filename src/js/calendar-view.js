// Stage 6.0b calendar screen: the trip as a list of days (core/calendar.js). Opened from the itinerary.
// Each day: the stop, transfers, tasks and the planned total for the day (not the list of expenses).
// Today follows the destination's calendar (Bangkok). All copy from locales; nothing is guessed.
import { interpolate } from './core/i18n.js';
import { todayIn } from './core/trip.js';
import { buildCalendar } from './core/calendar.js';
import { formatDate } from './core/itinerary.js';
import { formatMinor } from './money-view.js';
import { NOTE_MAX, validateNote, noteOf, setNote, removeNote } from './core/journal.js';
import { stopsOnDay } from './core/calendar.js';
import { calendarPhotos, fillThumbs } from './photos-view.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const icon = (id) => {
  const span = el('span', 'cal-icon');
  span.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${id}"/></svg>`;
  return span;
};

export function renderCalendar(ctx) {
  const panel = $('#panel-calendar');
  if (!panel) return;
  const { t, fmtLocale, country, locale } = ctx;
  const city = country.timeZoneCity?.[locale] ?? country.timeZone;
  $('[data-slot="cal-lead"]').textContent = interpolate(t('cal.lead'), { city });
  const cal = buildCalendar(ctx.trip(), todayIn(country.timeZone));
  $('[data-slot="cal-empty"]').hidden = cal.hasDates;

  const list = $('[data-slot="cal-days"]');
  const focusDate = list.contains(document.activeElement) ? document.activeElement.dataset.day : null;
  list.replaceChildren(...cal.days.map((d) => {
    const li = el('li', 'surface cal-day');
    li.dataset.date = d.date;
    if (d.isToday) { li.classList.add('is-today'); li.setAttribute('aria-current', 'date'); }

    const head = el('div', 'cal-head');
    head.append(
      el('span', 'cal-num', interpolate(t('cal.dayN'), { n: d.n })),
      el('h2', 'cal-date', formatDate(d.date, fmtLocale, { weekday: 'long', day: 'numeric', month: 'long' })),
    );
    if (d.isToday) head.append(el('span', 'badge cal-badge-today', t('cal.today')));
    li.append(head);

    // Where: on a travel day the stop left, then the stop arrived at.
    const where = el('p', 'cal-where');
    if (d.stops.length) {
      for (const s of d.stops) {
        const part = el('span', 'cal-stop');
        part.append(el('span', 'cal-stop-name', s.name));
        if (s.role !== 'stay') part.append(el('span', 'muted', t(`cal.role.${s.role}`)));
        where.append(part);
      }
    } else {
      where.append(el('span', 'muted', t('cal.noStop')));
    }
    li.append(where);

    for (const x of d.transfers) {
      const line = el('p', 'cal-transfer');
      line.append(icon(x.kind === 'flight' ? 'i-plane' : 'i-route'));
      line.append(el('span', '', interpolate(t('transfer.route'), { from: x.from, to: x.to })));
      line.append(el('span', x.time ? 'ltr muted' : 'muted', x.time || t('transfer.timeNone')));
      li.append(line);
    }

    for (const c of d.checkins) { // 6.0d: as entered; the time is on the clock it was entered in
      const line = el('p', `cal-task cal-checkin${c.done ? ' is-done' : ''}`);
      line.append(icon('i-clock'), el('span', 'cal-task-title', interpolate(t('cal.checkin'), { title: c.title })));
      line.append(el('span', c.time ? 'ltr muted' : 'muted', c.time || t('transfer.timeNone')));
      li.append(line);
    }

    for (const x of d.tasks) {
      const line = el('p', `cal-task is-${x.state}`);
      line.append(icon('i-list'), el('span', 'cal-task-title', x.title));
      if (x.state === 'overdue' || x.state === 'done') line.append(el('span', 'cal-task-state', t(`cal.task.${x.state}`)));
      li.append(line);
    }

    const planned = el('p', d.planned.count ? 'cal-planned' : 'cal-planned muted');
    planned.dataset.slot = 'cal-planned';
    planned.textContent = d.planned.count
      ? interpolate(t('cal.planned'), { amount: formatMinor(d.planned.minor, 'ILS', fmtLocale) })
      : t('cal.plannedNone');
    li.append(planned);

    // 6.0c journal: the day's note, and one button to add or edit it.
    const dateText = formatDate(d.date, fmtLocale, { weekday: 'long', day: 'numeric', month: 'long' });
    if (d.note) li.append(el('p', 'cal-note', d.note));
    const noteBtn = el('button', 'btn btn-ghost btn-small cal-note-btn');
    noteBtn.type = 'button';
    noteBtn.dataset.action = 'note-edit';
    noteBtn.dataset.day = d.date; // not data-date: that marks the day card itself
    noteBtn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}i-edit"/></svg>`;
    noteBtn.append(el('span', '', t(d.note ? 'note.edit' : 'note.add')));
    noteBtn.setAttribute('aria-label', interpolate(t(d.note ? 'note.editLabel' : 'note.addLabel'), { date: dateText }));
    li.append(noteBtn);
    li.append(calendarPhotos(ctx, d.date)); // 7.0b: the day's photos and an add button
    return li;
  }));
  fillThumbs(ctx, list);
  if (focusDate) list.querySelector(`[data-action="note-edit"][data-day="${focusDate}"]`)?.focus();
}

/** 6.0c: the note dialog. Saving an empty note never deletes; deleting is its own step and asks first. */
export function setupCalendar(ctx, { wireDialog, showFormErrors }) {
  const panel = $('#panel-calendar');
  if (!panel) return;
  const { t } = ctx;
  const dlg = $('#dlg-note');
  const form = $('[data-form="note"]');
  const delBtn = $('[data-action="note-delete"]');
  const dlgDel = $('#dlg-note-delete');
  let date = null;
  let opener = null;
  const restore = () => {
    const btn = panel.querySelector(`[data-action="note-edit"][data-day="${date}"]`);
    (btn ?? opener)?.focus();
  };
  wireDialog(dlg, () => { if (!dlgDel.open) restore(); });
  wireDialog(dlgDel, () => restore());
  const errors = (list) => {
    showFormErrors(t, form, list, 'noteErr');
    form.querySelector('.form-error').textContent = list.map((e) => interpolate(t(`noteErr.${e}`), { max: NOTE_MAX })).join(' ');
  };
  const dateText = (iso) => formatDate(iso, ctx.fmtLocale, { weekday: 'long', day: 'numeric', month: 'long' });
  const commit = (fn, message) => {
    const result = ctx.change(fn, { now: true });
    ctx.toast(result?.ok ? message : 'form.saveFailed');
  };

  function open(iso, from) {
    const trip = ctx.trip();
    date = iso;
    opener = from;
    form.reset();
    errors([]);
    const n = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${trip.startDate}T00:00:00Z`)) / 86400000) + 1;
    $('[data-slot="note-title"]').textContent = interpolate(t('note.title'), { n });
    $('[data-slot="note-date"]').textContent = dateText(iso);
    const stops = stopsOnDay(trip.destinations, iso);
    $('[data-slot="note-where"]').textContent = stops.length
      ? interpolate(t('note.where'), { where: stops.map((x) => x.name).join(' ← ') })
      : t('note.whereNone');
    const current = noteOf(trip.journal, iso);
    form.note.value = current;
    delBtn.hidden = !current;
    dlg.showModal();
    form.note.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = form.note.value;
    const current = noteOf(ctx.trip().journal, date);
    const problems = validateNote(value);
    if (problems.length) { errors(problems); return; }
    if (value.trim() === '') {
      if (current) { errors(['note.empty']); return; } // an empty save never deletes
      dlg.close(); // nothing written, nothing saved
      return;
    }
    commit((s) => { const trip = s.trips[s.activeTripId]; trip.journal = setNote(trip.journal, date, value, new Date().toISOString()); }, 'note.saved');
    dlg.close();
  });

  delBtn.addEventListener('click', () => {
    $('[data-slot="note-delete-text"]').textContent = interpolate(t('note.deleteText'), { date: dateText(date) });
    dlg.close();
    dlgDel.showModal();
  });
  $('[data-action="note-delete-yes"]').addEventListener('click', () => {
    commit((s) => { const trip = s.trips[s.activeTripId]; trip.journal = removeNote(trip.journal, date); }, 'note.deleted');
    dlgDel.close();
  });

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="note-edit"]');
    if (btn) open(btn.dataset.day, btn);
  });
}

/** On opening the screen, bring today's day into view (only while the trip is on). */
export function revealToday() {
  const today = $('#panel-calendar .cal-day.is-today');
  if (today) today.scrollIntoView({ block: 'start' });
}
