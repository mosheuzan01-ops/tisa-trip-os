// Money screen (features 2-4, Stage 4): "money left", "left for today", paid / planned / committed / free,
// nine categories with overspend, quick expenses with filters and a plain SVG pie, planning rates.
// Logic lives in core/money.js; this file only draws and wires. All copy comes from the locale files.
import { interpolate } from './core/i18n.js';
import { todayIn, isIsoDate } from './core/trip.js';
import {
  EMERGENCY, BASE_CURRENCY, STATUSES, METHODS, parseMoney, effectiveRates, rateToBase, currenciesFor, validateRates,
  ratesConsistent, categoryIds, validateExpense, makeExpense, editExpense, profileToBudget, summarize, daysLeft,
  dailyAllowance, filterExpenses, pieSlices, convertAll, atmCost,
} from './core/money.js';
import { validatePerson, balances, settle } from './core/split.js';
import { sortStops, cleanStops, formatDate } from './core/itinerary.js';
import { makeId } from './core/ids.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Whole shekels when the amount is round, agorot otherwise. */
export function formatMinor(minor, currency, locale) {
  const value = minor / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
  }).format(value);
}

const tripDates = (trip) => (isIsoDate(trip.startDate) && isIsoDate(trip.endDate) ? { start: trip.startDate, end: trip.endDate } : null);

/** Everything the screens need about money, computed once per render. */
export function moneyState(ctx) {
  const trip = ctx.trip();
  const pack = ctx.pack;
  const rates = effectiveRates(trip.rates, pack?.planningRates ?? {});
  const expenses = Array.isArray(trip.expenses) ? trip.expenses.filter((e) => e && Number.isInteger(e.baseMinor)) : [];
  const summary = summarize(trip.budget, expenses, rates);
  const days = daysLeft(tripDates(trip), todayIn(ctx.country.timeZone));
  return { trip, pack, rates, expenses, summary, daily: dailyAllowance(summary.freeMinor, days) };
}

function catName(ctx, id) {
  if (id === EMERGENCY) return ctx.t('money.cat.emergency');
  const c = ctx.pack?.budgetCategories.find((x) => x.id === id);
  return c ? (c.name[ctx.locale] ?? c.name.en) : id;
}
const catIndex = (ctx, id) => Math.max(0, categoryIds(ctx.pack).indexOf(id)) + 1;

function dailyText(ctx, m) {
  const { t, fmtLocale } = ctx;
  if (!m.summary.hasBudget) return t('money.today.noBudget');
  if (m.daily.kind === 'ok') return interpolate(t('money.today.ok'), { amount: formatMinor(m.daily.minor, BASE_CURRENCY, fmtLocale) });
  if (m.daily.kind === 'over') return interpolate(t('money.today.over'), { amount: formatMinor(-m.daily.minor, BASE_CURRENCY, fmtLocale) });
  return t(m.daily.kind === 'after' ? 'money.today.after' : 'money.today.noDates');
}

const filters = { date: '', category: '', destinationId: '' };

export function renderMoney(ctx) {
  const panel = $('#panel-money');
  if (!panel || !ctx.pack) return;
  const { t, fmtLocale } = ctx;
  const m = moneyState(ctx);
  const s = m.summary;
  const fm = (minor) => formatMinor(minor, BASE_CURRENCY, fmtLocale);

  // Home: "left for today" under the clock
  const home = $('[data-slot="today-money"]');
  if (home) { home.textContent = dailyText(ctx, m); home.hidden = false; home.dataset.kind = s.hasBudget ? m.daily.kind : 'none'; }

  // Hero
  $('[data-slot="money-free"]').textContent = s.hasBudget ? fm(s.freeMinor) : '—';
  $('[data-slot="money-free"]').classList.toggle('is-over', s.freeMinor < 0);
  const today = $('[data-slot="money-today"]');
  today.textContent = s.unconvertible ? interpolate(t('money.unconvertible'), { cur: s.unconvertible }) : dailyText(ctx, m);
  today.dataset.kind = s.hasBudget ? m.daily.kind : 'none';
  for (const k of ['paid', 'planned', 'committed']) $(`[data-slot="money-${k}"]`).textContent = fm(s[`${k}Minor`]);
  $('[data-slot="money-free-small"]').textContent = fm(s.freeMinor);
  $('[data-slot="money-total"]').textContent = fm(s.totalMinor);
  $('[data-slot="money-estimate"]').hidden = !m.trip.budget?.estimate;
  const bar = $('[data-slot="money-bar"]');
  const parts = [['paid', s.paidMinor], ['planned', s.plannedMinor], ['committed', s.committedMinor], ['free', Math.max(0, s.freeMinor)]];
  const whole = parts.reduce((a, [, v]) => a + v, 0);
  bar.replaceChildren(...parts.filter(([, v]) => v > 0).map(([k, v]) => {
    const seg = el('span', `seg seg-${k}`);
    seg.style.flexGrow = String(v / whole);
    return seg;
  }));
  bar.hidden = whole === 0;

  // Categories
  $('[data-slot="money-empty"]').hidden = s.hasCategories;
  $('[data-slot="money-cats"]').hidden = !s.hasCategories;
  const list = $('[data-slot="cat-list"]');
  const ids = categoryIds(m.pack).filter((id) => id !== EMERGENCY);
  const lines = new Map(s.categories.map((c) => [c.id, c]));
  const catLine = (c, name) => {
    const li = el('li', `cat c-${catIndex(ctx, c.id)}${c.over ? ' is-over' : ''}`);
    const head = el('div', 'cat-head');
    head.append(el('span', 'cat-dot'), el('span', 'cat-name', name));
    if (c.over) head.append(el('span', 'badge badge-over', t('money.cat.overBadge')));
    head.append(el('span', 'cat-nums', interpolate(t('money.cat.line'), { used: fm(c.usedMinor), plan: fm(c.planMinor) })));
    const meter = el('span', 'cat-meter');
    const fill = el('span', 'cat-fill');
    fill.style.width = `${c.planMinor ? Math.min(100, (c.usedMinor / c.planMinor) * 100) : (c.usedMinor ? 100 : 0)}%`;
    meter.append(fill);
    const left = el('p', 'cat-left', c.over ? interpolate(t('money.cat.over'), { amount: fm(-c.leftMinor) }) : interpolate(t('money.cat.left'), { amount: fm(c.leftMinor) }));
    li.append(head, meter, left);
    return li;
  };
  list.replaceChildren(...ids.map((id) => catLine(lines.get(id) ?? { id, planMinor: 0, usedMinor: 0, leftMinor: 0, over: false }, catName(ctx, id))));
  const em = $('[data-slot="cat-emergency"]');
  const emLine = catLine({ id: EMERGENCY, ...s.emergency }, catName(ctx, EMERGENCY));
  emLine.append(el('p', 'cat-note', t('money.cat.emergencyNote')));
  em.replaceChildren(emLine);

  // Filters (options reflect the data; a stale choice falls back to "all")
  const stops = sortStops(cleanStops(m.trip.destinations));
  const stopName = new Map(stops.map((x) => [x.id, x.name]));
  const days = [...new Set(m.expenses.map((e) => e.date))].sort();
  const fill = (options, key) => {
    const node = $(`[data-filter="${key}"]`);
    if (!options.some(([v]) => v === filters[key])) filters[key] = '';
    const keep = document.activeElement === node;
    node.replaceChildren(...[['', t('money.filter.all')], ...options].map(([v, label]) => Object.assign(document.createElement('option'), { value: v, textContent: label })));
    node.value = filters[key];
    if (keep) node.focus();
  };
  fill(days.map((d) => [d, formatDate(d, fmtLocale)]), 'date');
  fill(categoryIds(m.pack).map((id) => [id, catName(ctx, id)]), 'category');
  fill(stops.map((x) => [x.id, x.name]), 'destinationId');

  const shown = filterExpenses(m.expenses, filters).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const any = Object.values(filters).some(Boolean);
  $('[data-slot="exp-empty"]').textContent = shown.length ? '' : t(m.expenses.length && any ? 'money.exp.emptyFiltered' : 'money.exp.empty');

  // Pie (plain SVG). The same numbers are in the screen-reader text and the legend.
  const slices = pieSlices(shown);
  $('[data-slot="pie-card"]').hidden = slices.length === 0;
  const pie = $('[data-slot="pie"]');
  const pct = (f) => Math.round(f * 1000) / 10;
  pie.replaceChildren(...slices.map((p) => {
    let node;
    if (p.fraction >= 0.9999) {
      node = document.createElementNS(pie.namespaceURI, 'circle');
      node.setAttribute('r', '1');
    } else {
      node = document.createElementNS(pie.namespaceURI, 'path');
      const pt = (a) => `${(Math.sin(a)).toFixed(5)} ${(-Math.cos(a)).toFixed(5)}`;
      node.setAttribute('d', `M0 0L${pt(p.start)}A1 1 0 ${p.end - p.start > Math.PI ? 1 : 0} 1 ${pt(p.end)}Z`);
    }
    node.setAttribute('class', `slice c-${catIndex(ctx, p.id)}`);
    node.dataset.category = p.id;
    node.dataset.minor = String(p.minor);
    return node;
  }));
  const items = slices.map((p) => interpolate(t('pie.item'), { name: catName(ctx, p.id), amount: fm(p.minor), pct: pct(p.fraction) }));
  $('[data-slot="pie-desc"]').textContent = interpolate(t('pie.desc'), { list: items.join(', ') });
  $('[data-slot="pie-legend"]').replaceChildren(...slices.map((p, i) => {
    const li = el('li', `c-${catIndex(ctx, p.id)}`);
    li.append(el('span', 'cat-dot'), el('span', '', items[i]));
    return li;
  }));

  // Expense list
  const box = $('[data-slot="exp-list"]');
  const focused = box.contains(document.activeElement) ? [document.activeElement.dataset.action, document.activeElement.dataset.id] : null;
  box.replaceChildren(...shown.map((e) => {
    const name = e.description || catName(ctx, e.category);
    const li = el('li', `exp surface c-${catIndex(ctx, e.category)}`);
    li.dataset.id = e.id;
    const top = el('div', 'exp-top');
    const amount = el('span', 'exp-amount ltr', formatMinor(e.amountMinor, e.currency, fmtLocale));
    top.append(el('span', 'cat-dot'), el('span', 'exp-name', name), amount);
    const meta = el('p', 'exp-meta');
    meta.append(
      el('span', '', formatDate(e.date, fmtLocale)),
      ...(e.description ? [el('span', '', catName(ctx, e.category))] : []),
      el('span', `badge exp-status exp-${e.status}`, t(`exp.status.${e.status}`)),
    );
    if (e.destinationId && stopName.has(e.destinationId)) meta.append(el('span', '', stopName.get(e.destinationId)));
    if (e.currency !== BASE_CURRENCY) meta.append(el('span', 'ltr', fm(e.baseMinor)));
    li.append(top, meta);
    if (e.note) li.append(el('p', 'exp-note', e.note));
    const actions = el('div', 'stop-actions');
    for (const [icon, label, action] of [['i-edit', 'exp.editLabel', 'expense-edit'], ['i-trash', 'exp.deleteLabel', 'expense-delete']]) {
      const b = el('button', 'icon-btn stop-btn');
      b.type = 'button';
      b.dataset.action = action;
      b.dataset.id = e.id;
      b.setAttribute('aria-label', interpolate(t(label), { name }));
      b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${icon}"/></svg>`;
      actions.append(b);
    }
    li.append(actions);
    return li;
  }));
  if (focused) box.querySelector(`[data-action="${focused[0]}"][data-id="${focused[1]}"]`)?.focus();

  // Rates
  $('[data-slot="rates-badge"]').textContent = t(m.rates.planning ? 'money.rates.planning' : 'money.rates.custom');
  $('[data-slot="rates-list"]').replaceChildren(...Object.keys(m.pack.planningRates).map((k) => {
    const [from, to] = k.split('_');
    return el('li', 'ltr', interpolate(t('money.rates.line'), { from, to, rate: m.rates[k] }));
  }));
  $('[data-slot="rates-warn"]').textContent = t('money.rates.warn');
  $('[data-slot="rates-warn"]').hidden = ratesConsistent(m.rates);

  // Split: people and who pays whom (paid expenses only)
  const people = peopleOf(m.trip);
  const peopleBox = $('[data-slot="people"]');
  const focusedPerson = peopleBox.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  peopleBox.replaceChildren(...people.map((p) => {
    const li = el('li', 'person');
    const b = el('button', 'icon-btn stop-btn');
    b.type = 'button';
    b.dataset.action = 'person-delete';
    b.dataset.id = p.id;
    b.setAttribute('aria-label', interpolate(t('split.removeLabel'), { name: p.name }));
    b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}i-trash"/></svg>`;
    li.append(el('span', 'person-name', p.name), b);
    return li;
  }));
  if (focusedPerson) peopleBox.querySelector(`[data-id="${focusedPerson}"]`)?.focus();
  const settleBox = $('[data-slot="settle"]');
  if (people.length < 2) settleBox.replaceChildren(el('p', 'muted', t('split.need')));
  else {
    const names = new Map(people.map((p) => [p.id, p.name]));
    const moves = settle(balances(m.expenses, people));
    const ul = el('ul', 'settle-list');
    for (const x of moves) ul.append(el('li', '', interpolate(t('split.transfer'), { from: names.get(x.from), to: names.get(x.to), amount: fm(x.minor) })));
    settleBox.replaceChildren(el('h3', 'tool-title', t('split.settleTitle')), moves.length ? ul : el('p', 'muted', t('split.none')));
  }
  renderTools(ctx, m);
}

const peopleOf = (trip) => (Array.isArray(trip.people) ? trip.people.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string') : []);

/** Converter and ATM: computed from the inputs and today's rates; nothing is saved. */
function renderTools(ctx, m = moneyState(ctx)) {
  const { t, fmtLocale } = ctx;
  const conv = $('[data-form="convert"]');
  const sel = $('[data-slot="convert-currency"]');
  const list = currenciesFor(m.rates);
  if (sel.options.length !== list.length) {
    const keep = sel.value;
    sel.replaceChildren(...list.map((c) => Object.assign(document.createElement('option'), { value: c, textContent: c })));
    sel.value = list.includes(keep) ? keep : BASE_CURRENCY;
  }
  const rows = convertAll(parseMoney(conv.amount.value), sel.value, m.rates);
  $('[data-slot="convert-out"]').replaceChildren(...rows.map((r) => el('li', r.currency === sel.value ? 'is-from' : '', formatMinor(r.minor, r.currency, fmtLocale))));

  const fee = m.pack.atmFee;
  const atm = $('[data-form="atm"]');
  $('[data-slot="atm-amount-label"]').textContent = interpolate(t('atm.amountLabel'), { cur: fee.currency });
  $('[data-slot="atm-fee-label"]').textContent = interpolate(t('atm.feeLabel'), { cur: fee.currency });
  if (!atm.dataset.ready) { atm.fee.value = String(fee.amount); atm.dataset.ready = '1'; }
  const feeText = atm.fee.value.trim();
  const feeMinor = /^0+(\.0+)?$/.test(feeText) ? 0 : parseMoney(feeText);
  const out = $('[data-slot="atm-out"]');
  if (!atm.amount.value.trim()) { out.textContent = t('atm.tip'); return; }
  const r = atmCost(parseMoney(atm.amount.value), feeMinor, m.rates, fee.currency);
  out.textContent = r ? interpolate(t('atm.result'), {
    total: formatMinor(r.totalMinor, fee.currency, fmtLocale), base: formatMinor(r.totalBaseMinor, BASE_CURRENCY, fmtLocale), pct: r.feePct,
  }) : t('atm.invalid');
}

export function setupMoney(ctx, { wireDialog, showFormErrors }) {
  const panel = $('#panel-money');
  if (!panel) return;
  const { t, fmtLocale } = ctx;
  let opener = null;
  const restore = () => { if (opener?.isConnected) opener.focus(); };
  const commit = (fn, message) => {
    const result = ctx.change(fn, { now: true });
    ctx.toast(result?.ok ? message : 'form.saveFailed');
  };
  const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });

  for (const node of panel.querySelectorAll('[data-filter]')) {
    node.addEventListener('change', () => { filters[node.dataset.filter] = node.value; renderMoney(ctx); });
  }

  // ---------- Expense add / edit ----------
  const dlg = $('#dlg-expense');
  const form = $('[data-form="expense"]');
  let editing = null;
  wireDialog(dlg, restore);

  const showConvert = () => {
    const rates = moneyState(ctx).rates;
    const minor = parseMoney(form.amount.value);
    const cur = form.currency.value;
    const old = editing && minor === editing.amountMinor && cur === editing.currency ? editing : null;
    const rate = old ? old.rate : rateToBase(cur, rates);
    $('[data-slot="exp-convert"]').textContent = cur === BASE_CURRENCY || Number.isNaN(minor) ? '' : interpolate(t('exp.convert'), {
      base: formatMinor(old ? old.baseMinor : Math.round(minor * rate), BASE_CURRENCY, fmtLocale),
      cur, rate: Math.round(rate * 10000) / 10000,
    });
  };

  function openExpense(exp, from) {
    opener = from;
    editing = exp;
    const m = moneyState(ctx);
    form.reset();
    showFormErrors(t, form, [], 'expErr');
    $('[data-slot="expense-title"]').textContent = t(exp ? 'exp.editTitle' : 'exp.addTitle');
    $('[data-slot="exp-currency"]').replaceChildren(...currenciesFor(m.rates).map((c) => option(c, c)));
    $('[data-slot="exp-category"]').replaceChildren(...categoryIds(m.pack).map((id) => option(id, catName(ctx, id))));
    $('[data-slot="exp-status"]').replaceChildren(...STATUSES.map((x) => option(x, t(`exp.status.${x}`))));
    $('[data-slot="exp-method"]').replaceChildren(...METHODS.map((x) => option(x, t(`exp.method.${x}`))));
    const stops = sortStops(cleanStops(m.trip.destinations));
    $('[data-slot="exp-stop"]').replaceChildren(option('', t('exp.noStop')), ...stops.map((x) => option(x.id, x.name)));
    const today = todayIn(ctx.country.timeZone);
    const people = peopleOf(m.trip);
    $('[data-slot="exp-split"]').hidden = people.length < 2;
    $('[data-slot="exp-paid-by"]').replaceChildren(option('', t('split.noOne')), ...people.map((p) => option(p.id, p.name)));
    const shared = exp?.sharedBy ?? people.map((p) => p.id);
    $('[data-slot="exp-shared-by"]').replaceChildren(...people.map((p) => {
      const label = el('label', 'split-check');
      label.append(Object.assign(document.createElement('input'), { type: 'checkbox', name: 'sharedBy', value: p.id, checked: shared.includes(p.id) }), el('span', '', p.name));
      return label;
    }));
    form.paidBy.value = exp?.paidBy && people.some((p) => p.id === exp.paidBy) ? exp.paidBy : '';
    if (exp) {
      form.amount.value = (exp.amountMinor / 100).toFixed(exp.amountMinor % 100 ? 2 : 0);
      for (const k of ['currency', 'category', 'date', 'status', 'method', 'description', 'note']) form[k].value = exp[k] ?? '';
      form.destinationId.value = exp.destinationId ?? '';
    } else {
      // Sensible defaults the user can change: today's date (trip clock), the stop of today, paid, cash.
      form.date.value = today;
      form.currency.value = BASE_CURRENCY;
      form.category.value = categoryIds(m.pack)[0];
      form.status.value = 'paid';
      form.method.value = 'cash';
      const here = stops.find((x) => x.startDate <= today && today <= x.endDate);
      form.destinationId.value = here?.id ?? '';
    }
    showConvert();
    dlg.showModal();
    form.amount.focus();
  }

  form.addEventListener('input', showConvert);
  form.addEventListener('change', showConvert);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const m = moneyState(ctx);
    const input = Object.fromEntries(['amount', 'currency', 'category', 'date', 'status', 'method', 'description', 'note', 'destinationId'].map((k) => [k, form[k].value]));
    const errors = validateExpense(input, categoryIds(m.pack), currenciesFor(m.rates));
    if (errors.length) { showFormErrors(t, form, errors, 'expErr'); return; }
    const next = editing ? editExpense(editing, input, m.rates) : makeExpense(input, m.rates, () => makeId());
    const sharedBy = [...form.querySelectorAll('input[name="sharedBy"]:checked')].map((x) => x.value);
    if (peopleOf(m.trip).length >= 2 && form.paidBy.value && sharedBy.length) { next.paidBy = form.paidBy.value; next.sharedBy = sharedBy; } else { delete next.paidBy; delete next.sharedBy; }
    commit((st) => {
      const trip = st.trips[st.activeTripId];
      const i = trip.expenses.findIndex((x) => x?.id === next.id);
      if (i >= 0) trip.expenses[i] = next; else trip.expenses.push(next);
    }, 'exp.saved');
    opener = $(`[data-slot="exp-list"] [data-id="${next.id}"] [data-action="expense-edit"]`) ?? opener;
    dlg.close();
  });

  // ---------- Delete (after a yes) ----------
  const dlgDelete = $('#dlg-expense-delete');
  let deleting = null;
  wireDialog(dlgDelete, () => { deleting = null; restore(); });
  $('[data-action="expense-delete-confirm"]').addEventListener('click', () => {
    const id = deleting;
    if (!id) return;
    commit((st) => { const trip = st.trips[st.activeTripId]; trip.expenses = trip.expenses.filter((x) => x?.id !== id); }, 'exp.deleted');
    opener = $('[data-slot="exp-list"] [data-action="expense-edit"]') ?? $('#panel-money [data-action="expense-add"]');
    dlgDelete.close();
  });

  // ---------- Profile (only after a yes) ----------
  const dlgProfile = $('#dlg-profile');
  const pForm = $('[data-form="profile"]');
  wireDialog(dlgProfile, restore);
  function openProfile(from) {
    opener = from;
    const m = moneyState(ctx);
    const profiles = m.pack.budgetProfiles;
    const current = profiles.find((p) => p.id === m.trip.budget?.profileId) ?? profiles[Math.min(1, profiles.length - 1)];
    $('[data-slot="profile-options"]').replaceChildren(...profiles.map((p) => {
      const label = el('label', 'replan-mode');
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'profile', value: p.id, checked: p === current });
      const text = el('span');
      text.append(el('b', '', `${p.name[ctx.locale] ?? p.name.en}: ${formatMinor(p.total * 100, p.currency, fmtLocale)}`));
      if (p.description) text.append(el('small', '', p.description[ctx.locale] ?? p.description.en));
      label.append(input, text);
      return label;
    }));
    $('[data-slot="profile-warn"]').textContent = m.summary.hasCategories ? t('money.profile.replace') : '';
    dlgProfile.showModal();
    pForm.querySelector('input:checked')?.focus();
  }
  pForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const profile = ctx.pack.budgetProfiles.find((p) => p.id === pForm.profile.value);
    if (!profile) return;
    commit((st) => {
      const trip = st.trips[st.activeTripId];
      const { categoriesMinor, profileId, estimate } = profileToBudget(profile);
      const keepEmergency = trip.budget?.categoriesMinor?.[EMERGENCY];
      if (Number.isInteger(keepEmergency) && keepEmergency > 0) categoriesMinor[EMERGENCY] = keepEmergency; // never wipe the user's own emergency amount
      trip.budget = { ...trip.budget, currency: BASE_CURRENCY, categoriesMinor, profileId, estimate };
    }, 'money.profile.done');
    dlgProfile.close();
  });

  // ---------- Category amounts ----------
  const dlgCats = $('#dlg-cats');
  const cForm = $('[data-form="cats"]');
  wireDialog(dlgCats, restore);
  const readCat = (v) => (String(v).trim() === '' || /^0+(\.0+)?$/.test(String(v).trim()) ? 0 : parseMoney(v));
  const catsSum = () => {
    let total = 0; let emergency = 0;
    for (const input of cForm.querySelectorAll('input')) {
      const v = readCat(input.value);
      if (Number.isNaN(v)) continue;
      if (input.name === EMERGENCY) emergency = v; else total += v;
    }
    $('[data-slot="cats-sum"]').textContent = interpolate(t('money.cats.sum'), { total: formatMinor(total, BASE_CURRENCY, fmtLocale), emergency: formatMinor(emergency, BASE_CURRENCY, fmtLocale) });
  };
  function openCats(from) {
    opener = from;
    const m = moneyState(ctx);
    const cats = m.trip.budget?.categoriesMinor ?? {};
    $('[data-slot="cats-fields"]').replaceChildren(...categoryIds(m.pack).map((id) => {
      const label = el('label', 'field field-inline');
      const input = Object.assign(document.createElement('input'), { type: 'text', name: id, inputMode: 'decimal', autocomplete: 'off', className: 'ltr' });
      input.value = Number.isInteger(cats[id]) ? String(cats[id] / 100) : '';
      label.append(el('span', '', catName(ctx, id)), input);
      return label;
    }));
    cForm.querySelector('.form-error').textContent = '';
    catsSum();
    dlgCats.showModal();
    cForm.querySelector('input').focus();
  }
  cForm.addEventListener('input', catsSum);
  cForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = {};
    for (const input of cForm.querySelectorAll('input')) {
      const v = readCat(input.value);
      input.setAttribute('aria-invalid', String(Number.isNaN(v)));
      if (Number.isNaN(v)) {
        cForm.querySelector('.form-error').textContent = interpolate(t('catsErr.invalid'), { name: catName(ctx, input.name) });
        input.focus();
        return;
      }
      next[input.name] = v;
    }
    commit((st) => {
      const trip = st.trips[st.activeTripId];
      trip.budget = { ...trip.budget, currency: BASE_CURRENCY, categoriesMinor: next }; // the "estimate" label stays while it came from a profile
    }, 'money.cats.saved');
    dlgCats.close();
  });

  // ---------- Rates ----------
  const dlgRates = $('#dlg-rates');
  const rForm = $('[data-form="rates"]');
  wireDialog(dlgRates, restore);
  function openRates(from) {
    opener = from;
    const m = moneyState(ctx);
    $('[data-slot="rates-fields"]').replaceChildren(...Object.keys(m.pack.planningRates).map((k) => {
      const [a, b] = k.split('_');
      const label = el('label', 'field field-inline');
      const input = Object.assign(document.createElement('input'), { type: 'text', name: k, inputMode: 'decimal', autocomplete: 'off', className: 'ltr', value: String(m.rates[k]) });
      label.append(el('span', 'ltr', `1 ${a} = ? ${b}`), input);
      return label;
    }));
    rForm.querySelector('.form-error').textContent = '';
    dlgRates.showModal();
    rForm.querySelector('input').focus();
  }
  rForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = Object.fromEntries([...rForm.querySelectorAll('input')].map((x) => [x.name, x.value.trim().replace(',', '.')]));
    const errors = validateRates(input, Object.keys(input));
    for (const x of rForm.querySelectorAll('input')) x.setAttribute('aria-invalid', String(errors.includes(`${x.name}.invalid`)));
    if (errors.length) { rForm.querySelector('.form-error').textContent = t('ratesErr.invalid'); rForm.querySelector('[aria-invalid="true"]')?.focus(); return; }
    const defaults = ctx.pack.planningRates;
    const own = {};
    for (const [k, v] of Object.entries(input)) if (Number(v) !== defaults[k]) own[k] = Number(v);
    commit((st) => { st.trips[st.activeTripId].rates = own; }, 'money.rates.saved');
    dlgRates.close();
  });
  $('[data-action="rates-restore"]').addEventListener('click', () => {
    commit((st) => { st.trips[st.activeTripId].rates = {}; }, 'money.rates.restored');
    dlgRates.close();
  });

  // ---------- Split: people ----------
  const personForm = $('[data-form="person"]');
  personForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = personForm.name.value.trim();
    const errors = validatePerson(name, peopleOf(ctx.trip()));
    if (errors.length) { showFormErrors(t, personForm, errors, 'splitErr'); return; }
    showFormErrors(t, personForm, [], 'splitErr');
    commit((st) => { const trip = st.trips[st.activeTripId]; trip.people = [...peopleOf(trip), { id: makeId(), name }]; }, 'split.added');
    personForm.reset();
    personForm.name.focus();
  });
  const dlgPerson = $('#dlg-person-delete');
  let removing = null;
  wireDialog(dlgPerson, () => { removing = null; restore(); });
  $('[data-action="person-delete-confirm"]').addEventListener('click', () => {
    const id = removing;
    if (!id) return;
    commit((st) => { const trip = st.trips[st.activeTripId]; trip.people = peopleOf(trip).filter((p) => p.id !== id); }, 'split.removed');
    opener = $('[data-form="person"] [name="name"]');
    dlgPerson.close();
  });

  // ---------- Calculators (nothing saved) ----------
  for (const f of ['convert', 'atm']) {
    const node = $(`[data-form="${f}"]`);
    node.addEventListener('input', () => renderTools(ctx));
    node.addEventListener('change', () => renderTools(ctx));
    node.addEventListener('submit', (e) => e.preventDefault());
  }

  // ---------- One delegated handler for the screen ----------
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const { action, id } = btn.dataset;
    const find = () => moneyState(ctx).expenses.find((x) => x.id === id);
    if (action === 'expense-add') openExpense(null, btn);
    if (action === 'expense-edit') openExpense(find(), btn);
    if (action === 'expense-delete') {
      opener = btn;
      deleting = id;
      const exp = find();
      $('[data-slot="expense-delete-text"]').textContent = interpolate(t('exp.delete.text'), { name: exp?.description || catName(ctx, exp?.category) });
      dlgDelete.showModal();
      dlgDelete.querySelector('[data-close]').focus(); // the safe choice has focus
    }
    if (action === 'person-delete') {
      opener = btn;
      removing = id;
      const p = peopleOf(ctx.trip()).find((x) => x.id === id);
      $('[data-slot="person-delete-text"]').textContent = interpolate(t('split.remove.text'), { name: p?.name ?? '' });
      dlgPerson.showModal();
      dlgPerson.querySelector('[data-close]').focus();
    }
    if (action === 'profile-open') openProfile(btn);
    if (action === 'cats-open') openCats(btn);
    if (action === 'rates-open') openRates(btn);
  });
}
