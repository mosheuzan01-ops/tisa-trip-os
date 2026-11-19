// Browser-only loader for JSON settings and data. Paths are relative to index.html.

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return response.json();
}

export const loadConfig = () => loadJson('./config/app.config.json');
export const loadLocale = (locale) => loadJson(`./locales/${locale}.json`);
export const loadCountry = (id) => loadJson(`./data/countries/${id}.json`);
