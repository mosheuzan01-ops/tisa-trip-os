// Stage 14 (1.1.2): shared steps for the browser checks of the account card. The real app in Chromium, a FAKE
// Supabase behind Playwright routes (lib/fake-supabase.cjs): no network, sample users and data only (rule 16).
// An owner signs in on a phone with the rich sample trip and moves it into the account in the two 1.1.1 steps
// (backup file, then "move now"), so the card shows a linked trip of their own.
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const PASS = 'Sample-Passw0rd!';

async function startServer(port) {
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i += 1) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  return { server, base };
}

async function newContext(browser, sb, { seed = null, viewport = { width: 390, height: 844 }, scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, serviceWorkers: 'block', acceptDownloads: true });
  await sb.install(ctx, { configured: true });
  if (seed) await ctx.addInitScript((x) => { if (!sessionStorage.getItem('qa-seeded') && !localStorage.getItem('tisa:v1')) localStorage.setItem('tisa:v1', x); sessionStorage.setItem('qa-seeded', '1'); }, JSON.stringify(seed));
  return ctx;
}

async function openSettings(ctx, base, watch) {
  const page = await ctx.newPage();
  if (watch) watch(page);
  await page.goto(`${base}#/settings`);
  await page.waitForSelector('#panel-settings:not([hidden])');
  return page;
}

async function signIn(page, email, pass = PASS) {
  await page.click('[data-cloud="signin"]');
  await page.waitForSelector('#dlg-cloud-auth[open]');
  await page.fill('#dlg-cloud-auth [name="email"]', email);
  await page.fill('#dlg-cloud-auth [name="pass"]', pass);
  await page.click('[data-slot="cloud-auth-submit"]');
  await page.waitForFunction(() => !document.querySelector('#dlg-cloud-auth')?.open);
}

const waitPill = (page, text, timeout = 15000) => page.waitForFunction((t) => document.querySelector('[data-slot="cloud-pill-text"]')?.textContent === t && !document.querySelector('[data-slot="cloud-pill"]').hidden, text, { timeout });

/** First sign-in of an owner: the move dialog opens by itself; backup (step 1), then "move now" (step 2). */
async function signInAndMove(page, email) {
  await signIn(page, email);
  await page.waitForSelector('#dlg-cloud-migrate[open]', { timeout: 15000 });
  await Promise.all([page.waitForEvent('download'), page.click('[data-cloud="migrate-yes"]')]);
  await page.waitForSelector('#dlg-cloud-migrate[open] [data-cloud="migrate-upload"]:not([hidden])');
  await page.click('[data-cloud="migrate-upload"]');
  await page.waitForFunction(() => !document.querySelector('#dlg-cloud-migrate')?.open, null, { timeout: 15000 });
  await waitPill(page, 'מסונכרן');
}

const visibleActions = (page) => page.$$eval('[data-slot="cloud-card"] [data-cloud]', (bs) => bs.filter((b) => !b.hidden && !b.closest('[hidden]')).map((b) => b.dataset.cloud));

module.exports = { ROOT, PASS, startServer, newContext, openSettings, signIn, signInAndMove, waitPill, visibleActions };
