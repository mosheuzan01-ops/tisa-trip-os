// Lists screen (feature 10, Stage 5): checklist with two progress bars, tasks, and the home card.
// Logic lives in core/checklist.js; this file only draws and wires. All copy comes from the locale files.
// Rule-dependent items are shown as "to check" with a source and a check date; nothing is stated as fact.
import { interpolate } from './core/i18n.js';
import { todayIn } from './core/trip.js';
import {
  GROUPS, SECTIONS, TASK_STATUSES, validateItem, makeItem, progress, needsCheck, validateVerify, seedTasks,
  validateTask, makeTask, taskState, openTasks, nextTask, cleanItems, cleanTasks, hideDone,
  missingBuiltins, addBuiltins, needsBuiltinOffer, declineBuiltinOffer,
} from './core/checklist.js';
import { formatDate } from './core/itinerary.js';
import { makeId } from './core/ids.js';
import { searchList } from './core/search.js';
import { setupSearch } from './search-view.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const iconButton = (icon, label, action, id) => {
  const b = el('button', 'icon-btn stop-btn');
  b.type = 'button';
  b.dataset.action = action;
  b.dataset.id = id;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${icon}"/></svg>`;
  return b;
};
const checkbox = (action, id, checked, label) => {
  const wrap = el('label', 'item-check');
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
  input.dataset.action = action;
  input.dataset.id = id;
  wrap.append(input, el('span', 'item-name', label));
  return wrap;
};

/** Screen-only filters (not saved): hide what is already ticked / done. */
const view = { items: false, tasks: false, query: '' };

function listState(ctx) {
  const trip = ctx.trip();
  const items = cleanItems(trip.checklist);
  const tasks = cleanTasks(trip.tasks);
  return { trip, items, tasks, bars: progress(items), today: todayIn(ctx.country.timeZone) };
}

function setBar(ctx, kind, bar) {
  const { t } = ctx;
  $(`[data-slot="${kind}-num"]`).textContent = bar.total ? `${interpolate(t('lists.barNum'), bar)} (${bar.pct}%)` : t('lists.barEmpty');
  $(`[data-slot="${kind}-fill"]`).style.width = `${bar.pct ?? 0}%`;
  const meter = $(`[data-slot="${kind}-meter"]`);
  meter.setAttribute('aria-valuenow', String(bar.pct ?? 0));
  meter.setAttribute('aria-valuetext', bar.total ? interpolate(t('lists.barNum'), bar) : t('lists.barEmpty'));
}

export function renderLists(ctx) {
  const panel = $('#panel-checklist');
  if (!panel) return;
  const { t, fmtLocale } = ctx;
  const s = listState(ctx);

  // ---------- Home card ----------
  const open = openTasks(s.tasks);
  const next = nextTask(s.tasks);
  $('[data-slot="home-tasks-open"]').textContent = open.length === 0 ? t('home.tasks.none')
    : open.length === 1 ? t('home.tasks.one') : interpolate(t('home.tasks.other'), { n: open.length });
  const nextEl = $('[data-slot="home-tasks-next"]');
  nextEl.hidden = !next;
  if (next) {
    const st = taskState(next, s.today);
    nextEl.textContent = st === 'overdue' ? interpolate(t('home.tasks.nextOverdue'), { title: next.title })
      : next.due ? interpolate(t('home.tasks.nextDue'), { title: next.title, date: formatDate(next.due, fmtLocale) })
        : interpolate(t('home.tasks.next'), { title: next.title });
    nextEl.classList.toggle('is-overdue', st === 'overdue');
  }
  for (const kind of ['prep', 'pack']) {
    const bar = s.bars[kind];
    $(`[data-slot="home-${kind}-label"]`).textContent = bar.total ? interpolate(t(`home.${kind}`), { pct: bar.pct }) : t(`home.${kind}None`);
    $(`[data-slot="home-${kind}-fill"]`).style.width = `${bar.pct ?? 0}%`;
  }

  // ---------- Progress: four sections (pre-stage-10 PR A) ----------
  for (const sec of SECTIONS) setBar(ctx, sec, s.bars[sec]);

  // ---------- Built-in items: one-time card, and a button while anything is missing ----------
  const missing = missingBuiltins(s.trip.checklist, ctx.pack).length;
  const offer = needsBuiltinOffer(s.trip, ctx.pack);
  $('[data-slot="builtin-offer"]').hidden = !offer;
  $('[data-slot="builtin-offer-text"]').textContent = interpolate(t('list.builtin.offerText'), { n: missing });
  $('[data-action="list-builtin"]').hidden = offer || missing === 0;

  // Focus survives a redraw: same action on the same id.
  const focused = panel.contains(document.activeElement) && document.activeElement.dataset.id
    ? [document.activeElement.dataset.action, document.activeElement.dataset.id] : null;

  // ---------- Checklist by group ----------
  $('[data-slot="list-empty"]').hidden = s.items.length > 0;
  $('[data-slot="items-filter"]').hidden = s.items.length === 0;
  // Search: item name and note; task title and note. Progress bars and the home card never change with it.
  const shownItems = searchList(hideDone(s.items, view.items), view.query, (x) => [x.name, x.note]);
  const shownTasks = searchList(hideDone(s.tasks, view.tasks), view.query, (x) => [x.title, x.note]);
  const searching = view.query.trim() !== '';
  const plural = (key, n) => (n === 1 ? t(`${key}.one`) : interpolate(t(`${key}.other`), { n }));
  const found = $('[data-slot="lists-filtered"]');
  found.hidden = !searching || (shownItems.length + shownTasks.length === 0);
  found.textContent = interpolate(t('lists.found'), { items: plural('lists.found.items', shownItems.length), tasks: plural('lists.found.tasks', shownTasks.length) });
  $('[data-slot="lists-no-results"]').hidden = !searching || (shownItems.length + shownTasks.length > 0);
  $('[data-slot="lists-bar"]').hidden = s.items.length + s.tasks.length === 0;
  $('[data-slot="groups"]').replaceChildren(...GROUPS.filter((g) => shownItems.some((x) => x.group === g)).map((g) => {
    const all = s.items.filter((x) => x.group === g);
    const list = shownItems.filter((x) => x.group === g);
    const card = el('section', 'card surface list-group');
    const head = el('div', 'list-group-head');
    head.append(el('h3', 'tool-title', t(`list.group.${g}`)), el('span', 'bar-num', interpolate(t('lists.barNum'), { done: all.filter((x) => x.done).length, total: all.length })));
    const ul = el('ul', 'items');
    for (const x of list) {
      const li = el('li', `item${x.done ? ' is-done' : ''}`);
      li.dataset.id = x.id;
      const top = el('div', 'item-top');
      top.append(checkbox('item-toggle', x.id, x.done, x.name));
      if (x.qty > 1) top.append(el('span', 'badge', interpolate(t('list.qtyShort'), { n: x.qty })));
      li.append(top);
      if (x.verify) {
        const v = needsCheck(x)
          ? el('p', 'item-verify is-open', t('list.toCheck'))
          : el('p', 'item-verify', x.verify.source
            ? interpolate(t('list.checkedFrom'), { date: formatDate(x.verify.checkedAt, fmtLocale), source: x.verify.source })
            : interpolate(t('list.checked'), { date: formatDate(x.verify.checkedAt, fmtLocale) }));
        li.append(v);
      }
      if (x.note) li.append(el('p', 'item-note', x.note));
      const actions = el('div', 'stop-actions row-actions');
      actions.append(
        iconButton('i-edit', interpolate(t('list.editLabel'), { name: x.name }), 'item-edit', x.id),
        iconButton('i-trash', interpolate(t('list.deleteLabel'), { name: x.name }), 'item-delete', x.id),
      );
      top.append(actions);
      ul.append(li);
    }
    card.append(head, ul);
    return card;
  }));

  // ---------- Tasks ----------
  $('[data-slot="tasks-empty"]').hidden = s.tasks.length > 0;
  $('[data-slot="tasks-filter"]').hidden = s.tasks.length === 0;
  $('[data-slot="task-list"]').replaceChildren(...shownTasks.map((x) => {
    const st = taskState(x, s.today);
    const li = el('li', `task surface is-${st}`);
    li.dataset.id = x.id;
    const top = el('div', 'item-top');
    top.append(checkbox('task-toggle', x.id, x.status === 'done', x.title), el('span', `badge task-status task-${x.status}`, t(`task.status.${x.status}`)));
    li.append(top);
    if (x.due) {
      li.append(el('p', `task-due is-${st}`, st === 'overdue' ? interpolate(t('task.overdue'), { date: formatDate(x.due, fmtLocale) })
        : st === 'today' ? t('task.today') : interpolate(t('task.dueOn'), { date: formatDate(x.due, fmtLocale) })));
    }
    if (x.note) li.append(el('p', 'item-note', x.note));
    const actions = el('div', 'stop-actions row-actions');
    actions.append(
      iconButton('i-edit', interpolate(t('task.editLabel'), { title: x.title }), 'task-edit', x.id),
      iconButton('i-trash', interpolate(t('task.deleteLabel'), { title: x.title }), 'task-delete', x.id),
    );
    top.append(actions);
    return li;
  }));

  if (focused) panel.querySelector(`[data-action="${focused[0]}"][data-id="${focused[1]}"]`)?.focus();
}

export function setupLists(ctx, { wireDialog, showFormErrors }) {
  const panel = $('#panel-checklist');
  if (!panel) return;
  const { t } = ctx;
  let opener = null;
  const restore = () => { (opener?.isConnected ? opener : panel.querySelector('[data-action="item-add"]')).focus(); };
  const commit = (fn, message) => {
    const result = ctx.change(fn, { now: true });
    ctx.toast(result?.ok ? message : 'form.saveFailed');
  };
  const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
  const tripOf = (st) => st.trips[st.activeTripId];

  // ---------- Item add / edit ----------
  const dlgItem = $('#dlg-item');
  const iForm = $('[data-form="item"]');
  let editingItem = null;
  wireDialog(dlgItem, restore);
  const showVerify = () => { $('[data-slot="verify-box"]').hidden = !iForm.verify.checked; };
  function openItem(item, from) {
    opener = from;
    editingItem = item;
    iForm.reset();
    showFormErrors(t, iForm, [], 'itemErr');
    $('[data-slot="item-title"]').textContent = t(item ? 'list.editTitle' : 'list.addTitle');
    $('[data-slot="item-group"]').replaceChildren(...GROUPS.map((g) => option(g, t(`list.group.${g}`))));
    if (item) {
      iForm.name.value = item.name;
      iForm.group.value = item.group;
      iForm.qty.value = String(item.qty ?? 1);
      iForm.note.value = item.note ?? '';
      iForm.verify.checked = Boolean(item.verify);
      iForm.source.value = item.verify?.source ?? '';
      iForm.checkedAt.value = item.verify?.checkedAt ?? '';
    } else {
      iForm.qty.value = '1';
    }
    showVerify();
    dlgItem.showModal();
    iForm.name.focus();
  }
  iForm.verify.addEventListener('change', showVerify);
  iForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = { group: iForm.group.value, name: iForm.name.value, qty: iForm.qty.value, note: iForm.note.value };
    const verify = { source: iForm.source.value.trim(), checkedAt: iForm.checkedAt.value || null };
    const errors = [...validateItem(input), ...(iForm.verify.checked ? validateVerify(verify) : [])];
    if (errors.length) { showFormErrors(t, iForm, errors, 'itemErr'); return; }
    const next = makeItem(input, () => makeId(), editingItem);
    if (iForm.verify.checked) next.verify = verify; else delete next.verify;
    commit((st) => {
      const trip = tripOf(st);
      const i = trip.checklist.findIndex((x) => x?.id === next.id);
      if (i >= 0) trip.checklist[i] = next; else trip.checklist.push(next);
    }, 'list.saved');
    opener = $(`#panel-checklist [data-action="item-edit"][data-id="${next.id}"]`) ?? opener;
    dlgItem.close();
  });

  // ---------- Task add / edit (also from the home card) ----------
  const dlgTask = $('#dlg-task');
  const tForm = $('[data-form="task"]');
  let editingTask = null;
  wireDialog(dlgTask, restore);
  function openTask(task, from) {
    opener = from;
    editingTask = task;
    tForm.reset();
    showFormErrors(t, tForm, [], 'taskErr');
    $('[data-slot="task-title"]').textContent = t(task ? 'task.editTitle' : 'task.addTitle');
    $('[data-slot="task-status"]').replaceChildren(...TASK_STATUSES.map((x) => option(x, t(`task.status.${x}`))));
    tForm.status.value = task?.status ?? 'open';
    if (task) {
      tForm.title.value = task.title;
      tForm.due.value = task.due ?? '';
      tForm.note.value = task.note ?? '';
    }
    dlgTask.showModal();
    tForm.title.focus();
  }
  tForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = { title: tForm.title.value, status: tForm.status.value, due: tForm.due.value, note: tForm.note.value };
    const errors = validateTask(input);
    if (errors.length) { showFormErrors(t, tForm, errors, 'taskErr'); return; }
    const next = makeTask(input, () => makeId(), editingTask);
    commit((st) => {
      const trip = tripOf(st);
      const i = trip.tasks.findIndex((x) => x?.id === next.id);
      if (i >= 0) trip.tasks[i] = next; else trip.tasks.push(next);
    }, 'task.saved');
    opener = $(`#panel-checklist [data-action="task-edit"][data-id="${next.id}"]`)?.offsetParent ? $(`#panel-checklist [data-action="task-edit"][data-id="${next.id}"]`) : opener;
    dlgTask.close();
  });
  ctx.openNewTask = (from) => openTask(null, from);
  $('[data-action="task-quick"]').addEventListener('click', (e) => openTask(null, e.currentTarget));

  // ---------- Yes / no: delete and starter lists ----------
  const dlgConfirm = $('#dlg-list-confirm');
  const yesBtn = $('[data-action="list-confirm-yes"]');
  let onYes = null;
  wireDialog(dlgConfirm, () => { onYes = null; yesBtn.disabled = false; restore(); });
  function confirm(from, key, vars, fn, focusYes = false) {
    opener = from;
    onYes = fn;
    $('[data-slot="list-confirm-title"]').textContent = t(`${key}.title`);
    $('[data-slot="list-confirm-text"]').textContent = interpolate(t(`${key}.text`), vars);
    yesBtn.textContent = t(`${key}.confirm`);
    yesBtn.classList.toggle('btn-danger-solid', !focusYes);
    dlgConfirm.showModal();
    (focusYes ? yesBtn : dlgConfirm.querySelector('[data-close]')).focus(); // deletes start on the safe choice
  }
  yesBtn.addEventListener('click', () => {
    const fn = onYes;
    if (!fn) return;
    onYes = null; // a double tap runs it once
    yesBtn.disabled = true;
    fn();
    dlgConfirm.close();
  });

  // ---------- One delegated handler: clicks and ticks ----------
  setupSearch($('[data-search="lists"]'), (v) => { view.query = v; renderLists(ctx); });
  for (const [key, sel] of [['items', 'hide-done-items'], ['tasks', 'hide-done-tasks']]) {
    $(`[data-filter="${sel}"]`).addEventListener('change', (e) => { view[key] = e.target.checked; renderLists(ctx); });
  }
  panel.addEventListener('change', (e) => {
    const box = e.target.closest('input[type="checkbox"][data-action]');
    if (!box) return;
    const { action, id } = box.dataset;
    const result = ctx.change((st) => { // a tick saves quietly; a toast on every tick would be noise
      const trip = tripOf(st);
      if (action === 'item-toggle') { const x = trip.checklist.find((i) => i?.id === id); if (x) x.done = box.checked; }
      if (action === 'task-toggle') { const x = trip.tasks.find((i) => i?.id === id); if (x) x.status = box.checked ? 'done' : 'open'; }
    }, { now: true });
    if (!result?.ok) ctx.toast('form.saveFailed');
  });
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const { action, id } = btn.dataset;
    const s = listState(ctx);
    if (action === 'item-add') openItem(null, btn);
    if (action === 'item-edit') openItem(s.items.find((x) => x.id === id), btn);
    if (action === 'task-add') openTask(null, btn);
    if (action === 'task-edit') openTask(s.tasks.find((x) => x.id === id), btn);
    if (action === 'item-delete') {
      const x = s.items.find((i) => i.id === id);
      confirm(btn, 'list.delete', { name: x?.name ?? '' }, () => commit((st) => { const trip = tripOf(st); trip.checklist = trip.checklist.filter((i) => i?.id !== id); }, 'list.deleted'));
    }
    if (action === 'task-delete') {
      const x = s.tasks.find((i) => i.id === id);
      confirm(btn, 'task.delete', { title: x?.title ?? '' }, () => commit((st) => { const trip = tripOf(st); trip.tasks = trip.tasks.filter((i) => i?.id !== id); }, 'task.deleted'));
    }
    if (action === 'list-builtin') {
      const n = missingBuiltins(tripOf(ctx.state).checklist, ctx.pack).length;
      if (!n) return;
      confirm(btn, 'list.builtin', { n }, () => commit((st) => {
        const trip = tripOf(st);
        trip.checklist = addBuiltins(trip.checklist, ctx.pack, ctx.locale, () => makeId()).items;
      }, 'list.builtin.added'), true);
    }
    if (action === 'builtin-add') {
      commit((st) => {
        const trip = tripOf(st);
        trip.checklist = addBuiltins(trip.checklist, ctx.pack, ctx.locale, () => makeId()).items;
      }, 'list.builtin.added');
      panel.querySelector('[data-action="item-add"]').focus();
    }
    if (action === 'builtin-later') {
      commit((st) => declineBuiltinOffer(tripOf(st), ctx.pack), 'list.builtin.later');
      panel.querySelector('[data-action="list-builtin"]').focus();
    }
    if (action === 'tasks-seed') {
      confirm(btn, 'task.seed', { n: ctx.pack?.taskSeed?.length ?? 0 }, () => commit((st) => {
        const trip = tripOf(st);
        if (cleanTasks(trip.tasks).length) return;
        trip.tasks = [...trip.tasks, ...seedTasks(ctx.pack, ctx.locale, () => makeId())];
      }, 'task.seeded'), true);
    }
  });
}
