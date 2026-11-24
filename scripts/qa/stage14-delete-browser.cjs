// 1.1.2: "Delete trip" in the account card, in Chromium with the real app and supabase-js, and a FAKE Supabase behind
// Playwright routes (lib/fake-supabase.cjs): no network, sample users and data only (rule 16). The fake follows
// supabase/migrations/0003_delete_trip.sql; the real rules are checked by supabase/tests/rls_check.sql (D01-D10).
// DB1 the button: only the owner of a linked trip sees it; a member does not
// DB2 the button only opens the dialog: name, what goes, "cannot be undone", the question, Cancel / Yes; nothing sent
// DB3 Cancel, Esc and a tap outside close it and delete nothing
// DB4 failures (no network, refused): the reason is shown in the dialog, nothing changes, it can be tried again
// DB5 a double tap on "Yes" sends one delete; the trip, its records and members are gone; another trip is untouched
// DB6 the phone keeps its copy byte for byte, now "on this device only"; no move is offered by itself after a reload
// DB7 a friend's phone keeps its copy too ("no longer shared")
// DB8 the trip's photos on the phone (IndexedDB tisa-photos, never in the cloud) stay byte for byte after the delete
// Screenshots: the dialog at 390 and 1440, the failure at 390, the card after the delete at 390.
// Usage: QA_OUT=<dir> RUN=<n> PORT=<port> node scripts/qa/stage14-delete-browser.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { richState, putSamplePhoto, PHOTO_ID } = require('./lib/rich-trip.cjs');
const { createFakeSupabase, PROJECT } = require('./lib/fake-supabase.cjs');
const { ROOT, PASS, startServer, newContext, openSettings, signIn, signInAndMove, waitPill, visibleActions } = require('./lib/cloud-owner.cjs');

const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/1.1.2/delete');
const SHOT_DIR = path.join(OUT, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PORT = Number(process.env.PORT ?? 8198);
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];
const shot = async (page, name) => { await page.waitForTimeout(450); return page.screenshot({ path: path.join(SHOT_DIR, `${name}.jpg`), type: 'jpeg', quality: 75 }); }; // after the dialog's opening animation
const data = (page) => page.evaluate(() => localStorage.getItem('tisa:v1'));
const toast = (page, re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('[data-slot="toast"]').textContent), re.source, { timeout: 10000 });

(async () => {
  const { server, base } = await startServer(PORT);
  const browser = await chromium.launch();
  const sb = await createFakeSupabase();
  const { fake } = sb;
  const A = fake.addUser({ email: 'owner-a@example.com', password: PASS, display_name: 'Sample A', status: 'approved' });
  fake.addUser({ email: 'friend-b@example.com', password: PASS, display_name: 'Sample B', status: 'approved' });
  const watch = (name) => (page) => {
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith(PROJECT) && !/^(data|blob):/.test(u)) outside.push(u); });
  };
  const deletes = () => sb.log.filter((x) => x.fn === 'delete_trip').length;
  try {
    // another trip of the same owner, already in the account (e.g. from another phone): it must stay untouched
    fake.rpc(A, 'create_trip', { t: 'other-trip-0001', p_name: 'Other sample trip', p_cc: 'TH', p_start: null, p_end: null });
    fake.rpc(A, 'push_records', { rows: [{ trip_id: 'other-trip-0001', scope: 'shared', kind: 'stop', rec_id: 's1', data: { name: 'Sample stop' }, deleted: false, edited_at: new Date().toISOString() }] });
    const otherRecords = () => [...fake.records.values()].filter((r) => r.trip_id === 'other-trip-0001').length;

    const ctxA = await newContext(browser, sb, { seed: await richState() });
    const pageA = await openSettings(ctxA, base, watch('owner'));
    // first phone of an account that already has a trip: the move is not offered by itself, so use the button
    await signIn(pageA, 'owner-a@example.com');
    await waitPill(pageA, 'מסונכרן');
    await pageA.click('[data-cloud="upload"]');
    await pageA.waitForSelector('#dlg-cloud-migrate[open]');
    await Promise.all([pageA.waitForEvent('download'), pageA.click('[data-cloud="migrate-yes"]')]);
    await pageA.click('[data-cloud="migrate-upload"]');
    await pageA.waitForFunction(() => !document.querySelector('#dlg-cloud-migrate').open, null, { timeout: 15000 });
    await waitPill(pageA, 'מסונכרן');
    const tripId = JSON.parse(await data(pageA)).activeTripId;
    const recordsOf = () => [...fake.records.values()].filter((r) => r.trip_id === tripId).length;
    for (let i = 0; i < 100 && recordsOf() < 10; i += 1) await pageA.waitForTimeout(100);
    const original = await data(pageA);
    const tripRecords = recordsOf();
    // the trip's photo lives only on this phone (IndexedDB): its bytes are read again after the delete (DB8)
    await putSamplePhoto(pageA);
    const photoBytes = () => pageA.evaluate(async (id) => {
      const { getPhoto } = await import('/src/js/photo-store.js');
      const r = await getPhoto(id);
      if (!r) return null;
      const sha = async (b) => {
        const buf = b instanceof Blob ? await b.arrayBuffer() : b;
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((x) => x.toString(16).padStart(2, '0')).join('');
      };
      return { type: r.type, full: await sha(r.full), thumb: await sha(r.thumb) };
    }, PHOTO_ID);
    const photoBefore = await photoBytes();

    // a friend gets the trip on their phone
    fake.rpc(A, 'share_trip', { t: tripId, friend_email: 'friend-b@example.com' });
    const ctxB = await newContext(browser, sb, {});
    const pageB = await openSettings(ctxB, base, watch('friend'));
    await signIn(pageB, 'friend-b@example.com');
    await waitPill(pageB, 'מסונכרן');
    await pageB.check(`[data-slot="cloud-trip-list"] input[value="${tripId}"]`);
    await pageB.waitForFunction((id) => JSON.parse(localStorage.getItem('tisa:v1')).activeTripId === id, tripId, { timeout: 15000 });
    await pageB.waitForFunction(() => !document.querySelector('[data-cloud="members"]').hidden);
    const friendActions = await visibleActions(pageB);
    const ownerActions = await visibleActions(pageA);
    pass('DB1 only the owner of a linked trip sees "Delete trip"; a member does not', ownerActions.includes('delete') && !friendActions.includes('delete'), { ownerActions, friendActions });

    // DB2 the button only opens the dialog
    await pageA.click('[data-cloud="delete"]');
    await pageA.waitForSelector('#dlg-cloud-delete[open]');
    const dlg = await pageA.evaluate(() => ({
      name: document.querySelector('[data-slot="cloud-delete-name"]').textContent,
      what: document.querySelector('[data-slot="cloud-delete-what"]').textContent,
      text: document.querySelector('#dlg-cloud-delete').textContent,
      yes: document.querySelector('[data-cloud="delete-yes"]').textContent,
      cancel: document.querySelector('#dlg-cloud-delete [data-close]').textContent,
      focus: document.activeElement?.hasAttribute('data-close') && document.querySelector('#dlg-cloud-delete').contains(document.activeElement),
    }));
    const tripName = JSON.parse(original).trips[tripId].name;
    await shot(pageA, 'delete-dialog-390-light');
    await pageA.setViewportSize({ width: 1440, height: 900 }); await shot(pageA, 'delete-dialog-1440-light'); await pageA.setViewportSize({ width: 390, height: 844 });
    pass('DB2 "Delete trip" opens a dialog: the trip\'s name, what is deleted, that it cannot be undone, the question, Cancel and Yes; nothing sent',
      dlg.name === tripName && /תחנות/.test(dlg.what) && /הוצאות/.test(dlg.what) && /אי אפשר לבטל/.test(dlg.text) && /במכשיר בלבד/.test(dlg.text)
      && /האם אתה בטוח שברצונך למחוק את הטיול הזה\?/.test(dlg.text) && dlg.yes === 'כן, למחוק את הטיול' && dlg.cancel === 'ביטול' && dlg.focus && deletes() === 0,
      { dlg: { ...dlg, text: undefined }, deletes: deletes() });

    // DB3 cancel, Esc, a tap outside
    const ways = {};
    await pageA.click('#dlg-cloud-delete [data-close]');
    ways.cancel = await pageA.waitForFunction(() => !document.querySelector('#dlg-cloud-delete').open).then(() => true, () => false);
    await pageA.click('[data-cloud="delete"]'); await pageA.waitForSelector('#dlg-cloud-delete[open]');
    await pageA.keyboard.press('Escape');
    ways.esc = await pageA.waitForFunction(() => !document.querySelector('#dlg-cloud-delete').open).then(() => true, () => false);
    await pageA.click('[data-cloud="delete"]'); await pageA.waitForSelector('#dlg-cloud-delete[open]');
    const box = await pageA.$eval('#dlg-cloud-delete', (d) => { const r = d.getBoundingClientRect(); return { top: r.top }; });
    await pageA.mouse.click(195, Math.max(5, box.top - 20));
    ways.outside = await pageA.waitForFunction(() => !document.querySelector('#dlg-cloud-delete').open).then(() => true, () => false);
    pass('DB3 Cancel, Esc and a tap outside close the dialog and delete nothing', Object.values(ways).every(Boolean) && deletes() === 0 && fake.trips.has(tripId) && await data(pageA) === original, { ways, deletes: deletes() });

    // DB4 failures: no network, then a refusal
    const fails = {};
    // 'refused': the server answers not_allowed (here: the account was blocked meanwhile), as delete_trip does
    for (const [f, re] of [['network', /אין חיבור לשרת/], ['refused', /אין הרשאה/]]) {
      await pageA.click('[data-cloud="delete"]'); await pageA.waitForSelector('#dlg-cloud-delete[open]');
      if (f === 'refused') fake.setStatus(A, 'blocked'); else fake.fail = f;
      await pageA.click('[data-cloud="delete-yes"]');
      await pageA.waitForFunction(() => document.querySelector('[data-slot="cloud-delete-error"]').textContent.length > 0, null, { timeout: 10000 });
      const msg = await pageA.textContent('[data-slot="cloud-delete-error"]');
      fake.fail = null; fake.setStatus(A, 'approved');
      if (f === 'network') await shot(pageA, 'delete-failed-390-light');
      const yesEnabled = await pageA.$eval('[data-cloud="delete-yes"]', (b) => !b.disabled);
      fails[f] = { msg, ok: re.test(msg) && /לא נמחק/.test(msg) && yesEnabled && await pageA.isVisible('#dlg-cloud-delete[open]') };
      await pageA.click('#dlg-cloud-delete [data-close]');
      await pageA.waitForFunction(() => !document.querySelector('#dlg-cloud-delete').open);
    }
    const stillLinked = await pageA.evaluate((id) => JSON.parse(localStorage.getItem('latisa:sync:v1')).trips[id].linked, tripId);
    pass('DB4 no network or a refusal: the reason is in the dialog, nothing is deleted or changed, "Yes" works again',
      Object.values(fails).every((x) => x.ok) && fake.trips.has(tripId) && recordsOf() === tripRecords && stillLinked && await data(pageA) === original, { fails, stillLinked });

    // DB5 a double tap deletes once
    await waitPill(pageA, 'מסונכרן');
    const before = deletes();
    await pageA.click('[data-cloud="delete"]'); await pageA.waitForSelector('#dlg-cloud-delete[open]');
    await pageA.evaluate(() => { const b = document.querySelector('[data-cloud="delete-yes"]'); b.click(); b.click(); });
    await pageA.waitForFunction(() => !document.querySelector('#dlg-cloud-delete').open, null, { timeout: 10000 });
    await toast(pageA, /נמחק מהחשבון/);
    pass('DB5 a double tap sends one delete; the trip, its records and its members are gone; the owner\'s other trip is untouched',
      deletes() - before === 1 && !fake.trips.has(tripId) && recordsOf() === 0 && !fake.members.has(tripId) && fake.trips.has('other-trip-0001') && otherRecords() === 1,
      { calls: deletes() - before, records: recordsOf(), other: otherRecords() });

    // DB6 the phone keeps its copy; "on this device only"; nothing offered by itself after a reload
    const label = () => pageA.evaluate((id) => document.querySelector(`[data-slot="cloud-trip-list"] input[value="${id}"]`)?.nextElementSibling?.textContent ?? '', tripId);
    const afterDelete = await data(pageA);
    const actions = await visibleActions(pageA);
    await shot(pageA, 'card-after-delete-390-light');
    await pageA.reload(); await pageA.waitForSelector('#panel-settings:not([hidden])');
    await waitPill(pageA, 'מסונכרן');
    await pageA.waitForTimeout(500);
    const offered = await pageA.isVisible('#dlg-cloud-migrate[open]');
    pass('DB6 the phone keeps its copy byte for byte, now "on this device only"; share, members and delete are gone; no move offered by itself',
      JSON.stringify(JSON.parse(afterDelete).trips) === JSON.stringify(JSON.parse(original).trips) && JSON.stringify(JSON.parse(await data(pageA)).trips) === JSON.stringify(JSON.parse(original).trips)
      && /במכשיר בלבד/.test(await label()) && !actions.includes('delete') && !actions.includes('share') && !actions.includes('members') && actions.includes('upload') && !offered,
      { actions, label: await label(), offered });

    // DB8 the photos on the phone are untouched (after the delete and the reload above)
    const photoAfter = await photoBytes();
    pass('DB8 the trip\'s photo on the phone (IndexedDB) is still there, byte for byte, after the delete and a reload',
      Boolean(photoBefore?.full) && JSON.stringify(photoAfter) === JSON.stringify(photoBefore), { photoBefore, photoAfter });

    // DB7 the friend's phone keeps its copy
    const friendBefore = JSON.parse(await data(pageB)).trips[tripId];
    await pageB.evaluate(() => dispatchEvent(new Event('online')));
    await toast(pageB, /כבר לא משותף/);
    const friendAfter = JSON.parse(await data(pageB)).trips[tripId];
    pass('DB7 a friend\'s phone keeps its copy, told it is no longer shared', JSON.stringify(friendAfter) === JSON.stringify(friendBefore) && Boolean(friendAfter));
    await ctxA.close(); await ctxB.close();
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    pass('no requests outside the app and the (fake) Supabase project', outside.length === 0, { outside });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'delete-browser.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}${v.result === 'PASS' ? '' : `  ${JSON.stringify(v).slice(0, 900)}`}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exit(failed.length ? 1 : 0);
})();
