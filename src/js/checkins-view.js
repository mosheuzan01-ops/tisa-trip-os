// Stage 6.0d check-in for flights and hotels, on the transfers screen (opened from the itinerary).
// All entered by hand (core/checkins.js); no opening time is worked out. Time differences come from Intl
// (core/timezones.js). Reminders show only inside the app: home, assistant and calendar. All copy from locales.
import { interpolate } from './core/i18n.js';
import { todayIn } from './core/trip.js';
import {
  CHECKIN_KINDS, validateCheckin, makeCheckin, cleanCheckins, sortCheckins, checkinState, dueCheckins,
} from './core/checkins.js';
import { safeLink } from './core/transfers.js';
import { zoneDiffMinutes, convertLocal } from './core/timezones.js';
import { formatDate, sortStops, cleanStops } from './core/itinerary.js';
import { makeId } from './core/ids.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The two zones a time can be entered in, from data: the destination (country file) first, then home (config). */
export function zonesOf(ctx) {
  const { country, config, locale } = ctx;
  return [
    { id: country.timeZone, name: country.names?.[locale] ?? country.timeZone },
    { id: config.homeTimeZone, name: config.homeTimeZoneCity?.[locale] ?? config.homeTimeZone },
  ].filter((z) => typeof z.id === 'string' && z.id);
}
const zoneName = (ctx, id) => zonesOf(ctx).find((z) => z.id === id)?.name ?? id;

/** "Today <destination> is N hours ahead of <home>", worked out for that date; a plain message if the device cannot tell. */
export function diffText(ctx, date) {
  const { t } = ctx;
  const [a, b] = zonesOf(ctx);
  if (!a || !b) return t('tz.none');
  const diff = zoneDiffMinutes(date, a.id, b.id);
  if (diff === null) return t('tz.none');
  if (diff === 0) return interpolate(t('tz.same'), { a: a.name, b: b.name });
  const [ahead, behind] = diff > 0 ? [a, b] : [b, a];
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const amount = m ? interpolate(t('tz.hoursMinutes'), { h, m }) : h === 1 ? t('tz.hours.one') : interpolate(t('tz.hours.other'), { n: h });
  return interpolate(t('tz.diff'), { ahead: ahead.name, behind: behind.name, amount });
}

const routeOf = (ctx, x) => interpolate(ctx.t('transfer.route'), { from: x.from, to: x.to });

export function renderCheckins(ctx) {
  const panel = $('#panel-transfers');
  if (!panel) return;
  const { t, fmtLocale, country } = ctx;
  const trip = ctx.trip();
  $('[data-slot="tz-diff"]').textContent = diffText(ctx, todayIn(country.timeZone));

  const list = sortCheckins(cleanCheckins(trip.checkins));
  $('[data-slot="checkins-empty"]').hidden = list.length > 0;
  const transfers = Array.isArray(trip.transfers) ? trip.transfers : [];
  const stops = Array.isArray(trip.destinations) ? trip.destinations : [];
  const now = new Date();
  const box = $('[data-slot="checkin-list"]');
  const focused = box.contains(document.activeElement) ? [document.activeElement.dataset.action, document.activeElement.dataset.id] : null;
  box.replaceChildren(...list.map((c) => {
    const state = checkinState(c, now);
    const li = el('li', `transfer surface checkin is-${state}`);
    li.dataset.id = c.id;
    const top = el('div', 'item-top');
    const check = el('label', 'item-check');
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: c.done === true });
    input.dataset.action = 'checkin-toggle';
    input.dataset.id = c.id;
    input.setAttribute('aria-label', interpolate(t('checkin.doneLabel'), { title: c.title }));
    check.append(input, el('span', 'item-name', c.title));
    top.append(check);
    if (state !== 'upcoming') top.append(el('span', `badge checkin-state is-${state}`, t(`checkin.state.${state}`)));
    const actions = el('div', 'stop-actions row-actions');
    for (const [icon, label, action] of [['i-edit', 'checkin.editLabel', 'checkin-edit'], ['i-trash', 'checkin.deleteLabel', 'checkin-delete']]) {
      const b = el('button', 'icon-btn stop-btn');
      b.type = 'button';
      b.dataset.action = action;
      b.dataset.id = c.id;
      b.setAttribute('aria-label', interpolate(t(label), { title: c.title }));
      b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${icon}"/></svg>`;
      actions.append(b);
    }
    top.append(actions);
    li.append(top);

    const meta = el('p', 'exp-meta');
    meta.append(
      el('span', '', t(`checkin.kind.${c.kind}`)),
      el('span', '', formatDate(c.date, fmtLocale)),
      el('span', c.time ? 'ltr' : 'muted', c.time || t('transfer.timeNone')),
      el('span', 'muted', interpolate(t('checkin.zoneName'), { name: zoneName(ctx, c.zone) })),
    );
    li.append(meta);
    // The same moment on the other clock, worked out with Intl. Only when a time was entered.
    const other = zonesOf(ctx).find((z) => z.id !== c.zone);
    const there = other ? convertLocal(c.date, c.time, c.zone, other.id) : null;
    if (there) {
      li.append(el('p', 'checkin-other', there.date === c.date
        ? interpolate(t('checkin.other'), { name: other.name, time: there.time })
        : interpolate(t('checkin.otherDate'), { name: other.name, time: there.time, date: formatDate(there.date, fmtLocale) })));
    }
    const flight = c.transferId ? transfers.find((x) => x?.id === c.transferId) : null;
    if (flight) li.append(el('p', 'item-note', interpolate(t('checkin.flightLink'), { route: routeOf(ctx, flight) })));
    const stop = c.stopId ? stops.find((x) => x?.id === c.stopId) : null;
    if (stop) li.append(el('p', 'item-note', interpolate(t('checkin.stopLink'), { name: stop.name })));
    if (c.booking) li.append(el('p', 'item-note', interpolate(t('transfer.bookingShort'), { booking: c.booking })));
    if (c.note) li.append(el('p', 'item-note', c.note));
    const href = safeLink(c.link); // QP-1: also from a backup or a file, so checked again here
    if (href) {
      const a = el('a', 'transfer-link', t('checkin.openLink'));
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.append(a);
    }
    return li;
  }));
  if (focused) box.querySelector(`[data-action="${focused[0]}"][data-id="${CSS.escape(String(focused[1]))}"]`)?.focus();

  renderHomeCheckin(ctx);
}

/** Home: one line for the most pressing open check-in (past due first), linked to the check-in list. */
function renderHomeCheckin(ctx) {
  const btn = $('[data-slot="home-checkin"]');
  if (!btn) return;
  const { t } = ctx;
  const due = dueCheckins(ctx.trip().checkins, new Date());
  const all = [...due.overdue, ...due.today];
  btn.hidden = all.length === 0;
  if (!all.length) return;
  const first = all[0];
  const overdue = due.overdue.length > 0;
  btn.classList.toggle('is-overdue', overdue);
  let text = interpolate(t(overdue ? 'home.checkin.overdue' : 'home.checkin.today'), { title: first.title });
  if (all.length > 1) text = interpolate(t('home.checkin.more'), { text, n: all.length - 1 });
  btn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}i-clock"/></svg>`;
  btn.append(el('span', '', text));
}

export function setupCheckins(ctx, { wireDialog, showFormErrors }) {
  const panel = $('#panel-transfers');
  if (!panel) return;
  const { t } = ctx;
  let opener = null;
  let editing = null;
  let deleting = null;
  const restore = () => { (opener?.isConnected ? opener : panel.querySelector('[data-action="checkin-add"]')).focus(); };
  const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
  const list = () => cleanCheckins(ctx.trip().checkins);
  const commit = (fn, message) => {
    const result = ctx.change(fn, { now: true });
    ctx.toast(result?.ok ? message : 'form.saveFailed');
  };

  const dlg = $('#dlg-checkin');
  const form = $('[data-form="checkin"]');
  wireDialog(dlg, restore);
  const showKind = () => {
    const flight = form.kind.value === 'flight';
    $('[data-slot="checkin-flight-field"]').hidden = !flight;
    $('[data-slot="checkin-stop-field"]').hidden = flight;
  };
  form.kind.addEventListener('change', showKind);

  function open(c, from) {
    opener = from;
    editing = c;
    form.reset();
    showFormErrors(t, form, [], 'checkinErr');
    const trip = ctx.trip();
    $('[data-slot="checkin-title"]').textContent = t(c ? 'checkin.editTitle' : 'checkin.addTitle');
    $('[data-slot="checkin-kind"]').replaceChildren(...CHECKIN_KINDS.map((k) => option(k, t(`checkin.kind.${k}`))));
    $('[data-slot="checkin-zone"]').replaceChildren(...zonesOf(ctx).map((z) => option(z.id, interpolate(t('checkin.zoneName'), { name: z.name }))));
    const flights = (Array.isArray(trip.transfers) ? trip.transfers : []).filter((x) => x && x.kind === 'flight');
    $('[data-slot="checkin-flight"]').replaceChildren(option('', t('checkin.flightNone')), ...flights.map((x) => option(x.id, `${routeOf(ctx, x)} · ${formatDate(x.date, ctx.fmtLocale)}`)));
    $('[data-slot="checkin-stop"]').replaceChildren(option('', t('checkin.stopNone')), ...sortStops(cleanStops(trip.destinations)).map((x) => option(x.id, x.name)));
    if (c) {
      for (const k of ['kind', 'title', 'date', 'time', 'zone', 'booking', 'link', 'note']) form[k].value = c[k] ?? '';
      form.transferId.value = c.transferId && flights.some((x) => x.id === c.transferId) ? c.transferId : '';
      form.stopId.value = c.stopId ?? '';
    } else {
      form.kind.value = 'flight';
      form.zone.value = zonesOf(ctx)[0]?.id ?? '';
    }
    showKind();
    dlg.showModal();
    form.title.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = Object.fromEntries(['kind', 'title', 'date', 'time', 'zone', 'booking', 'link', 'note', 'transferId', 'stopId'].map((k) => [k, form[k].value]));
    const errors = validateCheckin(input, zonesOf(ctx).map((z) => z.id));
    if (errors.length) { showFormErrors(t, form, errors, 'checkinErr'); return; }
    const next = makeCheckin(input, () => makeId(), editing);
    commit((st) => {
      const trip = st.trips[st.activeTripId];
      if (!Array.isArray(trip.checkins)) trip.checkins = [];
      const i = trip.checkins.findIndex((x) => x?.id === next.id);
      if (i >= 0) trip.checkins[i] = next; else trip.checkins.push(next);
    }, 'checkin.saved');
    opener = panel.querySelector(`[data-action="checkin-edit"][data-id="${CSS.escape(String(next.id))}"]`) ?? opener;
    dlg.close();
  });

  const dlgDel = $('#dlg-checkin-delete');
  wireDialog(dlgDel, () => { deleting = null; restore(); });
  $('[data-action="checkin-delete-yes"]').addEventListener('click', () => {
    const id = deleting;
    if (!id) return;
    commit((st) => { const trip = st.trips[st.activeTripId]; trip.checkins = (trip.checkins ?? []).filter((x) => x?.id !== id); }, 'checkin.deleted');
    opener = panel.querySelector('[data-action="checkin-add"]');
    dlgDel.close();
  });

  panel.addEventListener('change', (e) => {
    const box = e.target.closest('input[data-action="checkin-toggle"]');
    if (!box) return;
    const result = ctx.change((st) => { // a tick saves quietly, as on the lists screen
      const c = (st.trips[st.activeTripId].checkins ?? []).find((x) => x?.id === box.dataset.id);
      if (c) c.done = box.checked;
    }, { now: true });
    if (!result?.ok) ctx.toast('form.saveFailed');
  });
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'checkin-add') open(null, btn);
    if (action === 'checkin-edit') open(list().find((x) => x.id === id), btn);
    if (action === 'checkin-delete') {
      const c = list().find((x) => x.id === id);
      if (!c) return;
      opener = btn;
      deleting = id;
      $('[data-slot="checkin-delete-text"]').textContent = interpolate(t('checkin.deleteText'), { title: c.title });
      dlgDel.showModal();
      dlgDel.querySelector('[data-close]').focus();
    }
  });
}
