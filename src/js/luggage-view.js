// Stage 6.0e luggage screen (core/luggage.js), opened from the lists; the lists tab stays lit.
// One card per bag: total, the user's limit (or "no limit set yet"), how much is left, and a calm red line when over.
// Items are typed by hand (name, weight, bag); the packing list is not touched. All copy from locales.
import { interpolate } from './core/i18n.js';
import {
  validateBag, validateLuggageItem, makeBag, makeLuggageItem, bagStatus, saveBag, removeBag, saveItem, removeItem, cleanBags,
} from './core/luggage.js';
import { makeId } from './core/ids.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Grams as kg for the locale ("2.2 ק״ג"), with Intl's own unit; up to 3 decimals, none added. */
export const formatKg = (grams, locale) => new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilogram', maximumFractionDigits: 3 }).format(grams / 1000);

const iconButton = (icon, label, action, id) => {
  const b = el('button', 'icon-btn stop-btn');
  b.type = 'button';
  b.dataset.action = action;
  b.dataset.id = id;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${icon}"/></svg>`;
  return b;
};

export function renderLuggage(ctx) {
  const panel = $('#panel-luggage');
  if (!panel) return;
  const { t, fmtLocale } = ctx;
  const kg = (g) => formatKg(g, fmtLocale);
  const bags = cleanBags(ctx.trip().luggage);
  $('[data-slot="luggage-empty"]').hidden = bags.length > 0;
  const box = $('[data-slot="bags"]');
  const focused = box.contains(document.activeElement) ? [document.activeElement.dataset.action, document.activeElement.dataset.id] : null;
  box.replaceChildren(...bags.map((b) => {
    const st = bagStatus(b);
    const card = el('section', `card surface bag is-${st.state}`);
    card.dataset.id = b.id;
    const head = el('div', 'item-top');
    const title = el('h2', 'bag-name', b.name);
    title.id = `bag-${b.id}`;
    card.setAttribute('aria-labelledby', title.id);
    const actions = el('div', 'stop-actions row-actions');
    actions.append(
      iconButton('i-edit', interpolate(t('lug.bag.editLabel'), { name: b.name }), 'bag-edit', b.id),
      iconButton('i-trash', interpolate(t('lug.bag.deleteLabel'), { name: b.name }), 'bag-delete', b.id),
    );
    head.append(title, actions);
    card.append(head);

    const line = el('p', 'bag-status');
    line.dataset.slot = 'bag-status';
    line.textContent = st.state === 'noLimit'
      ? interpolate(t('lug.totalNoLimit'), { total: kg(st.totalGrams) })
      : `${interpolate(t('lug.total'), { total: kg(st.totalGrams), limit: kg(st.limitGrams) })}${st.state === 'ok' ? ` · ${interpolate(t('lug.left'), { left: kg(st.leftGrams) })}` : ''}`;
    card.append(line);
    if (st.limitGrams !== null) {
      const meter = el('span', 'mini-meter bag-meter');
      meter.setAttribute('aria-hidden', 'true');
      const fill = el('span', 'mini-fill');
      fill.style.width = `${Math.min(100, Math.floor((st.totalGrams / st.limitGrams) * 100))}%`;
      meter.append(fill);
      card.append(meter);
    }
    if (st.state === 'over') card.append(el('p', 'bag-over', interpolate(t('lug.over'), { over: kg(st.overGrams) })));

    if (b.items.length) {
      const ul = el('ul', 'bag-items');
      for (const x of b.items) {
        const li = el('li', 'bag-item');
        li.append(el('span', 'bag-item-name', x.name), el('span', 'bag-item-kg', kg(x.grams)));
        const acts = el('div', 'stop-actions row-actions');
        acts.append(
          iconButton('i-edit', interpolate(t('lug.item.editLabel'), { name: x.name }), 'luggage-item-edit', x.id),
          iconButton('i-trash', interpolate(t('lug.item.deleteLabel'), { name: x.name }), 'luggage-item-delete', x.id),
        );
        li.append(acts);
        ul.append(li);
      }
      card.append(ul);
    } else {
      card.append(el('p', 'muted', t('lug.noItems')));
    }
    const add = el('button', 'btn btn-ghost btn-small bag-add-item');
    add.type = 'button';
    add.dataset.action = 'luggage-item-add';
    add.dataset.id = b.id;
    add.setAttribute('aria-label', interpolate(t('lug.addItemLabel'), { bag: b.name }));
    add.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}i-plus"/></svg>`;
    add.append(el('span', '', t('lug.addItem')));
    card.append(add);
    return card;
  }));
  if (focused) box.querySelector(`[data-action="${focused[0]}"][data-id="${focused[1]}"]`)?.focus();
}

export function setupLuggage(ctx, { wireDialog, showFormErrors }) {
  const panel = $('#panel-luggage');
  if (!panel) return;
  const { t } = ctx;
  let opener = null;
  const restore = () => { (opener?.isConnected ? opener : panel.querySelector('[data-action="bag-add"]')).focus(); };
  const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
  const bags = () => cleanBags(ctx.trip().luggage);
  const findItem = (id) => { for (const b of bags()) { const x = b.items.find((i) => i.id === id); if (x) return { item: x, bag: b }; } return null; };
  const commit = (fn, message) => {
    const result = ctx.change((st) => { const trip = st.trips[st.activeTripId]; trip.luggage = fn(trip.luggage && Array.isArray(trip.luggage.bags) ? trip.luggage : { bags: [] }); }, { now: true });
    ctx.toast(result?.ok ? message : 'form.saveFailed');
  };
  const kgInput = (grams) => String(grams / 1000);

  // ---------- Bag ----------
  const dlgBag = $('#dlg-bag');
  const bForm = $('[data-form="bag"]');
  let editingBag = null;
  wireDialog(dlgBag, restore);
  function openBag(b, from) {
    opener = from;
    editingBag = b;
    bForm.reset();
    showFormErrors(t, bForm, [], 'bagErr');
    $('[data-slot="bag-title"]').textContent = t(b ? 'lug.bag.editTitle' : 'lug.bag.addTitle');
    if (b) { bForm.name.value = b.name; bForm.limit.value = b.limitGrams === null ? '' : kgInput(b.limitGrams); }
    dlgBag.showModal();
    bForm.name.focus();
  }
  bForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = { name: bForm.name.value, limit: bForm.limit.value };
    const errors = validateBag(input);
    if (errors.length) { showFormErrors(t, bForm, errors, 'bagErr'); return; }
    const next = makeBag(input, () => makeId(), editingBag);
    commit((lug) => saveBag(lug, next), 'lug.bag.saved');
    opener = panel.querySelector(`[data-action="bag-edit"][data-id="${next.id}"]`) ?? opener;
    dlgBag.close();
  });

  // ---------- Item ----------
  const dlgItem = $('#dlg-luggage-item');
  const iForm = $('[data-form="luggage-item"]');
  let editingItem = null;
  wireDialog(dlgItem, restore);
  function openItem(found, bagId, from) {
    opener = from;
    editingItem = found?.item ?? null;
    iForm.reset();
    showFormErrors(t, iForm, [], 'lugItemErr');
    $('[data-slot="luggage-item-title"]').textContent = t(found ? 'lug.item.editTitle' : 'lug.item.addTitle');
    $('[data-slot="luggage-item-bag"]').replaceChildren(...bags().map((b) => option(b.id, b.name)));
    iForm.bagId.value = found?.bag.id ?? bagId;
    if (found) { iForm.name.value = found.item.name; iForm.weight.value = kgInput(found.item.grams); }
    dlgItem.showModal();
    iForm.name.focus();
  }
  iForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = { name: iForm.name.value, weight: iForm.weight.value, bagId: iForm.bagId.value };
    const errors = validateLuggageItem(input, bags().map((b) => b.id));
    if (errors.length) { showFormErrors(t, iForm, errors, 'lugItemErr'); return; }
    const next = makeLuggageItem(input, () => makeId(), editingItem);
    commit((lug) => saveItem(lug, next, input.bagId), 'lug.item.saved');
    opener = panel.querySelector(`[data-action="luggage-item-edit"][data-id="${next.id}"]`) ?? opener;
    dlgItem.close();
  });

  // ---------- Delete, after a yes ----------
  const dlgDel = $('#dlg-luggage-delete');
  let onYes = null;
  wireDialog(dlgDel, () => { onYes = null; restore(); });
  $('[data-action="luggage-delete-yes"]').addEventListener('click', () => {
    if (onYes) onYes();
    opener = panel.querySelector('[data-action="bag-add"]');
    dlgDel.close();
  });
  function ask(from, text, fn) {
    opener = from;
    onYes = fn;
    $('[data-slot="luggage-delete-text"]').textContent = text;
    dlgDel.showModal();
    dlgDel.querySelector('[data-close]').focus();
  }

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'bag-add') openBag(null, btn);
    if (action === 'bag-edit') openBag(bags().find((b) => b.id === id), btn);
    if (action === 'luggage-item-add') openItem(null, id, btn);
    if (action === 'luggage-item-edit') openItem(findItem(id), null, btn);
    if (action === 'bag-delete') {
      const b = bags().find((x) => x.id === id);
      if (!b) return;
      const n = b.items.length;
      const items = n === 1 ? t('lug.items.one') : interpolate(t('lug.items.other'), { n });
      ask(btn, interpolate(t(n ? 'lug.delete.bag' : 'lug.delete.bagEmpty'), { name: b.name, items }), () => commit((lug) => removeBag(lug, id), 'lug.deleted'));
    }
    if (action === 'luggage-item-delete') {
      const found = findItem(id);
      if (!found) return;
      ask(btn, interpolate(t('lug.delete.item'), { name: found.item.name }), () => commit((lug) => removeItem(lug, id), 'lug.deleted'));
    }
  });
}
