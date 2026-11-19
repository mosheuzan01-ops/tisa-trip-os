// Translation helpers. Pure functions: no DOM, no fetch, so Node tests can import them.

/**
 * Create a translator over one locale dictionary.
 * A missing key returns the key itself, so gaps are visible instead of silent.
 * @param {Record<string, string>} dict
 * @returns {(key: string) => string}
 */
export function createTranslator(dict) {
  return (key) => (Object.hasOwn(dict, key) ? dict[key] : key);
}

/**
 * Pick a supported locale, falling back to the default.
 * @param {string | undefined} requested
 * @param {{ defaultLocale: string, supportedLocales: string[] }} config
 */
export function resolveLocale(requested, config) {
  return config.supportedLocales.includes(requested) ? requested : config.defaultLocale;
}

/** Replace {name} placeholders. Unknown names stay visible so gaps are easy to spot. */
export function interpolate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (all, name) => (Object.hasOwn(values, name) ? String(values[name]) : all));
}
