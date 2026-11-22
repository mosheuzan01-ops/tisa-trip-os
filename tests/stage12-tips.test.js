// Stage 12 PR 1 (0.11.0): one info button ("ⓘ") with a short explanation, in 15 places approved by the owner
// (2026-11-22). Texts live in locales; one component; works offline. Browser side: scripts/qa/tips-browser.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TIP_KEYS } from '../src/js/core/tips.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const he = JSON.parse(read('locales/he.json'));
const en = JSON.parse(read('locales/en.json'));
const html = read('index.html');
const views = readdirSync(new URL('../src/js/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => [f, read(`src/js/${f}`)]);

const APPROVED = ['freeBefore', 'freeAfter', 'planned', 'committed', 'today', 'base', 'emergency', 'rates',
  'backup', 'photoBackup', 'unverified', 'userProvided', 'verify', 'flex', 'placeDates'];

test('T-1 exactly the 15 approved places, in the approved order', () => {
  assert.deepEqual(TIP_KEYS, APPROVED);
});

test('T-2 (S12-2) every tip has a name and a text in he and en; the text is at most 2 short sentences', () => {
  const missing = [];
  for (const k of TIP_KEYS) {
    for (const [lang, dict] of [['he', he], ['en', en]]) {
      for (const part of ['name', 'text']) if (!String(dict[`tip.${k}.${part}`] ?? '').trim()) missing.push(`${lang}:tip.${k}.${part}`);
      const text = String(dict[`tip.${k}.text`] ?? '');
      const sentences = text.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length;
      if (sentences > 2) missing.push(`${lang}:tip.${k}.text has ${sentences} sentences`);
      if (text.length > 160) missing.push(`${lang}:tip.${k}.text is ${text.length} chars`);
    }
  }
  for (const k of ['tip.label', 'tip.close']) for (const [lang, dict] of [['he', he], ['en', en]]) if (!dict[k]) missing.push(`${lang}:${k}`);
  assert.deepEqual(missing, []);
  assert.match(he['tip.label'], /^הסבר על \{name\}$/);
});

test('T-3 (S12-2) every tip used in the page or the screens is a known key, and every key is used', () => {
  const used = new Set([...html.matchAll(/data-tip="([^"]+)"/g)].map((m) => m[1]));
  for (const [, src] of views) for (const m of src.matchAll(/tipButton\([^,]+,\s*'([^']+)'/g)) used.add(m[1]);
  for (const [, src] of views) for (const m of src.matchAll(/TIP_OF_STATUS = \{([^}]+)\}/g)) for (const k of m[1].matchAll(/'([A-Za-z]+)'/g)) used.add(k[1]);
  const unknown = [...used].filter((k) => !TIP_KEYS.includes(k));
  const unused = TIP_KEYS.filter((k) => !used.has(k));
  assert.deepEqual({ unknown, unused }, { unknown: [], unused: [] });
});

test('T-4 one shared explanation dialog, with a close button and its title and text wired for screen readers', () => {
  const dialogs = html.match(/<dialog[^>]*id="dlg-tip"[^>]*>/g) ?? [];
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0], /aria-labelledby="dlg-tip-title"/);
  assert.match(dialogs[0], /aria-describedby="dlg-tip-text"/);
  const body = html.slice(html.indexOf('id="dlg-tip"'), html.indexOf('</dialog>', html.indexOf('id="dlg-tip"')));
  assert.match(body, /id="dlg-tip-title"/);
  assert.match(body, /id="dlg-tip-text"/);
  assert.match(body, /data-close[^>]*data-i18n="tip.close"/);
});

test('T-5 no static info button sits inside an element whose text the translator replaces (it would be wiped)', () => {
  // A [data-i18n] element gets textContent = ... at boot; a button inside it would disappear.
  const VOID = new Set(['meta', 'link', 'img', 'input', 'br', 'hr', 'source', 'use', 'path', 'circle', 'rect']);
  const stack = [];
  const bad = [];
  let tips = 0;
  for (const m of html.replace(/<!--[^]*?-->/g, '').matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (close) { while (stack.length && stack.pop().tag !== tag); continue; }
    if (/data-tip="/.test(attrs)) {
      tips += 1;
      if (stack.some((x) => /data-i18n="/.test(x.attrs))) bad.push(attrs.trim());
    }
    if (!self && !VOID.has(tag.toLowerCase())) stack.push({ tag, attrs });
  }
  assert.ok(tips >= 7, `static info buttons found: ${tips}`);
  assert.deepEqual(bad, []);
});

test('T-6 the info icon is a local symbol; the component makes no network call (S12-7)', () => {
  assert.match(read('assets/icons.svg'), /<symbol id="i-info"/);
  const comp = read('src/js/tip.js') + read('src/js/core/tips.js');
  assert.doesNotMatch(comp, /fetch\(|XMLHttpRequest|https?:\/\//);
});

test('T-7 the info button styles use design tokens only (no raw colours)', () => {
  const css = read('src/css/main.css');
  const block = css.slice(css.indexOf('/* Stage 12: info button */'), css.indexOf('/* end Stage 12: info button */'));
  assert.ok(block.length > 40, 'the Stage 12 info button block exists');
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
});
