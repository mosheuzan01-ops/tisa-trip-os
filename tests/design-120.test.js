// 1.2.0: the final design (latisa-design-final, owner-approved) ported into the real app.
// Home, budget and tools as in the approved design; route = departures board; lists = travel notebook.
// No prototype layer, no unverified photographs, no new data and no change to stored data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readText, readJson, listFiles } from './helpers.js';
import * as itinerary from '../src/js/core/itinerary.js';

// called through the module, so a missing export fails as an assertion (TDD red), not as a load error
const stopStatuses = (...a) => { assert.equal(typeof itinerary.stopStatuses, 'function', 'core/itinerary.js exports stopStatuses'); return itinerary.stopStatuses(...a); };

const s = (id, startDate, endDate, extra = {}) => ({ id, name: id, startDate, endDate, ...extra });
const list = [s('a', '2027-01-01', '2027-01-03'), s('b', '2027-01-03', '2027-01-05'), s('c', '2027-01-08', '2027-01-10')];

test('DF1: stopStatuses: before the trip every stop is ahead, after it every stop is done', () => {
  assert.deepEqual(stopStatuses([], '2027-01-01'), {});
  assert.deepEqual(stopStatuses(list, '2026-12-29'), { a: 'ahead', b: 'ahead', c: 'ahead' });
  assert.deepEqual(stopStatuses(list, '2027-01-11'), { a: 'done', b: 'done', c: 'done' });
});

test('DF2: stopStatuses: the stop of today is now, the ones before it done, the ones after it ahead', () => {
  assert.deepEqual(stopStatuses(list, '2027-01-02'), { a: 'now', b: 'ahead', c: 'ahead' });
  assert.deepEqual(stopStatuses(list, '2027-01-03'), { a: 'done', b: 'now', c: 'ahead' }, 'arrival day wins, as in whereToday');
  assert.deepEqual(stopStatuses(list, '2027-01-10'), { a: 'done', b: 'done', c: 'now' });
});

test('DF3: stopStatuses: between stops, done up to the next stop; same names do not matter (ids)', () => {
  assert.deepEqual(stopStatuses(list, '2027-01-06'), { a: 'done', b: 'done', c: 'ahead' });
  const twice = [s('x', '2027-01-01', '2027-01-03', { name: 'Bangkok' }), s('y', '2027-01-05', '2027-01-07', { name: 'Bangkok' })];
  assert.deepEqual(stopStatuses(twice, '2027-01-04'), { x: 'done', y: 'ahead' });
  assert.deepEqual(stopStatuses([s('q', '2027-02-01', '2027-02-03'), ...list], '2027-01-06'), { a: 'done', b: 'done', c: 'ahead', q: 'ahead' }, 'order of the input does not matter');
});

test('DF4: no "booked" or "open" status exists: the data has no booking field', () => {
  const values = new Set(Object.values(stopStatuses(list, '2027-01-04')).concat(Object.values(stopStatuses(list, '2027-01-02'))));
  for (const v of values) assert.ok(['done', 'now', 'ahead'].includes(v), v);
});

test('DF5: the design ships as real CSS: design.css after main.css, precached; no prototype layer, no photographs', () => {
  const html = readText('index.html');
  assert.ok(existsSync(join(ROOT, 'src/css/design.css')));
  assert.ok(html.indexOf('src/css/design.css') > html.indexOf('src/css/main.css'), 'design.css loads after main.css');
  assert.match(readText('sw.js'), /'\.\/src\/css\/design\.css'/);
  for (const file of ['index.html', 'sw.js', ...listFiles('src', ['.js', '.css'])]) {
    const text = readText(file);
    assert.doesNotMatch(text, /proto\/|data-dir=|data-metal=|data-screens|data-final|latisa-proto/, `${file} has a prototype leftover`);
    if (file.endsWith('.css')) assert.doesNotMatch(text, /url\("?[^")]*\.(webp|jpe?g|png|avif)/i, `${file} loads an image file`);
    assert.doesNotMatch(text, /photos\/photo-/, `${file} references a prototype photograph`);
    assert.doesNotMatch(text, /\b(v5|fx)-[a-z]/, `${file} has a prototype class name`);
  }
});

test('DF6: route markup: the country line has its own slot, filled with the country name; the caption is drawn by CSS only', () => {
  const html = readText('index.html');
  const panel = html.slice(html.indexOf('id="panel-itinerary"'), html.indexOf('data-slot="stops"'));
  assert.match(panel, /class="itin-country" data-slot="itin-country"/);
  assert.match(readText('src/js/app.js'), /\[data-slot="itin-country"\]/);
  assert.match(panel, /class="stops-head ltr" data-slot="stops-head" aria-hidden="true" hidden><\/p>/);
  assert.match(readText('src/css/design.css'), /\.stops-head::before\s*\{[^}]*content:\s*"NO\. · DESTINATION · DATES · STATUS"/);
});

test('DF7: lists markup: the notebook line has a label and a count slot; tools: links to the existing screens', () => {
  const html = readText('index.html');
  assert.match(html, /<p class="lists-summary" data-slot="lists-summary" hidden><span data-i18n="lists.notebook">[^<]*<\/span><span class="lists-summary-count" data-slot="lists-summary-count"><\/span><\/p>/);
  const tools = html.slice(html.indexOf('id="panel-tools"'), html.indexOf('</section>', html.indexOf('class="tools-more"')));
  assert.match(tools, /<nav class="tools-more" data-i18n-label="tools.more"/);
  for (const [href, key] of [['#/luggage', 'lug.open'], ['#/smart-bag', 'sbag.open'], ['#/info', 'tools.info']]) {
    assert.match(tools, new RegExp(`href="${href}"[^>]*>[\\s\\S]*?data-i18n="${key.replace('.', '\\.')}"`), href);
  }
});

test('DF8: the new copy is in both locales, without middle-dot strings', () => {
  for (const locale of ['he', 'en']) {
    const d = readJson(`locales/${locale}.json`);
    for (const key of ['itin.status.done', 'itin.status.ahead', 'lists.notebook', 'lists.ready', 'tools.more']) {
      assert.ok(typeof d[key] === 'string' && d[key].length > 0, `${locale}.json ${key}`);
    }
    assert.match(d['lists.ready'], /\{done\}[\s\S]*\{total\}/);
  }
  assert.equal(readJson('locales/he.json')['itin.status.done'], 'עבר');
  assert.equal(readJson('locales/he.json')['itin.status.ahead'], 'בהמשך');
  assert.equal(readJson('locales/he.json')['lists.notebook'], 'מחברת הטיול');
});

test('DF9: the views render the new parts from data (statuses, notebook line)', () => {
  const itin = readText('src/js/itinerary-view.js');
  assert.match(itin, /stopStatuses\(/);
  assert.match(itin, /'stop-status is-'/);
  assert.match(itin, /\[data-slot="stops-head"\]/);
  const lists = readText('src/js/checklist-view.js');
  assert.match(lists, /\[data-slot="lists-summary"\]/);
  assert.match(lists, /lists\.ready/);
});

test('DF10: Liquid Gold (light) and Obsidian Luxury (dark) are the theme tokens; the ring is 12.9375 wide', () => {
  const tokens = readText('src/css/tokens.css');
  assert.match(tokens, /\[data-theme="light"\][^{]*\{[^}]*--bg:\s*#F6F1E6/);
  assert.match(tokens, /\[data-theme="dark"\][^{]*\{[^}]*--bg:\s*#070708/);
  assert.match(readText('src/css/design.css'), /\.money-ring circle\s*\{[^}]*stroke-width:\s*12\.9375/);
});

test('DF11: version 1.2.0 in package.json, config and the service worker', () => {
  assert.equal(readJson('package.json').version, '1.2.0');
  assert.equal(readJson('config/app.config.json').appVersion, '1.2.0');
  assert.match(readText('sw.js'), /const VERSION = '1\.2\.0';/);
});

test('DF12: no text in design.css is smaller than the smallest text token (14px), pseudo-element text included', () => {
  const css = readText('src/css/design.css');
  const small = [];
  for (const [, sel, body] of css.matchAll(/([^{}\n]*)\{([^}]*)\}/g)) {
    for (const d of body.split(';').filter((x) => /\bfont(-size)?\s*:/.test(x))) {
      const size = d.replace(/\/[^\s;]+/, '').match(/(?<![\w.-])(\.\d+|\d+(?:\.\d+)?)(rem|px)\b/);
      if (size && (size[2] === 'rem' ? Number(size[1]) * 16 : Number(size[1])) < 14) small.push(`${sel.trim().slice(-60)}: ${d.trim()}`);
    }
  }
  assert.deepEqual(small, []);
});
