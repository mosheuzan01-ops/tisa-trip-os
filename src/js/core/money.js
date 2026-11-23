// Stage 4 money logic: budget, expenses, planning rates, "free" and "left for today". Pure functions, no DOM.
// Every amount is a whole number of minor units (agorot / satang): no floating-point money anywhere.
// An expense keeps its original amount, currency and the rate of the day it was entered, so later rate
// changes never rewrite history. Tested in tests/money.test.js.
import { isIsoDate, daysBetween } from './trip.js';

export const EMERGENCY = 'emergency';
export const FLIGHT = 'flight'; // stage 13: its plan is set aside in "free" until flight expenses cover it
export const BASE_CURRENCY = 'ILS';
export const ANCHOR_TOTAL = 'total'; // 1.0.1: budget.anchor when the user typed one total (docs/BUDGET_AND_START.md)
export const STATUSES = ['paid', 'planned', 'committed'];
export const METHODS = ['cash', 'card', 'transfer', 'other'];
export const DESCRIPTION_MAX = 80;
export const NOTE_MAX = 140;
const MAX_MINOR = 1e12;

/**
 * "1,234.56" -> 123456; "12,50" -> 1250. NaN for anything that is not a positive amount with at most two decimals.
 * A comma is a thousands separator only between groups of three digits ("1,234", "12,500.50"). A single comma with one
 * or two digits after it and no dot is a decimal comma ("12,50", "1,5"), as on phones whose number pad shows a comma
 * (the luggage weight reads it the same way). Any other comma pattern is refused, never guessed: before this, "12,50"
 * was silently saved as 1,250.
 */
export function parseMoney(text) {
  const s = String(text ?? '').replace(/\s/g, '');
  let clean = s;
  if (s.includes(',')) {
    if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) clean = s.replace(/,/g, '');
    else if (/^\d+,\d{1,2}$/.test(s)) clean = s.replace(',', '.');
    else return NaN;
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!m) return NaN;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return minor > 0 && minor <= MAX_MINOR / 10 ? minor : NaN;
}

/** A Stage 1 decimal amount to minor units (used only by the data migration). */
export const toMinor = (amount) => Math.round(Number(amount) * 100);

/** Planning rates from the country pack, with the user's edits on top. `planning` is true while nothing was edited. */
export function effectiveRates(stored = {}, defaults = {}) {
  const out = {};
  let edited = false;
  for (const k of Object.keys(defaults)) {
    const own = Number(stored?.[k]);
    if (Number.isFinite(own) && own > 0) { out[k] = own; edited = edited || own !== defaults[k]; } else out[k] = defaults[k];
  }
  out.planning = !edited;
  out.updatedAt = !edited ? null : (typeof stored?.updatedAt === 'string' ? stored.updatedAt : null);
  return out;
}

/** The user's own rates with the date they were set (shown as "last updated"). No own rates: no date. */
export const stampRates = (own, date) => (Object.keys(own).length ? { ...own, updatedAt: date } : {});

/** How many shekels one unit of the currency is worth. NaN when there is no rate for it. */
// Rates are keyed "FROM_TO" (1 FROM = n TO), as in the country pack's planningRates.
export function rateToBase(currency, rates) {
  if (currency === BASE_CURRENCY) return 1;
  if (rates[`${currency}_${BASE_CURRENCY}`] > 0) return rates[`${currency}_${BASE_CURRENCY}`];
  if (rates[`${BASE_CURRENCY}_${currency}`] > 0) return 1 / rates[`${BASE_CURRENCY}_${currency}`];
  return NaN;
}

/** Currencies an expense can use: the base plus every currency the rates can convert to it. */
export function currenciesFor(rates) {
  const out = [BASE_CURRENCY];
  for (const k of Object.keys(rates)) for (const c of k.split('_')) if (/^[A-Z]{3}$/.test(c) && !out.includes(c) && Number.isFinite(rateToBase(c, rates))) out.push(c);
  return out;
}

const rateKeys = (o) => Object.keys(o).filter((k) => /^[A-Z]{3}_[A-Z]{3}$/.test(k));

export function validateRates(input = {}, keys = rateKeys(input)) {
  return keys.filter((k) => !(Number(String(input[k] ?? '').replace(',', '.')) > 0 && Number(input[k]) < 1e6)).map((k) => `${k}.invalid`);
}

/** True when every cross rate X_Y matches X_base x base_Y (within half a percent). */
export function ratesConsistent(r) {
  return rateKeys(r).every((k) => {
    const [x, y] = k.split('_');
    if (x === BASE_CURRENCY || y === BASE_CURRENCY) return true;
    const a = r[`${x}_${BASE_CURRENCY}`];
    const b = r[`${BASE_CURRENCY}_${y}`];
    return !(a > 0 && b > 0) || Math.abs(a * b - r[k]) / r[k] < 0.005;
  });
}

/** Ids of the nine budget categories: the country pack's categories plus emergency. */
export const categoryIds = (pack) => [...(pack?.budgetCategories ?? []).map((c) => c.id), EMERGENCY];

/** Problems with an expense form, as message keys. Empty array = valid. */
export function validateExpense(input = {}, categories = [], currencies = [BASE_CURRENCY]) {
  const errors = [];
  if (String(input.amount ?? '').trim() === '') errors.push('amount.missing');
  else if (Number.isNaN(parseMoney(input.amount))) errors.push('amount.invalid');
  if (!currencies.includes(input.currency)) errors.push('currency.invalid');
  if (!categories.includes(input.category)) errors.push('category.invalid');
  if (!input.date) errors.push('date.missing');
  else if (!isIsoDate(input.date)) errors.push('date.invalid');
  if (!STATUSES.includes(input.status)) errors.push('status.invalid');
  if (!METHODS.includes(input.method)) errors.push('method.invalid');
  if (String(input.description ?? '').trim().length > DESCRIPTION_MAX) errors.push('description.tooLong');
  if (String(input.note ?? '').trim().length > NOTE_MAX) errors.push('note.tooLong');
  return errors;
}

/** A saved expense. The rate is frozen here; baseMinor is the shekel value on the day it was entered. */
export function makeExpense(input, rates, makeId, existing = null) {
  const amountMinor = parseMoney(input.amount);
  const rate = rateToBase(input.currency, rates);
  return {
    ...(existing ?? {}),
    id: existing?.id ?? makeId(),
    amountMinor,
    currency: input.currency,
    rate,
    baseMinor: Math.round(amountMinor * rate),
    category: input.category,
    date: input.date,
    destinationId: input.destinationId || null,
    description: String(input.description ?? '').trim(),
    method: input.method,
    status: input.status,
    note: String(input.note ?? '').trim(),
  };
}

/** Same expense, edited. The original rate stays unless the amount or currency changed. */
export function editExpense(old, input, rates) {
  const sameMoney = parseMoney(input.amount) === old.amountMinor && input.currency === old.currency;
  const next = makeExpense(input, rates, () => old.id, old);
  if (sameMoney) { next.rate = old.rate; next.baseMinor = old.baseMinor; }
  return next;
}

/** A budget profile from the country pack as an editable budget, marked as an estimate. Emergency starts at 0. */
export function profileToBudget(profile, locale = 'he') {
  const categoriesMinor = {};
  for (const [k, v] of Object.entries(profile.categories)) categoriesMinor[k] = toMinor(v);
  categoriesMinor[EMERGENCY] = toMinor(profile.emergency ?? 0); // owner: about one flight ticket (2026-11-19)
  // Stage 9: a template may name its categories and hide empty ones. Old profiles have neither.
  const names = profile.categoryNames?.[locale] ?? profile.categoryNames?.en ?? {};
  return {
    currency: profile.currency, totalMinor: null, categoriesMinor, profileId: profile.id, estimate: true,
    categoryNames: { ...names }, hidden: Array.isArray(profile.hidden) ? [...profile.hidden] : [],
  };
}

const isMinor = (v) => Number.isInteger(v) && v >= 0;
const sumBy = (list, pick) => list.reduce((s, x) => s + pick(x), 0);

/**
 * The whole money picture, in shekel minor units.
 * Running budget = the categories (or the home total while no category has an amount). Emergency is separate.
 * Stage 13 (owner, 2026-11-22): the money planned for the flight is set aside until flight expenses cover it.
 * paid + planned + committed + set aside for the flight + free = running budget, exactly. docs/BUDGET_AND_START.md.
 * 1.0.1: a budget with anchor 'total' uses the total the user typed instead (see the anchored branch below);
 * every budget without it (all data from 1.0.0 and before) gives exactly the 1.0.0 numbers.
 */
export function summarize(budget, expenses = [], rates = null) {
  const cats = budget?.categoriesMinor ?? {};
  const running = Object.entries(cats).filter(([k, v]) => k !== EMERGENCY && isMinor(v));
  const hasCategories = running.length > 0 || isMinor(cats[EMERGENCY]);
  // The home total may be in another currency (Stage 1 allowed that): convert it with today's rates.
  let homeTotal = isMinor(budget?.totalMinor) ? budget.totalMinor : 0;
  let unconvertible = null;
  const cur = budget?.currency ?? BASE_CURRENCY;
  if (homeTotal && cur !== BASE_CURRENCY) {
    const rate = rates ? rateToBase(cur, rates) : NaN;
    if (Number.isFinite(rate)) homeTotal = Math.round(homeTotal * rate); else { unconvertible = cur; homeTotal = 0; }
  }
  const runningSum = sumBy(running, ([, v]) => v);
  const totalMinor = runningSum > 0 ? runningSum : homeTotal; // category names at 0 are not a budget yet
  const list = expenses.filter((e) => e && Number.isInteger(e.baseMinor));
  const normal = list.filter((e) => e.category !== EMERGENCY);
  const by = (status) => sumBy(normal.filter((e) => e.status === status), (e) => e.baseMinor);
  const paidMinor = by('paid');
  const plannedMinor = by('planned');
  const committedMinor = by('committed');
  const used = (id) => sumBy(list.filter((e) => e.category === id), (e) => e.baseMinor);
  const line = (id) => {
    const planMinor = isMinor(cats[id]) ? cats[id] : 0;
    const usedMinor = used(id);
    const st = (status) => sumBy(list.filter((e) => e.category === id && e.status === status), (e) => e.baseMinor);
    // 7.0a: the same split per category (paid / planned / future). Added fields only; the old ones are unchanged.
    return { id, planMinor, usedMinor, leftMinor: planMinor - usedMinor, over: usedMinor > planMinor, paidMinor: st('paid'), plannedMinor: st('planned'), committedMinor: st('committed') };
  };
  const ids = [...new Set([...Object.keys(cats), ...list.map((e) => e.category)])].filter((k) => k !== EMERGENCY);
  const em = line(EMERGENCY);
  // Set aside for the flight: its plan, less the flight expenses so far (never below 0). "Before planning" counts
  // only what was paid, like the rest of that figure.
  const anchored = budget?.anchor === ANCHOR_TOTAL && isMinor(budget?.totalMinor);
  const flightPlanMinor = (anchored || runningSum > 0) && isMinor(cats[FLIGHT]) ? cats[FLIGHT] : 0;
  const flightBy = (statuses) => sumBy(normal.filter((e) => e.category === FLIGHT && statuses.includes(e.status)), (e) => e.baseMinor);
  const flightReserveMinor = Math.max(flightPlanMinor - flightBy(['paid', 'planned', 'committed']), 0);
  const flightReserveBeforeMinor = Math.max(flightPlanMinor - flightBy(['paid']), 0);
  const emergency = { planMinor: em.planMinor, usedMinor: em.usedMinor, leftMinor: em.leftMinor, over: em.over };
  if (anchored) {
    // 1.0.1 (owner, 2026-11-22): the total the user typed is the anchor; the categories are a plan inside it. The
    // emergency fund is part of the total: set aside like the flight, and its own expenses use it up first, so
    // nothing is counted twice (held = the larger of its plan and what was spent from it).
    const anchorTotal = budget.totalMinor;
    const emPaid = em.paidMinor;
    const emergencyHeldMinor = Math.max(em.planMinor, em.usedMinor);
    return {
      anchored: true,
      hasBudget: anchorTotal > 0,
      hasCategories,
      unconvertible: null,
      totalMinor: anchorTotal, paidMinor, plannedMinor, committedMinor, flightReserveMinor, emergencyHeldMinor,
      allocatedMinor: runningSum + em.planMinor,
      unallocatedMinor: anchorTotal - runningSum - em.planMinor,
      freeMinor: anchorTotal - paidMinor - plannedMinor - committedMinor - flightReserveMinor - emergencyHeldMinor,
      freeBeforePlanMinor: anchorTotal - paidMinor - flightReserveBeforeMinor - Math.max(em.planMinor, emPaid),
      categories: ids.map(line),
      emergency,
    };
  }
  return {
    anchored: false,
    hasBudget: totalMinor > 0 || em.planMinor > 0,
    hasCategories,
    unconvertible: runningSum > 0 ? null : unconvertible,
    totalMinor, paidMinor, plannedMinor, committedMinor, flightReserveMinor, emergencyHeldMinor: 0,
    allocatedMinor: runningSum,
    unallocatedMinor: totalMinor - runningSum,
    freeMinor: totalMinor - paidMinor - plannedMinor - committedMinor - flightReserveMinor,
    freeBeforePlanMinor: totalMinor - paidMinor - flightReserveBeforeMinor,
    categories: ids.map(line),
    emergency,
  };
}

/** Trip days still ahead, today included, by the destination's calendar. null without trip dates. */
export function daysLeft(dates, today) {
  if (!dates || !isIsoDate(dates.start) || !isIsoDate(dates.end)) return null;
  const length = daysBetween(dates.start, dates.end) + 1;
  if (today < dates.start) return length;
  if (today > dates.end) return 0;
  return daysBetween(today, dates.end) + 1;
}

/** "Left for today": free money / days left, rounded down to a whole shekel. */
export function dailyAllowance(freeMinor, days) {
  if (days === null || days === undefined) return { kind: 'noDates' };
  if (days === 0) return { kind: 'after' };
  if (freeMinor < 0) return { kind: 'over', minor: freeMinor };
  return { kind: 'ok', minor: Math.floor(freeMinor / days / 100) * 100 };
}

/** Expenses matching every filter that is set. */
export const filterExpenses = (list = [], { date, category, destinationId } = {}) => list.filter((e) => (!date || e.date === date)
  && (!category || e.category === category) && (!destinationId || e.destinationId === destinationId));

/** Pie slices by category, biggest first. Angles in radians from 0 to 2*PI. */
export function pieSlices(list = []) {
  const totals = new Map();
  for (const e of list) totals.set(e.category, (totals.get(e.category) ?? 0) + e.baseMinor);
  const all = sumBy([...totals.values()], (v) => v);
  if (!all) return [];
  let start = 0;
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id, minor]) => {
    const fraction = minor / all;
    const slice = { id, minor, fraction, start, end: start + fraction * 2 * Math.PI };
    start = slice.end;
    return slice;
  });
}

/** One amount in every currency the rates know, through the base currency. [] if it cannot be converted. */
export function convertAll(minor, from, rates) {
  const r = rateToBase(from, rates);
  if (!Number.isInteger(minor) || minor <= 0 || !Number.isFinite(r)) return [];
  const base = minor * r;
  return currenciesFor(rates).map((c) => ({ currency: c, minor: c === from ? minor : Math.round(base / rateToBase(c, rates)) }));
}

/** An ATM withdrawal in local currency plus the bank's fee: total, the fee as a share, both in shekels too. */
export function atmCost(amountMinor, feeMinor, rates, currency = Object.keys(rates).map((k) => k.split('_')[1]).find((c) => c !== BASE_CURRENCY)) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || !Number.isInteger(feeMinor) || feeMinor < 0) return null;
  const r = rateToBase(currency, rates);
  if (!Number.isFinite(r)) return null;
  const totalMinor = amountMinor + feeMinor;
  return {
    totalMinor,
    feePct: Math.round((feeMinor / amountMinor) * 1000) / 10,
    totalBaseMinor: Math.round(totalMinor * r),
    feeBaseMinor: Math.round(feeMinor * r),
  };
}

/** "Is it worth it?": a purchase (in shekel agorot) against free money after planning, and the new daily amount. */
export function affordability(summary, priceMinor, days) {
  if (!Number.isInteger(priceMinor) || priceMinor <= 0) return null;
  const freeNowMinor = summary.freeMinor;
  const freeAfterMinor = freeNowMinor - priceMinor;
  return {
    freeNowMinor,
    freeAfterMinor,
    dailyNow: dailyAllowance(freeNowMinor, days),
    dailyAfter: dailyAllowance(freeAfterMinor, days),
    verdict: !summary.hasBudget ? 'noBudget' : freeAfterMinor >= 0 ? 'ok' : 'over',
  };
}

/** Rows to CSV for Excel: BOM (so Hebrew opens right), CRLF, quoted when needed, formulas neutralised. */
export function toCsv(rows) {
  const cell = (v) => {
    let x = String(v ?? '');
    // QP-2: a leading tab or CR too (OWASP CSV injection); a negative number stays a number
    if (/^[=+@\t\r]/.test(x) || (/^-/.test(x) && Number.isNaN(Number(x)))) x = `'${x}`;
    return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}


// ---------- Stage 9: daily base, moving money, names, hidden categories ----------

/**
 * Daily base: the budget without the flight, split over the trip's calendar dates (both ends included), in
 * whole agorot (rounded down). The emergency fund is never part of it. null without dates or categories.
 */
export function dailyBase(budget, dates) {
  const cats = budget?.categoriesMinor ?? {};
  if (!dates || !isIsoDate(dates.start) || !isIsoDate(dates.end)) return null;
  const days = daysBetween(dates.start, dates.end) + 1;
  const plan = (id) => (isMinor(cats[id]) ? cats[id] : 0);
  const base = budget?.anchor === ANCHOR_TOTAL && isMinor(budget?.totalMinor)
    ? budget.totalMinor - plan(FLIGHT) - plan(EMERGENCY) // 1.0.1: the typed total, less the flight and the emergency fund set aside
    : Object.entries(cats).filter(([k, v]) => k !== EMERGENCY && k !== FLIGHT && isMinor(v)).reduce((s, [, v]) => s + v, 0);
  if (!(days > 0) || base <= 0) return null;
  return Math.floor(base / days);
}

/** Move money from one category's plan to another's. The total stays the same; an impossible move changes nothing. */
export function moveBetween(budget, from, to, minor) {
  const cats = budget?.categoriesMinor ?? {};
  const have = isMinor(cats[from]) ? cats[from] : 0;
  if (from === to || !Number.isInteger(minor) || minor <= 0 || minor > have || from === EMERGENCY || to === EMERGENCY) return budget;
  return { ...budget, categoriesMinor: { ...cats, [from]: have - minor, [to]: (isMinor(cats[to]) ? cats[to] : 0) + minor } };
}

export const CATEGORY_NAME_MAX = 40;

/** A trip's own name for a category. The id never changes, so expenses stay in it. Empty name = back to the default. */
export function renameCategory(budget, id, name) {
  const value = String(name ?? '').trim().slice(0, CATEGORY_NAME_MAX);
  const names = { ...(budget?.categoryNames ?? {}) };
  if (value) names[id] = value; else delete names[id];
  return { ...budget, categoryNames: names };
}

/** The name to show: the trip's own name when it has one, else the pack's. */
export const categoryLabel = (budget, id, fallback) => budget?.categoryNames?.[id] || fallback;

/** Category ids to list. A hidden one shows again as soon as it has a plan or any expense: nothing is ever lost. */
export function visibleCategories(budget, expenses = [], ids = []) {
  const hidden = new Set(Array.isArray(budget?.hidden) ? budget.hidden : []);
  const plan = budget?.categoriesMinor ?? {};
  return ids.filter((id) => !hidden.has(id) || (isMinor(plan[id]) && plan[id] > 0) || expenses.some((e) => e?.category === id));
}


// ---------- 1.0.1 (owner, 2026-11-22): one total; the categories are an optional plan inside it ----------

/** The total as typed: whole shekels, commas only between thousands. Minor units, or NaN. */
export function parseWholeShekels(text) {
  const clean = String(text ?? '').trim().replace(/\s/g, '');
  if (!/^(\d{1,3}(,\d{3})+|\d+)$/.test(clean)) return NaN;
  const minor = Number(clean.replace(/,/g, '')) * 100;
  return minor > 0 && minor <= MAX_MINOR / 10 ? minor : NaN;
}

/** The budget with this total, in shekels, as the anchor. Categories, names, emergency and the rest stay. */
export const setTotal = (budget, minor) => ({ ...(budget ?? {}), totalMinor: minor, currency: BASE_CURRENCY, anchor: ANCHOR_TOTAL });

/**
 * A suggested split of the total over the pack's existing categories, by the ratios of the approved 20,000 template
 * (owner, 2026-11-22: a starting point only; everything stays editable). Whole shekels, rounded down; the rounding
 * rest goes to "misc" so it adds up exactly. A category the template has no amount for gets 0. No emergency share.
 * Nothing is saved here: the screen shows it, and only applySuggestion (an explicit approval) stores it.
 */
export function suggestSplit(totalMinor, pack) {
  const tpl = (pack?.budgetTemplates ?? []).find((x) => x.id === 'plan20k');
  const ids = (pack?.budgetCategories ?? []).map((c) => c.id).filter((id) => id !== EMERGENCY);
  const shares = Object.fromEntries(ids.map((id) => [id, Number(tpl?.categories?.[id]) > 0 ? Number(tpl.categories[id]) : 0]));
  const whole = Object.values(shares).reduce((a, v) => a + v, 0);
  const shekels = Number.isInteger(totalMinor) && totalMinor > 0 ? Math.floor(totalMinor / 100) : 0;
  const out = Object.fromEntries(ids.map((id) => [id, whole ? Math.floor((shekels * shares[id]) / whole) * 100 : 0]));
  const rest = shekels * 100 - Object.values(out).reduce((a, v) => a + v, 0);
  const sink = ids.includes('misc') ? 'misc' : ids[0];
  if (sink && rest > 0) out[sink] += rest;
  return out;
}

/** Approve a suggestion: it becomes the categories. The total, the anchor, the emergency amount and names stay. */
export function applySuggestion(budget, suggestion) {
  const cats = budget?.categoriesMinor ?? {};
  const em = isMinor(cats[EMERGENCY]) ? cats[EMERGENCY] : 0;
  return { ...(budget ?? {}), categoriesMinor: { ...suggestion, [EMERGENCY]: em }, profileId: null, estimate: true };
}

/** Load a profile or the template into a budget. A user's own emergency amount is never wiped; an anchored total stays. */
export function withProfile(budget, profile, locale = 'he') {
  const next = profileToBudget(profile, locale);
  const own = budget?.categoriesMinor?.[EMERGENCY];
  if (Number.isInteger(own) && own > 0) next.categoriesMinor[EMERGENCY] = own;
  const merged = { ...(budget ?? {}), ...next, currency: BASE_CURRENCY };
  if (budget?.anchor === ANCHOR_TOTAL && isMinor(budget?.totalMinor)) { merged.totalMinor = budget.totalMinor; merged.anchor = ANCHOR_TOTAL; }
  return merged;
}

/** The total in the trip's other currencies (from its rates: the country pack, rule G11), whole units, shown small under the shekel field. */
export function fxApprox(minor, rates) {
  const out = {};
  for (const c of currenciesFor(rates ?? {}).filter((x) => x !== BASE_CURRENCY)) {
    const r = rateToBase(c, rates ?? {});
    if (Number.isFinite(r) && r > 0 && Number.isInteger(minor)) out[c] = Math.round(minor / 100 / r);
  }
  return out;
}
