// Before/after shots of the calendar (rule 1): today's day card, 375 and 1280, light and dark.
// BASE_DIR serves another checkout (main, for "before"). Writes to QA_OUT. Waits for UI state (rule 6).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const SERVE_DIR = process.env.BASE_DIR ? path.resolve(process.env.BASE_DIR) : ROOT;
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage6/6.0c');
const PREFIX = process.env.SHOT_PREFIX ?? 'after';
fs.mkdirSync(OUT, { recursive: true });
const at = '2026-12-01T10:00:00.000Z';
const STATE = {
  schemaVersion: 4, appVersion: '0.5.5', createdAt: at, updatedAt: at,
  settings: { language: 'he', theme: null, lastBackupAt: '2026-12-05T10:00:00.000Z', assistantQuestionLimit: 50 },
  activeTripId: 't',
  trips: { t: {
    id: 't', countryCode: 'TH', name: 'תאילנד', startDate: '2026-12-05', endDate: '2027-01-03',
    destinations: [{ id: 'd1', name: 'בנגקוק', startDate: '2026-12-05', endDate: '2026-12-08', note: '' }],
    budget: { currency: 'ILS', totalMinor: null, categoriesMinor: {}, profileId: null, estimate: false }, rates: {},
    expenses: [{ id: 'e', amountMinor: 12000, currency: 'ILS', rate: 1, baseMinor: 12000, category: 'food', date: '2026-12-06', destinationId: null, description: '', method: 'card', status: 'planned', note: '' }],
    transfers: [], checklist: [], tasks: [{ id: 'k', title: 'לכבס', status: 'open', due: '2026-12-06', note: '' }],
    events: [], info: {}, assistant: {},
    journal: process.env.WITH_NOTE ? { '2026-12-06': { note: 'שוק צף בבוקר, ואחר כך מסאז\'.\nלחזור לדוכן של המנגו.', updatedAt: at } } : {},
    checkins: [], luggage: { bags: [] },
  } },
};
(async () => {
  const server = spawn(process.execPath, [path.join(SERVE_DIR, 'scripts/serve.js')], { cwd: SERVE_DIR, env: { ...process.env, PORT: '8096' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  for (const [view, viewport] of Object.entries({ mobile: { width: 375, height: 812 }, desktop: { width: 1280, height: 800 } })) {
    for (const scheme of ['light', 'dark']) {
      if (view === 'desktop' && scheme === 'dark') continue;
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'he-IL', colorScheme: scheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
      await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('tisa:v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(STATE));
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date('2026-12-06T10:00:00+07:00'));
      await page.goto('http://127.0.0.1:8096/#/calendar');
      await page.waitForFunction(() => document.querySelector('#panel-calendar [data-date="2026-12-06"]'));
      await page.evaluate(() => document.fonts.ready);
      await page.locator('#panel-calendar [data-date="2026-12-06"]').evaluate((n) => n.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `${OUT}/${PREFIX}-calendar-day-${view}${scheme === 'dark' ? '-dark' : ''}.png` });
      await ctx.close();
    }
  }
  await browser.close();
  server.kill();
})().catch((e) => { console.error(e); process.exit(2); });
