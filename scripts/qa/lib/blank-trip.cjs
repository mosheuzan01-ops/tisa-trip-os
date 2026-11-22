// Pre-stage-10 PR B (owner decision 2026-11-21): a new install now comes with the plan20k budget and, once dates are
// entered, the suggested route. Older browser scripts were written for a trip that starts with no budget and no
// route; they keep testing that flow from a saved "0.8.3-style" trip: the built-in checklist, no budget, no dates,
// no stops (what an older version left on the phone). Seeded once per browser context, before the app loads.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..', '..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

async function blankState() {
  const [{ createDefaultState }, { readyChecklist }, { TH }, cfg] = await Promise.all([
    mod('src/js/core/schema.js'), mod('src/js/core/checklist.js'), mod('data/packs/th.js'),
    Promise.resolve(require(path.join(ROOT, 'config/app.config.json'))),
  ]);
  let n = 0;
  const makeId = () => `blank-${++n}`;
  const state = createDefaultState({ now: () => new Date(), appVersion: cfg.appVersion, makeId, countryCode: 'TH', tripName: 'תאילנד', language: 'he' });
  readyChecklist(state.trips[state.activeTripId], TH, 'he', makeId);
  return JSON.stringify(state);
}

/** Seed a blank 0.8.3-style trip into a Playwright browser context (once; a reload keeps what the page saved). */
async function blankTrip(ctx) {
  const seed = await blankState();
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('blank-seeded') && !localStorage.getItem('tisa:v1')) { localStorage.setItem('tisa:v1', x); } sessionStorage.setItem('blank-seeded', '1'); }, seed);
}

module.exports = { blankTrip, blankState };
