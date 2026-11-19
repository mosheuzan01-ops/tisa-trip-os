// Pre-publish QA guards (site-qa-before-publish, 2026-11-19): SEO meta, share cards, favicon, readable sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText } from './helpers.js';

const pages = ['index.html', 'brand.html'];
const meta = (html, attr, key) => {
  const m = html.match(new RegExp(`<meta[^>]*${attr}="${key}"[^>]*content="([^"]*)"`));
  return m ? m[1] : null;
};

for (const page of pages) {
  const html = readText(page);

  test(`Q1 ${page}: title is 10-60 characters`, () => {
    const t = html.match(/<title>([^<]*)<\/title>/)[1].trim();
    assert.ok(t.length >= 10 && t.length <= 60, `title "${t}" is ${t.length} chars`);
  });

  test(`Q2 ${page}: meta description is 50-160 characters`, () => {
    const d = meta(html, 'name', 'description');
    assert.ok(d, 'meta description missing');
    assert.ok(d.length >= 50 && d.length <= 160, `description is ${d.length} chars`);
  });

  test(`Q3 ${page}: Open Graph share card (title, description, image)`, () => {
    for (const k of ['og:title', 'og:description', 'og:image']) assert.ok(meta(html, 'property', k), `${k} missing`);
  });

  test(`Q4 ${page}: has a favicon`, () => {
    assert.match(html, /<link[^>]*rel="icon"/);
  });
}

test('Q5: smallest text token is at least 14px', () => {
  const tokens = readText('src/css/tokens.css');
  const rem = Number(tokens.match(/--text-caption:\s*([\d.]+)rem/)[1]);
  assert.ok(rem * 16 >= 14, `--text-caption is ${rem * 16}px`);
});

test('Q6: theme choice radio covers the full 44px pill, border included', () => {
  const css = readText('src/css/main.css');
  assert.match(css, /\.choice input \{[^}]*inset: -1px/);
});
