// Stage 12 PR 1 (0.11.0): one info button component, used in every place (core/tips.js lists them).
// A small button next to the term; a tap or Enter opens one shared sheet (#dlg-tip) with a short text from locales.
// Closing: tap outside, Esc, or the close button; focus goes back to the button. A modal dialog, so only one is open.
// Offline: the icon is in assets/icons.svg and the texts are in the locale file. No network.
import { interpolate } from './core/i18n.js';
import { isTipKey } from './core/tips.js';

const ICON = './assets/icons.svg#i-info';

/** Give a button (new or from index.html) its icon and its accessible name. */
function dress(btn, t) {
  const key = btn.dataset.tip;
  btn.type = 'button';
  btn.classList.add('tip-btn');
  btn.setAttribute('aria-label', interpolate(t('tip.label'), { name: t(`tip.${key}.name`) }));
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-controls', 'dlg-tip');
  btn.setAttribute('aria-expanded', 'false');
  if (!btn.firstElementChild) btn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICON}"/></svg>`;
  return btn;
}

/** An info button for a screen that draws its own rows. */
export function tipButton(t, key) {
  if (!isTipKey(key)) throw new Error(`Unknown tip: ${key}`);
  const btn = document.createElement('button');
  btn.dataset.tip = key;
  return dress(btn, t);
}

export function setupTips(ctx, { wireDialog }) {
  const { t } = ctx;
  const dlg = document.getElementById('dlg-tip');
  if (!dlg) return;
  const title = dlg.querySelector('#dlg-tip-title');
  const text = dlg.querySelector('#dlg-tip-text');
  let opener = null;
  let openKey = null;
  for (const btn of document.querySelectorAll('button[data-tip]')) dress(btn, t);

  wireDialog(dlg, () => {
    if (opener) opener.setAttribute('aria-expanded', 'false');
    // A screen may have been redrawn while the sheet was open: then go back to the same tip on the screen.
    const back = opener?.isConnected ? opener : [...document.querySelectorAll(`button[data-tip="${openKey}"]`)].find((b) => b.offsetParent);
    back?.focus();
    opener = null;
    openKey = null;
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('button[data-tip]');
    if (!btn || !isTipKey(btn.dataset.tip)) return;
    e.preventDefault();
    if (dlg.open) dlg.close();
    opener = btn;
    openKey = btn.dataset.tip;
    title.textContent = t(`tip.${openKey}.name`);
    text.textContent = t(`tip.${openKey}.text`);
    btn.setAttribute('aria-expanded', 'true');
    dlg.showModal();
    dlg.querySelector('[data-close]').focus();
  });
}
