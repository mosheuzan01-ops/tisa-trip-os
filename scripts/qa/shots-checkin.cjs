// Before/after shots for 6.0d (rule 1): transfers, home and assistant, with a flight check-in due today.
// 375 and 1280. BASE_DIR serves another checkout (main, for "before"). Writes to QA_OUT. Waits for UI state (rule 6).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const SERVE_DIR = process.env.BASE_DIR ? path.resolve(process.env.BASE_DIR) : ROOT;
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/6.0d');
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
fs.mkdirSync(OUT, { recursive: true });
const at = '2026-12-01T10:00:00.000Z';
const STATE = {
  schemaVersion: 4, appVersion: '0.5.5', createdAt: at, updatedAt: at,
  settings: { language: 'he', theme: null, lastBackupAt: '2026-12-03T10:00:00.000Z', assistantQuestionLimit: 50 },
  activeTripId: 't',
  trips: { t: {
    id: 't', countryCode: 'TH', name: 'תאילנד', startDate: '2026-12-05', endDate: '2027-01-03',
    destinations: [{ id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' }],
    budget: { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false }, rates: {}, expenses: [],
    transfers: [{ id: 't1', kind: 'flight', from: 'תל אביב', to: 'בנגקוק', date: '2026-12-05', time: '', company: '', booking: 'ABC123', priceMinor: null, currency: 'ILS', link: '', status: 'booked', note: '', expenseId: null }],
    checklist: [], tasks: [], events: [], info: {}, assistant: {}, journal: {},
    checkins: [
      { id: 'ci-f', kind: 'flight', title: "צ'ק-אין לטיסה", transferId: 't1', stopId: null, date: '2026-12-04', time: '', zone: 'Asia/Jerusalem', booking: 'ABC123', link: 'https://airline.example/checkin', note: '', done: false },
      { id: 'ci-h', kind: 'hotel', title: 'מלון בבנגקוק', transferId: null, stopId: 'd1', date: '2026-12-05', time: '14:00', zone: 'Asia/Bangkok', booking: '', link: '', note: '', done: false },
    ],
    luggage: { bags: [] },
  } },
};
(async () => {
  const server = spawn(process.execPath, [path.join(SERVE_DIR, 'scripts/serve.js')], { cwd: SERVE_DIR, env: { ...process.env, PORT: '8099' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  for (const [view, viewport] of Object.entries({ mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } })) {
    for (const route of ['transfers', 'home', 'assistant']) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'Asia/Jerusalem' });
      await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(STATE));
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date('2026-12-04T09:00:00+02:00'));
      await page.goto(`http://127.0.0.1:8099/#/${route}`);
      await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${OUT}/${PREFIX}-${route}-${view}.png`, fullPage: true });
      await ctx.close();
    }
  }
  await browser.close();
  server.kill();
})().catch((e) => { console.error(e); process.exit(2); });
