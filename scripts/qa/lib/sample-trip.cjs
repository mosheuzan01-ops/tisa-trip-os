// Stage 12: a sample trip (rule 16: sample dates and data only, not the owner's trip). Built with the app's own core
// functions: a new trip (built-in checklist, plan20k budget) with dates, so the suggested route is filled.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..', '..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const START = '2030-12-20';
const END = '2031-01-20';

async function sampleState({ start = START, end = END } = {}) {
  const [{ createDefaultState }, { readyTrip, fillRoute }, { TH }, cfg] = await Promise.all([
    mod('src/js/core/schema.js'), mod('src/js/core/template.js'), mod('data/packs/th.js'),
    Promise.resolve(require(path.join(ROOT, 'config/app.config.json'))),
  ]);
  let n = 0;
  const makeId = () => `sample-${++n}`;
  const state = createDefaultState({ now: () => new Date('2030-11-01T10:00:00Z'), appVersion: cfg.appVersion, makeId, countryCode: 'TH', tripName: 'תאילנד', language: 'he' });
  const trip = state.trips[state.activeTripId];
  trip.startDate = start;
  trip.endDate = end;
  readyTrip(trip, TH, 'he', makeId);
  fillRoute(trip, TH, 'he', makeId);
  return state;
}

/** Seed the sample trip into a Playwright context once (a reload keeps what the page saved). */
async function sampleTrip(ctx, opts) {
  const seed = JSON.stringify(await sampleState(opts));
  await ctx.addInitScript((x) => { if (!sessionStorage.getItem('sample-seeded') && !localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); sessionStorage.setItem('sample-seeded', '1'); }, seed);
}

module.exports = { sampleTrip, sampleState, START, END };
