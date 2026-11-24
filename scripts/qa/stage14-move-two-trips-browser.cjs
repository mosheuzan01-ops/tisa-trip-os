// 1.1.3 (B): two trips on one phone, in Chromium with the real app and supabase-js, and a FAKE Supabase behind
// Playwright routes (lib/fake-supabase.cjs): no network, sample users and data only (rule 16).
// MT1 trip 1's move reaches the server but the answer is lost: the dialog shows the failure, trip 1 stays "on this
//     device only", and its records really are in the (fake) cloud
// MT2 trip 2 is then moved completely (backup, "move now"): linked, trip 1 still not linked
// MT3 back on trip 1: a checklist item is deleted on the phone, then trip 1 is moved again: the item does not come
//     back on the phone or in the cloud (a delete, not a new copy); the other records stay; no duplicate trip or record
// MT4 trip 2 was not touched by trip 1's retry, and both trips are "(mine)" after a reload
// Usage: QA_OUT=<dir> RUN=<n> PORT=<port> node scripts/qa/stage14-move-two-trips-browser.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { richState } = require('./lib/rich-trip.cjs');
const { createFakeSupabase, PROJECT } = require('./lib/fake-supabase.cjs');
const { ROOT, startServer, newContext, openSettings, signIn, waitPill } = require('./lib/cloud-owner.cjs');

const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/1.1.3/b/browser');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8197);
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const outside = [];
const data = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tisa:v1')));
const closedMigrate = (page) => page.waitForFunction(() => !document.querySelector('#dlg-cloud-migrate')?.open, null, { timeout: 15000 });
const label = (page, id) => page.$eval(`[data-slot="cloud-trip-list"] input[value="${id}"] + span`, (s) => s.textContent);
async function choose(page, id) {
  await page.check(`[data-slot="cloud-trip-list"] input[value="${id}"]`);
  await page.waitForFunction((x) => JSON.parse(localStorage.getItem('tisa:v1')).activeTripId === x, id);
}
async function backup(page) {
  await page.waitForSelector('#dlg-cloud-migrate[open]');
  await Promise.all([page.waitForEvent('download'), page.click('[data-cloud="migrate-yes"]')]);
  await page.waitForSelector('#dlg-cloud-migrate[open] [data-cloud="migrate-upload"]:not([hidden])');
}

(async () => {
  const { server, base } = await startServer(PORT);
  const browser = await chromium.launch();
  const sb = await createFakeSupabase();
  const { fake } = sb;
  fake.addUser({ email: 'owner-a@example.com', display_name: 'Sample A', password: 'Sample-Passw0rd!', status: 'approved' });
  try {
    const seed = await richState();
    const one = seed.activeTripId;
    const two = 'second-sample-trip';
    seed.trips[two] = { ...JSON.parse(JSON.stringify(seed.trips[one])), id: two, name: 'Second sample trip', photos: [],
      checklist: [{ id: 'item-two-sample', group: 'documents', name: 'Sample item of trip 2', qty: 1, note: '', done: false }] };
    const ctx = await newContext(browser, sb, { seed });
    const page = await openSettings(ctx, base, (p) => {
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
      p.on('request', (r) => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith(PROJECT) && !/^(data|blob):/.test(u)) outside.push(u); });
    });
    const rowsOf = (t) => [...fake.records.values()].filter((r) => r.trip_id === t);

    // MT1: first sign-in offers the move of trip 1 by itself; the records reach the server, the answer is lost
    await signIn(page, 'owner-a@example.com');
    await backup(page);
    fake.loseAnswer = 'push_records';
    await page.click('[data-cloud="migrate-upload"]');
    await page.waitForSelector('[data-slot="cloud-migrate-status"][data-state="failed"]', { timeout: 15000 });
    fake.loseAnswer = null;
    const failText = await page.textContent('[data-slot="cloud-migrate-status"]');
    const sent1 = rowsOf(one).length;
    const kept = (await data(page)).trips[one].checklist.map((x) => x.id);
    pass('MT1 trip 1: records reached the server, the answer was lost; the dialog says so and trip 1 stays on this device only',
      sent1 > 10 && /הנתונים שלו לא נשלחו/.test(failText) && /במכשיר בלבד/.test(await label(page, one)), { sent1, failText });
    await page.keyboard.press('Escape');
    await closedMigrate(page);

    // MT2: trip 2 is moved completely
    await choose(page, two);
    await page.click('[data-cloud="upload"]');
    await backup(page);
    await page.click('[data-cloud="migrate-upload"]');
    await closedMigrate(page);
    await waitPill(page, 'מסונכרן');
    pass('MT2 trip 2 is moved completely; trip 1 is still on this device only', /שלי/.test(await label(page, two)) && /במכשיר בלבד/.test(await label(page, one)) && fake.trips.size === 2);
    const two0 = JSON.stringify(rowsOf(two).map((r) => [r.kind, r.rec_id, r.data, r.deleted]));

    // MT3: back on trip 1, delete one checklist item on the phone, then move trip 1 again
    await choose(page, one);
    const gone = kept[0];
    await page.goto(`${base}#/checklist`); await page.waitForSelector('#panel-checklist:not([hidden])');
    await page.click(`[data-action="item-delete"][data-id="${gone}"]`);
    await page.click('[data-action="list-confirm-yes"]');
    await page.waitForFunction((id) => !JSON.parse(localStorage.getItem('tisa:v1')).trips[JSON.parse(localStorage.getItem('tisa:v1')).activeTripId].checklist.some((x) => x.id === id), gone);
    await page.goto(`${base}#/settings`); await page.waitForSelector('#panel-settings:not([hidden])');
    const before = rowsOf(one).length;
    await page.click('[data-cloud="upload"]');
    await backup(page);
    await page.click('[data-cloud="migrate-upload"]');
    await closedMigrate(page);
    await waitPill(page, 'מסונכרן');
    const after = (await data(page)).trips[one].checklist.map((x) => x.id);
    const cloudGone = rowsOf(one).find((r) => r.kind === 'item' && r.rec_id === gone);
    const others = kept.slice(1).every((id) => after.includes(id) && rowsOf(one).some((r) => r.kind === 'item' && r.rec_id === id && !r.deleted));
    pass('MT3 the item deleted on the phone before the retry does not come back, on the phone or in the cloud; the rest stays; no duplicate',
      !after.includes(gone) && cloudGone?.deleted === true && others && rowsOf(one).length === before && fake.trips.size === 2 && /שלי/.test(await label(page, one)),
      { comesBack: after.includes(gone), cloudDeleted: cloudGone?.deleted, others, records: [before, rowsOf(one).length], trips: fake.trips.size });

    // MT4: trip 2 untouched; after a reload both are mine and nothing changes
    const two1 = JSON.stringify(rowsOf(two).map((r) => [r.kind, r.rec_id, r.data, r.deleted]));
    await page.reload(); await page.waitForSelector('#panel-settings:not([hidden])');
    await waitPill(page, 'מסונכרן');
    const afterReload = (await data(page)).trips[one].checklist.map((x) => x.id);
    pass('MT4 trip 2 was not touched by trip 1\'s retry; after a reload both are "(mine)" and the item is still gone',
      two0 === two1 && /שלי/.test(await label(page, one)) && /שלי/.test(await label(page, two)) && !afterReload.includes(gone));
    await ctx.close();
  } catch (e) {
    pass('MT-run', false, { error: String(e && e.stack || e).slice(0, 800) });
  } finally {
    await browser.close();
    server.kill();
  }
  pass('MT-clean no page errors and no request outside the app and the fake project', errors.length === 0 && outside.length === 0, { errors: errors.slice(0, 5), outside: outside.slice(0, 5) });
  fs.writeFileSync(path.join(OUT, 'stage14-move-two-trips-browser.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}${v.result === 'PASS' ? '' : `  ${JSON.stringify(v).slice(0, 600)}`}`);
  console.log(`${failed.length ? 'FAIL' : 'PASS'} ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})();
