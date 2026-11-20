// 0.6.0 closes Stage 6 (docs/GOALS_STAGE6.md, 6.0f): the version is raised in all three places so the phone's
// cache takes the new screens. Written before the version change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';

test('0.6.0 is set in all three places', () => {
  assert.equal(readJson('config/app.config.json').appVersion, '0.6.0');
  assert.equal(readJson('package.json').version, '0.6.0');
  assert.match(readText('sw.js'), /const VERSION = '0\.6\.0';/);
});

test('every Stage 6 file is in the offline cache', () => {
  const sw = readText('sw.js');
  for (const f of ['calendar-view.js', 'checkins-view.js', 'luggage-view.js', 'core/calendar.js', 'core/journal.js', 'core/checkins.js', 'core/timezones.js', 'core/luggage.js']) {
    assert.ok(sw.includes(`'./src/js/${f}'`), f);
  }
});

test('Stage 6 is recorded in the feature list: the calendar is an item, and Stage 7 keeps photos, the clip and the budget summary', () => {
  const f = readText('docs/FEATURES_TRIPILOT.md');
  assert.match(f, /0\.6\.0/);
  assert.match(f, /לוח שנה/);
  assert.match(f, /שלב 6[^\n]*הושלם|הושלם[^\n]*שלב 6/);
  assert.match(f, /שלב 7[^\n]*תמונות[^\n]*קליפ[^\n]*סיכום תקציב|שלב 7[\s\S]{0,200}תמונות[\s\S]{0,200}קליפ[\s\S]{0,200}סיכום תקציב/);
});
