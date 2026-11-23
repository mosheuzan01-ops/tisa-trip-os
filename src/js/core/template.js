// Stage 9: the one-time "switch to the new template" step for a user who already has data (owner, 2026-11-21).
// Applying copies the current budget and route into trip.archive first, then sets the template budget and, when
// the trip has dates, the suggested route. Expenses, transfers, check-ins, photos and every other field are never
// touched. Declining only records the answer. Pure functions on the trip object; tests/stage9-data.test.js.
import { profileToBudget, withProfile } from './money.js';
import { planRoute } from './route-plan.js';
import { isIsoDate } from './trip.js';
import { cleanStops } from './itinerary.js';
import { readyChecklist } from './checklist.js';

export const TEMPLATE_ID = 'plan20k';

const hasBudget = (b) => Object.keys(b?.categoriesMinor ?? {}).length > 0 || Number.isInteger(b?.totalMinor);
const hasData = (trip) => hasBudget(trip?.budget) || (trip?.destinations?.length ?? 0) > 0 || (trip?.expenses?.length ?? 0) > 0;

/** True once, for a trip that already has a budget, stops or expenses and is not on the template yet. */
export function needsTemplateOffer(trip) {
  // 'new' (stage 13): a trip that started in this version; the switch offer is only for trips from before the template.
  if (!trip || trip.templateOffer === 'applied' || trip.templateOffer === 'declined' || trip.templateOffer === 'new') return false;
  if (trip.budget?.profileId === TEMPLATE_ID) return false;
  return hasData(trip);
}

export function declineTemplate(trip) {
  trip.templateOffer = 'declined';
}

/** What applying would do, for the confirmation step. */
export function templatePreview(trip) {
  const dates = isIsoDate(trip?.startDate) && isIsoDate(trip?.endDate);
  return {
    archivesBudget: hasBudget(trip?.budget),
    replacesRoute: dates,
    archivesRoute: dates && (trip?.destinations?.length ?? 0) > 0,
    keepsExpenses: trip?.expenses?.length ?? 0,
  };
}

/** Apply the template. Changes only budget, destinations (with dates), archive and templateOffer. */
export function applyTemplate(trip, pack, locale, makeId, nowIso) {
  const tpl = pack.budgetTemplates.find((x) => x.id === TEMPLATE_ID);
  if (!tpl) return { warnings: ['template.missing'] };
  const archive = trip.archive ?? { budgets: [], routes: [] };
  archive.budgets = Array.isArray(archive.budgets) ? archive.budgets : [];
  archive.routes = Array.isArray(archive.routes) ? archive.routes : [];
  if (hasBudget(trip.budget)) archive.budgets.push({ at: nowIso, budget: structuredClone(trip.budget) });
  // never wipe the user's own emergency amount; 1.0.1: an anchored total stays (withProfile, core/money.js)
  trip.budget = withProfile(trip.budget, tpl, locale);
  let warnings = [];
  if (isIsoDate(trip.startDate) && isIsoDate(trip.endDate)) {
    const route = planRoute(trip.startDate, trip.endDate, pack.routeTemplate, locale, makeId);
    warnings = route.warnings;
    if (route.stops.length) {
      if ((trip.destinations?.length ?? 0) > 0) archive.routes.push({ at: nowIso, destinations: structuredClone(trip.destinations) });
      trip.destinations = route.stops;
    }
  }
  trip.archive = archive;
  trip.templateOffer = 'applied';
  return { warnings };
}

/** A stop's name for an expense or transfer: from the route, or from an archived route. null when unknown. */
export function stopNameFor(trip, id) {
  if (!id) return null;
  const live = (trip?.destinations ?? []).find((x) => x?.id === id);
  if (live) return { name: live.name, archived: false };
  for (const r of [...(trip?.archive?.routes ?? [])].reverse()) {
    const old = (r.destinations ?? []).find((x) => x?.id === id);
    if (old) return { name: old.name, archived: true };
  }
  return null;
}


// ---------- Pre-stage-10 PR B (owner, 2026-11-21): a new trip comes ready ----------

/** A budget with the template's category names and every amount at 0: "no budget yet" (stage 13, owner 2026-11-22).
 *  Each user enters their own; the 20,000 template itself is a manual choice ("load another template"). */
function blankBudget(tpl, locale) {
  const b = profileToBudget(tpl, locale);
  return { ...b, categoriesMinor: Object.fromEntries(Object.keys(b.categoriesMinor).map((k) => [k, 0])), profileId: null, estimate: false };
}

/** A new (or reset) trip: the built-in checklist; the shared trip dates and the suggested route (stage 13); and,
 *  when it has no budget of its own, the template's categories at 0. A trip with data of its own is left as it is:
 *  own dates keep their own route, own stops are never touched, own budget stays. docs/BUDGET_AND_START.md. */
export function readyTrip(trip, pack, locale, makeId) {
  readyChecklist(trip, pack, locale, makeId);
  const d = pack?.defaultTrip;
  const noDates = !isIsoDate(trip.startDate) && !isIsoDate(trip.endDate);
  if (noDates && !cleanStops(trip.destinations).length && isIsoDate(d?.start) && isIsoDate(d?.end)) {
    trip.startDate = d.start;
    trip.endDate = d.end;
  }
  fillRoute(trip, pack, locale, makeId);
  const tpl = pack?.budgetTemplates?.find((x) => x.id === TEMPLATE_ID);
  if (!tpl || hasBudget(trip.budget) || trip.budget?.profileId) return;
  trip.budget = { ...trip.budget, ...blankBudget(tpl, locale) };
  if (trip.templateOffer == null) trip.templateOffer = 'new';
}

/** Dates were saved: a trip with no stops gets the suggested route at once. Stops that exist are never touched. */
export function fillRoute(trip, pack, locale, makeId) {
  if (!isIsoDate(trip?.startDate) || !isIsoDate(trip?.endDate) || cleanStops(trip.destinations).length) return { added: 0, warnings: [] };
  const route = planRoute(trip.startDate, trip.endDate, pack?.routeTemplate, locale, makeId);
  if (route.stops.length) trip.destinations = [...(Array.isArray(trip.destinations) ? trip.destinations : []), ...route.stops];
  return { added: route.stops.length, warnings: route.warnings };
}

/** "New route from the template", after the preview and a yes: the current route goes to the archive exactly,
 *  the trip takes the new dates and the suggested route. Nothing changes when no route can be made. */
export function rebuildRoute(trip, dates, pack, locale, makeId, nowIso) {
  const route = planRoute(dates?.start, dates?.end, pack?.routeTemplate, locale, makeId);
  if (!route.stops.length) return { warnings: route.warnings };
  const archive = trip.archive ?? { budgets: [], routes: [] };
  archive.budgets = Array.isArray(archive.budgets) ? archive.budgets : [];
  archive.routes = Array.isArray(archive.routes) ? archive.routes : [];
  if ((trip.destinations?.length ?? 0) > 0) archive.routes.push({ at: nowIso, destinations: structuredClone(trip.destinations) });
  trip.archive = archive;
  trip.startDate = dates.start;
  trip.endDate = dates.end;
  trip.destinations = route.stops;
  return { warnings: route.warnings };
}
