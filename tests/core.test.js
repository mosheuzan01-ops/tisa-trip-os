import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator, resolveLocale } from '../src/js/core/i18n.js';
import { validateCountry, buildTitle, titleParts } from '../src/js/core/country.js';
import { readJson } from './helpers.js';

const config = readJson('config/app.config.json');

test('translator returns value, and the key itself when missing', () => {
  const t = createTranslator({ hello: 'שלום' });
  assert.equal(t('hello'), 'שלום');
  assert.equal(t('missing.key'), 'missing.key');
});

test('resolveLocale falls back to the default locale', () => {
  assert.equal(resolveLocale('he', config), 'he');
  assert.equal(resolveLocale('xx', config), config.defaultLocale);
  assert.equal(resolveLocale(undefined, config), config.defaultLocale);
});

test('validateCountry reports missing fields and bad currency codes', () => {
  assert.deepEqual(validateCountry(null), ['country must be an object']);
  assert.ok(validateCountry({}).includes('missing field: currency'));
  const bad = { id: 'x', names: {}, currency: 'baht', timeZone: 'UTC', dateFormatLocale: {} };
  assert.deepEqual(validateCountry(bad), ['currency must be an ISO 4217 code, e.g. "USD"']);
});

test('buildTitle produces the Stage 0 title from config + Thailand data', () => {
  const th = readJson('data/countries/th.json');
  assert.equal(buildTitle(config, th, 'he'), 'TISA — Experimental — תאילנד');
  assert.equal(buildTitle(config, th, 'en'), 'TISA — Experimental — Thailand');
});

test('titleParts splits the Latin brand from the localized place name', () => {
  const th = readJson('data/countries/th.json');
  assert.deepEqual(titleParts(config, th, 'he'), { brand: 'TISA — Experimental', place: 'תאילנד' });
});

test('interpolate fills {placeholders} and leaves unknown ones visible', async () => {
  const { interpolate } = await import('../src/js/core/i18n.js');
  assert.equal(interpolate('השעה עכשיו ב{city}', { city: 'X' }), 'השעה עכשיו בX');
  assert.equal(interpolate('{done} / {total}', { done: 0, total: 2 }), '0 / 2');
  assert.equal(interpolate('{missing}', {}), '{missing}');
});
