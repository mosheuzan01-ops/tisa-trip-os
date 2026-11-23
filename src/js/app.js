// App entry point: data, navigation, settings, offline. Screens never touch storage directly;
// they change ctx.state through ctx.change(), and the storage layer saves it after a short pause.
import { loadConfig, loadLocale, loadCountry, loadCountryInfo, loadPacking } from './core/load.js';
import { createTranslator, resolveLocale, interpolate } from './core/i18n.js';
import { buildTitle, validateCountry } from './core/country.js';
import {
  todayIn, tripStatus, validateDates, setupProgress,
} from './core/trip.js';
import { createStorage, browserBackend, requestPersistence, isPersisted } from './core/storage.js';
import { needsBackupReminder } from './core/schema.js';
import { readyTrip, fillRoute } from './core/template.js';
import { dataSummary } from './core/device-data.js';
import { exportBackup, parseBackup, backupFileName } from './core/backup.js';
import { makeId } from './core/ids.js';
import { createAutosave } from './core/autosave.js';
import { setupItinerary, renderItinerary } from './itinerary-view.js';
import { setupMoney, renderMoney, moneyState, formatMinor, wholeShekels, fxText } from './money-view.js';
import { parseWholeShekels, setTotal } from './core/money.js';
import { setupLists, renderLists } from './checklist-view.js';
import { setupTransfers, renderTransfers } from './transfers-view.js';
import { renderAssistant } from './assistant-view.js';
import { renderCalendar, revealToday, setupCalendar } from './calendar-view.js';
import { renderCheckins, setupCheckins } from './checkins-view.js';
import { renderLuggage, setupLuggage } from './luggage-view.js';
import { renderPhotos, setupPhotos, renderPhotoBackup, setupPhotoBackup } from './photos-view.js';
import { renderSummary, setupSummary } from './summary-view.js';
import { renderPlaces, setupPlaces } from './places-view.js';
import { renderInfo, setupInfo } from './info-view.js';
import { setupTips } from './tip.js';
import { renderSmartBag, setupSmartBag } from './smart-bag-view.js';
import { validateInfo } from './core/info.js';
import { setupCloud, renderCloud } from './cloud-view.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ICONS = './assets/icons.svg#';

// Every screen has an address (#/name). Stage numbers follow the work plan.
const SCREENS = {
  home: { tab: 'home' },
  itinerary: { tab: 'itinerary', title: 'nav.itinerary', icon: 'i-route' },
  money: { tab: 'budget', title: 'screen.money', icon: 'i-wallet' },
  checklist: { tab: 'lists', title: 'screen.checklist', icon: 'i-list' },
  transfers: { tab: 'itinerary', title: 'screen.transfers', icon: 'i-plane' }, // opened from the itinerary; that tab stays lit
  calendar: { tab: 'itinerary', title: 'screen.calendar', icon: 'i-calendar' }, // 6.0b, opened from the itinerary; that tab stays lit
  luggage: { tab: 'lists', title: 'screen.luggage', icon: 'i-bag' }, // 6.0e, opened from the lists; that tab stays lit
  'smart-bag': { tab: 'lists', title: 'screen.smartBag', icon: 'i-bag' }, // Stage 12, opened from the lists
  photos: { tab: 'itinerary', title: 'screen.photos', icon: 'i-image' }, // 7.0b, opened from the itinerary
  summary: { tab: 'itinerary', title: 'screen.summary', icon: 'i-summary' }, // 7.0c, opened from the itinerary
  places: { tab: 'itinerary', title: 'screen.places', icon: 'i-pin' }, // Stage 10, opened from the itinerary
  info: { tab: 'home', title: 'screen.info', icon: 'i-sos' }, // Stage 11, opened from home (tile and emergency button)
  assistant: { tab: 'home', title: 'screen.assistant', icon: 'i-chat' }, // opened from home; the home tab stays lit
  settings: {},
};
const LEGACY_ROUTES = { budget: 'money', lists: 'checklist', map: 'home' }; // Stage 1 used #budget and #lists; the map tab was removed in 0.2.2

function parseRoute(hash) {
  const m = /^#\/?([\w-]+)/.exec(hash ?? '');
  const name = m ? (LEGACY_ROUTES[m[1]] ?? m[1]) : 'home';
  return Object.hasOwn(SCREENS, name) ? name : 'home';
}

async function boot() {
  const config = await loadConfig();
  const locale = resolveLocale(document.documentElement.lang, config);
  const [dict, country, packModule, infoData, packing] = await Promise.all([
    loadLocale(locale), loadCountry(config.activeCountry), import(`../../data/packs/${config.activeCountry}.js`).catch(() => ({})),
    loadCountryInfo(config.activeCountry).catch(() => null),
    loadPacking(config.activeCountry).catch(() => null),
  ]);
  // Stage 11: the info file is used only when it passes every rule (no future date check here: the phone's clock may be off).
  const info = infoData && validateInfo(infoData).length === 0 ? infoData : null;
  const pack = Object.values(packModule)[0] ?? null; // planning data: categories, profiles, rates (estimates, not verified)
  const problems = validateCountry(country);
  if (problems.length) throw new Error(`Invalid country data: ${problems.join(', ')}`);

  const t = createTranslator(dict);
  document.documentElement.lang = locale;
  document.documentElement.dir = dict.dir;
  document.title = buildTitle(config, country, locale);

  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  for (const el of $$('[data-i18n-alt]')) el.setAttribute('alt', t(el.dataset.i18nAlt));
  for (const el of $$('[data-i18n-placeholder]')) el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));

  const place = country.names[locale] ?? country.names.en;
  for (const el of $$('[data-slot="country"]')) el.textContent = place;
  for (const el of $$('[data-slot="country-latin"]')) el.textContent = country.names.en ?? country.id;

  const prefix = config.storageKeyPrefix;
  const storage = createStorage({
    backend: browserBackend(),
    key: `${prefix}v1`,
    legacy: { trip: `${prefix}trip`, theme: `${prefix}theme` },
    corruptPrefix: `${prefix}corrupt:`,
    now: () => new Date(),
    appVersion: config.appVersion,
    makeId: () => makeId(),
    countryCode: country.id.toUpperCase(),
    tripName: place,
    language: locale,
  });
  const loaded = storage.load();
  const fmtLocale = country.dateFormatLocale?.[locale] ?? locale;
  const ctx = {
    t, locale, fmtLocale, country, config, storage, pack, info, packing,
    state: loaded.state, status: loaded.status, lastSave: null, route: 'home', waitingWorker: null,
    storageKey: `${prefix}v1`, rev: 0, // Stage 14: the sync checks rev to never overwrite an edit made while it ran
  };
  ctx.trip = () => ctx.state.trips[ctx.state.activeTripId];

  const autosave = createAutosave((state) => {
    ctx.lastSave = storage.save(state);
    renderBanners(ctx);
    if (ctx.lastSave?.ok) ctx.afterSave?.(); // Stage 14: note what changed for the sync (no-op without an account)
  });
  ctx.autosave = autosave;
  /** Change the data, redraw, and save after a short pause (or right away with { now: true }). */
  ctx.change = (fn, { now = false } = {}) => {
    ctx.rev += 1;
    fn(ctx.state);
    ctx.render();
    autosave.schedule(ctx.state);
    if (now) autosave.flush();
    return ctx.lastSave;
  };
  ctx.render = () => {
    applyTheme(ctx.state.settings.theme);
    renderTrip({ t, locale, country, trip: tripView(ctx) });
    renderSettings(ctx);
    renderItinerary(ctx);
    renderMoney(ctx);
    renderLists(ctx);
    renderTransfers(ctx);
    renderCheckins(ctx);
    renderCalendar(ctx);
    renderLuggage(ctx);
    renderPhotos(ctx);
    renderSummary(ctx);
    renderPlaces(ctx);
    renderInfo(ctx);
    renderSmartBag(ctx);
    renderPhotoBackup(ctx);
    renderAssistant(ctx);
    renderBanners(ctx);
    renderCloud(ctx);
  };
  addEventListener('pagehide', () => autosave.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave.flush(); });

  if (loaded.status === 'migrated') ctx.lastSave = storage.save(ctx.state); // move Stage 1 data to the new key (old keys stay)
  // Pre-stage-10 PR A (owner, 2026-11-21): a new trip comes with the built-in checklist, saved at once so a reload
  // keeps the same items (and ticks). Old data is never filled here: the lists screen offers what is missing.
  // PR B: and the plan20k budget; the route follows as soon as the trip dates are entered (fillRoute).
  if (loaded.status === 'new') { readyTrip(ctx.trip(), pack, locale, () => makeId()); ctx.lastSave = storage.save(ctx.state); }
  if (loaded.status === 'new' || loaded.status === 'migrated') requestPersistence().then(() => renderSettings(ctx));

  setupTheme(ctx);
  setupPass(t);
  setupClock(country, locale, t);
  ctx.toast = setupToast(t);
  setupRouter(ctx);
  setupSheets(ctx);
  setupSettings(ctx);
  ctx.downloadBackup = () => downloadBackup(ctx);
  setupCloud(ctx, { wireDialog });
  setupItinerary(ctx, { wireDialog, showFormErrors });
  setupMoney(ctx, { wireDialog, showFormErrors });
  setupLists(ctx, { wireDialog, showFormErrors });
  setupTransfers(ctx, { wireDialog, showFormErrors });
  setupCalendar(ctx, { wireDialog, showFormErrors });
  setupCheckins(ctx, { wireDialog, showFormErrors });
  setupLuggage(ctx, { wireDialog, showFormErrors });
  setupPhotos(ctx, { wireDialog, showFormErrors });
  setupSummary(ctx, { wireDialog, showFormErrors });
  setupPlaces(ctx, { wireDialog, showFormErrors });
  setupInfo(ctx);
  setupTips(ctx, { wireDialog });
  setupSmartBag(ctx);
  setupPhotoBackup(ctx);
  setupServiceWorker(ctx);
  addEventListener('online', () => renderBanners(ctx));
  addEventListener('offline', () => renderBanners(ctx));
  ctx.render();
  setInterval(() => { renderTrip({ t, locale, country, trip: tripView(ctx) }); renderItinerary(ctx); renderMoney(ctx); renderLists(ctx); renderCheckins(ctx); renderCalendar(ctx); renderSummary(ctx); renderAssistant(ctx); }, 60_000); // keeps "today" right across midnight
}

/** The home screen reads { dates, budget, money }. Money comes from the Stage 4 summary (whole agorot). */
function tripView(ctx) {
  const trip = ctx.trip();
  const m = moneyState(ctx);
  const total = trip.budget?.totalMinor;
  return {
    dates: trip.startDate && trip.endDate ? { start: trip.startDate, end: trip.endDate } : undefined,
    budget: m.summary.hasBudget ? { amount: m.summary.totalMinor / 100, currency: 'ILS' } : undefined,
    homeTotal: Number.isInteger(total) && total > 0 ? { amount: total / 100, currency: trip.budget.currency } : undefined,
    hasCategories: m.summary.hasCategories,
    money: m.summary,
    fmtLocale: ctx.fmtLocale,
  };
}

// ---------- Theme: null = follow the device ----------
function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme ?? systemTheme();
  $('.theme-btn')?.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
}

function setupTheme(ctx) {
  $('.theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    ctx.change((s) => { s.settings.theme = next; });
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(ctx.state.settings.theme));
}

function setupPass(t) {
  const pass = $('.pass');
  pass.addEventListener('click', () => {
    const showBudget = pass.getAttribute('aria-pressed') !== 'true';
    pass.setAttribute('aria-pressed', String(showBudget));
    pass.setAttribute('aria-label', t(showBudget ? pass.dataset.labelBack : pass.dataset.i18nLabel));
    pass.classList.remove('is-flipping');
    void pass.offsetWidth; // restart the lift animation on quick repeat taps
    pass.classList.add('is-flipping');
  });
  $('.pass-inner').addEventListener('animationend', () => pass.classList.remove('is-flipping'));
  setupTilt(pass);
}

// Small 3D tilt: the card leans toward the finger or pointer, and the glare follows it.
// Only CSS variables change; with reduced motion the card keeps its resting pose.
function setupTilt(pass) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let frame = 0;
  const set = (x, y, glare) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      pass.style.setProperty('--tx-s', x.toFixed(3));
      pass.style.setProperty('--ty-s', y.toFixed(3));
      pass.style.setProperty('--gx-s', `${((x + 1) * 50).toFixed(1)}%`);
      pass.style.setProperty('--gy-s', `${((y + 1) * 50).toFixed(1)}%`);
      pass.style.setProperty('--glare-s', String(glare));
    });
  };
  const follow = (e) => {
    if (reduce?.matches) return;
    const r = pass.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    pass.classList.add('is-tilting');
    set(x, y, 0.6);
  };
  const rest = () => {
    pass.classList.remove('is-tilting');
    set(0, 0, 0);
  };
  pass.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) follow(e); });
  pass.addEventListener('pointerdown', follow);
  for (const type of ['pointerleave', 'pointerup', 'pointercancel', 'blur']) pass.addEventListener(type, rest);
}

function setupClock(country, locale, t) {
  const city = country.timeZoneCity?.[locale] ?? country.timeZone;
  $('[data-slot="clock-label"]').textContent = interpolate(t('today.clock'), { city });
  const fmt = new Intl.DateTimeFormat(country.dateFormatLocale?.[locale] ?? locale, {
    timeZone: country.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const clock = $('[data-slot="clock"]');
  const tick = () => { clock.textContent = fmt.format(new Date()); };
  tick();
  setInterval(tick, 15_000);
}

function setupToast(t) {
  const box = $('[data-slot="toast"]');
  let timer;
  return (key, vars) => {
    box.textContent = vars ? interpolate(t(key), vars) : t(key);
    box.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => box.classList.remove('show'), 2600);
  };
}

// ---------- Trip state on the home screen ----------
function formatDay(iso, locale, opts = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

function renderTrip({ t, locale, country, trip }) {
  const fmtLocale = country.dateFormatLocale?.[locale] ?? locale;
  const progress = setupProgress(trip);
  $('[data-slot="setup-count"]').textContent = interpolate(t('setup.count'), { done: progress.done, total: progress.total });
  $('[data-slot="setup-fill"]').style.width = `${(progress.done / progress.total) * 100}%`;
  $('[data-slot="setup-text"]').textContent = t(progress.done === progress.total ? 'setup.textDone' : 'setup.text');
  for (const btn of $$('[data-step]')) {
    const done = progress[btn.dataset.step];
    const label = btn.querySelector('[data-label-set]');
    label.textContent = t(done ? label.dataset.labelSet : label.dataset.i18n);
    btn.classList.toggle('is-done', done);
  }

  // Today card + dates on the pass
  const status = tripStatus(trip.dates, todayIn(country.timeZone));
  const statusEl = $('[data-slot="today-status"]');
  const sub = $('[data-slot="today-sub"]');
  const passDates = $('[data-slot="pass-dates"]');
  $('[data-slot="today-title"]').textContent = t(`today.title.${status.phase}`);
  $('.home').dataset.setup = progress.done === progress.total ? 'done' : 'open';
  delete $('.home').dataset.boot; // Stage 13 (F1): the home cards show only once their order is known, so nothing jumps
  if (status.phase === 'unset') {
    statusEl.hidden = true;
    sub.textContent = t('today.empty');
    passDates.hidden = true;
  } else {
    const texts = {
      before: status.daysToGo === 1 ? t('today.before.one') : interpolate(t('today.before.other'), { n: status.daysToGo }),
      during: interpolate(t('today.during'), status),
      after: t('today.after'),
    };
    // A big figure for the number that matters; screen readers get the full sentence instead.
    const figure = status.phase === 'before' && status.daysToGo > 1
      ? { num: status.daysToGo, caption: t('today.before.caption') }
      : status.phase === 'during' ? { num: status.day, caption: interpolate(t('today.during.caption'), status) } : null;
    if (figure) {
      const sr = Object.assign(document.createElement('span'), { className: 'sr-only', textContent: texts[status.phase] });
      const look = Object.assign(document.createElement('span'), { className: 'status-figure' });
      look.setAttribute('aria-hidden', 'true');
      look.append(
        Object.assign(document.createElement('span'), { className: 'status-num ltr', textContent: String(figure.num) }),
        Object.assign(document.createElement('span'), { className: 'status-cap', textContent: figure.caption }),
      );
      statusEl.replaceChildren(sr, look);
    } else {
      statusEl.textContent = texts[status.phase];
    }
    statusEl.classList.toggle('has-figure', Boolean(figure));
    statusEl.hidden = false;
    const lengthText = status.length === 1 ? t('today.length.one') : interpolate(t('today.length.other'), { n: status.length });
    sub.textContent = interpolate(t('today.range'), {
      start: formatDay(trip.dates.start, fmtLocale),
      end: formatDay(trip.dates.end, fmtLocale, { day: 'numeric', month: 'long', year: 'numeric' }),
      length: lengthText,
    });
    const short = { day: 'numeric', month: 'short' };
    passDates.textContent = `${formatDay(trip.dates.start, 'en-GB', short)} – ${formatDay(trip.dates.end, 'en-GB', short)}`;
    passDates.hidden = false;
  }

  // Budget on the back of the pass
  const money = trip.money;
  $('[data-slot="budget-empty"]').hidden = money.hasBudget;
  const kpis = { total: money.totalMinor, spent: money.paidMinor, left: money.freeMinor };
  for (const key of ['total', 'spent', 'left']) {
    $(`[data-slot="kpi-${key}"]`).textContent = money.hasBudget ? formatMinor(kpis[key], 'ILS', fmtLocale) : '—';
  }
}


// ---------- Setup sheets on the home screen (native <dialog>: focus trap, Esc to close) ----------
function showFormErrors(t, form, errors, prefix = 'err') {
  form.querySelector('.form-error').textContent = errors.map((e) => t(`${prefix}.${e}`)).join(' ');
  for (const input of form.querySelectorAll('input, select, textarea')) {
    const bad = errors.some((e) => e.startsWith(`${input.name}.`) || (input.name === 'end' && e === 'range.tooLong'));
    input.setAttribute('aria-invalid', String(bad));
  }
  form.querySelector('[aria-invalid="true"]')?.focus();
}

function wireDialog(dlg, onClose) {
  // Tap outside the sheet closes it. The <dialog> itself is also the target of a tap on its own top strip (the grab
  // handle, .sheet::before) and padding, so the tap must land outside the sheet's box too, or what was typed is lost.
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) dlg.close();
  });
  for (const b of dlg.querySelectorAll('[data-close]')) b.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', onClose);
}

function setupSheets(ctx) {
  const { t, locale, country, config } = ctx;
  const city = country.timeZoneCity?.[locale] ?? country.timeZone;
  for (const el of $$('[data-slot="dates-hint"]')) el.textContent = interpolate(t('dates.hint'), { city });


  const sheets = { dates: $('#dlg-dates'), budget: $('#dlg-budget') };
  let opener = null;

  function open(name, from) {
    if (name === 'dates' && ctx.datesLocked?.()) { ctx.toast('cloud.datesOwnerOnly'); return; } // Stage 14: shared trip, owner only
    opener = from ?? document.activeElement;
    const dlg = sheets[name];
    const form = dlg.querySelector('form');
    const view = tripView(ctx);
    form.reset();
    showFormErrors(t, form, []);
    if (name === 'dates' && view.dates) {
      form.start.value = view.dates.start;
      form.end.value = view.dates.end;
    }
    if (name === 'budget') { // 1.0.1: one total in whole shekels; dollars and baht shown small under it
      const total = view.money.hasBudget ? view.money.totalMinor : null;
      form.amount.value = wholeShekels(total);
      $('[data-slot="budget-fx"]').textContent = fxText(ctx, total, moneyState(ctx).rates);
    }
    dlg.querySelector('[data-clear]').hidden = !(name === 'budget' ? view.homeTotal : view.dates);
    dlg.showModal();
    form.querySelector('input').focus();
  }

  for (const dlg of Object.values(sheets)) wireDialog(dlg, () => { if (opener?.isConnected) opener.focus(); });

  function commit(fn, dlg, message) {
    const result = ctx.change(fn, { now: true });
    dlg.close();
    ctx.toast(result?.ok ? message : 'form.saveFailed');
  }

  $('[data-form="dates"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const dates = { start: form.start.value, end: form.end.value };
    const errors = validateDates(dates);
    if (errors.length) { showFormErrors(t, form, errors); return; }
    if (ctx.needsReplan?.(dates)) { // stops exist: show the before/after first, save only on yes
      const from = opener;
      sheets.dates.close();
      ctx.openReplan(dates, from);
      return;
    }
    let built = 0; // PR B: a trip with no stops gets the suggested route at once
    commit((s) => { const trip = s.trips[s.activeTripId]; trip.startDate = dates.start; trip.endDate = dates.end; built = fillRoute(trip, ctx.pack, ctx.locale, () => makeId()).added; }, sheets.dates, 'toast.saved');
    if (built) ctx.toast('itin.route.built');
  });

  $('[data-form="budget"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const v = parseWholeShekels(form.amount.value); // 1.0.1: whole shekels, the same rule as the money screen
    if (Number.isNaN(v)) {
      form.amount.setAttribute('aria-invalid', 'true');
      $('[data-slot="budget-error"]').textContent = t('total.err');
      form.amount.focus();
      return;
    }
    commit((s) => { const trip = s.trips[s.activeTripId]; trip.budget = setTotal(trip.budget, v); }, sheets.budget, 'toast.saved');
  });

  for (const b of $$('[data-clear]')) {
    b.addEventListener('click', () => {
      const part = b.dataset.clear;
      if (part === 'dates' && ctx.datesLocked?.()) { ctx.toast('cloud.datesOwnerOnly'); return; }
      commit((s) => {
        const trip = s.trips[s.activeTripId];
        if (part === 'dates') { trip.startDate = null; trip.endDate = null; }
        if (part === 'budget') { trip.budget.totalMinor = null; trip.budget.currency = 'ILS'; delete trip.budget.anchor; }
      }, sheets[part], 'toast.cleared');
    });
  }

  for (const b of $$('[data-open]')) b.addEventListener('click', () => open(b.dataset.open, b));
}

// ---------- Navigation: #/screen addresses, phone Back button, refresh keeps the screen ----------
function setupRouter(ctx) {
  const { t } = ctx;
  const tabs = $$('[role="tab"]');
  const panels = { home: $('#panel-home'), itinerary: $('#panel-itinerary'), money: $('#panel-money'), checklist: $('#panel-checklist'), transfers: $('#panel-transfers'), calendar: $('#panel-calendar'), luggage: $('#panel-luggage'), 'smart-bag': $('#panel-smart-bag'), photos: $('#panel-photos'), summary: $('#panel-summary'), places: $('#panel-places'), info: $('#panel-info'), assistant: $('#panel-assistant'), soon: $('#panel-soon'), settings: $('#panel-settings') };
  const main = $('#main');
  const rtl = () => document.documentElement.dir === 'rtl';

  // Links to every screen that is not built yet, so each one is reachable from the navigation.
  const more = $('[data-slot="soon-links"]');
  for (const [name, screen] of Object.entries(SCREENS)) {
    if (!screen.soon) continue;
    const a = document.createElement('a');
    a.className = 'soon-link';
    a.href = `#/${name}`;
    a.dataset.route = name;
    a.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${screen.icon}"/></svg><span></span><span class="soon-link-stage"></span>`;
    a.querySelector('span').textContent = t(screen.title);
    a.querySelector('.soon-link-stage').textContent = t('soon.linkFuture');
    more.append(a);
  }

  function show(route, { focus = true } = {}) {
    ctx.route = route;
    const screen = SCREENS[route];
    const kind = route in panels ? route : 'soon';
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== kind;
    const activeTab = tabs.find((x) => x.dataset.tab === screen.tab);
    for (const x of tabs) {
      const on = x === activeTab;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on || (!activeTab && x === tabs[0]) ? 0 : -1;
      if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
    }
    for (const el of $$('[data-route]')) {
      if (el.dataset.route === route) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    }
    if (kind === 'soon') {
      if (activeTab) panels.soon.setAttribute('aria-labelledby', activeTab.id); else panels.soon.removeAttribute('aria-labelledby');
      panels.soon.setAttribute('aria-label', t(screen.title));
      $('[data-slot="soon-title"]').textContent = t(screen.title);
      $('[data-slot="soon-icon"]').setAttribute('href', ICONS + screen.icon);
      $('[data-slot="soon-text"]').textContent = t('soon.future'); // no stage numbers: a future version (owner, 2026-11-19)
      for (const a of $$('.soon-link', more)) a.hidden = a.dataset.route === route;
    }
    renderBanners(ctx);
    if (focus) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    if (route === 'calendar') revealToday(); // the calendar opens on today while the trip is on
    if (route === 'photos') renderPhotos(ctx); // also checks how full the storage is
  }

  // Tabs keep keyboard focus on the tab bar (Stage 1 behavior); other links move focus to the new screen.
  let focusNext = true;
  const go = (route, { focusMain = true } = {}) => {
    focusNext = focusMain;
    if (location.hash === `#/${route}`) { show(route, { focus: focusMain }); return; }
    location.hash = `#/${route}`; // a new history entry, so the phone's Back button returns here
  };
  ctx.go = go;

  for (const tab of tabs) {
    tab.addEventListener('click', () => go(parseRoute(`#${tab.dataset.route}`), { focusMain: false }));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      const step = { ArrowLeft: rtl() ? 1 : -1, ArrowRight: rtl() ? -1 : 1, ArrowDown: 1, ArrowUp: -1 }[e.key];
      let next = null;
      if (step) next = tabs[(i + step + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      for (const x of tabs) x.tabIndex = x === next ? 0 : -1;
      next.focus();
    });
  }
  for (const el of $$('[data-go]')) el.addEventListener('click', () => go(el.dataset.go));
  $('.brand').addEventListener('click', (e) => { e.preventDefault(); go('home'); });

  window.addEventListener('hashchange', () => {
    const route = parseRoute(location.hash);
    if (location.hash !== `#/${route}`) history.replaceState(null, '', `#/${route}`); // old #budget links, typos
    show(route, { focus: focusNext });
    focusNext = true;
  });
  const first = parseRoute(location.hash);
  if (location.hash !== `#/${first}`) history.replaceState(null, '', `#/${first}`); // tidy old or empty addresses
  show(first, { focus: false });
}

// ---------- Banners: storage problems, update, offline, backup reminder ----------
function renderBanners(ctx) {
  const box = $('[data-slot="banners"]');
  if (!box) return;
  const { t, storage, status } = ctx;
  const list = [];
  if (status === 'corrupt' && storage.mode === 'readonly') {
    list.push({ kind: 'warn', text: t('banner.corrupt'), actions: [['banner.importAction', 'import'], ['banner.resetAction', 'reset']] });
  } else if (status === 'future' && storage.mode === 'readonly') {
    list.push({ kind: 'warn', text: t('banner.future'), actions: [] });
  } else if (storage.mode === 'unavailable' || ctx.lastSave?.reason === 'unavailable') {
    list.push({ kind: 'warn', text: t('banner.storageOff'), actions: [] });
  } else if (ctx.lastSave?.reason === 'quota') {
    list.push({ kind: 'warn', text: t('banner.storageFull'), actions: [['banner.backupAction', 'export']] });
  }
  if (ctx.waitingWorker) list.push({ kind: 'info', text: t('banner.update'), actions: [['banner.updateAction', 'update']] });
  if (navigator.onLine === false) list.push({ kind: 'info', text: t('banner.offline'), actions: [] });
  if (ctx.route === 'home' && storage.mode === 'ok' && needsBackupReminder(ctx.state, new Date())) {
    list.push({ kind: 'soft', text: t('banner.backup'), actions: [['banner.backupAction', 'export']] });
  }
  const key = JSON.stringify(list);
  if (box.dataset.key === key) return; // nothing changed: keep focus and screen-reader state
  box.dataset.key = key;
  box.replaceChildren(...list.map((b) => {
    const el = document.createElement('div');
    el.className = `banner banner-${b.kind}`;
    el.setAttribute('role', b.kind === 'warn' ? 'alert' : 'status');
    const p = document.createElement('p');
    p.textContent = b.text;
    el.append(p);
    if (b.actions.length) {
      const row = document.createElement('div');
      row.className = 'banner-actions';
      for (const [label, action] of b.actions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'banner-btn';
        btn.dataset.action = action;
        btn.textContent = t(label);
        row.append(btn);
      }
      el.append(row);
    }
    return el;
  }));
  box.hidden = list.length === 0;
}

// ---------- Settings (feature 8): dates, theme, backup, import, reset, install, limits, version ----------
function formatStamp(iso, locale) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function renderSettings(ctx) {
  const { t, state, fmtLocale } = ctx;
  const panel = $('#panel-settings');
  if (!panel) return;
  const trip = ctx.trip();
  const form = $('[data-form="settings-dates"]');
  if (document.activeElement?.form !== form) {
    form.start.value = trip.startDate ?? '';
    form.end.value = trip.endDate ?? '';
  }
  const theme = state.settings.theme ?? 'system';
  for (const r of $$('input[name="theme"]', panel)) r.checked = r.value === theme;
  $('[data-slot="last-backup"]').textContent = state.settings.lastBackupAt
    ? interpolate(t('settings.backup.last'), { date: formatStamp(state.settings.lastBackupAt, fmtLocale) })
    : t('settings.backup.never');
  $('[data-slot="version-app"]').textContent = ctx.config.appVersion;
  // Pre-stage-10 PR A: what this side holds, so Safari and the home-screen app can be compared on iPhone.
  const sum = dataSummary(state);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  $('[data-slot="device-data"]').textContent = interpolate(t('settings.device.summary'), {
    ...sum, where: t(standalone ? 'settings.device.app' : 'settings.device.browser'), date: formatStamp(sum.createdAt, fmtLocale),
  });
  $('[data-slot="version-schema"]').textContent = String(state.schemaVersion);
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  $('[data-slot="install-done"]').hidden = !installed;
  $('[data-slot="install-btn"]').hidden = installed || !ctx.installPrompt;
  const persistEl = $('[data-slot="persist-status"]');
  if (ctx.storage.mode === 'unavailable') persistEl.textContent = t('settings.storage.off');
  else {
    isPersisted().then((p) => {
      persistEl.textContent = t(p === true ? 'settings.storage.persisted' : p === false ? 'settings.storage.notPersisted' : 'settings.storage.unknown');
    });
  }
}

function downloadBackup(ctx) {
  const now = new Date();
  const text = JSON.stringify(exportBackup(ctx.state, now), null, 2);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: backupFileName(now) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  ctx.change((s) => { s.settings.lastBackupAt = now.toISOString(); }, { now: true });
  ctx.toast('backup.done');
}

function setupSettings(ctx) {
  const { t, config } = ctx;
  const panel = $('#panel-settings');
  const word = t('reset.word');
  $('[data-slot="reset-type-label"]').textContent = interpolate(t('reset.typeLabel'), { word });

  // Dates
  const datesForm = $('[data-form="settings-dates"]');
  datesForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (ctx.datesLocked?.()) { ctx.toast('cloud.datesOwnerOnly'); renderSettings(ctx); return; } // Stage 14: only the trip owner
    const dates = { start: datesForm.start.value, end: datesForm.end.value };
    const errors = validateDates(dates);
    if (errors.length) { showFormErrors(t, datesForm, errors); return; }
    showFormErrors(t, datesForm, []);
    if (ctx.needsReplan?.(dates)) {
      ctx.openReplan(dates, datesForm.querySelector('[type="submit"]'), () => {
        datesForm.start.value = ctx.trip().startDate ?? '';
        datesForm.end.value = ctx.trip().endDate ?? '';
      });
      return;
    }
    let built = 0; // PR B: a trip with no stops gets the suggested route at once
    const result = ctx.change((s) => { const trip = s.trips[s.activeTripId]; trip.startDate = dates.start; trip.endDate = dates.end; built = fillRoute(trip, ctx.pack, ctx.locale, () => makeId()).added; }, { now: true });
    ctx.toast(!result?.ok ? 'form.saveFailed' : built ? 'itin.route.built' : 'toast.saved');
  });

  // Theme
  for (const r of $$('input[name="theme"]', panel)) {
    r.addEventListener('change', () => ctx.change((s) => { s.settings.theme = r.value === 'system' ? null : r.value; }));
  }

  // Import: check the file, show what it holds, and replace only after an explicit yes.
  const fileInput = $('#import-file');
  const importError = $('[data-slot="import-error"]');
  const dlgImport = $('#dlg-import');
  let pending = null;
  let opener = null;
  wireDialog(dlgImport, () => { pending = null; fileInput.value = ''; if (opener?.isConnected) opener.focus(); });
  const pickFile = () => { importError.textContent = ''; fileInput.click(); };
  $('[data-action="import-pick"]').addEventListener('click', pickFile);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    let text;
    try { text = await file.text(); } catch { importError.textContent = t('import.err.read'); return; }
    const opts = { now: () => new Date(), appVersion: config.appVersion, makeId: () => makeId(), countryCode: ctx.country.id.toUpperCase(), tripName: ctx.trip().name };
    const result = parseBackup(text, opts);
    if (!result.ok) {
      importError.textContent = interpolate(t(`import.err.${result.error}`), { app: config.appName });
      fileInput.value = '';
      return;
    }
    pending = result;
    const s = result.summary;
    $('[data-slot="import-trip"]').textContent = s.tripName;
    $('[data-slot="import-dates"]').textContent = s.startDate && s.endDate
      ? `${formatDay(s.startDate, ctx.fmtLocale, { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatDay(s.endDate, ctx.fmtLocale, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : t('import.noDates');
    $('[data-slot="import-updated"]').textContent = formatStamp(s.updatedAt, ctx.fmtLocale);
    opener = $('[data-action="import-pick"]');
    dlgImport.showModal();
    $('[data-action="import-confirm"]').focus();
  });
  $('[data-action="import-confirm"]').addEventListener('click', () => {
    if (!pending) return;
    ctx.state = pending.state;
    ctx.status = 'ok';
    ctx.lastSave = ctx.storage.replace(ctx.state);
    ctx.afterImport?.(); // Stage 14: a restore while signed in waits for "this phone only" or "the cloud too"
    dlgImport.close();
    ctx.render();
    ctx.toast(ctx.lastSave.ok ? 'import.done' : 'form.saveFailed');
  });

  // Reset: typed confirmation, with a backup offered first.
  const dlgReset = $('#dlg-reset');
  const resetInput = $('[data-slot="reset-input"]');
  const resetConfirm = $('[data-action="reset-confirm"]');
  let resetOpener = null;
  wireDialog(dlgReset, () => { resetInput.value = ''; resetConfirm.disabled = true; if (resetOpener?.isConnected) resetOpener.focus(); });
  const openReset = (from) => { resetOpener = from; resetConfirm.disabled = true; dlgReset.showModal(); resetInput.focus(); };
  $('[data-action="reset-open"]').addEventListener('click', (e) => openReset(e.currentTarget));
  resetInput.addEventListener('input', () => { resetConfirm.disabled = resetInput.value.trim() !== word; });
  $('[data-action="reset-backup"]').addEventListener('click', () => downloadBackup(ctx));
  dlgReset.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (resetInput.value.trim() !== word) return;
    const { state } = ctx.storage.reset();
    readyTrip(state.trips[state.activeTripId], ctx.pack, ctx.locale, () => makeId());
    const result = ctx.storage.save(state);
    ctx.state = state;
    ctx.status = 'ok';
    ctx.lastSave = result;
    dlgReset.close();
    ctx.render();
    ctx.toast('reset.done');
  });

  // Scoped to the settings panel: the backup banner (rendered earlier, on home) has its own export button.
  $('[data-action="export"]', panel).addEventListener('click', () => downloadBackup(ctx));

  // Banner buttons (rendered later) use one delegated handler.
  $('[data-slot="banners"]').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'export') downloadBackup(ctx);
    if (action === 'import') { ctx.go('settings'); pickFile(); }
    if (action === 'reset') openReset(e.target);
    if (action === 'update' && ctx.waitingWorker) {
      ctx.autosave.flush();
      ctx.updating = true;
      ctx.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  });

  // Install (Android / desktop Chrome offer a prompt; iPhone uses Safari's Share menu).
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    ctx.installPrompt = e;
    renderSettings(ctx);
  });
  addEventListener('appinstalled', () => { ctx.installPrompt = null; renderSettings(ctx); });
  $('[data-slot="install-btn"]').addEventListener('click', async () => {
    const prompt = ctx.installPrompt;
    if (!prompt) return;
    ctx.installPrompt = null;
    await prompt.prompt();
    renderSettings(ctx);
  });
}

// ---------- Offline: service worker with a precached copy; a new version waits until the user agrees ----------
function setupServiceWorker(ctx) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (ctx.updating) location.reload(); // only after "Update"; the first install must not reload the page
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offer = (worker) => { ctx.waitingWorker = worker; renderBanners(ctx); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((error) => console.warn('[TISA] offline mode unavailable:', error.message));
}

boot().catch((error) => {
  // Static Hebrew fallback stays on screen; log for developers only.
  console.warn('[TISA] boot skipped:', error.message);
});
