// 1.1.4: a new trip on this phone, the fifth tab "Tools", the home "Shortcuts", and the admin's users area
// (pending count with a cache, "add to a trip" through share_trip, blocking with a closed "blocked (N)" group).
// No server change: only the existing functions admin_list_users, admin_list_trips, admin_set_status and share_trip.
// Pure logic in Node, plus static checks of index.html, app.js and the locales. Sample data only (rule 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, readJson } from './helpers.js';
import { createDefaultState, validateState, addTrip, TRIP_NAME_MAX } from '../src/js/core/schema.js';
import { BADGE_TTL_MS, pendingOf, badgeDue, badgeCount, splitUsers, tripsToOffer } from '../src/js/core/admin-users.js';

let n = 0;
const makeId = () => { n += 1; return `nt-${String(n).padStart(4, '0')}`; };
const base = () => {
  const s = createDefaultState({ now: () => new Date('2026-11-24T08:00:00Z'), appVersion: '1.1.4', makeId, countryCode: 'TH', tripName: 'טיול לדוגמה' });
  const t = s.trips[s.activeTripId];
  t.startDate = '2030-01-01'; t.endDate = '2030-01-10';
  t.destinations = [{ id: 'st-1', name: 'עיר לדוגמה', startDate: '2030-01-01', endDate: '2030-01-05', note: '' }];
  t.expenses = [{ id: 'ex-1', amountMinor: 1000, currency: 'ILS', rate: 1, baseMinor: 1000, category: 'food', date: '2030-01-02', destinationId: null, description: 'דוגמה', note: '', method: 'cash', status: 'paid' }];
  return s;
};

// ---------------- new trip ----------------
test('NT-1 a new trip is added next to the old one, the old trip is unchanged byte for byte, the data stays valid', () => {
  const s = base();
  const oldId = s.activeTripId;
  const before = JSON.stringify(s.trips[oldId]);
  const r = addTrip(s, { name: '  טיול חדש  ', makeId, countryCode: 'TH' });
  assert.equal(r.ok, true);
  assert.equal(Object.keys(s.trips).length, 2);
  assert.equal(JSON.stringify(s.trips[oldId]), before);
  const t = s.trips[r.id];
  assert.equal(t.name, 'טיול חדש');
  assert.equal(t.countryCode, 'TH');
  assert.deepEqual([t.startDate, t.endDate], [null, null]);
  assert.deepEqual([t.destinations, t.expenses, t.checklist, t.places], [[], [], [], []]);
  assert.equal(t.budget.totalMinor, null);
  assert.deepEqual(validateState(s), []);
});

test('NT-2 a new trip becomes the shown trip; the ids never collide with an existing trip', () => {
  const s = base();
  const taken = s.activeTripId;
  let i = 0;
  const clash = () => { i += 1; return i === 1 ? taken : `nt-new-${i}`; };
  const r = addTrip(s, { name: 'שני', makeId: clash, countryCode: 'TH' });
  assert.equal(r.ok, true);
  assert.notEqual(r.id, taken);
  assert.equal(s.activeTripId, r.id);
  assert.equal(Object.keys(s.trips).length, 2);
});

test('NT-3 an empty or too long name is refused and nothing changes', () => {
  for (const name of ['', '   ', 'א'.repeat(TRIP_NAME_MAX + 1), null]) {
    const s = base();
    const before = JSON.stringify(s);
    const r = addTrip(s, { name, makeId, countryCode: 'TH' });
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(s), before);
  }
  assert.equal(addTrip(base(), { name: 'א'.repeat(TRIP_NAME_MAX), makeId, countryCode: 'TH' }).ok, true);
});

// ---------------- admin: pending count and its cache ----------------
const U = (id, status, role = 'user') => ({ id, email: `${id}@example.com`, display_name: '', phone: null, role, status });
const LIST = [U('adm', 'approved', 'admin'), U('p1', 'pending'), U('p2', 'pending'), U('a1', 'approved'), U('b1', 'blocked'), U('b2', 'blocked')];

test('AB-1 pending = users waiting for approval (not the approved, the blocked or the admin)', () => {
  assert.equal(pendingOf(LIST), 2);
  assert.equal(pendingOf([]), 0);
  assert.equal(pendingOf(null), 0);
});

test('AB-2 the cache: asked again only after the time limit, and only for the same admin', () => {
  const now = Date.parse('2026-11-24T10:00:00Z');
  assert.equal(badgeDue(null, 'adm', now), true);
  const c = { userId: 'adm', n: 2, at: new Date(now).toISOString() };
  assert.equal(badgeDue(c, 'adm', now + 1000), false);
  assert.equal(badgeDue(c, 'adm', now + BADGE_TTL_MS - 1), false);
  assert.equal(badgeDue(c, 'adm', now + BADGE_TTL_MS), true);
  assert.equal(badgeDue(c, 'other', now + 1000), true);
  assert.ok(BADGE_TTL_MS >= 5 * 60_000, 'not more than once every 5 minutes');
});

test('AB-3 the count shown: only for the same admin, 0 hides it', () => {
  const c = { userId: 'adm', n: 3, at: '2026-11-24T10:00:00Z' };
  assert.equal(badgeCount(c, 'adm'), 3);
  assert.equal(badgeCount(c, 'someone-else'), 0);
  assert.equal(badgeCount({ userId: 'adm', n: 0, at: c.at }, 'adm'), 0);
  assert.equal(badgeCount(null, 'adm'), 0);
});

// ---------------- admin: users grouped, add to a trip ----------------
test('AU-1 blocked users are in their own group; everyone else stays in the main list, in order', () => {
  const { active, blocked } = splitUsers(LIST);
  assert.deepEqual(active.map((u) => u.id), ['adm', 'p1', 'p2', 'a1']);
  assert.deepEqual(blocked.map((u) => u.id), ['b1', 'b2']);
});

const OWNED = [{ id: 'tr-own-1', name: 'טיול של המנהל', role: 'owner' }, { id: 'tr-own-2', name: 'עוד טיול', role: 'owner' }, { id: 'tr-shared', name: 'משותף', role: 'member' }];
const ADMIN_TRIPS = [
  { id: 'tr-own-1', members: [{ user_id: 'adm', role: 'owner' }, { user_id: 'a1', role: 'member' }] },
  { id: 'tr-own-2', members: [{ user_id: 'adm', role: 'owner' }] },
  { id: 'tr-shared', members: [{ user_id: 'x', role: 'owner' }, { user_id: 'adm', role: 'member' }] },
];

test('AU-2 add to a trip: only the trips the admin owns, without the ones the user is already on', () => {
  assert.deepEqual(tripsToOffer(U('a1', 'approved'), OWNED, ADMIN_TRIPS).map((x) => x.id), ['tr-own-2']);
  assert.deepEqual(tripsToOffer(U('a2', 'approved'), OWNED, ADMIN_TRIPS).map((x) => x.id), ['tr-own-1', 'tr-own-2']);
});

test('AU-3 add to a trip is never offered to a pending, blocked or admin user, or with no trip of the admin', () => {
  assert.deepEqual(tripsToOffer(U('p1', 'pending'), OWNED, ADMIN_TRIPS), []);
  assert.deepEqual(tripsToOffer(U('b1', 'blocked'), OWNED, ADMIN_TRIPS), []);
  assert.deepEqual(tripsToOffer(U('adm', 'approved', 'admin'), OWNED, ADMIN_TRIPS), []);
  assert.deepEqual(tripsToOffer(U('a2', 'approved'), [], ADMIN_TRIPS), []);
  assert.deepEqual(tripsToOffer(U('a2', 'approved'), OWNED.filter((x) => x.role !== 'owner'), ADMIN_TRIPS), []);
});

// ---------------- the screens (static) ----------------
const html = readText('index.html');
const tabs = [...html.matchAll(/<button class="tab"[^>]*data-tab="([a-z]+)"[^>]*data-route="([a-z-]+)"/g)].map((m) => [m[1], m[2]]);
const section = (id) => {
  const start = html.indexOf(`id="${id}"`);
  const open = html.lastIndexOf('<section', start);
  let depth = 0;
  const re = /<\/?section\b/g;
  re.lastIndex = open;
  for (let m; (m = re.exec(html));) { depth += m[0] === '<section' ? 1 : -1; if (depth === 0) return html.slice(open, m.index); }
  return '';
};
const GLOBAL = ['transfers', 'calendar', 'photos', 'places', 'summary'];

test('TL-1 five tabs, in order: home, itinerary, budget, lists, tools (#/tools)', () => {
  assert.deepEqual(tabs, [['home', 'home'], ['itinerary', 'itinerary'], ['budget', 'money'], ['lists', 'checklist'], ['tools', 'tools']]);
  assert.match(readText('src/css/main.css'), /\.tabbar-list \{[^}]*repeat\(5, minmax\(0, 1fr\)\)/);
});

test('TL-2 the tools screen: title "כלים", lead "מבט על כל הטיול", and the five global tools that open their own screens', () => {
  const tools = section('panel-tools');
  assert.ok(tools, 'panel-tools exists');
  assert.match(tools, /data-i18n="toolsTab\.title">כלים</);
  assert.match(tools, /data-i18n="toolsTab\.lead">מבט על כל הטיול</);
  assert.deepEqual([...tools.matchAll(/data-go="([a-z-]+)"/g)].map((m) => m[1]), GLOBAL);
});

test('TL-3 the itinerary no longer repeats the five global tools; their screens still exist', () => {
  const itin = section('panel-itinerary');
  for (const g of GLOBAL) {
    assert.doesNotMatch(itin, new RegExp(`data-go="${g}"`), `itinerary still links ${g}`);
    assert.match(html, new RegExp(`id="panel-${g}"`), `screen ${g} kept`);
  }
});

test('TL-4 the router: #/tools is a screen, and the five global screens light the tools tab', () => {
  const app = readText('src/js/app.js');
  assert.match(app, /tools: \{ tab: 'tools'/);
  for (const g of GLOBAL) assert.match(app, new RegExp(`\\b${g}: \\{ tab: 'tools'`), `${g} -> tools tab`);
  assert.match(app, /tools: \$\('#panel-tools'\)/);
});

test('TL-5 home: four shortcuts kept, the title is "קיצורי דרך" (not "הכלים שלכם")', () => {
  const he = readJson('locales/he.json');
  const en = readJson('locales/en.json');
  assert.equal(he['tools.title'], 'קיצורי דרך');
  assert.equal(en['tools.title'], 'Shortcuts');
  const home = section('panel-home');
  assert.equal([...home.matchAll(/class="tile surface"/g)].length, 4);
  assert.match(home, /data-slot="home-admin"[^>]*hidden/, 'the admin notice starts hidden');
});

test('TL-6 every new text key is in both languages', () => {
  const he = readJson('locales/he.json');
  const en = readJson('locales/en.json');
  const keys = ['nav.tools', 'toolsTab.title', 'toolsTab.lead', 'screen.tools', 'trip.new', 'trip.new.title', 'trip.new.hint', 'trip.new.name', 'trip.new.create', 'trip.new.err', 'trip.new.done',
    'cloud.admin.pending', 'cloud.admin.blocked', 'cloud.admin.unblock', 'cloud.admin.addToTrip', 'cloud.admin.addPick', 'cloud.admin.add', 'cloud.admin.addText', 'cloud.admin.added', 'cloud.admin.addNotApproved', 'cloud.admin.approveFirst', 'cloud.share.hintAccount'];
  for (const k of keys) {
    assert.ok(typeof he[k] === 'string' && he[k].length, `he ${k}`);
    assert.ok(typeof en[k] === 'string' && en[k].length, `en ${k}`);
  }
  assert.match(he['cloud.admin.blockText'], /לא מוחקת/);
  assert.match(he['cloud.share.hintAccount'], /לא מוסיפה/);
});

test('TL-7 the new trip dialog is in the page (works with no account), and the trip choice works with no account', () => {
  assert.match(html, /<dialog[^>]*id="dlg-new-trip"/);
  assert.ok(html.indexOf('id="dlg-new-trip"') < html.indexOf('<template id="tpl-cloud">'), 'not inside the account template');
  const cv = readText('src/js/cloud-view.js');
  assert.ok(cv.indexOf("'cloud-trip-list\"]').addEventListener('change'") < cv.indexOf('if (!cloud.configured)'), 'the trip choice is wired before the no-account return');
});

test('TL-8 no push notifications and no new server call or migration', () => {
  const all = ['src/js/app.js', 'src/js/cloud-view.js', 'src/js/admin-view.js', 'sw.js'].map(readText).join('\n');
  assert.doesNotMatch(all, /Notification\.requestPermission|pushManager|showNotification/);
  const rpcs = [...readText('src/js/admin-view.js').matchAll(/call\('([a-z_]+)'/g)].map((m) => m[1]);
  for (const f of rpcs) assert.ok(['admin_list_users', 'admin_list_trips', 'admin_set_status', 'unshare_trip', 'share_trip'].includes(f), f);
  assert.deepEqual(readText('supabase/migrations/0003_delete_trip.sql').length > 0, true);
});
