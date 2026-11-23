// Review fixes on 1.1.0 (2026-11-23): five issues found in a full review, each with its regression check here.
// Browser side: scripts/qa/review-fixes-browser.cjs (RF-1 sheets, RF-3 imported place ids). Sample data only (rule 16).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseMoney } from '../src/js/core/money.js';
import { parseKg } from '../src/js/core/luggage.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// ---------- RF-1: a sheet closes only on a tap outside its box ----------
test('RF-1: wireDialog closes a sheet only when the tap lands outside the sheet box (not on its grab-handle strip)', () => {
  const src = read('src/js/app.js');
  const body = /function wireDialog\(dlg, onClose\) \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  assert.match(body, /getBoundingClientRect\(\)/, 'the backdrop check must compare the tap with the sheet box');
  assert.doesNotMatch(body, /if \(e\.target === dlg\) dlg\.close\(\)/, 'target === dlg alone also matches the sheet\'s own top strip');
});

// ---------- RF-2: a decimal comma is never read as a thousands comma ----------
test('RF-2: parseMoney reads a decimal comma (12,50) as agorot, not as 1,250 shekels', () => {
  assert.equal(parseMoney('12,50'), 1250);
  assert.equal(parseMoney('1,5'), 150);
  assert.equal(parseMoney('0,99'), 99);
  assert.equal(parseMoney(' 7,05 '), 705);
});

test('RF-2: parseMoney keeps thousands commas (groups of three) exactly as before', () => {
  assert.equal(parseMoney('1,234'), 123400);
  assert.equal(parseMoney('12,345'), 1234500);
  assert.equal(parseMoney('1,234.56'), 123456);
  assert.equal(parseMoney('12,500.50'), 1250050);
  assert.equal(parseMoney('1,234,567'), 123456700);
  assert.equal(parseMoney('1234.5'), 123450);
  assert.equal(parseMoney('7'), 700);
});

test('RF-2: parseMoney refuses comma patterns that are neither (no silent guess)', () => {
  for (const bad of ['1,2,3', '12,5,0', '1,23,456', '1,234,5', '1,2.50', '12,50.5', ',5', '5,', '1,,234', '1,2345', '0,00']) {
    assert.ok(Number.isNaN(parseMoney(bad)), bad);
  }
});

test('RF-2: money and luggage weights agree on the decimal comma', () => {
  assert.equal(parseKg('1,5'), 1500);
  assert.equal(parseMoney('1,5'), 150);
});

// ---------- RF-3: ids from files and the cloud never break a selector ----------
test('RF-3: every selector built from a record id escapes it with CSS.escape', () => {
  const files = readdirSync(path.join(ROOT, 'src/js')).filter((f) => f.endsWith('.js'));
  const bad = [];
  for (const f of files) {
    read(`src/js/${f}`).split('\n').forEach((line, i) => {
      // [data-id="${x}"], [data-place-id="${x}"], [data-photo-id="${x}"], [data-person="${x}"] and the person
      // checkboxes ([name="sharedBy"][value="${x}"]) must be [data-id="${CSS.escape(x)}"]: ids come from files and the cloud.
      if (/data-[\w-]*(?:id|person)="\$\{(?!CSS\.escape\()/.test(line)
        || /\[name="sharedBy"\]\[value="\$\{(?!CSS\.escape\()/.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

// ---------- RF-4 / RF-5: the local server (npm start, npm run phone) ----------
// Runs a copy of scripts/serve.js in a temp folder next to a sibling folder whose name starts the same way.
async function withServer(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-serve-'));
  const app = path.join(dir, 'app');
  mkdirSync(path.join(app, 'scripts'), { recursive: true });
  mkdirSync(path.join(dir, 'app-private'));
  copyFileSync(path.join(ROOT, 'scripts/serve.js'), path.join(app, 'scripts/serve.js'));
  writeFileSync(path.join(app, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(app, 'index.html'), '<!doctype html><title>sample</title>');
  writeFileSync(path.join(dir, 'app-private', 'notes.txt'), 'SAMPLE-PRIVATE-TEXT');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['scripts/serve.js'], { cwd: app, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  child.on('exit', () => { exited = true; });
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('server did not start')), 5000);
    child.stdout.on('data', (d) => { if (/running at/.test(String(d))) { clearTimeout(timer); res(); } });
  });
  const base = `http://127.0.0.1:${port}`;
  try { await fn({ base, isRunning: () => !exited }); } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
}

const get = async (url) => { try { const r = await fetch(url); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; } };

test('RF-4: a malformed address gets 400 and the local server keeps running', async () => {
  await withServer(async ({ base, isRunning }) => {
    const bad = await get(`${base}/%E0%A4%A`);
    assert.equal(bad.status, 400);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(isRunning(), 'the server process must still be alive');
    assert.equal((await get(`${base}/`)).status, 200);
  });
});

test('RF-5: the local server never serves a file from a sibling folder that shares its name prefix', async () => {
  await withServer(async ({ base }) => {
    for (const p of ['/..%2Fapp-private%2Fnotes.txt', '/..%2F..%2Fapp-private%2Fnotes.txt', '/%2e%2e%2Fapp-private%2Fnotes.txt']) {
      const r = await get(`${base}${p}`);
      assert.ok(r.status === 403 || r.status === 404, `${p} -> ${r.status}`);
      assert.doesNotMatch(r.text, /SAMPLE-PRIVATE-TEXT/, p);
    }
    assert.equal((await get(`${base}/index.html`)).status, 200);
  });
});
