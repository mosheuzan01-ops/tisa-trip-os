// Brand kit page: renders swatches from the live tokens and clones real components from index.html,
// so the kit always shows exactly what the app ships.
const ICON_FILE = './assets/icons.svg';

const GROUPS = [
  ['בסיס', ['--bg', '--surface', '--surface-2', '--line', '--ink', '--muted', '--title', '--accent', '--focus']],
  ['מתכות כהות (גוון לכל משטח)', ['--m-today-2', '--m-setup-2', '--m-t1-2', '--m-t2-2', '--m-t3-2', '--m-t4-2', '--m-nav-2', '--on-dmetal', '--on-dmetal-muted']],
  ['פלטינה-זהב', ['--metal-1', '--metal-2', '--metal-3', '--metal-4', '--metal-5', '--metal-6', '--metal-7', '--metal-ink']],
  ['שקיעה וים', ['--sky-1', '--sky-2', '--sky-3', '--sky-4', '--sea-2', '--sea-3', '--sun-core', '--rock-1', '--rim']],
];

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function contexts(host) {
  return ['light', 'dark'].map((theme) => {
    const ctx = el('div', 'bk-ctx');
    ctx.dataset.theme = theme;
    ctx.append(el('span', 'bk-ctx-label ltr', theme.toUpperCase()));
    host.append(ctx);
    return ctx;
  });
}

function renderSwatches() {
  const host = document.querySelector('[data-swatches]');
  for (const ctx of contexts(host)) {
    for (const [title, names] of GROUPS) {
      const group = el('div', 'bk-group');
      const grid = el('div', 'bk-swatches');
      group.append(el('span', 'bk-group-title', title), grid);
      for (const name of names) {
        const chip = el('span', 'bk-chip');
        chip.style.background = `var(${name})`;
        const sw = el('div', 'bk-swatch');
        const value = el('span', 'ltr');
        sw.append(chip, el('b', 'ltr', name.slice(2)), value);
        grid.append(sw);
        requestAnimationFrame(() => { value.textContent = getComputedStyle(ctx).getPropertyValue(name).trim(); });
      }
      ctx.append(group);
    }
  }
}

async function renderIcons() {
  const host = document.querySelector('[data-icons]');
  const svg = await (await fetch(ICON_FILE)).text();
  const ids = [...svg.matchAll(/<symbol id="([\w-]+)"/g)].map((m) => m[1]);
  for (const id of ids) {
    const cell = el('div', 'bk-icon');
    cell.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICON_FILE}#${id}"/></svg>`;
    cell.append(el('span', 'ltr', id.replace(/^i-/, '')));
    host.append(cell);
  }
}

async function renderSpecimens() {
  const html = await (await fetch('./index.html')).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const host of document.querySelectorAll('[data-clone]')) {
    const source = doc.querySelector(host.dataset.clone);
    if (!source) continue;
    for (const ctx of contexts(host)) {
      const copy = document.importNode(source, true);
      // Demo copies: keep ids unique and keep them out of the tab order.
      for (const node of [copy, ...copy.querySelectorAll('[id]')]) {
        if (!node.matches('linearGradient, radialGradient')) node.removeAttribute('id');
      }
      for (const node of copy.querySelectorAll('[aria-controls]')) node.removeAttribute('aria-controls');
      for (const node of [copy, ...copy.querySelectorAll('button, a')]) if (node.matches('button, a')) node.tabIndex = -1;
      // Same gradient ids in every copy: scope them so each scene keeps its own.
      const suffix = `-${ctx.dataset.theme}-${Math.random().toString(36).slice(2, 7)}`;
      for (const grad of copy.querySelectorAll('linearGradient[id], radialGradient[id]')) {
        const id = grad.id;
        grad.id = id + suffix;
        for (const user of copy.querySelectorAll(`[fill="url(#${id})"], [stroke="url(#${id})"]`)) {
          for (const attr of ['fill', 'stroke']) if (user.getAttribute(attr) === `url(#${id})`) user.setAttribute(attr, `url(#${id}${suffix})`);
        }
      }
      ctx.append(copy);
    }
  }
  const [country] = await Promise.all([fetch('./config/app.config.json').then((r) => r.json())
    .then((c) => fetch(`./data/countries/${c.activeCountry}.json`)).then((r) => r.json())]);
  for (const n of document.querySelectorAll('[data-slot="country"]')) n.textContent = country.names.he;
  for (const n of document.querySelectorAll('[data-slot="country-latin"]')) n.textContent = country.names.en;
  for (const pass of document.querySelectorAll('.bk-ctx .pass')) {
    pass.tabIndex = 0;
    pass.addEventListener('click', () => pass.setAttribute('aria-pressed', String(pass.getAttribute('aria-pressed') !== 'true')));
  }
}

renderSwatches();
renderIcons().catch((e) => console.warn('[TISA brand] icons:', e.message));
renderSpecimens().catch((e) => console.warn('[TISA brand] specimens:', e.message));
