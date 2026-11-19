// Expense split between travellers (Stage 4 add-on). Pure functions, whole agorot only.
// An expense can say who paid (paidBy) and who shares it (sharedBy). Only paid expenses count.
// Tested in tests/money-tools.test.js.

export const PERSON_MAX = 30;

export function validatePerson(name, people = []) {
  const n = String(name ?? '').trim();
  if (!n) return ['name.missing'];
  if (n.length > PERSON_MAX) return ['name.tooLong'];
  if (people.some((p) => p.name.trim() === n)) return ['name.taken'];
  return [];
}

/** Equal shares in whole agorot. The leftover agorot go to the first sharers, so the shares add up exactly. */
export function splitShares(minor, ids = []) {
  if (!ids.length) return {};
  const base = Math.floor(minor / ids.length);
  let left = minor - base * ids.length;
  const out = {};
  for (const id of ids) { out[id] = base + (left > 0 ? 1 : 0); if (left > 0) left -= 1; }
  return out;
}

export const SPLIT_MODES = ['equal', 'percent', 'amount'];

/** Split `total` in proportion to whole-number weights; leftover agorot go to the biggest remainders. Exact sum. */
function proportional(total, weights) {
  const ids = Object.keys(weights);
  const sum = ids.reduce((a, id) => a + weights[id], 0);
  if (!sum) return {};
  const raw = ids.map((id) => [id, (total * weights[id]) / sum]);
  const out = Object.fromEntries(raw.map(([id, v]) => [id, Math.floor(v)]));
  let left = total - Object.values(out).reduce((a, v) => a + v, 0);
  const order = raw.map(([id, v], i) => [id, v - Math.floor(v), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  for (const [id] of order) { if (left <= 0) break; out[id] += 1; left -= 1; }
  return out;
}

/**
 * Each person's share of an expense, in shekel agorot (exact sum), or null if the expense is not split.
 * equal: sharedBy (0.4.1 data). percent: shares in hundredths of a percent (7000 = 70%).
 * amount: shares in the expense's own currency minor units, converted in proportion to its shekel value.
 */
export function expenseShares(e) {
  if (!e || !Number.isInteger(e.baseMinor)) return null;
  const mode = e.split?.mode;
  if ((mode === 'percent' || mode === 'amount') && e.split.shares && Object.keys(e.split.shares).length) {
    return proportional(e.baseMinor, e.split.shares);
  }
  if (Array.isArray(e.sharedBy) && e.sharedBy.length) return splitShares(e.baseMinor, e.sharedBy);
  return null;
}

/** Problems with a split form. values: percent in hundredths, or amounts in the expense currency's minor units. */
export function validateSplit(mode, values = {}, amountMinor = 0) {
  if (mode === 'equal') return Object.keys(values).length ? [] : ['shares.none'];
  const v = Object.values(values);
  if (!v.length) return ['shares.none'];
  if (v.some((x) => !Number.isInteger(x) || x < 0)) return ['value.invalid'];
  const sum = v.reduce((a, x) => a + x, 0);
  if (mode === 'percent' && sum !== 10000) return ['percent.sum'];
  if (mode === 'amount' && sum !== amountMinor) return ['amount.sum'];
  return [];
}

/**
 * What each person is owed (+) or owes (-), after recorded repayments.
 * Only paid expenses count. Anything with an unknown person is skipped, never guessed.
 */
export function balances(expenses = [], people = [], repayments = []) {
  const known = new Set(people.map((p) => p.id));
  const bal = Object.fromEntries(people.map((p) => [p.id, 0]));
  for (const e of expenses) {
    if (e?.status !== 'paid' || !known.has(e.paidBy)) continue;
    const shares = expenseShares(e);
    if (!shares || !Object.keys(shares).every((id) => known.has(id))) continue;
    bal[e.paidBy] += e.baseMinor;
    for (const [id, share] of Object.entries(shares)) bal[id] -= share;
  }
  for (const r of repayments) {
    if (!known.has(r?.from) || !known.has(r?.to) || !Number.isInteger(r.minor) || r.minor <= 0) continue;
    bal[r.from] += r.minor;
    bal[r.to] -= r.minor;
  }
  return bal;
}

/** Who pays whom: the biggest debt goes to the biggest credit first. */
export function settle(bal) {
  const debtors = Object.entries(bal).filter(([, v]) => v < 0).map(([id, v]) => [id, -v]).sort((a, b) => b[1] - a[1]);
  const creditors = Object.entries(bal).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const minor = Math.min(debtors[i][1], creditors[j][1]);
    out.push({ from: debtors[i][0], to: creditors[j][0], minor });
    debtors[i][1] -= minor;
    creditors[j][1] -= minor;
    if (debtors[i][1] === 0) i += 1;
    if (creditors[j][1] === 0) j += 1;
  }
  return out;
}
