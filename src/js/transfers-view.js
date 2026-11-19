// 0.5.3 flights and transfers screen: everything entered by hand. A price keeps one linked expense in step
// (core/transfers.js), and each stop on the itinerary lists the transfers on its days. All copy from locales.
import { interpolate } from './core/i18n.js';
import {
  KINDS, TRANSFER_STATUSES, validateTransfer, saveTransfer, removeTransfer, sortTransfers,
} from './core/transfers.js';
import { currenciesFor } from './core/money.js';
import { formatDate } from './core/itinerary.js';
import { moneyState, formatMinor } from './money-view.js';
import { makeId } from './core/ids.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const cleanTransfers = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x.id === 'string' && KINDS.includes(x.kind)) : []);
export const routeText = (t, x) => interpolate(t('transfer.route'), { from: x.from, to: x.to });

export function renderTransfers(ctx) {
  const panel = $('#panel-transfers');
  if (!panel) return;
  const { t, fmtLocale } = ctx;
  const list = sortTransfers(cleanTransfers(ctx.trip().transfers));
  $('[data-slot="transfers-empty"]').hidden = list.length > 0;
  const box = $('[data-slot="transfer-list"]');
  const focused = box.contains(document.activeElement) ? [document.activeElement.dataset.action, document.activeElement.dataset.id] : null;
  box.replaceChildren(...list.map((x) => {
    const li = el('li', `transfer surface is-${x.status}`);
    li.dataset.id = x.id;
    const top = el('div', 'item-top');
    const kind = el('span', 'transfer-kind');
    kind.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${x.kind === 'flight' ? 'i-plane' : 'i-route'}"/></svg>`;
    kind.append(el('span', 'sr-only', t(`transfer.kind.${x.kind}`)));
    top.append(kind, el('span', 'transfer-route', routeText(t, x)), el('span', `badge transfer-status`, t(`transfer.status.${x.status}`)));
    const actions = el('div', 'stop-actions row-actions');
    for (const [icon, label, action] of [['i-edit', 'transfer.editLabel', 'transfer-edit'], ['i-trash', 'transfer.deleteLabel', 'transfer-delete']]) {
      const b = el('button', 'icon-btn stop-btn');
      b.type = 'button';
      b.dataset.action = action;
      b.dataset.id = x.id;
      b.setAttribute('aria-label', interpolate(t(label), { route: routeText(t, x) }));
      b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${icon}"/></svg>`;
      actions.append(b);
    }
    top.append(actions);
    const meta = el('p', 'exp-meta');
    meta.append(el('span', '', formatDate(x.date, fmtLocale)), el('span', x.time ? 'ltr' : 'muted', x.time || t('transfer.timeNone')), el('span', '', t(`transfer.kind.${x.kind}`)));
    if (x.company) meta.append(el('span', '', x.company));
    if (x.booking) meta.append(el('span', '', interpolate(t('transfer.bookingShort'), { booking: x.booking })));
    if (Number.isInteger(x.priceMinor)) meta.append(el('span', 'ltr transfer-price', formatMinor(x.priceMinor, x.currency, fmtLocale)));
    li.append(top, meta);
    if (x.note) li.append(el('p', 'item-note', x.note));
    if (x.link) {
      const a = el('a', 'transfer-link', t('transfer.openLink'));
      a.href = x.link; // typed by the user; validated as http(s) only
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.append(a);
    }
    return li;
  }));
  if (focused) box.querySelector(`[data-action="${focused[0]}"][data-id="${focused[1]}"]`)?.focus();
}

export function setupTransfers(ctx, { wireDialog, showFormErrors }) {
  const panel = $('#panel-transfers');
  if (!panel) return;
  const { t } = ctx;
  let opener = null;
  const restore = () => { (opener?.isConnected ? opener : panel.querySelector('[data-action="transfer-add"]')).focus(); };
  const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
  const list = () => cleanTransfers(ctx.trip().transfers);

  const dlg = $('#dlg-transfer');
  const form = $('[data-form="transfer"]');
  let editing = null;
  wireDialog(dlg, restore);
  function open(x, from) {
    opener = from;
    editing = x;
    form.reset();
    showFormErrors(t, form, [], 'transferErr');
    $('[data-slot="transfer-title"]').textContent = t(x ? 'transfer.editTitle' : 'transfer.addTitle');
    $('[data-slot="transfer-kind"]').replaceChildren(...KINDS.map((k) => option(k, t(`transfer.kind.${k}`))));
    $('[data-slot="transfer-status"]').replaceChildren(...Object.keys(TRANSFER_STATUSES).map((k) => option(k, t(`transfer.status.${k}`))));
    const currencies = currenciesFor(moneyState(ctx).rates);
    $('[data-slot="transfer-currency"]').replaceChildren(...currencies.map((c) => option(c, c)));
    if (x) {
      for (const k of ['kind', 'from', 'to', 'date', 'time', 'company', 'booking', 'currency', 'link', 'status', 'note']) form[k].value = x[k] ?? '';
      form.price.value = Number.isInteger(x.priceMinor) ? (x.priceMinor / 100).toFixed(x.priceMinor % 100 ? 2 : 0) : '';
    } else {
      form.kind.value = 'flight';
      form.status.value = 'planned';
      form.currency.value = currencies[0];
    }
    dlg.showModal();
    form.from.focus();
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const m = moneyState(ctx);
    const input = Object.fromEntries(['kind', 'from', 'to', 'date', 'time', 'company', 'booking', 'price', 'currency', 'link', 'status', 'note'].map((k) => [k, form[k].value]));
    const errors = validateTransfer(input, currenciesFor(m.rates));
    if (errors.length) { showFormErrors(t, form, errors, 'transferErr'); return; }
    let savedId = null;
    const result = ctx.change((st) => {
      const trip = st.trips[st.activeTripId];
      const next = saveTransfer(trip, input, editing, m.rates, () => makeId());
      trip.transfers = next.transfers;
      trip.expenses = next.expenses;
      savedId = editing?.id ?? next.transfers[next.transfers.length - 1].id;
    }, { now: true });
    ctx.toast(!result?.ok ? 'form.saveFailed' : (input.price.trim() ? 'transfer.saved' : 'transfer.savedNoPrice'));
    opener = $(`#panel-transfers [data-action="transfer-edit"][data-id="${savedId}"]`) ?? opener;
    dlg.close();
  });

  const dlgDel = $('#dlg-transfer-delete');
  let deleting = null;
  wireDialog(dlgDel, () => { deleting = null; restore(); });
  $('[data-action="transfer-delete-confirm"]').addEventListener('click', () => {
    const id = deleting;
    if (!id) return;
    const withExpense = dlgDel.querySelector('[name="withExpense"]').checked;
    const result = ctx.change((st) => {
      const trip = st.trips[st.activeTripId];
      const next = removeTransfer(trip, id, withExpense);
      trip.transfers = next.transfers;
      trip.expenses = next.expenses;
    }, { now: true });
    ctx.toast(result?.ok ? 'transfer.deleted' : 'form.saveFailed');
    opener = panel.querySelector('[data-action="transfer-edit"]') ?? panel.querySelector('[data-action="transfer-add"]');
    dlgDel.close();
  });

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'transfer-add') open(null, btn);
    if (action === 'transfer-edit') open(list().find((x) => x.id === id), btn);
    if (action === 'transfer-delete') {
      const x = list().find((y) => y.id === id);
      opener = btn;
      deleting = id;
      $('[data-slot="transfer-delete-text"]').textContent = interpolate(t('transfer.delete.text'), { route: routeText(t, x) });
      const box = dlgDel.querySelector('[name="withExpense"]');
      box.checked = true;
      $('[data-slot="transfer-delete-expense"]').hidden = !x?.expenseId;
      dlgDel.showModal();
      dlgDel.querySelector('[data-close]').focus();
    }
  });
}
