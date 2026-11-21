// Stage 9: the one-time "switch to the new template" step for a user who already has data (owner, 2026-11-21).
// Applying copies the current budget and route into trip.archive first, then sets the template budget and, when
// the trip has dates, the suggested route. Expenses, transfers, check-ins, photos and every other field are never
// touched. Declining only records the answer. Pure functions on the trip object; tests/stage9-data.test.js.
import { profileToBudget, EMERGENCY } from './money.js';
import { planRoute } from './route-plan.js';
import { isIsoDate } from './trip.js';

export const TEMPLATE_ID = 'plan20k';

const hasBudget = (b) => Object.keys(b?.categoriesMinor ?? {}).length > 0 || Number.isInteger(b?.totalMinor);
const hasData = (trip) => hasBudget(trip?.budget) || (trip?.destinations?.length ?? 0) > 0 || (trip?.expenses?.length ?? 0) > 0;

/** True once, for a trip that already has a budget, stops or expenses and is not on the template yet. */
export function needsTemplateOffer(trip) {
  if (!trip || trip.templateOffer === 'applied' || trip.templateOffer === 'declined') return false;
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
  const next = profileToBudget(tpl, locale);
  const own = trip.budget?.categoriesMinor?.[EMERGENCY];
  if (Number.isInteger(own) && own > 0) next.categoriesMinor[EMERGENCY] = own; // never wipe the user's own emergency amount
  trip.budget = { ...trip.budget, ...next };
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
