// 0.5.1 text search, shared by the money and lists screens. Pure functions, no DOM.
// Case-insensitive, partial (substring) match; no fuzzy matching. Tested in tests/search.test.js.

export const normalize = (s) => String(s ?? '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** True when the query appears inside any of the fields (joined with spaces). An empty query matches. */
export function matches(fields, query) {
  const q = normalize(query);
  if (!q) return true;
  return normalize(fields.filter((f) => f !== null && f !== undefined).join(' ')).includes(q);
}

/** The items whose fields match, in their original order. */
export const searchList = (list, query, toFields) => list.filter((x) => matches(toFields(x), query));

/** Sum of the shown expenses in shekel agorot (whole numbers). */
export const sumBase = (list) => list.reduce((s, e) => s + e.baseMinor, 0);
