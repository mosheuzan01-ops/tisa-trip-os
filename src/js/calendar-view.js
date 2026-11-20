// Stage 6.0b calendar screen: the trip as a list of days (core/calendar.js). Opened from the itinerary.
// Each day: the stop, transfers, tasks and the planned total for the day (not the list of expenses).
// Today follows the destination's calendar (Bangkok). All copy from locales; nothing is guessed.
import { interpolate } from './core/i18n.js';
import { todayIn } from './core/trip.js';
import { buildCalendar } from './core/calendar.js';
import { formatDate } from './core/itinerary.js';
import { formatMinor } from './money-view.js';

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
    return li;
  }));
}

/** On opening the screen, bring today's day into view (only while the trip is on). */
export function revealToday() {
  const today = $('#panel-calendar .cal-day.is-today');
  if (today) today.scrollIntoView({ block: 'start' });
}
