// The app's data model (one object, saved under one key) and its version migrations. Pure functions, no DOM.
// Shape and rules are documented in docs/BACKUP_FORMAT.md; a backup file carries this same object.
import { isIsoDate, daysBetween } from './trip.js';
import { toMinor } from './money.js';

export const SCHEMA_VERSION = 8;
export const DEFAULT_QUESTION_LIMIT = 50;
export const BACKUP_REMINDER_DAYS = 7;

const ARRAY_FIELDS = ['destinations', 'expenses', 'transfers', 'checklist', 'events', 'tasks', 'checkins', 'photos', 'places'];
const OBJECT_FIELDS = ['budget', 'rates', 'info', 'assistant', 'journal', 'luggage'];
/** Empty slots for later features, so later stages add data without changing the shape. */
export const TRIP_FEATURE_FIELDS = ['destinations', 'expenses', 'budget', 'rates', 'transfers', 'checklist', 'tasks', 'events', 'info', 'assistant', 'journal', 'checkins', 'luggage', 'photos', 'places'];
const THEMES = [null, 'light', 'dark'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Stage 4 budget: whole minor units in the base currency, nine categories, nothing filled in. */
export const emptyBudget = () => ({ currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false, categoryNames: {}, hidden: [] });
/** Stage 9: copies of a budget or route the user replaced. Only ever added to. */
export const emptyArchive = () => ({ budgets: [], routes: [] });
/** Stage 6 luggage: bags the user adds by hand; weights in whole grams, no limit until the user sets one. */
export const emptyLuggage = () => ({ bags: [] });
/** Stage 12 smart suitcase: the activities the user chose. Suggestions are worked out, never stored. */
export const emptySmartBag = () => ({ activities: [] });

export function createTrip({ makeId, countryCode, tripName }) {
  const trip = { id: makeId(), countryCode, name: tripName, startDate: null, endDate: null };
  for (const f of ARRAY_FIELDS) trip[f] = [];
  for (const f of OBJECT_FIELDS) trip[f] = {};
  trip.budget = emptyBudget();
  trip.luggage = emptyLuggage();
  trip.smartBag = emptySmartBag();
  trip.archive = emptyArchive();
  trip.templateOffer = null;
  return trip;
}

export function createDefaultState({ now, appVersion, makeId, countryCode, tripName, language = 'he' }) {
  const at = now().toISOString();
  const trip = createTrip({ makeId, countryCode, tripName });
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    createdAt: at,
    updatedAt: at,
    settings: { language, theme: null, lastBackupAt: null, assistantQuestionLimit: DEFAULT_QUESTION_LIMIT },
    activeTripId: trip.id,
    trips: { [trip.id]: trip },
  };
}

/** Problems with a state object, as short codes. Empty array = valid. */
export function validateState(state) {
  if (!isObj(state)) return ['state.notObject'];
  const errors = [];
  if (state.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion');
  for (const f of ['appVersion', 'createdAt', 'updatedAt']) if (typeof state[f] !== 'string') errors.push(f);
  const s = state.settings;
  if (!isObj(s)) errors.push('settings');
  else {
    if (typeof s.language !== 'string') errors.push('settings.language');
    if (!THEMES.includes(s.theme ?? null)) errors.push('settings.theme');
    if (s.lastBackupAt !== null && typeof s.lastBackupAt !== 'string') errors.push('settings.lastBackupAt');
    if (!Number.isInteger(s.assistantQuestionLimit) || s.assistantQuestionLimit < 0) errors.push('settings.assistantQuestionLimit');
  }
  if (!isObj(state.trips)) return [...errors, 'trips'];
  if (!(state.activeTripId in state.trips)) errors.push('activeTripId');
  for (const [id, trip] of Object.entries(state.trips)) {
    if (!isObj(trip) || trip.id !== id) { errors.push(`trip.${id}`); continue; }
    if (typeof trip.countryCode !== 'string' || typeof trip.name !== 'string') errors.push(`trip.${id}.meta`);
    for (const f of ['startDate', 'endDate']) if (trip[f] !== null && !isIsoDate(trip[f])) errors.push(`trip.${id}.${f}`);
    if (trip.startDate && trip.endDate && daysBetween(trip.startDate, trip.endDate) < 0) errors.push(`trip.${id}.range`);
    for (const f of ARRAY_FIELDS) if (!Array.isArray(trip[f])) errors.push(`trip.${id}.${f}`);
    for (const f of OBJECT_FIELDS) if (!isObj(trip[f])) errors.push(`trip.${id}.${f}`);
    if (isObj(trip.luggage) && !Array.isArray(trip.luggage.bags)) errors.push(`trip.${id}.luggage.bags`);
    if (!isObj(trip.smartBag) || !Array.isArray(trip.smartBag.activities)) errors.push(`trip.${id}.smartBag`);
    if (!isObj(trip.archive) || !Array.isArray(trip.archive.budgets) || !Array.isArray(trip.archive.routes)) errors.push(`trip.${id}.archive`);
    if (isObj(trip.budget) && (!isObj(trip.budget.categoryNames) || !Array.isArray(trip.budget.hidden))) errors.push(`trip.${id}.budget.names`);
  }
  return errors;
}

// One function per version step. Never delete user data; carry unknown fields over.
const MIGRATIONS = {
  // 0 -> 1: the Stage 1 format ("tisa:trip" { dates, budget } + "tisa:theme") becomes one versioned object.
  0(old, opts) {
    const next = createDefaultState(opts);
    next.schemaVersion = 1; // the next step brings it to the current version
    const trip = next.trips[next.activeTripId];
    const { dates, budget, ...rest } = isObj(old.trip) ? old.trip : {};
    for (const [k, v] of Object.entries(rest)) if (!(k in trip)) trip[k] = v;
    if (isObj(dates)) {
      if (isIsoDate(dates.start)) trip.startDate = dates.start;
      if (isIsoDate(dates.end)) trip.endDate = dates.end;
    }
    if (isObj(budget)) trip.budget = { ...budget };
    if (old.theme === 'light' || old.theme === 'dark') next.settings.theme = old.theme;
    return next;
  },
  // 1 -> 2 (Stage 4): budget { amount, currency } in decimals becomes whole minor units with categories.
  // Nothing is dropped: unknown budget fields stay, and every other trip field is untouched.
  1(old) {
    const next = { ...old, schemaVersion: 2, trips: {} };
    for (const [id, trip] of Object.entries(old.trips ?? {})) {
      const b = isObj(trip?.budget) ? trip.budget : {};
      if ('categoriesMinor' in b) { next.trips[id] = trip; continue; }
      const { amount, currency, ...rest } = b;
      const total = Number(amount) > 0 ? toMinor(amount) : null;
      next.trips[id] = { ...trip, budget: { ...emptyBudget(), ...rest, currency: typeof currency === 'string' ? currency : 'ILS', totalMinor: total } };
    }
    return next;
  },
  // 2 -> 3 (Stage 5): tasks are added; any old checklist entries get the new fields' defaults. Nothing else changes.
  2(old) {
    const next = { ...old, schemaVersion: 3, trips: {} };
    for (const [id, trip] of Object.entries(old.trips ?? {})) {
      const list = Array.isArray(trip?.checklist) ? trip.checklist : [];
      next.trips[id] = {
        ...trip,
        tasks: Array.isArray(trip?.tasks) ? trip.tasks : [],
        checklist: list.map((x) => (isObj(x) ? { group: 'documents', qty: 1, note: '', done: false, ...x } : x)),
      };
    }
    return next;
  },
  // 3 -> 4 (Stage 6): journal, check-ins and luggage are added empty. Fields that already exist and everything else stay.
  3(old) {
    const next = { ...old, schemaVersion: 4, trips: {} };
    for (const [id, trip] of Object.entries(old.trips ?? {})) {
      next.trips[id] = {
        ...trip,
        journal: isObj(trip?.journal) ? trip.journal : {},
        checkins: Array.isArray(trip?.checkins) ? trip.checkins : [],
        luggage: isObj(trip?.luggage) && Array.isArray(trip.luggage.bags) ? trip.luggage : emptyLuggage(),
      };
    }
    return next;
  },
  // 4 -> 5 (Stage 7): photo metadata is added empty. The images themselves live in IndexedDB, never here.
  4(old) {
    const next = { ...old, schemaVersion: 5, trips: {} };
    for (const [id, trip] of Object.entries(old.trips ?? {})) {
      next.trips[id] = { ...trip, photos: Array.isArray(trip?.photos) ? trip.photos : [] };
    }
    return next;
  },
  // 5 -> 6 (Stage 9): an archive for replaced budgets and routes, a trip's own category names, hidden empty
  // categories, and the one-time template offer. Only additions: every existing field stays as it was.
  5(old) {
    const next = { ...old, schemaVersion: 6, trips: {} };
    for (const [id, trip] of Object.entries(old.trips ?? {})) {
      const b = isObj(trip?.budget) ? trip.budget : emptyBudget();
      const a = isObj(trip?.archive) ? trip.archive : {};
      next.trips[id] = {
        ...trip,
        budget: { ...b, categoryNames: isObj(b.categoryNames) ? b.categoryNames : {}, hidden: Array.isArray(b.hidden) ? b.hidden : [] },
        archive: { ...a, budgets: Array.isArray(a.budgets) ? a.budgets : [], routes: Array.isArray(a.routes) ? a.routes : [] },
        templateOffer: trip?.templateOffer ?? null,
      };
    }
    return next;
  },
  // 6 -> 7 (Stage 10): saved places are added empty. Only an addition: places that already exist and every other
  // field stay exactly as they were.
  6(old) {
    const next = { ...old, schemaVersion: 7, trips: {} };
    for (const [id, trip] of Object.entries(old.trips ?? {})) {
      next.trips[id] = { ...trip, places: Array.isArray(trip?.places) ? trip.places : [] };
    }
    return next;
  },
  // 7 -> 8 (Stage 12): the smart suitcase's chosen activities, added empty. Only an addition: checklist items,
  // bags and every other field stay exactly as they were; a smartBag that already exists is kept.
  7(old) {
    const next = { ...old, schemaVersion: 8, trips: {} };
    for (const [id, trip] of Object.entries(old.trips ?? {})) {
      const sb = trip?.smartBag;
      next.trips[id] = { ...trip, smartBag: isObj(sb) && Array.isArray(sb.activities) ? sb : { ...(isObj(sb) ? sb : {}), activities: [] } };
    }
    return next;
  },
};

/** Bring older data up to SCHEMA_VERSION. Data that is already current is returned unchanged. */
export function migrate(data, opts) {
  let out = data;
  let v = Number.isInteger(out?.schemaVersion) ? out.schemaVersion : 0;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`no migration from schema ${v}`);
    out = step(out, opts);
    v = out.schemaVersion;
  }
  return out;
}

/** True when no backup was made in the last 7 days (counting from install when there was never one). */
export function needsBackupReminder(state, now) {
  const since = state.settings?.lastBackupAt ?? state.createdAt;
  const ms = now.getTime() - new Date(since).getTime();
  return Number.isFinite(ms) && ms >= BACKUP_REMINDER_DAYS * 86_400_000;
}

/** 1.1.4: the longest trip name the new-trip dialog takes. */
export const TRIP_NAME_MAX = 60;

/** 1.1.4: "New trip". Adds an empty trip next to the others (the same shape as createTrip) and shows it. No other trip
 *  is read, changed or removed. The new trip is local only: it has no sync entry, so it is "on this device only"
 *  until the user moves it to the account. No template, dates, route or budget: those belong to the country pack's own plan.
 *  Returns { ok, id } or { ok: false } (empty or too long name; nothing changes then). */
export function addTrip(state, { name, makeId, countryCode }) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean || clean.length > TRIP_NAME_MAX || !isObj(state?.trips)) return { ok: false };
  let id = makeId();
  for (let i = 0; Object.hasOwn(state.trips, id) && i < 20; i += 1) id = makeId();
  if (Object.hasOwn(state.trips, id)) return { ok: false };
  const trip = createTrip({ makeId: () => id, countryCode, tripName: clean });
  state.trips[id] = trip;
  state.activeTripId = id;
  return { ok: true, id };
}
