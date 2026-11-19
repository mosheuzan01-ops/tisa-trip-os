// 0.5.5 browser check: the settings dates text names no stage, the cache is tisa-<version>, and export works
// from settings while the backup reminder is due. 375 and 1280. Waits for UI state (rule 6). Run 3 times.
// Writes only to QA_OUT, default docs/evidence/stage6/0.5.5 (rule 10). BASE_DIR serves another checkout (for "before" shots).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SERVE_DIR = process.env.BASE_DIR ? path.resolve(process.env.BASE_DIR) : ROOT;
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/0.5.5');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.env.SHOTS !== '0';
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
const PORT = 8091;
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = { mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } };
const results = {};
const pass = (id, ok, detail) => { results[id] = { result: ok ? 'PASS' : 'FAIL', ...detail }; };
const errors = [];
const ready = async (page) => { await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0); await page.evaluate(() => document.fonts.ready); };

(async () => {
  const server = spawn(process.execPath, [path.join(SERVE_DIR, 'scripts/serve.js')], { cwd: SERVE_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const version = JSON.parse(fs.readFileSync(path.join(SERVE_DIR, 'config/app.config.json'), 'utf8')).appVersion;

  for (const [view, viewport] of Object.entries(VIEWS)) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    // A backup 17 days old: the reminder shows on home, as on a real phone mid-trip.
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('tisa:v1', JSON.stringify({ schemaVersion: 3, appVersion: '0.5.4', createdAt: '2026-11-19T10:00:00.000Z', updatedAt: '2026-11-19T10:00:00.000Z',
        settings: { language: 'he', theme: null, lastBackupAt: '2026-11-19T10:00:00.000Z', assistantQuestionLimit: 50 }, activeTripId: 't',
        trips: { t: { id: 't', countryCode: 'TH', name: 'תאילנד', startDate: '2026-12-05', endDate: '2027-01-03', destinations: [], budget: { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false }, rates: {}, expenses: [], transfers: [], checklist: [], tasks: [], events: [], info: {}, assistant: {} } } }));
    });
    await page.clock.setFixedTime(new Date('2026-12-06T10:00:00+07:00'));
    await page.goto(`${BASE}#/home`);
    await ready(page);
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('tisa-')), null, { timeout: 15000 }).catch(() => {});
    const cacheKeys = await page.evaluate(async () => caches.keys());
    await page.click('.settings-btn');
    await page.locator('#panel-settings').waitFor();
    const hint = await page.locator('[data-i18n="settings.dates.hint"]').innerText();
    if (SHOTS) await page.locator('[data-i18n="settings.dates.hint"]').scrollIntoViewIfNeeded();
    if (SHOTS) await page.screenshot({ path: `${OUT}/${PREFIX}-settings-${view}.png` });
    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    await page.click('#panel-settings [data-action="export"]');
    await page.waitForFunction(() => document.querySelector('[data-slot="toast"]').classList.contains('show'), null, { timeout: 5000 }).catch(() => {});
    pass(`texts ${view}`, !/שלב/.test(hint), { hint });
    pass(`cache ${view}`, cacheKeys.includes(`tisa-${version}`), { cacheKeys, version });
    pass(`export from settings ${view}`, downloads === 1, { downloads });
    await ctx.close();
  }
  pass('no JS errors', errors.length === 0, { errors });
  await browser.close();
  server.kill();
  fs.writeFileSync(path.join(OUT, `browser-check-${PREFIX}${process.env.RUN ? `-run${process.env.RUN}` : ''}.json`), `${JSON.stringify(results, null, 2)}\n`);
  for (const [id, r] of Object.entries(results)) console.log(`${r.result}  ${id}`);
  process.exit(Object.values(results).every((r) => r.result === 'PASS') ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
