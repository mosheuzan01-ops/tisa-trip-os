// 0.5.4 assistant screen: rule-based, from the user's own data only (core/assistant.js).
// Each figure shows how it was made ("how this is worked out"). A full AI chat is a future version.
import { interpolate } from './core/i18n.js';
import { todayIn } from './core/trip.js';
import { moneyAdvice, todayAdvice, DUE_WINDOW_DAYS } from './core/assistant.js';
import { categoryIds, EMERGENCY } from './core/money.js';
import { formatDate } from './core/itinerary.js';
import { cleanTasks } from './core/checklist.js';
import { dueCheckins } from './core/checkins.js';
import { zonesOf } from './checkins-view.js';
import { moneyState, formatMinor } from './money-view.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function catName(ctx, id) {
  if (id === EMERGENCY) return ctx.t('money.cat.emergency');
  const c = ctx.pack?.budgetCategories.find((x) => x.id === id);
  return c ? (c.name[ctx.locale] ?? c.name.en) : id;
}

export function renderAssistant(ctx) {
  const panel = $('#panel-assistant');
  if (!panel || !ctx.pack) return;
  const { t, fmtLocale, country, locale } = ctx;
  const city = country.timeZoneCity?.[locale] ?? country.timeZone;
  const fm = (minor) => formatMinor(minor, 'ILS', fmtLocale);
  const m = moneyState(ctx);
  const days = m.days ?? null; // the same days-left number the money screen used (Bangkok calendar)
  const a = moneyAdvice(m.summary, m.daily, days);

  // ---------- Money ----------
  const box = $('[data-slot="ast-money"]');
  const warn = $('[data-slot="ast-warn"]');
  const how = $('[data-slot="ast-how"]');
  if (a.level === 'noBudget') {
    const go = el('button', 'btn btn-ghost btn-small', t('ast.toMoney'));
    go.type = 'button';
    go.addEventListener('click', () => ctx.go('money'));
    box.replaceChildren(el('p', 'muted', t('ast.noBudget')), go);
    warn.hidden = true;
    how.hidden = true;
  } else {
    const daily = m.daily.kind === 'ok' ? interpolate(t('ast.daily'), { amount: fm(m.daily.minor) })
      : m.daily.kind === 'after' ? t('ast.dailyAfter') : m.daily.kind === 'over' ? interpolate(t('ast.daily'), { amount: fm(m.daily.minor) }) : t('ast.dailyNone');
    box.replaceChildren(
      el('p', 'ast-line', interpolate(t('ast.freeBefore'), { amount: fm(a.freeBeforeMinor) })),
      el('p', `ast-line ast-strong${a.freeAfterMinor < 0 ? ' is-over' : ''}`, interpolate(t('ast.freeAfter'), { amount: fm(a.freeAfterMinor) })),
      el('p', 'ast-line', daily),
    );
    const lines = [];
    if (a.level === 'over') lines.push(interpolate(t('ast.warn.over'), { amount: fm(-a.freeAfterMinor) }));
    const cats = a.overCategories.filter((id) => categoryIds(ctx.pack).includes(id)).map((id) => catName(ctx, id));
    if (cats.length) lines.push(interpolate(t('ast.warn.cats'), { list: cats.join(', ') }));
    warn.textContent = lines.join(' ');
    warn.hidden = lines.length === 0;
    const as = a.assumptions;
    $('[data-slot="ast-how-body"]').replaceChildren(
      el('p', '', interpolate(t('ast.how.before'), { total: fm(as.totalMinor), paid: fm(as.paidMinor) })),
      el('p', '', interpolate(t('ast.how.after'), { planned: fm(as.plannedMinor), committed: fm(as.committedMinor) })),
      el('p', '', as.days === null ? t('ast.how.dailyNone') : interpolate(t('ast.how.daily'), { days: as.days, city })),
      el('p', 'muted', t('ast.how.source')),
    );
    how.hidden = false;
  }

  // ---------- Today ----------
  const today = todayIn(country.timeZone);
  const trip = ctx.trip();
  const tasks = cleanTasks(trip.tasks);
  const ta = todayAdvice({ stops: trip.destinations, transfers: Array.isArray(trip.transfers) ? trip.transfers : [], tasks, today });
  const tbox = $('[data-slot="ast-today"]');
  const ci = dueCheckins(trip.checkins, new Date()); // 6.0d: each by the clock it was entered in
  const zoneName = (id) => zonesOf(ctx).find((z) => z.id === id)?.name ?? id;
  if (ta.nothing && !ci.overdue.length && !ci.today.length) tbox.replaceChildren(el('p', 'muted', t('ast.today.nothing')));
  else {
    const ul = el('ul', 'ast-list');
    if (ta.stop) ul.append(el('li', 'ast-strong', interpolate(t('ast.today.stop'), { place: ta.stop.name })));
    for (const x of ta.transfers) {
      const route = interpolate(t('transfer.route'), { from: x.from, to: x.to });
      ul.append(el('li', '', x.time ? interpolate(t('ast.today.transfer'), { route, time: x.time }) : interpolate(t('ast.today.transferNoTime'), { route })));
    }
    for (const c of ci.overdue) ul.append(el('li', 'is-overdue', interpolate(t('ast.today.checkinOverdue'), { title: c.title })));
    for (const c of ci.today) {
      ul.append(el('li', '', c.time ? interpolate(t('ast.today.checkinTime'), { title: c.title, time: c.time, zone: zoneName(c.zone) }) : interpolate(t('ast.today.checkin'), { title: c.title })));
    }
    for (const x of ta.due.overdue) ul.append(el('li', 'is-overdue', interpolate(t('ast.today.overdue'), { title: x.title })));
    for (const x of ta.due.today) ul.append(el('li', '', interpolate(t('ast.today.dueToday'), { title: x.title })));
    tbox.replaceChildren(ul);
  }

  // ---------- Tasks coming due ----------
  const dbox = $('[data-slot="ast-due"]');
  const groups = [['overdue', ta.due.overdue], ['today', ta.due.today], ['soon', ta.due.soon]].filter(([, l]) => l.length);
  const parts = groups.map(([key, list]) => {
    const wrap = el('div', `ast-group is-${key}`);
    const ul = el('ul', 'ast-list');
    for (const x of list) ul.append(el('li', '', interpolate(t('ast.due.item'), { title: x.title, date: formatDate(x.due, fmtLocale) })));
    wrap.append(el('h3', 'tool-title', t(`ast.due.${key}`)), ul);
    return wrap;
  });
  dbox.replaceChildren(...(parts.length ? parts : [el('p', 'muted', t('ast.due.none'))]), el('p', 'sheet-hint', interpolate(t('ast.due.window'), { n: DUE_WINDOW_DAYS, city })));
}
