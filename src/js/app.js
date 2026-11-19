// App entry point: data, navigation, settings, offline. Screens never touch storage directly;
// they change ctx.state through ctx.change(), and the storage layer saves it after a short pause.
import { loadConfig, loadLocale, loadCountry } from './core/load.js';
import { createTranslator, resolveLocale, interpolate } from './core/i18n.js';
import { buildTitle, validateCountry } from './core/country.js';
import {
  todayIn, tripStatus, validateDates, validateBudget, parseAmount, budgetSummary, setupProgress,
} from './core/trip.js';
import { createStorage, browserBackend, requestPersistence, isPersisted } from './core/storage.js';
import { needsBackupReminder } from './core/schema.js';
import { exportBackup, parseBackup, backupFileName } from './core/backup.js';
import { makeId } from './core/ids.js';
import { createAutosave } from './core/autosave.js';
import {
  sortStops, nightsOf, totalNights, validateStop, cleanStop, findOverlaps, overlapsFor, outsideTrip,
  whereToday, seedIfNeeded, moveStop, replanOptions, diffStops,
} from './core/itinerary.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ICONS = './assets/icons.svg#';

// Every screen has an address (#/name). Stage numbers follow the work plan.
const SCREENS = {
  home: { tab: 'home' },
  itinerary: { tab: 'itinerary', title: 'nav.itinerary', icon: 'i-route' }, // built in Stage 3
  money: { tab: 'budget', title: 'screen.money', icon: 'i-wallet', stage: 4 },
  checklist: { tab: 'lists', title: 'screen.checklist', icon: 'i-list', stage: 5 },
  transfers: { title: 'screen.transfers', icon: 'i-plane', stage: 5 },
  info: { title: 'screen.info', icon: 'i-doc', stage: 7 },
  assistant: { title: 'screen.assistant', icon: 'i-chat', stage: 7 },
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
  const [dict, country] = await Promise.all([loadLocale(locale), loadCountry(config.activeCountry)]);
  const problems = validateCountry(country);
  if (problems.length) throw new Error(`Invalid country data: ${problems.join(', ')}`);

  const t = createTranslator(dict);
  document.documentElement.lang = locale;
  document.documentElement.dir = dict.dir;
  document.title = buildTitle(config, country, locale);

  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of $$('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));

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
  // Country pack (planning defaults from the product owner's spec). Optional: the app works without it.
  const pack = await import(`../../data/packs/${config.activeCountry}.js`)
    .then((m) => Object.values(m).find((v) => v && Array.isArray(v.destinations)) ?? null)
    .catch(() => null);
  const fmtLocale = country.dateFormatLocale?.[locale] ?? locale;
  const ctx = {
    t, locale, fmtLocale, country, config, storage,
    state: loaded.state, status: loaded.status, lastSave: null, route: 'home', waitingWorker: null, pack,
  };
  ctx.trip = () => ctx.state.trips[ctx.state.activeTripId];
  /** First open: the pack's stops fill an empty route, once. Never when the saved data could not be read. */
  ctx.seed = (state) => storage.mode !== 'readonly' && seedIfNeeded(state.trips[state.activeTripId], pack?.destinations, locale, () => makeId());

  const autosave = createAutosave((state) => {
    ctx.lastSave = storage.save(state);
    renderBanners(ctx);
  });
  ctx.autosave = autosave;
  /** Change the data, redraw, and save after a short pause (or right away with { now: true }). */
  ctx.change = (fn, { now = false } = {}) => {
    fn(ctx.state);
    ctx.render();
    autosave.schedule(ctx.state);
    if (now) autosave.flush();
    return ctx.lastSave;
  };
  ctx.render = () => {
    applyTheme(ctx.state.settings.theme);
    renderTrip({ t, locale, country, trip: tripView(ctx.trip()) });
    renderItinerary(ctx);
    renderSettings(ctx);
    renderBanners(ctx);
  };
  addEventListener('pagehide', () => autosave.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave.flush(); });

  const seeded = ctx.seed(ctx.state);
  if (loaded.status === 'migrated' || seeded) ctx.lastSave = storage.save(ctx.state); // Stage 1 data moves to the new key (old keys stay)
  if (loaded.status === 'new' || loaded.status === 'migrated') requestPersistence().then(() => renderSettings(ctx));

  setupTheme(ctx);
  setupPass(t);
  setupClock(country, locale, t);
  ctx.toast = setupToast(t);
  setupRouter(ctx);
  setupSheets(ctx);
  setupSettings(ctx);
  setupItinerary(ctx);
  setupServiceWorker(ctx);
  addEventListener('online', () => renderBanners(ctx));
  addEventListener('offline', () => renderBanners(ctx));
  ctx.render();
  setInterval(() => { renderTrip({ t, locale, country, trip: tripView(ctx.trip()) }); renderItinerary(ctx); }, 60_000); // keeps "today" right across midnight
}

/** The Stage 1 home screen reads { dates, budget }; the data model keeps startDate / endDate on the trip. */
function tripView(trip) {
  return {
    dates: trip.startDate && trip.endDate ? { start: trip.startDate, end: trip.endDate } : undefined,
    budget: Number(trip.budget?.amount) > 0 && trip.budget.currency
      ? { amount: Number(trip.budget.amount), currency: trip.budget.currency } : undefined,
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
  return (key) => {
    box.textContent = t(key);
    box.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => box.classList.remove('show'), 2600);
  };
}

// ---------- Trip state on the home screen ----------
function formatDay(iso, locale, opts = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

function formatMoney(value, currency, locale) {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, notation: Math.abs(value) >= 1e6 ? 'compact' : 'standard',
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
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
  const summary = budgetSummary(trip.budget);
  $('[data-slot="budget-empty"]').hidden = Boolean(summary);
  for (const key of ['total', 'spent', 'left']) {
    $(`[data-slot="kpi-${key}"]`).textContent = summary ? formatMoney(summary[key], summary.currency, fmtLocale) : '—';
  }
}


// ---------- Setup sheets on the home screen (native <dialog>: focus trap, Esc to close) ----------
function showFormErrors(t, form, errors) {
  form.querySelector('.form-error').textContent = errors.map((e) => t(`err.${e}`)).join(' ');
  for (const input of form.querySelectorAll('input, select')) {
    const bad = errors.some((e) => e.startsWith(`${input.name}.`) || (input.name === 'end' && e === 'range.tooLong'));
    input.setAttribute('aria-invalid', String(bad));
  }
  form.querySelector('[aria-invalid="true"]')?.focus();
}

function wireDialog(dlg, onClose) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // tap outside the sheet
  for (const b of dlg.querySelectorAll('[data-close]')) b.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', onClose);
}

function setupSheets(ctx) {
  const { t, locale, country, config } = ctx;
  const city = country.timeZoneCity?.[locale] ?? country.timeZone;
  for (const el of $$('[data-slot="dates-hint"]')) el.textContent = interpolate(t('dates.hint'), { city });

  const select = $('[data-slot="currency-select"]');
  const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([locale], { type: 'currency' }) : null;
  for (const code of config.budgetCurrencies) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = names ? interpolate(t('form.currencyOption'), { name: names.of(code), code }) : code;
    select.append(opt);
  }

  const sheets = { dates: $('#dlg-dates'), budget: $('#dlg-budget') };
  let opener = null;

  function open(name, from) {
    opener = from ?? document.activeElement;
    const dlg = sheets[name];
    const form = dlg.querySelector('form');
    const view = tripView(ctx.trip());
    form.reset();
    showFormErrors(t, form, []);
    if (name === 'dates' && view.dates) {
      form.start.value = view.dates.start;
      form.end.value = view.dates.end;
    }
    if (name === 'budget') {
      form.currency.value = view.budget?.currency ?? config.budgetCurrencies[0];
      if (view.budget) form.amount.value = String(view.budget.amount);
    }
    dlg.querySelector('[data-clear]').hidden = !view[name];
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
    sheets.dates.close();
    ctx.saveTripDates(dates);
  });

  $('[data-form="budget"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const entry = { amount: form.amount.value, currency: form.currency.value };
    const errors = validateBudget(entry, config.budgetCurrencies);
    if (errors.length) { showFormErrors(t, form, errors); return; }
    commit((s) => {
      const trip = s.trips[s.activeTripId];
      trip.budget = { ...trip.budget, amount: parseAmount(entry.amount), currency: entry.currency };
    }, sheets.budget, 'toast.saved');
  });

  for (const b of $$('[data-clear]')) {
    b.addEventListener('click', () => {
      const part = b.dataset.clear;
      commit((s) => {
        const trip = s.trips[s.activeTripId];
        if (part === 'dates') { trip.startDate = null; trip.endDate = null; }
        if (part === 'budget') { delete trip.budget.amount; delete trip.budget.currency; }
      }, sheets[part], 'toast.cleared');
    });
  }

  for (const b of $$('[data-open]')) b.addEventListener('click', () => open(b.dataset.open, b));
}

// ---------- Navigation: #/screen addresses, phone Back button, refresh keeps the screen ----------
function setupRouter(ctx) {
  const { t } = ctx;
  const tabs = $$('[role="tab"]');
  const panels = { home: $('#panel-home'), itinerary: $('#panel-itinerary'), soon: $('#panel-soon'), settings: $('#panel-settings') };
  const main = $('#main');
  const rtl = () => document.documentElement.dir === 'rtl';

  // Links to every screen that is not built yet, so each one is reachable from the navigation.
  const more = $('[data-slot="soon-links"]');
  for (const [name, screen] of Object.entries(SCREENS)) {
    if (!screen.stage) continue;
    const a = document.createElement('a');
    a.className = 'soon-link';
    a.href = `#/${name}`;
    a.dataset.route = name;
    a.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${screen.icon}"/></svg><span></span><span class="soon-link-stage"></span>`;
    a.querySelector('span').textContent = t(screen.title);
    a.querySelector('.soon-link-stage').textContent = interpolate(t('soon.linkStage'), { n: screen.stage });
    more.append(a);
  }

  function show(route, { focus = true } = {}) {
    ctx.route = route;
    const screen = SCREENS[route];
    const kind = Object.hasOwn(panels, route) ? route : 'soon';
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
      $('[data-slot="soon-text"]').textContent = interpolate(t('soon.stage'), { n: screen.stage });
      for (const a of $$('.soon-link', more)) a.hidden = a.dataset.route === route;
    }
    renderBanners(ctx);
    if (focus) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
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
    const dates = { start: datesForm.start.value, end: datesForm.end.value };
    const errors = validateDates(dates);
    if (errors.length) { showFormErrors(t, datesForm, errors); return; }
    showFormErrors(t, datesForm, []);
    ctx.saveTripDates(dates);
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
    seedIfNeeded(ctx.trip(), ctx.pack?.destinations, ctx.locale, () => makeId()); // a Stage 2 backup has no route yet
    ctx.status = 'ok';
    ctx.lastSave = ctx.storage.replace(ctx.state);
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
    ctx.state = state;
    ctx.status = 'ok';
    ctx.seed(state); // a fresh start gets the pack's route again, like a first open
    ctx.lastSave = ctx.storage.save(state);
    dlgReset.close();
    ctx.render();
    ctx.toast('reset.done');
  });

  $('[data-action="export"]').addEventListener('click', () => downloadBackup(ctx));

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

// ---------- Route and dates (feature 1, Stage 3): a list of stops, no calendar, no map ----------
const plural = (t, base, n) => (n === 0 && t(`${base}.zero`) !== `${base}.zero` ? t(`${base}.zero`) : n === 1 ? t(`${base}.one`) : interpolate(t(`${base}.other`), { n }));

/** "5 Dec – 8 Dec" style range in the app's date format (Intl, no library). The year shows when it changes. */
function formatRange(start, end, locale, { year = false } = {}) {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const short = { day: 'numeric', month: 'short' };
  const withYear = { ...short, year: 'numeric' };
  return [formatDay(start, locale, sameYear && !year ? short : withYear), formatDay(end, locale, year || !sameYear ? withYear : short)];
}

function icon(name) {
  const box = document.createElement('span');
  box.innerHTML = `<svg class="icon" aria-hidden="true"><use href="${ICONS}${name}"/></svg>`; // fixed markup, no user text
  return box.firstElementChild;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderItinerary(ctx) {
  const panel = $('#panel-itinerary');
  if (!panel) return;
  const { t, fmtLocale, country, locale } = ctx;
  const trip = ctx.trip();
  const stops = sortStops(trip.destinations);
  const today = todayIn(country.timeZone);
  const where = whereToday(stops, today);
  const overlaps = findOverlaps(stops);
  const outside = new Set(outsideTrip(stops, trip));
  const byId = new Map(stops.map((s) => [s.id, s]));

  // Summary
  const summary = $('[data-slot="itin-summary"]');
  const range = $('[data-slot="itin-range"]');
  summary.hidden = range.hidden = stops.length === 0;
  if (stops.length) {
    summary.textContent = interpolate(t('itin.summary'), { stops: plural(t, 'itin.stops', stops.length), nights: plural(t, 'itin.nights', totalNights(stops)) });
    const lastEnd = stops.reduce((m, s) => (s.endDate > m ? s.endDate : m), stops[0].endDate);
    const [a, b] = formatRange(stops[0].startDate, lastEnd, fmtLocale, { year: true });
    range.textContent = interpolate(t('itin.range'), { start: a, end: b });
  }

  // Today (by the destination's calendar date)
  const city = country.timeZoneCity?.[locale] ?? country.timeZone;
  $('[data-slot="itin-today-label"]').textContent = interpolate(t('itin.today.label'), { city });
  const name = (id) => byId.get(id)?.name ?? '';
  const texts = {
    empty: () => t('itin.today.empty'),
    before: () => interpolate(t(where.daysToGo === 1 ? 'itin.today.before.one' : 'itin.today.before.other'), { n: where.daysToGo, name: name(where.nextId) }),
    during: () => {
      if (where.nights === 0) return interpolate(t('itin.today.dayVisit'), { name: name(where.stopId) });
      if (where.leaving) return interpolate(t('itin.today.leaving'), { name: name(where.stopId) });
      return interpolate(t('itin.today.during'), { name: name(where.stopId), night: where.night, nights: where.nights });
    },
    between: () => interpolate(t('itin.today.between'), { name: name(where.nextId) }),
    after: () => t('itin.today.after'),
  };
  const todayCard = $('.itin-today');
  todayCard.dataset.phase = where.phase;
  $('[data-slot="itin-today-text"]').textContent = texts[where.phase]();

  // Warnings (the data is never changed for them; the traveler decides)
  const warnings = [];
  if (overlaps.size) warnings.push(t('itin.warn.overlap'));
  if (outside.size) warnings.push(t('itin.warn.outside'));
  const warnBox = $('[data-slot="itin-warnings"]');
  const warnKey = warnings.join('|');
  if (warnBox.dataset.key !== warnKey) {
    warnBox.dataset.key = warnKey;
    warnBox.replaceChildren(...warnings.map((w) => Object.assign(el('p', 'banner banner-warn', w), { role: 'status' })));
  }

  // List
  $('[data-slot="itin-empty"]').hidden = stops.length > 0;
  const list = $('[data-slot="stops"]');
  const focused = document.activeElement?.closest?.('[data-stop]') && document.activeElement.dataset.do
    ? [document.activeElement.closest('[data-stop]').dataset.stop, document.activeElement.dataset.do] : null;
  list.replaceChildren(...stops.map((s, i) => {
    const li = el('li', 'stop surface');
    li.dataset.stop = s.id;
    const isToday = where.phase === 'during' && where.stopId === s.id;
    if (isToday) { li.classList.add('is-today'); li.setAttribute('aria-current', 'date'); }
    const num = el('span', 'stop-num ltr', String(i + 1));
    num.setAttribute('aria-hidden', 'true');
    const body = el('div', 'stop-body');
    const head = el('div', 'stop-head');
    head.append(el('h3', 'stop-name', s.name));
    if (isToday) head.append(el('span', 'stop-badge is-today', t('itin.badge.today')));
    if (s.flexible) head.append(el('span', 'stop-badge', t('itin.badge.flexible')));
    const [a, b] = formatRange(s.startDate, s.endDate, fmtLocale);
    const meta = el('p', 'stop-meta');
    meta.append(el('span', 'stop-dates', interpolate(t('itin.range'), { start: a, end: b })), el('span', 'stop-nights', plural(t, 'itin.nights', nightsOf(s))));
    body.append(head, meta);
    if (s.note) body.append(el('p', 'stop-note', s.note));
    for (const [on, key] of [[overlaps.has(s.id), 'itin.mark.overlap'], [outside.has(s.id), 'itin.mark.outside']]) {
      if (on) body.append(el('p', 'stop-flag', t(key)));
    }
    const actions = el('div', 'stop-actions');
    for (const [act, ico, key, disabled] of [
      ['up', 'i-up', 'itin.up', i === 0], ['down', 'i-down', 'itin.down', i === stops.length - 1],
      ['edit', 'i-edit', 'itin.edit', false], ['delete', 'i-trash', 'itin.delete', false],
    ]) {
      const btn = el('button', `icon-btn stop-btn stop-${act}`);
      btn.type = 'button';
      btn.dataset.do = act;
      btn.disabled = disabled;
      btn.setAttribute('aria-label', interpolate(t(key), { name: s.name }));
      btn.append(icon(ico));
      actions.append(btn);
    }
    li.append(num, body, actions);
    return li;
  }));
  if (focused) {
    const back = list.querySelector(`[data-stop="${CSS.escape(focused[0])}"] [data-do="${focused[1]}"]`);
    (back && !back.disabled ? back : list.querySelector(`[data-stop="${CSS.escape(focused[0])}"] [data-do="edit"]`))?.focus();
  }
}

/** The "was / will be" rows of the preview dialog. */
function renderPlanRows(ctx, before, after) {
  const { t, fmtLocale } = ctx;
  const fmt = (r) => {
    const [a, b] = formatRange(r.startDate, r.endDate, fmtLocale);
    return `${interpolate(t('itin.range'), { start: a, end: b })}, ${plural(t, 'itin.nights', r.nights)}`;
  };
  $('[data-slot="plan-rows"]').replaceChildren(...diffStops(before, after).map((r) => {
    const li = el('li', `plan-row${r.changed ? ' is-changed' : ''}`);
    li.append(el('span', 'plan-name', r.name));
    if (r.changed) {
      const was = el('span', 'plan-was');
      was.append(el('span', 'plan-tag', t('plan.was')), el('s', '', fmt(r.from)));
      const will = el('span', 'plan-will');
      will.append(el('span', 'plan-tag', t('plan.will')), el('span', '', fmt(r.to)));
      li.append(was, will);
    } else {
      li.append(el('span', 'plan-same', `${fmt(r.to)}, ${t('plan.same')}`));
    }
    return li;
  }));
}

function setupItinerary(ctx) {
  const { t } = ctx;
  const list = $('[data-slot="stops"]');
  const dlgStop = $('#dlg-stop');
  const dlgDelete = $('#dlg-delete');
  const dlgPlan = $('#dlg-plan');
  const stopForm = $('[data-form="stop"]');
  const planForm = $('[data-form="plan"]');
  const stopWarn = $('[data-slot="stop-warn"]');
  const submitBtn = $('[data-slot="stop-submit"]');
  let opener = null;
  let editing = null; // id of the stop being edited, or null when adding
  let warnedFor = null; // the overlap warning was shown for these exact values; a second save means "save anyway"
  let deleting = null;
  let plan = null; // { kind: 'replan' | 'reorder', before, options?, after?, dates? }
  let planned = false;

  const restoreFocus = () => { if (opener?.isConnected) opener.focus(); else $('[data-action="stop-add"]').focus(); };
  wireDialog(dlgStop, restoreFocus);
  wireDialog(dlgDelete, () => { deleting = null; restoreFocus(); });
  wireDialog(dlgPlan, () => {
    if (!planned && plan) ctx.toast('plan.toastCancel');
    plan = null;
    planned = false;
    restoreFocus();
  });

  const stops = () => ctx.trip().destinations;
  const findStop = (id) => stops().find((s) => s.id === id);

  function showStopErrors(errors) {
    $('[data-slot="stop-error"]').textContent = errors.map((e) => t(`stop.err.${e}`)).join(' ');
    const field = { name: 'name', start: 'start', end: 'end', note: 'note' };
    for (const input of stopForm.querySelectorAll('input')) {
      input.setAttribute('aria-invalid', String(errors.some((e) => field[e.split('.')[0]] === input.name)));
    }
    stopForm.querySelector('[aria-invalid="true"]')?.focus();
  }

  function resetWarning() {
    warnedFor = null;
    stopWarn.textContent = '';
    submitBtn.textContent = t('form.save');
  }

  function openStop(id, from) {
    opener = from ?? document.activeElement;
    editing = id;
    stopForm.reset();
    showStopErrors([]);
    resetWarning();
    $('[data-slot="stop-title"]').textContent = t(id ? 'stop.titleEdit' : 'stop.titleAdd');
    const s = id ? findStop(id) : null;
    if (s) {
      stopForm.name.value = s.name;
      stopForm.start.value = s.startDate;
      stopForm.end.value = s.endDate;
      stopForm.note.value = s.note ?? '';
    } else {
      const last = sortStops(stops()).at(-1);
      if (last) stopForm.start.value = last.endDate; // the next stop usually starts where the last one ends
    }
    dlgStop.showModal();
    stopForm.name.focus();
  }

  for (const input of stopForm.querySelectorAll('input')) input.addEventListener('input', resetWarning);

  stopForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const draft = { id: editing ?? makeId(), name: stopForm.name.value, startDate: stopForm.start.value, endDate: stopForm.end.value, note: stopForm.note.value };
    const errors = validateStop(draft);
    if (errors.length) { showStopErrors(errors); resetWarning(); return; }
    showStopErrors([]);
    const clash = overlapsFor(draft, stops());
    const key = JSON.stringify({ ...draft, id: editing });
    if (clash.length && warnedFor !== key) {
      warnedFor = key;
      stopWarn.textContent = interpolate(t('stop.warnOverlap'), { names: clash.map((s) => s.name).join(', ') });
      submitBtn.textContent = t('stop.saveAnyway');
      return;
    }
    const old = editing ? findStop(editing) : null;
    const record = cleanStop({ ...old, ...draft });
    const result = ctx.change((st) => {
      const trip = st.trips[st.activeTripId];
      if (old) trip.destinations = trip.destinations.map((s) => (s.id === old.id ? record : s));
      else trip.destinations.push(record);
    }, { now: true });
    opener = null;
    dlgStop.close();
    list.querySelector(`[data-stop="${CSS.escape(record.id)}"] [data-do="edit"]`)?.focus();
    ctx.toast(result?.ok ? (old ? 'toast.saved' : 'stop.toastAdded') : 'form.saveFailed');
  });

  $('[data-action="stop-add"]').addEventListener('click', (e) => openStop(null, e.currentTarget));

  // One handler for every stop's buttons
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-do]');
    if (!btn || btn.disabled) return;
    const id = btn.closest('[data-stop]').dataset.stop;
    const action = btn.dataset.do;
    if (action === 'edit') openStop(id, btn);
    if (action === 'delete') {
      opener = btn;
      deleting = id;
      $('[data-slot="delete-title"]').textContent = interpolate(t('del.title'), { name: findStop(id).name });
      dlgDelete.showModal();
      dlgDelete.querySelector('[data-close]').focus(); // the safe choice has focus
    }
    if (action === 'up' || action === 'down') {
      const before = sortStops(stops());
      const after = moveStop(before, id, action === 'up' ? -1 : 1);
      if (!after) return;
      opener = btn;
      openPlan({ kind: 'reorder', before, after });
    }
  });

  $('[data-action="delete-confirm"]').addEventListener('click', () => {
    if (!deleting) return;
    const sorted = sortStops(stops());
    const i = sorted.findIndex((s) => s.id === deleting);
    const neighbor = sorted[i + 1] ?? sorted[i - 1];
    const gone = deleting;
    const result = ctx.change((st) => {
      const trip = st.trips[st.activeTripId];
      trip.destinations = trip.destinations.filter((s) => s.id !== gone);
    }, { now: true });
    opener = neighbor ? list.querySelector(`[data-stop="${CSS.escape(neighbor.id)}"] [data-do="edit"]`) : $('[data-action="stop-add"]');
    dlgDelete.close();
    ctx.toast(result?.ok ? 'stop.toastDeleted' : 'form.saveFailed');
  });

  // ---------- Preview dialog: replan after a change of trip dates, or a new order ----------
  const modes = $('[data-slot="plan-modes"]');
  function currentAfter() {
    if (plan.kind === 'reorder') return plan.after;
    const mode = planForm.mode.value;
    const option = plan.options[mode];
    return option?.stops ?? plan.before;
  }
  function refreshPlan() {
    const after = currentAfter();
    renderPlanRows(ctx, plan.before, after);
    let warn = '';
    if (plan.kind === 'replan') {
      const option = plan.options[planForm.mode.value];
      const n = option?.outside?.length ?? 0;
      if (n) warn = n === 1 ? t('plan.outside.one') : interpolate(t('plan.outside.other'), { n });
    }
    $('[data-slot="plan-warn"]').textContent = warn;
  }

  function openPlan(next) {
    plan = next;
    planned = false;
    const replan = plan.kind === 'replan';
    $('[data-slot="plan-title"]').textContent = t(replan ? 'plan.titleReplan' : 'plan.titleReorder');
    $('[data-slot="plan-text"]').textContent = t(replan ? 'plan.textReplan' : 'plan.textReorder');
    modes.hidden = !replan;
    if (replan) {
      const fit = plan.options.fit;
      const flex = plan.before.find((s) => s.flexible);
      const fitInput = planForm.querySelector('input[value="fit"]');
      fitInput.disabled = !fit.ok;
      fitInput.closest('.plan-mode').classList.toggle('is-disabled', !fit.ok);
      $('[data-slot="plan-fit-desc"]').textContent = fit.ok
        ? interpolate(t('plan.mode.fit.desc'), { name: flex.name })
        : fit.reason === 'flexRange' ? interpolate(t('plan.fit.flexRange'), { name: fit.name, min: fit.min, max: fit.max }) : t('plan.fit.noFlexible');
      planForm.mode.value = fit.ok ? 'fit' : 'shift';
    }
    refreshPlan();
    dlgPlan.showModal();
    (replan ? planForm.querySelector('input[name="mode"]:checked') : planForm.querySelector('[type="submit"]')).focus();
  }
  for (const r of planForm.querySelectorAll('input[name="mode"]')) r.addEventListener('change', refreshPlan);

  planForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!plan) return;
    const after = currentAfter();
    const { kind, dates } = plan;
    const result = ctx.change((st) => {
      const trip = st.trips[st.activeTripId];
      if (kind === 'replan') { trip.startDate = dates.start; trip.endDate = dates.end; }
      const next = new Map(after.map((s) => [s.id, s]));
      trip.destinations = trip.destinations.map((s) => next.get(s.id) ?? s);
    }, { now: true });
    planned = true;
    dlgPlan.close();
    ctx.toast(result?.ok ? (kind === 'replan' ? 'toast.saved' : 'plan.toastDone') : 'form.saveFailed');
  });

  /**
   * Save new trip dates. With a route that no longer matches, show the three replan choices first;
   * nothing (not even the trip dates) changes unless the traveler confirms.
   */
  ctx.saveTripDates = (dates) => {
    const before = sortStops(stops());
    const options = replanOptions(before, dates);
    const trip = ctx.trip();
    const changed = trip.startDate !== dates.start || trip.endDate !== dates.end;
    if (options.needed && changed) {
      opener = document.activeElement;
      openPlan({ kind: 'replan', before, options, dates });
      return;
    }
    const result = ctx.change((st) => { const tr = st.trips[st.activeTripId]; tr.startDate = dates.start; tr.endDate = dates.end; }, { now: true });
    ctx.toast(result?.ok ? 'toast.saved' : 'form.saveFailed');
  };
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
