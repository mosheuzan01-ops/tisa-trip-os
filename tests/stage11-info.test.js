// Stage 11 (0.10.0): Thailand info and emergency (docs/GOALS_STAGE11.md, M1-M7). Written before the code (rule 12).
// The info file holds public facts only, each with its own status, source and check date. Notes in tests are samples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';
import {
  INFO_STATUSES, NOTE_MAX, INSURANCE_FIELDS, validateInfo, isShown, emergencyNumbers, telHref, mapLink, sourceOf,
  setNote, noteOf, cleanNotes, allItems,
} from '../src/js/core/info.js';
import { createDefaultState } from '../src/js/core/schema.js';
import { exportBackup, parseBackup } from '../src/js/core/backup.js';
import { TH } from '../data/packs/th.js';

const DATA = readJson('data/info/th.json');
const TODAY = new Date().toISOString().slice(0, 10);
const MAPS = 'https://www.google.com/maps/search/?api=1&query=';
const SRC = { s1: { title: { he: 'מקור לדוגמה', en: 'Sample source' }, url: 'https://example.org/page', checkedAt: '2030-01-01' } };
const sample = (over = {}) => ({
  id: 'th', checkedAt: '2030-01-01', sources: SRC,
  emergency: [{ key: 'x', kind: 'phone', label: { he: 'דוגמה', en: 'Sample' }, value: '1234', status: 'verified-official', source: 's1', checkedAt: '2030-01-01' }],
  contacts: [], hospitals: { draft: true, list: [] }, phrases: { status: 'hidden', items: [] }, conduct: { status: 'hidden', items: [] },
  ...over,
});
const item = (over = {}) => ({ key: 'x', kind: 'phone', label: { he: 'דוגמה', en: 'Sample' }, value: '1234', status: 'verified-official', source: 's1', checkedAt: '2030-01-01', ...over });
const emergencyOf = (key) => DATA.emergency.find((x) => x.key === key);
const hospital = (key) => DATA.hospitals.list.find((h) => h.key === key);
const field = (h, key) => h.fields.find((f) => f.key === key);

// ---------- Statuses and the rules every item follows (M1, M2) ----------
test('I-1: exactly four statuses: verified from an official source, provided by the user, not verified yet, not shown', () => {
  assert.deepEqual(INFO_STATUSES, ['verified-official', 'user-provided', 'unverified', 'hidden']);
});

test('I-2: the Thailand info file passes every rule (source, check date not in the future, known status)', () => {
  assert.deepEqual(validateInfo(DATA, TODAY), []);
  assert.ok(allItems(DATA).length >= 20, 'the file has real content');
});

test('I-3: verified without a source, without a date or with a future date is refused; so is an unknown status', () => {
  assert.deepEqual(validateInfo(sample(), '2030-01-02'), []);
  const bad = (over) => validateInfo(sample({ emergency: [item(over)] }), '2030-01-02');
  assert.ok(bad({ source: undefined }).length > 0, 'no source');
  assert.ok(bad({ source: 'nope' }).length > 0, 'unknown source');
  assert.ok(bad({ checkedAt: undefined }).length > 0, 'no date');
  assert.ok(bad({ checkedAt: '2030-01-05' }).length > 0, 'future date');
  assert.ok(bad({ status: 'verified' }).length > 0, 'unknown status');
  assert.ok(bad({ status: 'user-provided', source: undefined, checkedAt: undefined }).length > 0, 'user-provided needs a date');
  assert.deepEqual(bad({ status: 'user-provided', source: undefined }), []);
  assert.ok(bad({ status: 'unverified', value: '1111' }).length > 0, 'an unverified item keeps no value');
  assert.deepEqual(bad({ status: 'unverified', value: null, source: undefined, checkedAt: undefined }), []);
  assert.ok(bad({ value: 'abc' }).length > 0, 'a phone is digits');
  assert.ok(validateInfo(sample({ sources: { s1: { ...SRC.s1, url: 'http://example.org' } } }), '2030-01-02').length > 0, 'https only');
});

test('I-4: Thai script only in a verified field (no made-up Thai names, addresses or sentences)', () => {
  const thai = 'ทดสอบ';
  assert.ok(validateInfo(sample({ emergency: [item({ kind: 'text', value: thai, status: 'user-provided', source: undefined })] }), '2030-01-02').length > 0);
  assert.deepEqual(validateInfo(sample({ emergency: [item({ kind: 'text', value: thai })] }), '2030-01-02'), []);
  for (const it of allItems(DATA)) if (/[฀-๿]/.test(it.value ?? '')) assert.equal(it.status, 'verified-official', it.path);
});

// ---------- Emergency numbers (M2, M4) ----------
test('I-5: the five emergency numbers, each verified with a source and a date; tourist police is 1155, not 1151', () => {
  const want = { ambulance: '1669', police: '191', fire: '199', 'tourist-police': '1155', 'tourist-info': '1672' };
  for (const [key, value] of Object.entries(want)) {
    const x = emergencyOf(key);
    assert.ok(x, key);
    assert.equal(x.value, value, key);
    assert.equal(x.status, 'verified-official', key);
    assert.ok(sourceOf(DATA, x)?.url.startsWith('https://'), key);
    assert.match(x.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.ok(!JSON.stringify(DATA).includes('1151'));
});

test('I-6: the emergency button shows verified numbers only', () => {
  const data = sample({ emergency: [item({ key: 'a' }), item({ key: 'b', status: 'unverified', value: null, source: undefined, checkedAt: undefined }), item({ key: 'c', status: 'hidden' }), item({ key: 'd', status: 'user-provided', source: undefined })] });
  assert.deepEqual(emergencyNumbers(data).map((x) => x.key), ['a']);
  assert.equal(emergencyNumbers(DATA).length, 5);
});

test('I-7: a call link only for a phone with a value that is verified or provided by the user', () => {
  assert.equal(telHref(item({ value: '+66 2 310 3000' })), 'tel:+6623103000');
  assert.equal(telHref(item({ value: '077-429-559' })), 'tel:077429559');
  assert.equal(telHref(item({ value: '1669' })), 'tel:1669');
  assert.equal(telHref(item({ status: 'user-provided', value: '1234' })), 'tel:1234');
  assert.equal(telHref(item({ status: 'unverified', value: null })), null);
  assert.equal(telHref(item({ status: 'hidden' })), null);
  assert.equal(telHref(item({ kind: 'address', value: 'Road 1' })), null);
});

// ---------- Maps (M5): only from a verified address, only as a link ----------
test('I-8: a map link only from a verified address (or verified Thai address); none from an address the user gave', () => {
  const fields = [item({ key: 'address', kind: 'address', value: '1 Sample Rd, Bangkok' })];
  assert.equal(mapLink(fields, MAPS), `${MAPS}${encodeURIComponent('1 Sample Rd, Bangkok')}`);
  assert.equal(mapLink([item({ key: 'address', kind: 'address', value: 'x', status: 'user-provided', source: undefined })], MAPS), null);
  assert.equal(mapLink([item({ key: 'addressTh', kind: 'address', value: 'ถนน 1' })], MAPS), `${MAPS}${encodeURIComponent('ถนน 1')}`);
  assert.equal(mapLink(fields, ''), null);
  assert.equal(mapLink([], MAPS), null);
});

// ---------- Contacts ----------
test('I-9: Chabad Bangkok: the address on the official page, with the link and the check date', () => {
  const c = DATA.contacts.find((x) => x.key === 'chabad-bangkok');
  const addr = c.fields.find((f) => f.key === 'address');
  assert.equal(addr.value, '18 Phra Athit Road, Chana Songkhram, Phra Nakhon, Bangkok 10200, Thailand');
  assert.equal(addr.status, 'verified-official');
  assert.equal(sourceOf(DATA, addr).url, 'https://chabadthailand.co.il/houses/bangkok/');
  assert.equal(c.fields.filter((f) => f.key === 'address').length, 1, 'no second address');
});

test('I-10: the embassy: no emergency mobile unless verified on an official site; nothing marked verified without a source', () => {
  const e = DATA.contacts.find((x) => x.key === 'embassy-israel');
  assert.ok(e);
  const mobile = e.fields.find((f) => f.key === 'emergencyPhone');
  assert.ok(!mobile || mobile.status === 'hidden' || (mobile.status === 'verified-official' && sourceOf(DATA, mobile)));
  assert.ok(!mobile || !isShown(mobile) || mobile.status === 'verified-official');
});

// ---------- Hospitals: a draft list matched to the route; insurance not verified ----------
test('I-11: hospitals are a draft until the route is final; Bangkok and Samui high, Chiang Mai low, no Hua Hin', () => {
  assert.equal(DATA.hospitals.draft, true);
  const keys = DATA.hospitals.list.map((h) => h.key);
  for (const k of ['bangkok', 'samui', 'krabi', 'koh-tao', 'phuket-siriroj', 'chiang-mai']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.some((k) => /hua-?hin/.test(k)));
  assert.equal(hospital('bangkok').priority, 'high');
  assert.equal(hospital('samui').priority, 'high');
  assert.equal(hospital('chiang-mai').priority, 'low');
  for (const h of DATA.hospitals.list) assert.ok(['high', 'normal', 'low'].includes(h.priority), h.key);
});

test('I-12: no travel insurance yet: insurance, pre-approval and payment stay "not verified" for every hospital', () => {
  assert.deepEqual(INSURANCE_FIELDS, ['insurance', 'preapproval', 'payment']);
  for (const h of DATA.hospitals.list) {
    for (const k of INSURANCE_FIELDS) assert.equal(field(h, k)?.status, 'unverified', `${h.key}.${k}`);
  }
});

test('I-13: emergency room hours and English service are shown as verified only with a source', () => {
  for (const h of DATA.hospitals.list) {
    for (const k of ['er', 'english']) {
      const f = field(h, k);
      assert.ok(f, `${h.key}.${k}`);
      if (f.status === 'verified-official') assert.ok(sourceOf(DATA, f), `${h.key}.${k}`);
      else assert.equal(f.value ?? null, null, `${h.key}.${k} keeps no unverified claim`);
    }
  }
  assert.equal(field(hospital('samui'), 'er').status, 'verified-official');
});

// ---------- Thai phrases and conduct: sourced or not shown ----------
test('I-14: Thai phrases and conduct rules: not shown unless every item has a source', () => {
  for (const part of ['phrases', 'conduct']) {
    const p = DATA[part];
    assert.ok(INFO_STATUSES.includes(p.status), part);
    if (p.status !== 'hidden') for (const x of p.items) assert.equal(x.status, 'verified-official', `${part}.${x.key}`);
  }
});

test('I-15: hidden items are never shown; everything else is', () => {
  assert.equal(isShown(item({ status: 'hidden' })), false);
  assert.equal(isShown(item()), true);
  assert.equal(isShown(item({ status: 'unverified', value: null })), true);
});

// ---------- The user's notes (M6): saved in the trip, in the backup ----------
test('I-16: notes: trimmed, capped, empty removes; only text is kept', () => {
  assert.ok(NOTE_MAX >= 200);
  let info = {};
  info = setNote(info, 'samui', '  פוליסה לדוגמה  ');
  assert.equal(noteOf(info, 'samui'), 'פוליסה לדוגמה');
  info = setNote(info, 'x', 'a'.repeat(NOTE_MAX + 50));
  assert.equal(noteOf(info, 'x').length, NOTE_MAX);
  info = setNote(info, 'samui', '   ');
  assert.equal(noteOf(info, 'samui'), '');
  assert.ok(!('samui' in info.notes));
  assert.deepEqual(cleanNotes({ a: 'ok', b: 5, c: null }), { a: 'ok' });
  assert.deepEqual(cleanNotes(null), {});
});

test('I-17: notes live in trip.info and come back from a backup unchanged', () => {
  const opts = { now: () => new Date('2030-11-01T10:00:00Z'), appVersion: '0.10.0', makeId: () => 'trip-1', countryCode: 'TH', tripName: 'תאילנד' };
  const state = createDefaultState(opts);
  const trip = state.trips[state.activeTripId];
  trip.info = setNote(trip.info, 'insurance', 'מספר פוליסה לדוגמה');
  const file = JSON.stringify(exportBackup(state, new Date('2030-11-02T10:00:00Z')));
  const back = parseBackup(file, opts);
  assert.equal(back.ok, true);
  assert.equal(noteOf(back.state.trips['trip-1'].info, 'insurance'), 'מספר פוליסה לדוגמה');
});

// ---------- Offline and the screen (M4, M6, M7) ----------
test('I-18: offline: the info file, the screen and its logic are in the service worker cache', () => {
  const sw = readText('sw.js');
  for (const f of ['./data/info/th.json', './src/js/info-view.js', './src/js/core/info.js']) assert.ok(sw.includes(`'${f}'`), f);
});

test('I-19: the info screen is built (not "soon"); home has an emergency button and an info tile', () => {
  const app = readText('src/js/app.js');
  assert.doesNotMatch(app, /info: \{[^}]*soon: true/);
  const html = readText('index.html');
  assert.match(html, /id="panel-info"/);
  assert.match(html, /data-action="home-emergency"/);
  assert.match(html, /data-go="info"[^>]*>[\s\S]{0,200}data-i18n="tools\.info"/);
  assert.doesNotMatch(html, /tel:\d/, 'numbers come from the data file, not typed in the page');
});

test('I-20: the checklist note on emergency numbers follows the verified data and points to the info screen', () => {
  const em = TH.checklistBuiltin.find((x) => x.key === 'emergency-numbers');
  assert.ok(em);
  assert.doesNotMatch(em.note.he, /טרם אומת/);
  assert.match(em.note.he, /מידע וחירום/);
  for (const n of ['1669', '191', '199', '1155', '1672']) assert.ok(em.note.he.includes(n), n);
  assert.ok(!em.verify);
});

test('I-21: every info text key used by the screen exists in Hebrew and English', () => {
  const he = readJson('locales/he.json');
  const en = readJson('locales/en.json');
  const used = new Set([...readText('src/js/info-view.js').matchAll(/t\('(info\.[\w.-]+)'\)/g), ...readText('index.html').matchAll(/data-i18n(?:-label)?="(info\.[\w.-]+|tools\.info[\w.]*|home\.emergency[\w.]*)"/g)].map((m) => m[1]));
  assert.ok(used.size >= 10, 'the screen uses its own texts');
  for (const k of used) { assert.ok(he[k], `he ${k}`); assert.ok(en[k], `en ${k}`); }
});
