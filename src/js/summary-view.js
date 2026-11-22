// Stage 7.0c trip summary (#/summary, opened from the itinerary): days, places, spending by category, the budget
// table, and the slideshow (the summary "clip", owner decision A). Every money figure is moneyState(ctx).summary,
// the object the money screen draws from; this file only formats it.
import { interpolate } from './core/i18n.js';
import { formatDate } from './core/itinerary.js';
import { todayIn } from './core/trip.js';
import { tripSummary, budgetTable } from './core/summary.js';
import { slideshow, placeOf, FEATURE_MAX } from './core/photos.js';
import { placeOfPhoto } from './core/place-share.js';
import { moneyState, formatMinor, catName } from './money-view.js';
import { photoUrl } from './photo-store.js';
import { thumbButton, fillThumbs } from './photos-view.js';

const $ = (sel, root = document) => root.querySelector(sel);
const ICONS = './assets/icons.svg#';
const SLIDE_MS = 4000;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function renderSummary(ctx) {
  const panel = $('#panel-summary');
  if (!panel) return;
  const { t, fmtLocale } = ctx;
  const m = moneyState(ctx);
  const fm = (minor) => formatMinor(minor, 'ILS', fmtLocale);
  const trip = ctx.trip();
  const s = tripSummary(trip, m.summary, todayIn(ctx.country.timeZone));

  // Numbers
  $('[data-slot="sum-days"]').textContent = s.days === null ? t('sum.noDates') : String(s.days);
  $('[data-slot="sum-places-count"]').textContent = String(s.places.length);
  $('[data-slot="sum-spent"]').textContent = fm(s.spentMinor);
  $('[data-slot="sum-photos"]').textContent = String(s.photos);

  // Places
  $('[data-slot="sum-places-empty"]').hidden = s.places.length > 0;
  $('[data-slot="sum-places-empty"]').textContent = t('sum.placesNone');
  $('[data-slot="sum-places"]').replaceChildren(...s.places.map((x) => {
    const li = el('li', 'sum-place');
    li.append(el('span', 'sum-place-name', x.name));
    const nights = x.nights === 0 ? t('sum.dayVisit') : x.nights === 1 ? t('sum.nightsOne') : interpolate(t('sum.nights'), { n: x.nights });
    li.append(el('span', 'muted', `${formatDate(x.startDate, fmtLocale)}, ${nights}`));
    return li;
  }));

  // Spending by category (only categories with spending), from the same summary
  $('[data-slot="sum-cats-empty"]').hidden = s.categories.length > 0 || s.emergency.usedMinor > 0;
  $('[data-slot="sum-cats-empty"]').textContent = t('sum.catsNone');
  const catItems = s.categories.map((c) => {
    const li = el('li', 'sum-cat');
    li.dataset.sumCat = c.id;
    li.dataset.minor = String(c.usedMinor);
    li.append(el('span', 'sum-cat-name', catName(ctx, c.id)), el('span', 'sum-cat-num', fm(c.usedMinor)));
    return li;
  });
  $('[data-slot="sum-cats"]').replaceChildren(...catItems);

  // Budget table: plan against actual, paid / planned / future / free, the same over rule as the money screen
  const tb = budgetTable(m.summary);
  const showTable = m.summary.hasCategories && tb.rows.length > 0;
  $('[data-slot="sum-table"]').hidden = !showTable;
  $('[data-slot="sum-budget-empty"]').hidden = showTable;
  $('[data-slot="sum-budget-empty"]').textContent = t('sum.budget.none');
  const cols = [['plan', 'planMinor', 'sum.col.plan'], ['paid', 'paidMinor', 'exp.status.paid'], ['planned', 'plannedMinor', 'exp.status.planned'], ['committed', 'committedMinor', 'sum.col.committed'], ['free', 'freeMinor', 'sum.col.free']];
  const row = (id, name, r, head = 'th') => {
    const tr = el('tr', r.over ? 'is-over' : '');
    tr.dataset.row = id;
    const th = el(head, 'sum-cell-name');
    if (head === 'th') th.scope = 'row';
    th.append(el('span', '', name));
    if (r.over) th.append(el('span', 'badge badge-over', t('sum.over')));
    tr.append(th);
    for (const [col, key, label] of cols) {
      const td = el('td', `sum-cell${col === 'free' && r.over ? ' is-over' : ''}`, fm(r[key]));
      td.dataset.col = col;
      td.dataset.minor = String(r[key]);
      td.dataset.label = t(label); // shown on narrow screens, where each row becomes a small card
      tr.append(td);
    }
    return tr;
  };
  $('[data-slot="sum-rows"]').replaceChildren(...tb.rows.map((r) => row(r.id, catName(ctx, r.id), r)));
  $('[data-slot="sum-foot"]').replaceChildren(row('total', t('sum.total'), tb.total));
  $('[data-slot="sum-emergency"]').textContent = m.summary.hasCategories
    ? interpolate(t('sum.emergency'), { used: fm(tb.emergency.usedMinor), plan: fm(tb.emergency.planMinor) }) : '';

  // Slideshow preview
  const show = slideshow(trip);
  $('[data-action="show-play"]').disabled = show.list.length === 0;
  $('[data-slot="sum-show-note"]').textContent = !show.list.length ? t('sum.show.none')
    : interpolate(t(show.auto ? 'sum.show.auto' : show.list.some((p) => !p.featured) ? 'sum.show.chosenPlaces' : 'sum.show.chosen'), { n: show.list.length, max: FEATURE_MAX });
  const strip = $('[data-slot="sum-strip"]');
  strip.replaceChildren(...show.list.map((p) => { const li = el('li'); li.append(thumbButton(ctx, p, 'sum-thumb')); return li; }));
  fillThumbs(ctx, strip);
}

export function setupSummary(ctx, { wireDialog }) {
  const panel = $('#panel-summary');
  if (!panel) return;
  const { t, fmtLocale } = ctx;
  const dlg = $('#dlg-show');
  const img = $('[data-slot="show-img"]');
  const caption = $('[data-slot="show-caption"]');
  const count = $('[data-slot="show-count"]');
  const toggle = $('[data-action="show-toggle"]');
  let list = [];
  let i = 0;
  let timer = null;
  let playing = false;
  let opener = null;
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const setPlaying = (on) => {
    playing = on;
    clearTimeout(timer);
    toggle.setAttribute('aria-label', t(on ? 'sum.show.pause' : 'sum.show.resume'));
    $('[data-slot="show-toggle-icon"]').setAttribute('href', `${ICONS}${on ? 'i-pause' : 'i-play'}`);
    if (on) timer = setTimeout(() => go(1), SLIDE_MS);
  };
  async function show() {
    const p = list[i];
    const trip = ctx.trip();
    const place = placeOf(p, trip).name ?? t('photo.outside');
    const date = p.date ? formatDate(p.date, fmtLocale, { day: 'numeric', month: 'long' }) : t('photo.noDate');
    const n = p.date && trip.startDate ? Math.round((Date.parse(`${p.date}T00:00:00Z`) - Date.parse(`${trip.startDate}T00:00:00Z`)) / 86400000) + 1 : null;
    const base = n && n > 0 ? interpolate(t('sum.show.caption'), { n, date, place }) : interpolate(t('sum.show.captionNoDay'), { date, place });
    // Stage 10: a photo linked to a saved place shows the place's name on the slide
    const saved = placeOfPhoto(p.id, trip.places);
    const withPlace = saved ? interpolate(t('sum.show.withPlace'), { base, name: saved.name }) : base;
    caption.textContent = p.caption ? `${withPlace}. ${p.caption}` : withPlace;
    count.textContent = `${i + 1} / ${list.length}`;
    img.alt = p.caption || withPlace;
    const url = await photoUrl(p.id, 'full').catch(() => null);
    if (list[i] === p) { if (url) img.src = url; else img.removeAttribute('src'); }
    if (playing) setPlaying(true);
  }
  function go(step) {
    if (!list.length) return;
    i = (i + step + list.length) % list.length;
    img.classList.remove('is-in');
    show().then(() => requestAnimationFrame(() => img.classList.add('is-in')));
  }

  wireDialog(dlg, () => { setPlaying(false); img.removeAttribute('src'); if (opener?.isConnected) opener.focus(); });
  $('[data-action="show-play"]').addEventListener('click', (e) => {
    list = slideshow(ctx.trip()).list;
    if (!list.length) return;
    opener = e.currentTarget;
    i = 0;
    dlg.showModal();
    setPlaying(!reduced()); // with reduced motion the slides wait for the user
    go(0);
    toggle.focus();
  });
  $('[data-action="show-next"]').addEventListener('click', () => go(1));
  $('[data-action="show-prev"]').addEventListener('click', () => go(-1));
  toggle.addEventListener('click', () => setPlaying(!playing));
  dlg.addEventListener('keydown', (e) => {
    const rtl = document.documentElement.dir === 'rtl';
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(rtl ? 1 : -1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(rtl ? -1 : 1); }
  });
  // A thumbnail in the strip opens the slideshow at that photo
  $('[data-slot="sum-strip"]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-photo-id]');
    if (!b) return;
    list = slideshow(ctx.trip()).list;
    i = Math.max(0, list.findIndex((p) => p.id === b.dataset.photoId));
    opener = b;
    dlg.showModal();
    setPlaying(false);
    go(0);
    toggle.focus();
  });
}
