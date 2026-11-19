// Country data contract. Country facts live in data/countries/<id>.json, never in code.

export const REQUIRED_COUNTRY_FIELDS = ['id', 'names', 'currency', 'timeZone', 'dateFormatLocale'];

/**
 * Validate a country data object. Returns a list of problems; empty means valid.
 * @param {unknown} country
 * @returns {string[]}
 */
export function validateCountry(country) {
  if (!country || typeof country !== 'object') return ['country must be an object'];
  const errors = [];
  for (const field of REQUIRED_COUNTRY_FIELDS) {
    if (!(field in country)) errors.push(`missing field: ${field}`);
  }
  if ('currency' in country && !/^[A-Z]{3}$/.test(country.currency)) {
    errors.push('currency must be an ISO 4217 code, e.g. "USD"');
  }
  return errors;
}

/**
 * Build the page title from settings and data, e.g. "TISA — Experimental — <country>".
 * @param {{ appName: string, buildLabel: string }} config
 * @param {{ names: Record<string, string> }} country
 * @param {string} locale
 */
export function buildTitle(config, country, locale) {
  const { brand, place } = titleParts(config, country, locale);
  return [brand, place].join(TITLE_SEPARATOR);
}

export const TITLE_SEPARATOR = ' — ';

/**
 * Title split into the Latin brand part and the localized place name,
 * so the page can isolate each direction (avoids bidi mix-ups in RTL).
 */
export function titleParts(config, country, locale) {
  const brand = [config.appName, config.buildLabel].filter(Boolean).join(TITLE_SEPARATOR);
  const place = country.names[locale] ?? country.names.en ?? country.id;
  return { brand, place };
}
