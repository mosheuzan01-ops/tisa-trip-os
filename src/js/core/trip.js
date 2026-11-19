// Trip setup logic: dates, countdown and budget. Pure functions, no DOM; tested in tests/trip.test.js.
// Dates are calendar dates as "YYYY-MM-DD" strings, never Date objects, so time zones cannot shift them.

export const MAX_TRIP_DAYS = 365;
const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse "YYYY-MM-DD" to a UTC timestamp, or NaN if it is not a real calendar date. */
function toUtc(iso) {
  const m = ISO_DATE.exec(String(iso ?? ''));
  if (!m) return NaN;
  const [y, mo, d] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : NaN;
}

export const isIsoDate = (iso) => Number.isFinite(toUtc(iso));

/** Today's calendar date at the destination ("YYYY-MM-DD"). */
export function todayIn(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole calendar days from a to b (negative if b is earlier). */
export function daysBetween(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Where today sits relative to the trip. Days are counted inclusively (one-day trip = 1 day). */
export function tripStatus(dates, today) {
  if (!dates || !isIsoDate(dates.start) || !isIsoDate(dates.end)) return { phase: 'unset' };
  const length = daysBetween(dates.start, dates.end) + 1;
  const fromStart = daysBetween(dates.start, today);
  if (fromStart < 0) return { phase: 'before', daysToGo: -fromStart, length };
  if (fromStart < length) return { phase: 'during', day: fromStart + 1, length };
  return { phase: 'after', length };
}

/** Problems with a date range, as message keys. Empty array = valid. */
export function validateDates({ start, end } = {}) {
  const errors = [];
  if (!start) errors.push('start.missing');
  else if (!isIsoDate(start)) errors.push('start.invalid');
  if (!end) errors.push('end.missing');
  else if (!isIsoDate(end)) errors.push('end.invalid');
  if (errors.length) return errors;
  const span = daysBetween(start, end);
  if (span < 0) return ['end.beforeStart'];
  if (span + 1 > MAX_TRIP_DAYS) return ['range.tooLong'];
  return [];
}

/** Turn user text such as "12,500.50" into a number; NaN if it is not a usable amount. */
export function parseAmount(text) {
  const clean = String(text ?? '').replace(/[\s,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return NaN;
  const n = Number(clean);
  return n > 0 && n <= 1e12 ? n : NaN;
}

/** Problems with a budget entry, as message keys. */
export function validateBudget({ amount, currency } = {}, allowedCurrencies = []) {
  const errors = [];
  if (amount === undefined || amount === null || String(amount).trim() === '') errors.push('amount.missing');
  else if (!Number.isFinite(parseAmount(amount))) errors.push('amount.invalid');
  if (!allowedCurrencies.includes(currency)) errors.push('currency.invalid');
  return errors;
}

const cents = (n) => Math.round(Number(n) * 100);

/** Budget totals. Spent is only what was recorded; nothing is estimated. */
export function budgetSummary(budget, expenses = []) {
  if (!budget || !Number.isFinite(Number(budget.amount))) return null;
  const total = cents(budget.amount);
  const spent = expenses.reduce((sum, e) => sum + cents(e.amount), 0);
  return { total: total / 100, spent: spent / 100, left: (total - spent) / 100, currency: budget.currency };
}

export function setupProgress(trip = {}) {
  const dates = validateDates(trip.dates ?? {}).length === 0;
  const budget = Boolean(trip.budget && Number(trip.budget.amount) > 0 && trip.budget.currency);
  return { done: Number(dates) + Number(budget), total: 2, dates, budget };
}
