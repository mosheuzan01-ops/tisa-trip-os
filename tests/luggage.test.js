// Stage 6.0e: luggage weight (docs/GOALS_STAGE6.md S6-9, S6-10, S6-11). Written before src/js/core/luggage.js.
// The user sets the limit; the app only adds up and warns. No airline limit lives anywhere in the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseKg, validateBag, validateLuggageItem, makeBag, makeLuggageItem, bagStatus, saveBag, removeBag, saveItem, removeItem, cleanBags,
} from '../src/js/core/luggage.js';
import { readText } from './helpers.js';

let n = 0;
const id = () => `x${++n}`;
const item = (name, grams) => ({ id: id(), name, grams });
const bag = (o) => ({ id: id(), name: 'מזוודה', limitGrams: null, items: [], ...o });

test('S6-9: weights are typed in kg and kept in whole grams, with no rounding error', () => {
  assert.equal(parseKg('23'), 23000);
  assert.equal(parseKg('0.85'), 850);
  assert.equal(parseKg('1.005'), 1005);
  assert.equal(parseKg('7,5'), 7500, 'a comma works like a dot');
  assert.equal(parseKg(' 12.4 '), 12400);
  assert.equal(parseKg('0.1') + parseKg('0.2'), 300, 'grams add up exactly (0.1 + 0.2 kg)');
  for (const bad of ['', 'abc', '-1', '0', '1.2345', '1e3', '1000', '12.4.5']) assert.ok(Number.isNaN(parseKg(bad)), bad);
});

test('S6-9: a bag needs a name; its limit is optional and set by the user', () => {
  assert.deepEqual(validateBag({ name: 'מזוודה גדולה', limit: '23' }), []);
  assert.deepEqual(validateBag({ name: 'תיק גב', limit: '' }), [], 'no limit is fine');
  assert.deepEqual(validateBag({ name: ' ', limit: '' }), ['name.missing']);
  assert.deepEqual(validateBag({ name: 'x'.repeat(41), limit: '' }), ['name.tooLong']);
  assert.deepEqual(validateBag({ name: 'a', limit: 'הרבה' }), ['limit.invalid']);
  assert.equal(makeBag({ name: ' תיק גב ', limit: '' }, id).limitGrams, null);
  assert.equal(makeBag({ name: 'a', limit: '7' }, id).limitGrams, 7000);
});

test('S6-9: an item needs a name, a weight and a bag that exists', () => {
  const bags = ['b1', 'b2'];
  assert.deepEqual(validateLuggageItem({ name: 'נעליים', weight: '0.85', bagId: 'b1' }, bags), []);
  assert.deepEqual(validateLuggageItem({ name: '', weight: '1', bagId: 'b1' }, bags), ['name.missing']);
  assert.deepEqual(validateLuggageItem({ name: 'x'.repeat(61), weight: '1', bagId: 'b1' }, bags), ['name.tooLong']);
  assert.deepEqual(validateLuggageItem({ name: 'a', weight: '', bagId: 'b1' }, bags), ['weight.missing']);
  assert.deepEqual(validateLuggageItem({ name: 'a', weight: 'כבד', bagId: 'b1' }, bags), ['weight.invalid']);
  assert.deepEqual(validateLuggageItem({ name: 'a', weight: '1', bagId: 'b9' }, bags), ['bag.invalid']);
  assert.deepEqual(makeLuggageItem({ name: ' מחשב ', weight: '1.35' }, id), { id: 'x' + n, name: 'מחשב', grams: 1350 });
});

test('S6-9: total, limit and over: 0 items, under, exactly at the limit (not over), over, and no limit (no warning)', () => {
  assert.deepEqual(bagStatus(bag({ limitGrams: 23000 })), { totalGrams: 0, limitGrams: 23000, state: 'ok', overGrams: 0, leftGrams: 23000 });
  assert.deepEqual(bagStatus(bag({ limitGrams: 23000, items: [item('א', 10000), item('ב', 8400)] })), { totalGrams: 18400, limitGrams: 23000, state: 'ok', overGrams: 0, leftGrams: 4600 });
  assert.equal(bagStatus(bag({ limitGrams: 23000, items: [item('א', 23000)] })).state, 'ok', 'equal to the limit is not over');
  assert.deepEqual(bagStatus(bag({ limitGrams: 7000, items: [item('א', 6500), item('ב', 750)] })), { totalGrams: 7250, limitGrams: 7000, state: 'over', overGrams: 250, leftGrams: 0 });
  assert.deepEqual(bagStatus(bag({ limitGrams: null, items: [item('א', 40000)] })), { totalGrams: 40000, limitGrams: null, state: 'noLimit', overGrams: 0, leftGrams: null });
});

test('add, edit and move between bags; nothing given is changed', () => {
  const b1 = bag({ name: 'גדולה' });
  const b2 = bag({ name: 'קטנה' });
  let lug = { bags: [b1] };
  lug = saveBag(lug, b2);
  assert.deepEqual(lug.bags.map((b) => b.name), ['גדולה', 'קטנה']);
  const shoes = makeLuggageItem({ name: 'נעליים', weight: '0.85' }, id);
  const before = structuredClone(lug);
  lug = saveItem(lug, shoes, b1.id);
  assert.deepEqual(before.bags[0].items, [], 'the luggage given is not changed');
  assert.equal(bagStatus(lug.bags[0]).totalGrams, 850);
  lug = saveItem(lug, { ...shoes, grams: 900 }, b2.id); // edit and move to the other bag
  assert.equal(lug.bags[0].items.length, 0);
  assert.deepEqual(lug.bags[1].items, [{ ...shoes, grams: 900 }]);
  const renamed = saveBag(lug, makeBag({ name: 'קטנה', limit: '7' }, id, lug.bags[1]));
  assert.equal(renamed.bags[1].limitGrams, 7000);
  assert.equal(renamed.bags[1].items.length, 1, 'editing a bag keeps its items');
});

test('S6-10: removing an item or a bag removes only that', () => {
  const a = item('א', 100);
  const b = item('ב', 200);
  const lug = { bags: [bag({ id: 'b1', items: [a, b] }), bag({ id: 'b2', items: [item('ג', 300)] })] };
  assert.deepEqual(removeItem(lug, a.id).bags[0].items, [b]);
  assert.equal(removeItem(lug, a.id).bags[1].items.length, 1);
  assert.deepEqual(removeBag(lug, 'b1').bags.map((x) => x.id), ['b2']);
  assert.equal(lug.bags.length, 2);
});

test('broken bags and items are skipped on screen and left in the data', () => {
  const raw = [bag({ items: [item('א', 100), { id: 'bad' }, null] }), null, { id: 'nob' }, 'x'];
  const clean = cleanBags({ bags: raw });
  assert.equal(clean.length, 1);
  assert.equal(clean[0].items.length, 1);
  assert.equal(raw.length, 4);
  assert.deepEqual(cleanBags(null), []);
});

test('S6-11: no airline weight limit is written anywhere in the app', () => {
  for (const f of ['src/js/core/luggage.js', 'src/js/luggage-view.js', 'locales/he.json', 'locales/en.json', 'data/packs/th.js', 'index.html']) {
    assert.doesNotMatch(readText(f), /\b(7|8|10|15|20|23|30|32)\s*(ק"ג|ק״ג|קילו|kg)\b/i, `${f}: a fixed weight limit`);
  }
});
