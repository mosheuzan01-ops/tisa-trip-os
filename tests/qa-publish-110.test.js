// QA before publish on 1.1.0 (site-qa-before-publish, 2026-11-23). Browser side: scripts/qa/qa-publish-110-browser.cjs.
// QP-1: a booking link reaches the screen also from a backup, a places/flights file or a shared trip (the transfer link
//       is shared with every member). It was checked only in the form. Now it is checked again where it is shown:
//       only http(s) becomes a link.
// QP-2: the expenses CSV neutralises a cell that starts with a tab or a carriage return too (OWASP CSV injection).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as transfers from '../src/js/core/transfers.js';
import { toCsv } from '../src/js/core/money.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const safe = (x) => (typeof transfers.safeLink === 'function' ? transfers.safeLink(x) : 'missing');

test('QP-1a safeLink keeps http and https links as they are', () => {
  assert.equal(typeof transfers.safeLink, 'function', 'safeLink is exported from core/transfers.js');
  assert.equal(safe('https://example.com/booking?id=1'), 'https://example.com/booking?id=1');
  assert.equal(safe('http://example.com'), 'http://example.com');
  assert.equal(safe('HTTPS://EXAMPLE.COM/x'), 'HTTPS://EXAMPLE.COM/x');
});

test('QP-1b safeLink refuses every other scheme and every malformed value', () => {
  assert.equal(typeof transfers.safeLink, 'function');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', '\tjavascript:alert(1)', 'java\nscript:alert(1)',
    'data:text/html,<b>x</b>', 'intent://x#Intent;end', 'tel:+6611', 'file:///etc/hosts', '//example.com', 'https://', 'https:// x',
    'https://example.com/a b', '', null, undefined, 42, {}, `https://example.com/${'a'.repeat(300)}`]) {
    assert.equal(safe(bad), null, `refused: ${JSON.stringify(bad)}`);
  }
});

test('QP-1c the transfer and check-in lists show a link only through safeLink', () => {
  for (const f of ['src/js/transfers-view.js', 'src/js/checkins-view.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\.href\s*=\s*(x|c)\.link\b/, `${f}: no raw stored link in href`);
    assert.match(src, /safeLink\(/, `${f}: uses safeLink`);
  }
});

test('QP-1d the form rules did not change: what the form accepts, safeLink shows', () => {
  for (const ok of ['https://example.com/x', 'http://a.b/c?d=e']) {
    assert.deepEqual(transfers.validateTransfer({ kind: 'bus', from: 'א', to: 'ב', date: '2030-01-01', link: ok }).filter((e) => e.startsWith('link')), []);
    assert.equal(safe(ok), ok);
  }
});

test('QP-2 CSV neutralises a cell that starts with a tab or a carriage return', () => {
  const body = (rows) => toCsv(rows).slice(1); // without the BOM
  assert.match(body([['\t=1+1']]), /^'\t=1\+1\r\n$/, 'leading tab');
  assert.match(body([['\r=1+1']]), /^"'\r=1\+1"\r\n$/, 'leading CR (quoted, since it holds a CR)');
  // unchanged behaviour
  assert.match(body([['=SUM(A1)']]), /^'=SUM\(A1\)/);
  assert.equal(body([['-12.50']]), '-12.50\r\n', 'a negative number stays a number');
  assert.equal(body([['פאד תאי']]), 'פאד תאי\r\n');
});

// QP-3 (owner approval, 2026-11-23): the scanner's "no loading=lazy" WARN is KNOWN for exactly two images, photo-big and
// slides-img. They have no src in the HTML; the app gives them a blob: URL from IndexedDB only when their sheet opens,
// so there is nothing to load from the network and nothing to defer. Any other image without lazy is still a WARN.
test('QP-3 only photo-big and slides-img may skip loading=lazy, and only while they have no src in the HTML', () => {
  const html = read('index.html');
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  const noLazy = imgs.slice(2).filter((tag) => attr(tag, 'loading') !== 'lazy'); // the scanner skips the first two images
  assert.deepEqual(noLazy.map((tag) => attr(tag, 'class')).sort(), ['photo-big', 'slides-img'], 'no other image without lazy');
  for (const tag of noLazy) assert.equal(attr(tag, 'src'), undefined, `${attr(tag, 'class')}: no src in the HTML (blob: at run time only)`);
  const rules = read('docs/RULES.md');
  assert.match(rules, /lazy[^\n]*`photo-big`[^\n]*`slides-img`/, 'RULES.md rule 7 names exactly these two images');
  assert.match(rules, /lazy[^\n]*(כל תמונה אחרת|אחרת)[^\n]*WARN/, 'RULES.md says any other image without lazy stays WARN');
});
