// Guards for the project's standing rules (GOALS.md G5, G8, G9, G11, G12, G14, G15, G16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readText, readJson, listFiles, stripApproved } from './helpers.js';
import { validateCountry } from '../src/js/core/country.js';

const appFiles = ['index.html', ...listFiles('src', ['.js', '.css'])];

test('G5: zero dependencies', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(existsSync(join(ROOT, 'node_modules')), false);
});

test('G8: page is Hebrew and RTL', () => {
  assert.match(readText('index.html'), /<html lang="he" dir="rtl"[ >]/);
  assert.equal(readJson('locales/he.json').dir, 'rtl');
});

test('G9: no external URLs (no CDN) in app code', () => {
  for (const file of appFiles) {
    assert.doesNotMatch(stripApproved(readText(file)), /https?:\/\//, `${file} references an external URL`);
  }
});

test('G11: country facts live in data, not in code', () => {
  for (const file of listFiles('src', ['.js'])) {
    const src = readText(file);
    assert.doesNotMatch(src, /תאילנד|Thailand|THB|Asia\/Bangkok/, `${file} hardcodes country data`);
  }
  for (const name of readdirSync(join(ROOT, 'data/countries'))) {
    assert.deepEqual(validateCountry(readJson(`data/countries/${name}`)), [], name);
  }
});

test('G12: settings and locales are complete', () => {
  const config = readJson('config/app.config.json');
  for (const key of ['appName', 'buildLabel', 'defaultLocale', 'supportedLocales', 'activeCountry']) {
    assert.ok(key in config, `config missing ${key}`);
  }
  assert.ok(existsSync(join(ROOT, `data/countries/${config.activeCountry}.json`)));
  const keys = (l) => Object.keys(readJson(`locales/${l}.json`)).sort();
  for (const locale of config.supportedLocales) {
    assert.deepEqual(keys(locale), keys(config.defaultLocale), `${locale} keys differ`);
  }
});

test('G14 + G15: no secrets, cookies or analytics', () => {
  // Stage 14 (owner, 2026-11-23): sign-in with email and password (Supabase Auth) is approved, so the words
  // "password" and "token" may appear only in the sign-in files below. Everything else stays banned everywhere, and
  // real secrets (service_role, sb_secret_, database passwords) are searched for in tests/stage14-rules.test.js (S14-8).
  const SIGN_IN_FILES = ['index.html', 'src/js/cloud-view.js', 'src/js/core/cloud-api.js', 'src/js/core/storage.js'];
  const banned = /api[_-]?key|\bsecret\b|password|\btoken\b|document\.cookie|gtag|analytics|sendBeacon/i;
  const bannedInSignIn = /api[_-]?key|\bsecret\b|document\.cookie|gtag|analytics|sendBeacon/i;
  for (const file of appFiles) assert.doesNotMatch(readText(file), SIGN_IN_FILES.includes(file) ? bannedInSignIn : banned, file);
});

test('G16: no prices or dates in data (Stage 0 must not invent them)', () => {
  const banned = /price|cost|rate|amount|date"\s*:|"\d{4}-\d{2}-\d{2}/i;
  // Stage 11 (owner, 2026-11-22): data/info/*.json must carry the real date each fact was checked; tests/stage11-info.test.js
  // (I-2, I-3) holds those dates to a source and to "not in the future". Prices and amounts stay banned there too.
  for (const file of listFiles('data', ['.json'])) {
    const text = readText(file);
    if (file.startsWith('data/info/')) { assert.doesNotMatch(text, /price|cost|amount/i, file); continue; }
    assert.doesNotMatch(text, banned, file);
  }
});
