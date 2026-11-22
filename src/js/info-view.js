// Stage 11: country info and emergency (#/info, opened from home; the home tab stays lit). Data: core/info.js and
// data/info/<id>.json, cached by the service worker, so the screen works in airplane mode with no requests.
// Every detail shows its status: verified (with source and check date), given by the user, or "not verified yet".
// Calls use tel: links (they need a phone signal); maps open only on tap and only from a verified address (rule 5).
// Own class names and data attributes (rule 14). All copy from locales; the facts come only from the data file.
import { interpolate } from './core/i18n.js';
import { isShown, emergencyNumbers, telHref, mapLink, sourceOf, setNote, noteOf, NOTE_MAX } from './core/info.js';
import { copyText } from './places-view.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="${ICONS}${name}"/></svg>`;
const BADGE = { 'verified-official': 'is-verified', 'user-provided': 'is-user', unverified: 'is-pending' };
const FIELD_ORDER = ['name', 'nameTh', 'address', 'addressTh', 'phone', 'hours', 'er', 'english', 'site', 'emergencyPhone', 'insurance', 'preapproval', 'payment'];

const pick = (v, locale) => (v && typeof v === 'object' ? v[locale] ?? v.he ?? v.en ?? '' : v ?? '');
const day = (iso, fmtLocale) => new Intl.DateTimeFormat(fmtLocale, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const byOrder = (a, b) => FIELD_ORDER.indexOf(a.key) - FIELD_ORDER.indexOf(b.key);

/** One detail: label, status, value (or how to check it), source and date, and its actions. */
function row(ctx, item, label, path) {
  const { t, locale, fmtLocale } = ctx;
  const li = el('li', 'info-row');
  li.dataset.infoKey = path;
  li.dataset.status = item.status;
  const top = el('div', 'info-row-top');
  top.append(el('span', 'info-label', label), el('span', `badge info-badge ${BADGE[item.status]}`, t(`info.status.${item.status}`)));
  li.append(top);
  if (item.status === 'unverified') {
    li.append(el('p', 'info-how', pick(item.how, locale)));
    return li;
  }
  const value = el('p', `info-value info-value-${item.kind}`, pick(item.value, locale));
  if (item.kind !== 'text' || /[฀-๿]/.test(value.textContent)) value.dir = /[฀-๿]/.test(value.textContent) ? 'auto' : 'ltr';
  li.append(value);
  if (item.note) li.append(el('p', 'info-note-text muted', pick(item.note, locale)));
  const src = sourceOf(ctx.info, item);
  const meta = el('p', 'info-src');
  if (item.status === 'verified-official' && src) {
    meta.append(el('span', null, interpolate(t('info.source'), { title: pick(src.title, locale), date: day(item.checkedAt, fmtLocale) })), ' ');
    const url = el('span', 'info-src-url', src.url);
    url.dir = 'ltr';
    meta.append(url);
  } else meta.textContent = interpolate(t('info.userGiven'), { date: day(item.checkedAt, fmtLocale) });
  li.append(meta);
  const tel = telHref(item);
  if (tel || item.kind === 'phone' || item.kind === 'address') {
    const acts = el('div', 'info-acts');
    if (tel) {
      const call = el('a', 'btn btn-primary info-call');
      call.href = tel;
      call.innerHTML = `${icon('i-phone')}<span></span>`;
      call.querySelector('span').textContent = interpolate(t('info.call'), { n: `\u2066${item.value}\u2069` });
      acts.append(call);
    }
    const copy = el('button', 'btn btn-ghost info-copy');
    copy.type = 'button';
    copy.dataset.action = 'info-copy';
    copy.dataset.copy = pick(item.value, locale);
    copy.innerHTML = `${icon('i-copy')}<span></span>`;
    copy.querySelector('span').textContent = t('info.copy');
    copy.setAttribute('aria-label', interpolate(t('info.copyLabel'), { label }));
    acts.append(copy);
    li.append(acts);
  }
  return li;
}

/** The user's own note for a card (policy number, insurer line, remarks). Saved in the trip, so it is in the backup. */
function noteBox(ctx, key, labelText) {
  const { t } = ctx;
  const box = el('details', 'info-note');
  box.dataset.noteKey = key;
  const sum = el('summary', 'info-note-sum', t('info.note.title'));
  const field = el('label', 'field info-note-field');
  const area = el('textarea', 'info-note-input');
  area.maxLength = NOTE_MAX;
  area.rows = 3;
  area.dataset.noteFor = key;
  field.append(el('span', null, interpolate(t('info.note.label'), { name: labelText })), area);
  const save = el('button', 'btn btn-ghost info-note-save', t('info.note.save'));
  save.type = 'button';
  save.dataset.action = 'info-note-save';
  save.dataset.noteKey = key;
  box.append(sum, field, el('p', 'muted info-note-hint', t('info.note.hint')), save);
  return box;
}

/** A card: verified and user-given details first; details not verified yet folded under one line. */
function card(ctx, { key, title, sub, fields, badge, fold = false, open = false }) {
  const { t } = ctx;
  const c = el('article', 'card surface info-card');
  c.dataset.infoCard = key;
  const head = el('div', 'info-card-head');
  head.append(el('h3', 'info-card-title', title));
  if (badge) head.append(el('span', `badge info-prio ${badge.cls}`, badge.text));
  c.append(head);
  if (sub) c.append(el('p', 'muted info-card-sub', sub));
  const shown = fields.filter(isShown).sort(byOrder);
  const done = shown.filter((f) => f.status !== 'unverified');
  const pending = shown.filter((f) => f.status === 'unverified');
  const label = (f) => t(`info.field.${f.key}`);
  // Hospitals fold to keep the screen short: the call button stays outside; details, sources and notes open on tap.
  let host = c;
  if (fold) {
    const tel = telHref(fields.find((f) => f.key === 'phone'));
    if (tel) {
      const call = el('a', 'btn btn-primary info-call info-quick-call');
      call.href = tel;
      call.innerHTML = `${icon('i-phone')}<span></span>`;
      call.querySelector('span').textContent = interpolate(t('info.call'), { n: `\u2066${fields.find((f) => f.key === 'phone').value}\u2069` });
      c.append(call);
    }
    host = el('details', 'info-fold');
    host.open = open;
    host.append(el('summary', 'info-fold-sum', t('info.details')));
    c.append(host);
  }
  if (done.length) {
    const ul = el('ul', 'info-list');
    for (const f of done) ul.append(row(ctx, f, label(f), `${key}.${f.key}`));
    host.append(ul);
  }
  const map = mapLink(fields, ctx.config.mapsSearchUrl);
  if (map) {
    const b = el('button', 'btn btn-ghost info-map');
    b.type = 'button';
    b.dataset.action = 'info-map';
    b.dataset.url = map;
    b.innerHTML = `${icon('i-pin')}<span></span>`;
    b.querySelector('span').textContent = t('info.map');
    host.append(b);
  }
  if (pending.length) {
    const d = el('details', 'info-pending');
    d.append(el('summary', 'info-pending-sum', interpolate(t('info.pending'), { n: pending.length })));
    const ul = el('ul', 'info-list');
    for (const f of pending) ul.append(row(ctx, f, label(f), `${key}.${f.key}`));
    d.append(ul);
    host.append(d);
  }
  host.append(noteBox(ctx, key, title));
  return c;
}

function build(ctx) {
  const { t, locale, info } = ctx;
  const sos = $('[data-slot="info-sos"]');
  const err = $('[data-slot="info-error"]');
  err.hidden = !!info;
  if (!info) return;
  sos.replaceChildren(...emergencyNumbers(info).map((x) => row(ctx, x, pick(x.label, locale), `emergency.${x.key}`)));
  // Emergency numbers that are not verified are never in the emergency list; if any, they wait below with their status.
  const others = info.emergency.filter((x) => isShown(x) && !emergencyNumbers(info).includes(x));
  const rest = $('[data-slot="info-sos-other"]');
  rest.hidden = others.length === 0;
  rest.querySelector('ul').replaceChildren(...others.map((x) => row(ctx, x, pick(x.label, locale), `emergency.${x.key}`)));

  $('[data-slot="info-contacts"]').replaceChildren(...info.contacts.map((c) => card(ctx, { key: c.key, title: pick(c.title, locale), fields: c.fields })));
  $('[data-slot="info-draft"]').textContent = info.hospitals.draft ? pick(info.hospitals.draftNote, locale) : '';
  $('[data-slot="info-draft"]').hidden = !info.hospitals.draft;
  const prio = { high: 'is-high', normal: 'is-normal', low: 'is-low' };
  $('[data-slot="info-hospitals"]').replaceChildren(...info.hospitals.list.map((h) => {
    const name = h.fields.find((f) => f.key === 'name' && f.status === 'verified-official');
    return card(ctx, {
      key: `hospital-${h.key}`, title: pick(h.area, locale), sub: name ? pick(name.value, locale) : t('info.noName'), fields: h.fields,
      badge: { cls: prio[h.priority], text: t(`info.priority.${h.priority}`) }, fold: true, open: h.priority === 'high',
    });
  }));
  $('[data-slot="info-insurance"]').replaceChildren(noteBox(ctx, 'insurance', t('info.insurance.title')));
  $('[data-slot="info-insurance"] details').open = true;
  const hiddenNotes = ['phrases', 'conduct'].filter((p) => info[p]?.status === 'hidden').map((p) => el('p', 'muted', pick(info[p].note, locale)));
  $('[data-slot="info-more"]').replaceChildren(...hiddenNotes);
  $('[data-slot="info-checked"]').textContent = interpolate(t('info.checkedAll'), { date: day(info.checkedAt, ctx.fmtLocale) });
}

export function renderInfo(ctx) {
  const panel = $('#panel-info');
  if (!panel || !ctx.info) return;
  const trip = ctx.trip();
  for (const area of panel.querySelectorAll('[data-note-for]')) {
    if (document.activeElement === area) continue; // never overwrite what the user is typing
    area.value = noteOf(trip.info, area.dataset.noteFor);
  }
}

export function setupInfo(ctx) {
  const panel = $('#panel-info');
  if (!panel) return;
  build(ctx);
  $('[data-action="home-emergency"]')?.addEventListener('click', () => ctx.go('info'));
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'info-copy') {
      ctx.toast(await copyText(b.dataset.copy) ? 'info.copied' : 'info.copyFailed');
    } else if (b.dataset.action === 'info-map') {
      if (navigator.onLine === false) ctx.toast('place.map.offline');
      window.open(b.dataset.url, '_blank', 'noopener');
    } else if (b.dataset.action === 'info-note-save') {
      const key = b.dataset.noteKey;
      const area = panel.querySelector(`[data-note-for="${key}"]`);
      const res = ctx.change((s) => { const trip = s.trips[s.activeTripId]; trip.info = setNote(trip.info, key, area.value); }, { now: true });
      area.value = noteOf(ctx.trip().info, key);
      ctx.toast(res?.ok === false ? 'form.saveFailed' : 'info.note.saved');
    }
  });
}
