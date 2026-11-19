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

/** What each person is owed (+) or owes (-). Expenses with unknown people are skipped, never guessed. */
export function balances(expenses = [], people = []) {
  const known = new Set(people.map((p) => p.id));
  const bal = Object.fromEntries(people.map((p) => [p.id, 0]));
  for (const e of expenses) {
    if (e?.status !== 'paid' || !known.has(e.paidBy) || !Array.isArray(e.sharedBy) || !e.sharedBy.length) continue;
    if (!e.sharedBy.every((id) => known.has(id)) || !Number.isInteger(e.baseMinor)) continue;
    bal[e.paidBy] += e.baseMinor;
    for (const [id, share] of Object.entries(splitShares(e.baseMinor, e.sharedBy))) bal[id] -= share;
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
