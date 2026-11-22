// Pre-stage-10, PR A: the built-in checklist (owner decision 2026-11-21, docs/GOALS_STAGE10.md "PR A").
// A new trip comes with the full list; old data keeps every item and tick and is only offered the missing items.
// Nothing is ticked automatically. Rule-dependent items (entry rules, emergency numbers, airline and airport rules)
// stay "to check" until the user writes where they checked. Written before the code (TDD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GROUPS, groupKind, groupSection, SECTIONS, NAME_MAX, NOTE_MAX, progress, makeItem, needsCheck,
  builtinItems, missingBuiltins, addBuiltins, readyChecklist, needsBuiltinOffer, declineBuiltinOffer,
} from '../src/js/core/checklist.js';
import { dataSummary } from '../src/js/core/device-data.js';
import { createDefaultState, migrate } from '../src/js/core/schema.js';
import { TH } from '../data/packs/th.js';
import { readJson, readText } from './helpers.js';

const idGen = (p = 'x') => { let n = 0; return () => `${p}${++n}`; };
const B = TH.checklistBuiltin ?? [];
const same = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const v5 = () => JSON.parse(fs.readFileSync(new URL('./fixtures/v5-stage7.json', import.meta.url), 'utf8'));
const opts = { now: () => new Date('2030-01-01T00:00:00Z'), appVersion: '0.0.0-test', makeId: idGen('s'), countryCode: 'TH', tripName: 'תאילנד' };

// ---------- groups and sections ----------
test('A-1: four sections, every group in exactly one; old groups keep their kind', () => {
  assert.deepEqual(SECTIONS, ['prep', 'carry', 'bag', 'arrival']);
  for (const g of ['carryOn', 'hygiene', 'checkedBag', 'flightDay', 'afterLanding']) assert.ok(GROUPS.includes(g), g);
  for (const g of GROUPS) assert.ok(SECTIONS.includes(groupSection(g)), g);
  assert.deepEqual(['documents', 'money', 'comms', 'offline', 'flightDay'].map(groupSection), ['prep', 'prep', 'prep', 'prep', 'prep']);
  assert.deepEqual(['carryOn', 'flightComfort', 'flightFood', 'hygiene'].map(groupSection), ['carry', 'carry', 'carry', 'carry']);
  assert.deepEqual(['checkedBag', 'health', 'clothing', 'chargers'].map(groupSection), ['bag', 'bag', 'bag', 'bag']);
  assert.equal(groupSection('afterLanding'), 'arrival');
  // groupKind keeps its old meaning for the old groups (home card: prep / pack)
  assert.deepEqual(['documents', 'offline', 'health', 'flightFood'].map(groupKind), ['prep', 'prep', 'pack', 'pack']);
  assert.equal(groupKind('afterLanding'), 'arrival');
  // display order: sections in order
  const order = GROUPS.map(groupSection);
  assert.deepEqual(order, [...order].sort((a, b) => SECTIONS.indexOf(a) - SECTIONS.indexOf(b)));
});

test('A-2: progress per section; pack = carry-on + checked bag; after landing counts apart', () => {
  const list = [
    { group: 'documents', done: true }, { group: 'carryOn', done: true }, { group: 'checkedBag', done: false },
    { group: 'afterLanding', done: false }, { group: 'flightFood', done: false },
  ];
  const p = progress(list);
  assert.deepEqual(p.prep, { done: 1, total: 1, pct: 100 });
  assert.deepEqual(p.carry, { done: 1, total: 2, pct: 50 });
  assert.deepEqual(p.bag, { done: 0, total: 1, pct: 0 });
  assert.deepEqual(p.arrival, { done: 0, total: 1, pct: 0 });
  assert.deepEqual(p.pack, { done: 1, total: 3, pct: 33 });
});

test('A-3: every group and section has a label in both languages', () => {
  for (const loc of ['he', 'en']) {
    const d = readJson(`locales/${loc}.json`);
    for (const g of GROUPS) assert.ok(d[`list.group.${g}`], `${loc} list.group.${g}`);
    for (const s of SECTIONS) assert.ok(d[`lists.${s}`], `${loc} lists.${s}`);
  }
  const he = readJson('locales/he.json');
  assert.match(he['list.group.offline'], /2–3 ימים לפני/);
  assert.match(he['list.group.flightDay'], /ביום הטיסה/);
});

// ---------- the pack's built-in list ----------
test('A-4: built-in entries: unique keys, known groups, names and notes in both languages within limits', () => {
  assert.ok(Array.isArray(B) && B.length >= 50, `only ${B?.length}`);
  assert.ok(Number.isInteger(TH.checklistBuiltinVersion) && TH.checklistBuiltinVersion >= 1);
  assert.equal(new Set(B.map((x) => x.key)).size, B.length, 'keys are unique');
  for (const loc of ['he', 'en']) assert.equal(new Set(B.map((x) => same(x.name[loc]))).size, B.length, `${loc} names are unique`);
  for (const x of B) {
    assert.ok(GROUPS.includes(x.group), x.key);
    for (const loc of ['he', 'en']) {
      assert.ok(x.name[loc] && x.name[loc].length <= NAME_MAX, `${x.key} ${loc} name`);
      if (x.note) assert.ok(x.note[loc] && x.note[loc].length <= NOTE_MAX, `${x.key} ${loc} note`);
    }
  }
  for (const g of GROUPS) assert.ok(B.some((x) => x.group === g), `group ${g} has items`);
});

test('A-5: the owner\'s list is in, in the right groups', () => {
  const at = (key) => B.find((x) => x.key === key);
  const want = {
    documents: ['passport', 'passport-validity', 'entry-rules', 'passport-copy', 'ticket-offline', 'insurance', 'first-address', 'driving-permit'],
    money: ['credit-card', 'backup-card', 'cash'],
    comms: ['esim'],
    offline: ['checkin-online', 'downloads', 'offline-maps', 'police-app', 'emergency-numbers', 'phone-space', 'charge-phone', 'bookings-offline', 'translator', 'app-backup'],
    flightDay: ['day-check', 'home-check', 'leave-early'],
    carryOn: ['carry-basics', 'carry-charger', 'headphones', 'carry-medicine', 'glasses', 'house-keys'],
    flightComfort: ['neck-pillow', 'warm-layer', 'eye-mask', 'earplugs', 'socks', 'long-shirt'],
    flightFood: ['snacks', 'gum', 'bottle', 'meal'],
    hygiene: ['lotion', 'wipes', 'eye-drops', 'liquids-bag'],
    checkedBag: ['bag-clothes', 'bag-limits', 'lithium-carry', 'valuables-carry'],
    health: ['first-aid', 'sunscreen', 'repellent'],
    clothing: ['light-clothes', 'swimwear', 'sandals', 'temple-clothes'],
    chargers: ['plug-adapter'],
    afterLanding: ['bag-arrived', 'esim-activate', 'show-address', 'cash-arrival'],
  };
  for (const [group, keys] of Object.entries(want)) {
    for (const key of keys) assert.equal(at(key)?.group, group, key);
  }
});

test('A-6: rule-dependent items are "to check"; nothing is stated as verified; no fixed weight', () => {
  const ruled = ['passport-validity', 'entry-rules', 'driving-permit', 'police-app', 'emergency-numbers', 'leave-early', 'bottle', 'meal',
    'liquids-bag', 'bag-limits', 'lithium-carry', 'temple-clothes', 'plug-adapter'];
  for (const key of ruled) assert.equal(B.find((x) => x.key === key)?.verify, true, key);
  const emergency = B.find((x) => x.key === 'emergency-numbers');
  for (const n of ['1669', '191', '199', '1155', '1672']) assert.ok(emergency.note.he.includes(n), n);
  assert.match(emergency.note.he, /טרם אומת/);
  assert.match(B.find((x) => x.key === 'insurance').note.he, /טרם נרכש/);
  assert.match(B.find((x) => x.key === 'driving-permit').note.he, /רק אם/);
  const text = JSON.stringify(B);
  assert.doesNotMatch(text, /23\s*(ק"ג|ק״ג|kg)/i, 'no fixed baggage weight');
  // numbers only where the owner gave them (the emergency item); nothing else carries a number
  for (const x of B.filter((y) => y.key !== 'emergency-numbers' && y.key !== 'leave-early')) assert.doesNotMatch(JSON.stringify(x), /\d{2,}/, x.key);
});

test('A-7: every item of the old starter and flight lists is kept (by its name or an alias)', () => {
  for (const loc of ['he', 'en']) {
    const names = new Set(B.flatMap((x) => [x.name[loc], ...(x.aliases?.[loc] ?? [])].map(same)));
    for (const x of [...TH.checklistSeed, ...TH.flightChecklistSeed]) assert.ok(names.has(same(x.name[loc])), `${loc}: ${x.name[loc]}`);
  }
});

// ---------- turning the list into items ----------
test('A-8: built-in items: key, group, name, note; nothing ticked; rule items open for checking', () => {
  const list = builtinItems(TH, 'he', idGen('b'));
  assert.equal(list.length, B.length);
  assert.ok(list.every((x) => x.done === false && typeof x.builtin === 'string' && x.qty === 1));
  const em = list.find((x) => x.builtin === 'emergency-numbers');
  assert.ok(needsCheck(em) && em.verify.checkedAt === null);
  assert.match(em.note, /1669/);
  assert.equal(builtinItems(TH, 'en', idGen('b')).find((x) => x.builtin === 'passport').name, 'Passport');
});

test('A-9: a new trip gets the full list once; a second call adds nothing', () => {
  const state = createDefaultState(opts);
  const trip = state.trips[state.activeTripId];
  readyChecklist(trip, TH, 'he', idGen('r'));
  assert.ok(trip.checklist.length > 0, 'filled');
  assert.equal(trip.checklist.length, B.length);
  const snapshot = JSON.stringify(trip.checklist);
  readyChecklist(trip, TH, 'he', idGen('q'));
  assert.equal(JSON.stringify(trip.checklist), snapshot);
});

test('A-10: a trip that already has items is never filled automatically', () => {
  const trip = { checklist: [makeItem({ group: 'documents', name: 'שלי', qty: '' }, () => 'own')] };
  readyChecklist(trip, TH, 'he', idGen('r'));
  assert.equal(trip.checklist.length, 1);
});

// ---------- old data ----------
test('A-11: old data: missing items only; every old item and tick stays exactly; twice adds nothing', () => {
  const state = migrate(v5(), opts);
  const trip = state.trips[state.activeTripId];
  const old = structuredClone(trip.checklist);
  const missing = missingBuiltins(old, TH, 'he');
  assert.ok(missing.length > 0 && missing.length < B.length);
  assert.ok(!missing.some((x) => x.key === 'passport'), 'the old "דרכון" item counts as the built-in one');
  const one = addBuiltins(old, TH, 'he', idGen('a'));
  assert.equal(one.added, missing.length);
  assert.deepEqual(one.items.slice(0, old.length), old, 'old items, ticks and order unchanged');
  assert.ok(one.items.slice(old.length).every((x) => !x.done && x.builtin));
  const names = one.items.map((x) => same(x.name));
  assert.equal(new Set(names).size, names.length, 'no repeated names');
  const two = addBuiltins(one.items, TH, 'he', idGen('b'));
  assert.equal(two.added, 0);
  assert.deepEqual(two.items, one.items);
});

test('A-12: an old item under an alias or in another language counts; an own item with a new name stays apart', () => {
  const own = [
    makeItem({ group: 'chargers', name: 'סוללה ניידת', qty: '' }, () => 'o1'),
    makeItem({ group: 'flightComfort', name: 'Neck pillow', qty: '' }, () => 'o2'),
    makeItem({ group: 'documents', name: 'הפריט שלי', qty: '' }, () => 'o3'),
  ];
  const keys = missingBuiltins(own, TH, 'he').map((x) => x.key);
  assert.ok(keys.includes('passport'), 'a built-in item the trip does not have is missing');
  assert.ok(!keys.includes('carry-charger'), 'alias');
  assert.ok(!keys.includes('neck-pillow'), 'other language');
  assert.equal(addBuiltins(own, TH, 'he', idGen('z')).items.filter((x) => x.name === 'הפריט שלי').length, 1);
});

test('A-13: a deleted built-in item is not forced back: the offer card stays hidden after "not now"', () => {
  const trip = { checklist: [] };
  assert.equal(needsBuiltinOffer(trip, TH, 'he'), true);
  declineBuiltinOffer(trip, TH);
  assert.deepEqual(trip.builtinOffer, { declined: TH.checklistBuiltinVersion });
  assert.equal(trip.checklist.length, 0, '"not now" only records the answer');
  assert.equal(needsBuiltinOffer(trip, TH, 'he'), false);
  const full = { checklist: builtinItems(TH, 'he', idGen('f')) };
  assert.equal(needsBuiltinOffer(full, TH, 'he'), false, 'nothing missing, no card');
});

// ---------- where the data lives (iPhone: Safari and the home-screen app keep separate data) ----------
test('A-14: data summary for the settings screen: created date and counts, nothing else', () => {
  const state = migrate(v5(), opts);
  const trip = state.trips[state.activeTripId];
  assert.deepEqual(dataSummary(state), {
    createdAt: state.createdAt, items: trip.checklist.length, stops: trip.destinations.length,
    expenses: trip.expenses.length, photos: trip.photos.length,
  });
});

// ---------- wiring ----------
test('A-15: the app fills a new trip and a reset trip; the old seed buttons are gone', () => {
  const app = readText('src/js/app.js');
  // PR B: readyTrip (core/template.js) fills the checklist through readyChecklist, and adds the budget.
  assert.match(app, /status === 'new'[^\n]*(readyChecklist|readyTrip)/);
  assert.match(app, /storage\.reset\(\)[\s\S]{0,300}(readyChecklist|readyTrip)/);
  const html = readText('index.html');
  assert.doesNotMatch(html, /data-action="list-seed"|data-action="list-flight-items"/);
  assert.match(html, /data-slot="builtin-offer"/);
  assert.match(html, /data-action="list-builtin"/);
  for (const s of SECTIONS) assert.match(html, new RegExp(`data-slot="${s}-num"`));
  assert.match(html, /data-slot="device-data"/);
  assert.match(readText('sw.js'), /'\.\/src\/js\/core\/device-data\.js'/);
});
