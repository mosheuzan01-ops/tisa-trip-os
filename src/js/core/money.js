// Stage 4 money logic: budget, expenses, planning rates, "free" and "left for today". Pure functions, no DOM.
// Every amount is a whole number of minor units (agorot / satang): no floating-point money anywhere.
// An expense keeps its original amount, currency and the rate of the day it was entered, so later rate
// changes never rewrite history. Tested in tests/money.test.js.
import { isIsoDate, daysBetween } from './trip.js';

export const EMERGENCY = 'emergency';
export const BASE_CURRENCY = 'ILS';
export const STATUSES = ['paid', 'planned', 'committed'];
export const METHODS = ['cash', 'card', 'transfer', 'other'];
export const DESCRIPTION_MAX = 80;
export const NOTE_MAX = 140;
const MAX_MINOR = 1e12;

/** "1,234.56" -> 123456. NaN for anything that is not a positive amount with at most two decimals. */
export function parseMoney(text) {
  const clean = String(text ?? '').replace(/[\s,]/g, '');
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
  return out;
}

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
export function profileToBudget(profile) {
  const categoriesMinor = {};
  for (const [k, v] of Object.entries(profile.categories)) categoriesMinor[k] = toMinor(v);
  categoriesMinor[EMERGENCY] = toMinor(profile.emergency ?? 0); // owner: about one flight ticket (2026-11-19)
  return { currency: profile.currency, totalMinor: null, categoriesMinor, profileId: profile.id, estimate: true };
}

const isMinor = (v) => Number.isInteger(v) && v >= 0;
const sumBy = (list, pick) => list.reduce((s, x) => s + pick(x), 0);

/**
 * The whole money picture, in shekel minor units.
 * Running budget = the eight categories (or the home total while there are no categories). Emergency is separate.
 * paid + planned + committed + free = running budget, exactly.
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
  const totalMinor = running.length ? sumBy(running, ([, v]) => v) : homeTotal;
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
    return { id, planMinor, usedMinor, leftMinor: planMinor - usedMinor, over: usedMinor > planMinor };
  };
  const ids = [...new Set([...Object.keys(cats), ...list.map((e) => e.category)])].filter((k) => k !== EMERGENCY);
  const em = line(EMERGENCY);
  return {
    hasBudget: totalMinor > 0 || hasCategories,
    hasCategories,
    unconvertible: running.length ? null : unconvertible,
    totalMinor, paidMinor, plannedMinor, committedMinor,
    freeMinor: totalMinor - paidMinor - plannedMinor - committedMinor,
    freeBeforePlanMinor: totalMinor - paidMinor,
    categories: ids.map(line),
    emergency: { planMinor: em.planMinor, usedMinor: em.usedMinor, leftMinor: em.leftMinor, over: em.over },
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
    if (/^[=+@]/.test(x) || (/^-/.test(x) && Number.isNaN(Number(x)))) x = `'${x}`;
    return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
