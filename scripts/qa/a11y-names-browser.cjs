// QA gate guard for the KNOWN item "fields wrapped in <label>" (rule 7, approved by the product owner 2026-11-21).
// The static scan counts every input without label[for] as "without label". This check proves, in a real browser,
// that every field has an accessible name, so the KNOWN never hides a real failure:
//  1. Every input/select/textarea in index.html gets the name Chrome computes (CDP Accessibility tree), with its
//     screen open: each route, and each <dialog> opened in turn.
//  2. A field never rendered that way is checked through the DOM (labels, aria-label, aria-labelledby).
//  3. The only fields allowed without a name are the four hidden file inputs opened from a button (rule 7, KNOWN),
//     by id, and only while they stay aria-hidden, tabindex=-1 and type=file. Any other field without a name is FAIL.
// QA_OUT (default docs/evidence/stage9/pr3/qa-gate/a11y-names), PORT (default 8133). Run 3 times (rule 6).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.resolve(process.env.APP_ROOT ?? ROOT); // APP_ROOT: serve another checkout (used to prove the check catches a missing label)
const OUT = path.resolve(ROOT, process.env.QA_OUT ?? 'docs/evidence/stage9/pr3/qa-gate/a11y-names');
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8133);
const BASE = `http://127.0.0.1:${PORT}/`;
const v5 = fs.readFileSync(path.join(ROOT, 'tests/fixtures/v5-stage7.json'), 'utf8');
const KNOWN_FILE_INPUTS = ['photo-file', 'import-file', 'photos-import-file', 'flights-import-file'];
const FIELDS = 'input:not([type=hidden]), select, textarea';

(async () => {
  const server = spawn(process.execPath, [path.join(APP, 'scripts/serve.js')], { cwd: APP, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 700));
  const browser = await chromium.launch();
  const result = { fields: {}, errors: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', reducedMotion: 'reduce', serviceWorkers: 'block' });
    await ctx.addInitScript((x) => { if (!sessionStorage.getItem('s')) { localStorage.setItem('tisa:v1', x); sessionStorage.setItem('s', '1'); } }, v5);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => result.errors.push(e.message));
    const cdp = await ctx.newCDPSession(page);
    await page.goto(BASE);
    await page.waitForFunction(() => document.querySelector('[data-slot="version-app"]')?.textContent.length > 0);

    // Give every field a stable key, so the same field is counted once across screens.
    const total = await page.evaluate((sel) => { let n = 0; for (const f of document.querySelectorAll(sel)) f.dataset.qaKey = f.id || `${f.closest('[id]')?.id ?? 'doc'}:${f.name || f.type}:${n++}`; return document.querySelectorAll(sel).length; }, FIELDS);

    // Chrome's computed accessible name for every field that is rendered right now.
    const harvest = async (where) => {
      const keys = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((f) => f.getClientRects().length).map((f) => f.dataset.qaKey), FIELDS);
      for (const key of keys) {
        if (result.fields[key]?.how === 'chrome' && !result.fields[key].ignored) continue;
        const { result: object } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-qa-key="${key.replace(/"/g, '\\"')}"]')` });
        const { node } = await cdp.send('DOM.describeNode', { objectId: object.objectId });
        const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
        const ax = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId) ?? nodes[0];
        result.fields[key] = { how: 'chrome', where, name: (ax?.name?.value ?? '').trim(), ignored: !!ax?.ignored };
      }
    };

    const routes = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-route]')].map((e) => e.dataset.route))]);
    for (const route of routes) {
      await page.evaluate((r) => { location.hash = `#/${r}`; }, route);
      await page.waitForFunction((r) => location.hash === `#/${r}`, route);
      await page.waitForFunction(() => document.querySelectorAll('.panel:not([hidden])').length >= 1);
      // Closed <details> keep their fields out of the accessibility tree: open them, measure, close them again.
      await page.evaluate(() => { for (const d of document.querySelectorAll('.panel:not([hidden]) details:not([open])')) { d.dataset.qaWasClosed = '1'; d.open = true; } });
      await harvest(`route ${route}`);
      await page.evaluate(() => { for (const d of document.querySelectorAll('[data-qa-was-closed]')) { d.open = false; delete d.dataset.qaWasClosed; } });
    }
    const dialogs = await page.evaluate(() => [...document.querySelectorAll('dialog[id]')].map((d) => d.id));
    for (const id of dialogs) {
      await page.evaluate((i) => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); document.getElementById(i).showModal(); }, id);
      await page.locator(`#${id}[open]`).waitFor({ state: 'attached' });
      // Reveal collapsed sub-sections inside the dialog so their fields render too.
      await page.evaluate((i) => {
        for (const el of document.getElementById(i).querySelectorAll('[hidden]')) { el.dataset.qaWasHidden = '1'; el.hidden = false; }
        for (const d of document.getElementById(i).querySelectorAll('details:not([open])')) { d.dataset.qaWasClosed = '1'; d.open = true; }
      }, id);
      await harvest(`dialog ${id}`);
      await page.evaluate((i) => { const d = document.getElementById(i); for (const el of d.querySelectorAll('[data-qa-was-hidden]')) el.hidden = true; for (const x of d.querySelectorAll('[data-qa-was-closed]')) x.open = false; d.close(); }, id);
    }
    // Anything never rendered: the DOM name sources (what the accessible-name algorithm uses for form fields).
    const dom = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((f) => {
      const by = (f.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((i) => document.getElementById(i)?.textContent ?? '').join(' ');
      const lab = [...(f.labels ?? [])].map((l) => l.textContent).join(' ');
      return { key: f.dataset.qaKey, id: f.id, type: f.type, name: (by || f.getAttribute('aria-label') || lab || f.title || '').replace(/\s+/g, ' ').trim(), ariaHidden: f.getAttribute('aria-hidden') === 'true', tabindex: f.getAttribute('tabindex') };
    }), FIELDS);
    for (const d of dom) {
      const r = result.fields[d.key] ?? (result.fields[d.key] = { how: 'dom', where: 'not rendered', name: d.name });
      Object.assign(r, { id: d.id, type: d.type, ariaHidden: d.ariaHidden, tabindex: d.tabindex });
    }
    result.total = total;
    await ctx.close();
  } catch (e) {
    result.errors.push(String(e.stack ?? e));
  } finally {
    await browser.close();
    server.kill();
  }

  const all = Object.entries(result.fields);
  const known = all.filter(([, f]) => KNOWN_FILE_INPUTS.includes(f.id) && f.type === 'file' && f.ariaHidden && f.tabindex === '-1' && !f.name);
  const unnamed = all.filter(([k, f]) => (!f.name || f.ignored) && !known.some(([kk]) => kk === k));
  const knownOk = known.length === KNOWN_FILE_INPUTS.length;
  const summary = {
    total: result.total, checked: all.length, byChrome: all.filter(([, f]) => f.how === 'chrome').length, byDom: all.filter(([, f]) => f.how === 'dom').length,
    named: all.filter(([, f]) => f.name).length, known: known.map(([k]) => k), unnamed: unnamed.map(([k, f]) => ({ key: k, ...f })), errors: result.errors,
    result: result.total === all.length && unnamed.length === 0 && knownOk && result.errors.length === 0 ? 'PASS' : 'FAIL',
  };
  fs.writeFileSync(path.join(OUT, 'a11y-names.json'), JSON.stringify({ summary, fields: result.fields }, null, 1));
  console.log(JSON.stringify({ ...summary, unnamed: summary.unnamed.map((u) => u.key) }));
  console.log(summary.result === 'PASS' ? 'ALL PASS' : 'FAIL');
  process.exitCode = summary.result === 'PASS' ? 0 : 1;
})();
