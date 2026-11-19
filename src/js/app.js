// App entry point: wires settings, data and copy into the home screen.
// Trip setup (dates + budget) is stored on this device only. Later-stage actions show a "next stage" note.
import { loadConfig, loadLocale, loadCountry } from './core/load.js';
import { createTranslator, resolveLocale, interpolate } from './core/i18n.js';
import { buildTitle, validateCountry } from './core/country.js';
import {
  todayIn, tripStatus, validateDates, validateBudget, parseAmount, budgetSummary, setupProgress,
} from './core/trip.js';
import { createStore } from './core/store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ICONS = './assets/icons.svg#';

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

  setupTheme(config);
  setupPass();
  setupClock(country, locale, t);
  const toast = setupToast(t);
  const tabs = setupTabs(t);
  for (const el of $$('[data-go]')) el.addEventListener('click', () => tabs.select(el.dataset.go, { focusPanel: true }));
  for (const el of $$('[data-toast]')) el.addEventListener('click', () => toast('toast.next'));

  let storage = null;
  try { storage = window.localStorage; } catch { /* blocked: keep working without saving */ }
  const store = createStore(storage, config.storageKeyPrefix);
  const ctx = { t, locale, country, config, store, toast, trip: store.load() };
  ctx.render = () => renderTrip(ctx);
  setupSheets(ctx);
  ctx.render();
  setInterval(ctx.render, 60_000); // keeps "today" right across midnight at the destination
}

function setupTheme(config) {
  const root = document.documentElement;
  const button = $('.theme-btn');
  const key = `${config.storageKeyPrefix}theme`;
  const sync = () => button.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
  sync();
  button.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(key, root.dataset.theme); } catch { /* private mode: theme just won't persist */ }
    sync();
  });
}

function setupPass() {
  const pass = $('.pass');
  pass.addEventListener('click', () => {
    pass.setAttribute('aria-pressed', String(pass.getAttribute('aria-pressed') !== 'true'));
  });
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

// ---------- Setup sheets (native <dialog>: focus trap, Esc to close) ----------
function setupSheets(ctx) {
  const { t, locale, country, config } = ctx;
  const city = country.timeZoneCity?.[locale] ?? country.timeZone;
  $('[data-slot="dates-hint"]').textContent = interpolate(t('dates.hint'), { city });

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

  function showErrors(form, errors) {
    form.querySelector('.form-error').textContent = errors.map((e) => t(`err.${e}`)).join(' ');
    for (const input of form.querySelectorAll('input, select')) {
      const bad = errors.some((e) => e.startsWith(`${input.name}.`) || (input.name === 'end' && e === 'range.tooLong'));
      input.setAttribute('aria-invalid', String(bad));
    }
    form.querySelector('[aria-invalid="true"]')?.focus();
  }

  function open(name, from) {
    opener = from ?? document.activeElement;
    const dlg = sheets[name];
    const form = dlg.querySelector('form');
    form.reset();
    showErrors(form, []);
    if (name === 'dates' && ctx.trip.dates) {
      form.start.value = ctx.trip.dates.start;
      form.end.value = ctx.trip.dates.end;
    }
    if (name === 'budget') {
      form.currency.value = ctx.trip.budget?.currency ?? config.budgetCurrencies[0];
      if (ctx.trip.budget) form.amount.value = String(ctx.trip.budget.amount);
    }
    dlg.querySelector('[data-clear]').hidden = !ctx.trip[name];
    dlg.showModal();
    form.querySelector('input').focus();
  }

  for (const dlg of Object.values(sheets)) {
    dlg.addEventListener('close', () => { if (opener?.isConnected) opener.focus(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // tap outside the sheet
    for (const b of dlg.querySelectorAll('[data-close]')) b.addEventListener('click', () => dlg.close());
  }

  function commit(next, dlg, message) {
    ctx.trip = next;
    const saved = ctx.store.save(next);
    ctx.render();
    dlg.close();
    ctx.toast(saved ? message : 'form.saveFailed');
  }

  $('[data-form="dates"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const dates = { start: form.start.value, end: form.end.value };
    const errors = validateDates(dates);
    if (errors.length) { showErrors(form, errors); return; }
    commit({ ...ctx.trip, dates }, sheets.dates, 'toast.saved');
  });

  $('[data-form="budget"]').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const entry = { amount: form.amount.value, currency: form.currency.value };
    const errors = validateBudget(entry, config.budgetCurrencies);
    if (errors.length) { showErrors(form, errors); return; }
    commit({ ...ctx.trip, budget: { amount: parseAmount(entry.amount), currency: entry.currency } }, sheets.budget, 'toast.saved');
  });

  for (const b of $$('[data-clear]')) {
    b.addEventListener('click', () => {
      const next = { ...ctx.trip };
      delete next[b.dataset.clear];
      commit(next, sheets[b.dataset.clear], 'toast.cleared');
    });
  }

  for (const b of $$('[data-open]')) b.addEventListener('click', () => open(b.dataset.open, b));
}

// Accessible tabs: click, Enter/Space, arrow keys (RTL-aware), Home/End; roving tabindex; URL hash.
function setupTabs(t) {
  const tabs = $$('[role="tab"]');
  const home = $('#panel-home');
  const soon = $('#panel-soon');
  const main = $('#main');
  const rtl = () => document.documentElement.dir === 'rtl';

  function select(name, { focusPanel = false, updateHash = true } = {}) {
    const tab = tabs.find((x) => x.dataset.tab === name) ?? tabs[0];
    for (const x of tabs) {
      const on = x === tab;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
    }
    const isHome = tab.dataset.tab === 'home';
    home.hidden = !isHome;
    soon.hidden = isHome;
    if (!isHome) {
      soon.setAttribute('aria-labelledby', tab.id);
      $('[data-slot="soon-title"]').textContent = t(`nav.${tab.dataset.tab}`);
      $('[data-slot="soon-icon"]').setAttribute('href', ICONS + tab.dataset.icon);
    }
    if (updateHash) history.replaceState(null, '', isHome ? location.pathname : `#${tab.dataset.tab}`);
    if (focusPanel) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab.dataset.tab));
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

  $('.brand').addEventListener('click', (e) => { e.preventDefault(); select('home', { focusPanel: true }); });
  const fromHash = () => select(location.hash.slice(1) || 'home', { updateHash: false });
  window.addEventListener('hashchange', fromHash);
  fromHash();
  return { select };
}

boot().catch((error) => {
  // Static Hebrew fallback stays on screen; log for developers only.
  console.warn('[TISA] boot skipped:', error.message);
});
