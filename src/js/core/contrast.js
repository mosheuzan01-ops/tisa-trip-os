// Pure helpers for the design system: WCAG 2 contrast and theme-variable parsing. No DOM.

function channels(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`expected a 3- or 6-digit hex color, got "${hex}"`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two opaque hex colors (1 to 21). */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 1e6) / 1e6;
}

/** Read `[data-theme="name"] { --var: value; }` blocks into { theme: { var: value } }. */
export function parseThemes(css) {
  const themes = {};
  for (const block of css.matchAll(/\[data-theme="([\w-]+)"\][^{]*\{([^}]*)\}/g)) {
    const theme = (themes[block[1]] ??= {});
    for (const decl of block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) theme[decl[1]] = decl[2].trim();
  }
  return themes;
}
