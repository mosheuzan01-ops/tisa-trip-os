// Stage 12 PR 2 (0.11.1): smart suitcase. Suggestions only, from local rules (data/packing/th.json); a suggestion
// becomes a normal checklist item only after a tap (owner decision 2026-11-22, option A). Sample data only (rule 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  destinationKind, tripDays, routeKinds, cleanActivities, suggestions, applyForecast, acceptSuggestion, acceptAll,
  setActivities, smartActivities,
} from '../src/js/core/smart-bag.js';
import { GROUPS, builtinItems, groupSection } from '../src/js/core/checklist.js';
import { createDefaultState, migrate, validateState, SCHEMA_VERSION } from '../src/js/core/schema.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';
import { TH } from '../data/packs/th.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const DATA = JSON.parse(read('data/packing/th.json'));
const he = JSON.parse(read('locales/he.json'));
const en = JSON.parse(read('locales/en.json'));
let n = 0;
const makeId = () => `id-${++n}`;
const stop = (name, startDate, endDate) => ({ id: makeId(), name, startDate, endDate, note: '' });
/** A sample trip: dates, a route, the built-in checklist only when asked. */
function trip({ start = '2030-12-20', end = '2031-01-20', stops = ['בנגקוק'], builtin = false, activities } = {}) {
  const t = { id: 't', startDate: start, endDate: end, destinations: stops.map((s) => stop(s, start, end)), checklist: [], luggage: { bags: [] } };
  if (builtin) t.checklist = builtinItems(TH, 'he', makeId);
  if (activities) t.smartBag = { activities };
  return t;
}
const keys = (list) => list.map((x) => x.key);
const find = (r, key) => [...(r.must ?? []), ...(r.nice ?? []), ...(r.avoid ?? [])].find((x) => x.key === key);
/** The suggestion, asserted to be there (a red is an assertion, not a TypeError). */
const got = (r, key) => { const x = find(r, key); assert.ok(x, `suggestion ${key} is shown`); return x; };

test('B-1 the rules file: 7 activities, a 7-day clothes cap, every rule well formed, names in he and en', () => {
  assert.equal(DATA.clothesCapDays, 7);
  assert.deepEqual(DATA.activities.map((a) => a.id), ['beach', 'snorkel', 'party', 'temples', 'trek', 'motorbike', 'city']);
  const bad = [];
  for (const r of DATA.rules) {
    if (!r.key || !r.name?.he || !r.name?.en) bad.push(`${r.key}: name`);
    if (!['must', 'nice', 'avoid'].includes(r.category)) bad.push(`${r.key}: category`);
    if (r.category !== 'avoid' && !GROUPS.includes(r.group)) bad.push(`${r.key}: group ${r.group}`);
    if (r.category !== 'avoid' && !['carry', 'bag'].includes(groupSection(r.group))) bad.push(`${r.key}: not in carry-on or bag`);
    if (r.category !== 'avoid' && !(Number.isInteger(r.qty) || ['cap', 'halfCap'].includes(r.qty))) bad.push(`${r.key}: qty`);
    if (r.category === 'avoid' && (!r.reason?.he || !r.reason?.en)) bad.push(`${r.key}: reason`);
    if (!r.when || !Object.keys(r.when).length) bad.push(`${r.key}: when`);
    for (const a of r.when?.activities ?? []) if (!DATA.activities.some((x) => x.id === a)) bad.push(`${r.key}: activity ${a}`);
    for (const k of r.when?.kinds ?? []) if (!(k in DATA.kinds)) bad.push(`${r.key}: kind ${k}`);
    if (r.sameAs && !TH.checklistBuiltin.some((x) => x.key === r.sameAs)) bad.push(`${r.key}: sameAs ${r.sameAs}`);
  }
  assert.deepEqual(bad, []);
});

test('B-2 the motorbike licence is a "to check" item: Thailand\'s legal requirements are not stated as fact (owner, 2026-11-22)', () => {
  const lic = DATA.rules.find((r) => r.key === 'moto-licence');
  assert.equal(lic.verify, true);
  assert.match(lic.note.he, /טרם אומתו/);
  assert.match(lic.note.he, /מקור רשמי/);
  assert.ok(!DATA.rules.some((r) => /ישראלי|בינלאומי/.test(r.name.he)), 'no rule names a specific licence as required');
  for (const r of DATA.rules.filter((x) => x.key.startsWith('temple-'))) assert.equal(r.verify, true);
});

test('B-3 destination kind by name only (owner: names for now): city, island, beach; unknown names are not classified', () => {
  assert.equal(destinationKind('בנגקוק', DATA), 'city');
  assert.equal(destinationKind('  bangkok ', DATA), 'city');
  assert.equal(destinationKind('קו  טאו', DATA), 'island');
  assert.equal(destinationKind('פוקט', DATA), 'beach');
  assert.equal(destinationKind('פאי', DATA), null);
  const r = routeKinds(trip({ stops: ['בנגקוק', 'קו סמוי', 'פאי'] }), DATA);
  assert.deepEqual(r.kinds, ['city', 'island']);
  assert.deepEqual(r.unclassified, ['פאי']);
});

test('B-4 (S12-3) the number of days changes the suggestions and the quantities (cap 7, laundry on the way)', () => {
  assert.equal(tripDays(trip({ start: '2030-12-20', end: '2030-12-22' })), 3);
  const short = suggestions(trip({ start: '2030-12-20', end: '2030-12-22' }), DATA, 'he');
  const long = suggestions(trip(), DATA, 'he');
  assert.equal(got(short, 'underwear').qty, 3);
  assert.equal(got(long, 'underwear').qty, 7);
  assert.equal(got(short, 'shorts').qty, 2);
  assert.equal(got(long, 'shorts').qty, 4);
  assert.equal(find(short, 'laundry-soap'), undefined);
  assert.ok(find(long, 'laundry-soap'));
  assert.ok(find(long, 'sewing-kit'));
  assert.equal(find(short, 'outfit-per-day'), undefined);
  assert.match(got(long, 'outfit-per-day').reason, /7/);
  const none = suggestions(trip({ start: null, end: null }), DATA, 'he');
  assert.equal(none.days, null);
  assert.equal(got(none, 'underwear').qty, 7, 'no dates: the cap');
  assert.equal(find(none, 'laundry-soap'), undefined, 'no dates: no day-based rule');
});

test('B-5 (S12-3) the destinations change the suggestions: an island brings swimwear and a hat; an unclassified stop brings nothing', () => {
  const city = suggestions(trip({ stops: ['בנגקוק'] }), DATA, 'he');
  const island = suggestions(trip({ stops: ['בנגקוק', 'קו טאו'] }), DATA, 'he');
  const pai = suggestions(trip({ stops: ['פאי'] }), DATA, 'he');
  assert.equal(find(city, 'swimwear'), undefined);
  assert.equal(got(island, 'swimwear').category, 'must');
  assert.equal(got(island, 'swimwear').qty, 2);
  assert.ok(find(island, 'hat'));
  assert.equal(got(city, 'walking-shoes').category, 'must');
  assert.equal(got(pai, 'walking-shoes').category, 'nice');
  assert.deepEqual(pai.unclassified, ['פאי']);
});

test('B-6 (S12-3) the activities change the suggestions; the same item from two rules shows once, at the higher level', () => {
  const plain = suggestions(trip(), DATA, 'he');
  const act = suggestions(trip({ activities: ['snorkel', 'trek', 'motorbike'] }), DATA, 'he');
  assert.equal(find(plain, 'dive-card'), undefined);
  assert.equal(got(act, 'dive-card').category, 'must');
  assert.equal(got(plain, 'socks').category, 'nice');
  assert.equal(got(plain, 'socks').qty, 2);
  assert.equal(got(act, 'socks').category, 'must');
  assert.equal(got(act, 'socks').qty, 7);
  assert.equal([...act.must, ...act.nice].filter((x) => x.key === 'socks').length, 1);
  const lic = find(act, 'moto-licence');
  assert.equal(lic.verify, true);
  assert.match(lic.note, /טרם אומתו/);
  assert.equal(got(act, 'moto-licence').group, 'carryOn');
});

test('B-7 (S12-4) no suggestion for an item already in the checklist (by name, by built-in key) or in a bag', () => {
  const t = trip({ stops: ['קו טאו'], builtin: true, activities: ['trek'] });
  const r1 = suggestions(t, DATA, 'he');
  assert.equal(find(r1, 'sunscreen'), undefined, 'the built-in "קרם הגנה" is there');
  assert.equal(find(r1, 'swimwear'), undefined, 'the built-in "בגד ים" is there');
  t.checklist = t.checklist.map((x) => (x.builtin === 'swimwear' ? { ...x, name: 'בגד ים כחול' } : x));
  assert.equal(find(suggestions(t, DATA, 'he'), 'swimwear'), undefined, 'renamed: still the same built-in item');
  t.checklist.push({ id: makeId(), group: 'carryOn', name: '  תיק   יום ', qty: 1, note: '', done: false }); // a flight-list item, odd spaces
  t.luggage = { bags: [{ id: 'b1', name: 'תיק', limitGrams: null, items: [{ id: 'l1', name: 'כובע', grams: 200 }] }] };
  const r2 = suggestions(t, DATA, 'he');
  assert.equal(find(r2, 'day-pack'), undefined);
  assert.equal(find(r2, 'hat'), undefined, 'a bag already has "כובע"');
  assert.ok(find(r2, 'beach-towel'), 'other suggestions stay');
});

test('B-8 (S12-4) accepting a suggestion adds one normal item; a second tap adds nothing; nothing else changes', () => {
  const t = trip({ builtin: true, stops: ['קו סמוי'] });
  const before = structuredClone(t.checklist);
  const s = find(suggestions(t, DATA, 'he'), 'beach-towel');
  const a = acceptSuggestion(t.checklist, s, makeId);
  assert.equal(a.added, 1);
  const b = acceptSuggestion(a.items, s, makeId);
  assert.equal(b.added, 0);
  assert.equal(b.items.length, before.length + 1);
  assert.deepEqual(b.items.slice(0, before.length), before, 'existing items untouched, same order');
  const item = b.items.at(-1);
  assert.deepEqual({ group: item.group, name: item.name, qty: item.qty, done: item.done, smart: item.smart },
    { group: 'clothing', name: 'סרונג או מגבת חוף', qty: 1, done: false, smart: 'beach-towel' });
  assert.equal(find(suggestions({ ...t, checklist: b.items }, DATA, 'he'), 'beach-towel'), undefined);
  const lic = find(suggestions(trip({ activities: ['motorbike'] }), DATA, 'he'), 'moto-licence');
  const c = acceptSuggestion([], lic, makeId).items[0];
  assert.deepEqual(c.verify, { source: '', checkedAt: null });
  assert.match(c.note, /טרם אומתו/);
});

test('B-9 "add all the musts" adds each missing must once; a second time adds nothing; "avoid" is never added', () => {
  const t = trip({ builtin: true, stops: ['קו סמוי'], activities: ['party'] });
  const r = suggestions(t, DATA, 'he');
  const a = acceptAll(t.checklist, r.must, makeId);
  assert.equal(a.added, r.must.length);
  assert.ok(a.added > 0);
  assert.equal(acceptAll(a.items, r.must, makeId).added, 0);
  assert.deepEqual(suggestions({ ...t, checklist: a.items }, DATA, 'he').must, []);
  assert.equal(acceptSuggestion([], r.avoid[0], makeId).added, 0);
});

test('B-10 the suggestions never change the trip (no item added, edited or removed on its own)', () => {
  const t = trip({ builtin: true, stops: ['קו טאו', 'בנגקוק'], activities: ['snorkel'] });
  const snap = JSON.stringify(t);
  suggestions(t, DATA, 'he');
  suggestions(t, DATA, 'en');
  assert.equal(JSON.stringify(t), snap);
});

test('B-11 activities: only known ids, once each, in the file\'s order; saved on the trip without touching anything else', () => {
  assert.deepEqual(cleanActivities(['trek', 'nope', 'beach', 'trek'], DATA), ['beach', 'trek']);
  const t = trip({ builtin: true });
  const snap = JSON.stringify(t.checklist);
  setActivities(t, ['city', 'x'], DATA);
  assert.deepEqual(t.smartBag, { activities: ['city'] });
  assert.deepEqual(smartActivities(t, DATA), ['city']);
  assert.equal(JSON.stringify(t.checklist), snap);
  assert.deepEqual(smartActivities({}, DATA), []);
});

test('B-12 weather later: an extension point that takes a forecast; today it gets null and changes nothing', () => {
  const r = suggestions(trip(), DATA, 'he');
  assert.equal(applyForecast(r, null), r);
  assert.equal(applyForecast(r, undefined), r);
  const src = read('src/js/core/smart-bag.js') + read('src/js/smart-bag-view.js');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|https?:\/\//, 'no network (S12-7)');
});

test('B-13 (S12-5) migration 7 -> 8 adds an empty smartBag; checklist, bags, places and everything else stay exactly', () => {
  assert.equal(SCHEMA_VERSION, 8);
  const opts = { now: () => new Date('2030-11-01T10:00:00Z'), appVersion: '0.11.0', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };
  const old = createDefaultState(opts);
  old.schemaVersion = 7;
  const t = old.trips[old.activeTripId];
  t.checklist = [{ id: 'c1', group: 'clothing', name: 'חולצה לדוגמה', qty: 3, note: 'הערה', done: true }];
  t.luggage = { bags: [{ id: 'b1', name: 'מזוודה', limitGrams: 20000, items: [{ id: 'i1', name: 'נעליים', grams: 900 }] }] };
  t.places = [{ id: 'p1', name: 'מקום לדוגמה' }];
  delete t.smartBag;
  const snap = structuredClone(t);
  const next = migrate(structuredClone(old), opts);
  assert.equal(next.schemaVersion, 8);
  assert.deepEqual(validateState(next), []);
  const nt = next.trips[next.activeTripId];
  assert.deepEqual(nt.smartBag, { activities: [] });
  const { smartBag, ...rest } = nt;
  assert.deepEqual(rest, snap);
  const kept = migrate({ ...structuredClone(old), trips: { [t.id]: { ...structuredClone(t), smartBag: { activities: ['trek'] } } } }, opts);
  assert.deepEqual(kept.trips[t.id].smartBag, { activities: ['trek'] }, 'an existing value is kept');
});

test('B-14 (S12-6) activities and "packed" ticks on added items are in the backup and come back on restore', () => {
  const opts = { now: () => new Date('2030-11-01T10:00:00Z'), appVersion: '0.11.1', makeId, countryCode: 'TH', tripName: 'תאילנד' };
  const state = createDefaultState(opts);
  const t = state.trips[state.activeTripId];
  setActivities(t, ['snorkel'], DATA);
  t.startDate = '2030-12-20';
  t.endDate = '2030-12-30';
  t.destinations = [stop('קו טאו', '2030-12-20', '2030-12-30')];
  t.checklist = acceptAll(t.checklist, suggestions(t, DATA, 'he').must, makeId).items;
  assert.ok(t.checklist.length > 0, 'musts were added');
  t.checklist[0].done = true;
  const text = JSON.stringify(exportBackup(state, new Date('2030-12-01T00:00:00Z')));
  const back = parseBackup(text, opts);
  assert.equal(back.ok, true);
  const bt = back.state.trips[back.state.activeTripId];
  assert.deepEqual(bt.smartBag, { activities: ['snorkel'] });
  assert.deepEqual(bt.checklist, t.checklist);
  assert.equal(bt.checklist[0].done, true);
});

test('B-15 texts: every screen key in he and en; the screen, the data and the core are precached for offline', () => {
  const need = ['sbag.title', 'sbag.lead', 'sbag.open', 'sbag.days', 'sbag.noDates', 'sbag.kinds', 'sbag.unclassified', 'sbag.activities',
    'sbag.must', 'sbag.nice', 'sbag.avoid', 'sbag.addAll', 'sbag.add', 'sbag.addLabel', 'sbag.added', 'sbag.addedAll', 'sbag.none',
    'sbag.where', 'sbag.toLists', 'sbag.qty', 'sbag.toCheck', 'screen.smartBag'];
  const missing = [];
  for (const k of need) for (const [lang, d] of [['he', he], ['en', en]]) if (!d[k]) missing.push(`${lang}:${k}`);
  assert.deepEqual(missing, []);
  const sw = read('sw.js');
  for (const f of ['./data/packing/th.json', './src/js/core/smart-bag.js', './src/js/smart-bag-view.js']) assert.ok(sw.includes(`'${f}'`), f);
});
