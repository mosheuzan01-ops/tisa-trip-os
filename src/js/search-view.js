// 0.5.1 shared search box, used by the money and lists screens (one component, two places).
// Markup lives in index.html: <div class="search-bar" data-search="…"> with an input and a clear button.
// The box only reports the query; each screen decides which fields to search (core/search.js).

export function setupSearch(root, onChange) {
  const input = root.querySelector('[data-slot="search-input"]');
  const clear = root.querySelector('[data-action="search-clear"]');
  const sync = () => {
    root.dataset.query = input.value.trim();
    clear.hidden = input.value === '';
    onChange(input.value);
  };
  input.addEventListener('input', sync);
  input.addEventListener('search', sync); // the native clear (x) on some browsers
  clear.addEventListener('click', () => { input.value = ''; sync(); input.focus(); });
  root.dataset.query = '';
  clear.hidden = true;
  return { value: () => input.value };
}
