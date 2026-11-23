// 1.1.2: the layout of the account card ("my account and trips") and of every action row in settings, measured in
// Chromium at phone, tablet and desktop widths. FAKE Supabase behind Playwright routes: no network, sample data only.
// The 1.1.1 problem: .settings-actions was an auto-fit grid, so three buttons on a phone made two columns and left an
// empty cell under "Trip members". What is checked:
// L1 every visible action row in settings is filled edge to edge: no empty cell, no lonely button beside a gap
// L2 the buttons of one row group have one height
// L3 the account card groups its buttons: trip actions (share, members, delete) apart from account actions (admin,
//    password, sign-out), so "Admin" is never in the row of the trip's buttons
// L4 no sideways scroll of the page at any width
// L5 the members and admin dialogs open from their buttons and close again (behaviour unchanged)
// Screenshots: the card at 390 and 1440 (light) and 390 (dark), the members and admin dialogs at 390.
// Usage: QA_OUT=<dir> RUN=<n> PORT=<port> node scripts/qa/stage14-account-layout-browser.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { richState } = require('./lib/rich-trip.cjs');
const { createFakeSupabase } = require('./lib/fake-supabase.cjs');
const { ROOT, PASS, startServer, newContext, openSettings, signInAndMove, visibleActions } = require('./lib/cloud-owner.cjs');

const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/1.1.2/layout');
const SHOT_DIR = path.join(OUT, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PORT = Number(process.env.PORT ?? 8197);
const WIDTHS = [320, 390, 430, 768, 1024, 1440];
const results = {};
const pass = (id, ok, detail = {}) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];

/** Every visible action row in the settings panel: is each line of buttons filled from edge to edge? */
function measure() {
  const rows = [];
  for (const g of document.querySelectorAll('#panel-settings .settings-actions')) {
    const bs = [...g.children].filter((b) => b.offsetParent !== null && getComputedStyle(b).display !== 'none');
    if (!bs.length || g.offsetParent === null) continue;
    const box = g.getBoundingClientRect();
    const lines = new Map();
    for (const b of bs) {
      const r = b.getBoundingClientRect();
      const k = Math.round(r.top);
      if (!lines.has(k)) lines.set(k, []);
      lines.get(k).push(r);
    }
    const gaps = [];
    for (const [top, rs] of lines) {
      const left = Math.min(...rs.map((r) => r.left));
      const right = Math.max(...rs.map((r) => r.right));
      const empty = Math.round((left - box.left) + (box.right - right));
      if (empty > 2) gaps.push({ top, buttons: rs.length, empty });
    }
    const heights = [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))];
    rows.push({ slot: g.dataset.slot ?? g.closest('section')?.getAttribute('aria-labelledby') ?? '?', names: bs.map((b) => b.dataset.cloud ?? b.textContent.trim().slice(0, 20)), lines: lines.size, gaps, heights });
  }
  return { rows, overflow: document.documentElement.scrollWidth - innerWidth };
}

(async () => {
  const { server, base } = await startServer(PORT);
  const browser = await chromium.launch();
  const sb = await createFakeSupabase();
  sb.fake.addUser({ email: 'admin-owner@example.com', password: PASS, display_name: 'Sample Admin', status: 'approved', role: 'admin' });
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  };
  try {
    const ctx = await newContext(browser, sb, { seed: await richState() });
    const page = await openSettings(ctx, base, watch);
    await signInAndMove(page, 'admin-owner@example.com');
    const shown = await visibleActions(page);

    const per = {};
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(100);
      per[w] = await page.evaluate(measure);
    }
    const gapRows = Object.entries(per).flatMap(([w, m]) => m.rows.filter((r) => r.gaps.length).map((r) => ({ w, ...r })));
    const tallRows = Object.entries(per).flatMap(([w, m]) => m.rows.filter((r) => r.heights.length > 1).map((r) => ({ w, slot: r.slot, heights: r.heights })));
    const overflow = Object.entries(per).filter(([, m]) => m.overflow > 0).map(([w, m]) => ({ w, overflow: m.overflow }));
    pass('L1 every action row in settings is filled edge to edge at 320-1440 px (no empty cell beside a button)', gapRows.length === 0, { gapRows, shown });
    pass('L2 the buttons of one row have one height', tallRows.length === 0, { tallRows });

    const groups = await page.evaluate(() => [...document.querySelectorAll('[data-slot="cloud-card"] .settings-actions')]
      .map((g) => [...g.querySelectorAll('[data-cloud]')].filter((b) => !b.hidden).map((b) => b.dataset.cloud)).filter((x) => x.length));
    const tripRow = groups.find((g) => g.includes('members')) ?? [];
    const accountRow = groups.find((g) => g.includes('signout')) ?? [];
    pass('L3 the card groups trip actions (share, members) apart from account actions (admin, password, sign-out)',
      tripRow.includes('share') && !tripRow.includes('admin') && accountRow.includes('admin') && accountRow.includes('password'), { groups });
    pass('L4 no sideways scroll of the page at any width', overflow.length === 0, { overflow });

    // screenshots of the card
    const card = page.locator('[data-slot="cloud-card"]');
    await page.setViewportSize({ width: 390, height: 844 });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: path.join(SHOT_DIR, 'account-card-390-light.jpg'), type: 'jpeg', quality: 80 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: path.join(SHOT_DIR, 'account-card-1440-light.jpg'), type: 'jpeg', quality: 80 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(150);
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: path.join(SHOT_DIR, 'account-card-390-dark.jpg'), type: 'jpeg', quality: 80 });
    await page.emulateMedia({ colorScheme: 'light' });

    // L5 members and admin still open and close from their buttons
    await page.click('[data-cloud="members"]');
    await page.waitForSelector('#dlg-cloud-members[open] .cloud-row');
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(SHOT_DIR, 'members-dialog-390-light.jpg'), type: 'jpeg', quality: 80 });
    await page.click('#dlg-cloud-members [data-close]');
    await page.waitForFunction(() => !document.querySelector('#dlg-cloud-members').open);
    await page.click('[data-cloud="admin"]');
    await page.waitForSelector('#dlg-cloud-admin[open] [data-slot="cloud-admin-trips"] .cloud-row', { timeout: 10000 });
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(SHOT_DIR, 'admin-dialog-390-light.jpg'), type: 'jpeg', quality: 80 });
    await page.click('#dlg-cloud-admin [data-close]');
    const adminClosed = await page.waitForFunction(() => !document.querySelector('#dlg-cloud-admin').open).then(() => true, () => false);
    pass('L5 "Trip members" and "Admin" still open their dialogs and close again', adminClosed);
    fs.writeFileSync(path.join(OUT, 'measure.json'), JSON.stringify(per, null, 2));
    await ctx.close();
  } catch (error) {
    pass('run', false, { error: String(error.stack ?? error) });
  } finally {
    pass('no JS errors', errors.length === 0, { errors });
    await browser.close();
    server.kill();
  }
  fs.writeFileSync(path.join(OUT, 'account-layout.json'), JSON.stringify(results, null, 2));
  const failed = Object.entries(results).filter(([, v]) => v.result !== 'PASS');
  for (const [k, v] of Object.entries(results)) console.log(`${v.result}  ${k}${v.result === 'PASS' ? '' : `  ${JSON.stringify(v).slice(0, 900)}`}`);
  console.log(failed.length ? `FAIL ${failed.length}` : 'ALL PASS');
  process.exit(failed.length ? 1 : 0);
})();
