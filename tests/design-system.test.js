// Stage 1 design-system guards (GOALS.md S1, S2, S6, S9, S10, S11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readText, readJson, listFiles, stripApproved } from './helpers.js';
import { contrastRatio, parseThemes } from '../src/js/core/contrast.js';

const TOKENS = 'src/css/tokens.css';
const pages = ['index.html', 'brand.html'];
const viewFiles = [...pages, ...listFiles('src', ['.js', '.css']), 'assets/icons.svg'];

test('contrastRatio follows the WCAG 2 formula', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#000000'), 21);
  assert.equal(contrastRatio('#7A1F3D', '#7A1F3D'), 1);
  assert.equal(Math.round(contrastRatio('#777777', '#FFFFFF') * 100) / 100, 4.48);
  assert.equal(Math.round(contrastRatio('#FFF', '#000') * 10) / 10, 21);
  assert.throws(() => contrastRatio('red', '#000'), /hex/);
});

test('parseThemes reads custom properties per theme block', () => {
  const css = `[data-theme="light"] { --a: #FFFFFF; --b: 4px; }\n[data-theme="dark"] { --a: #000000; }`;
  assert.deepEqual(parseThemes(css), { light: { '--a': '#FFFFFF', '--b': '4px' }, dark: { '--a': '#000000' } });
});

test('S1: tokens.css is the only place that defines colors', () => {
  const colorLiteral = /#[0-9a-f]{3,8}\b(?![-\w])|\brgba?\(|\bhsla?\(|:\s*(white|black)\b/i;
  for (const file of viewFiles) {
    if (file === TOKENS) continue;
    // Ignore in-page anchors such as href="#home" and url(#id) references.
    const text = readText(file).replace(/(href|xlink:href)="[^"]*"/g, '').replace(/url\(#[\w-]+\)/g, '');
    assert.doesNotMatch(text, colorLiteral, `${file} contains a color literal; use a token`);
  }
});

test('S2: fonts and icons are local; no external URLs anywhere in the view', () => {
  for (const file of [...viewFiles, TOKENS]) {
    assert.doesNotMatch(stripApproved(readText(file)).replace(/xmlns(:\w+)?="[^"]*"/g, ''), /https?:\/\/|\/\/[a-z0-9-]+\.[a-z]{2,}\//i, file);
  }
  const fontCss = readText('src/css/fonts.css');
  const urls = [...fontCss.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2, 'expected local @font-face sources');
  for (const url of urls) assert.ok(existsSync(join(ROOT, 'src/css', url)), `missing font ${url}`);
});

test('S6: every text/background token pair passes WCAG AA in light and dark', () => {
  const themes = parseThemes(readText(TOKENS));
  assert.ok(themes.light && themes.dark, 'tokens.css must define light and dark themes');
  // [text token, background token, minimum ratio]. 4.5 = normal text, 3 = large text or UI parts.
  const pairs = [
    ['--ink', '--bg', 4.5], ['--ink', '--surface', 4.5], ['--muted', '--bg', 4.5], ['--muted', '--surface', 4.5],
    ['--title', '--bg', 4.5], ['--on-accent', '--accent', 4.5], ['--focus', '--bg', 3],
    ['--on-deep', '--deep', 4.5], ['--on-deep-muted', '--deep', 4.5], ['--deep-btn-ink', '--deep-btn', 4.5],
    ...[1, 2, 3, 4, 5, 6, 7].map((i) => ['--metal-ink', `--metal-${i}`, 4.5]),
    ['--on-deep', '--metal-pill', 4.5], ['--toast-ink', '--toast-bg', 4.5],
    // Design v2 calm surfaces: tab chip, selected choice, danger text, accent icons, inputs.
    ['--ink', '--surface-2', 4.5], ['--muted', '--surface-2', 4.5], ['--title', '--surface-2', 4.5], ['--title', '--surface', 4.5],
    ['--bg', '--ink', 4.5], ['--danger', '--surface', 4.5], ['--accent', '--surface', 3], ['--line-strong', '--surface', 1.2],
    // Page text over the dusk glow (its peak colors), so the atmosphere never costs contrast.
    ...['--glow-1', '--glow-2'].flatMap((g) => [['--ink', g, 4.5], ['--muted', g, 4.5], ['--title', g, 4.5]]),
  ];
  // Darker metal surfaces: light text must pass on every gradient stop.
  for (const fam of ['setup']) {
    for (let i = 1; i <= 5; i++) pairs.push(['--on-dmetal', `--m-${fam}-${i}`, 4.5], ['--on-dmetal-muted', `--m-${fam}-${i}`, 4.5]);
  }
  for (let i = 1; i <= 5; i++) {
    pairs.push(['--on-dmetal-error', `--m-setup-${i}`, 4.5]);
  }
  const failures = [];
  for (const [name, theme] of Object.entries(themes)) {
    for (const [fg, bg, min] of pairs) {
      assert.ok(theme[fg] && theme[bg], `${name} theme is missing ${fg} or ${bg}`);
      const ratio = contrastRatio(theme[fg], theme[bg]);
      if (ratio < min) failures.push(`${name}: ${fg} on ${bg} = ${ratio.toFixed(2)} (< ${min})`);
    }
  }
  assert.deepEqual(failures, []);
});

test('S9: app text comes from the locale files; no placeholder copy', () => {
  const html = readText('index.html');
  const keys = [...html.matchAll(/data-i18n(?:-label)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 20, 'expected the home screen to use locale keys');
  for (const locale of ['he', 'en']) {
    const dict = readJson(`locales/${locale}.json`);
    for (const key of keys) assert.ok(key in dict, `${locale}.json is missing ${key}`);
  }
  for (const file of [...pages, 'locales/he.json', 'locales/en.json']) {
    assert.doesNotMatch(readText(file), /lorem|ipsum/i, file);
  }
});

test('S10: no invented dates or prices in the view or the copy', () => {
  const invented = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|[₪$€฿]\s?\d|\d\s?(₪|THB|USD|ILS)/;
  for (const file of [...pages, 'locales/he.json', 'locales/en.json']) {
    assert.doesNotMatch(readText(file), invented, file);
  }
});

test('S11: every bundled font has its license and a CREDITS.md entry', () => {
  const credits = readText('CREDITS.md');
  for (const font of listFiles('assets/fonts', ['.ttf', '.woff2'])) {
    const name = font.split('/').pop();
    assert.match(credits, new RegExp(name.replace('.', '\\.')), `CREDITS.md does not list ${name}`);
  }
  for (const license of ['assets/fonts/OFL-Heebo.txt', 'assets/fonts/OFL-IBMPlexMono.txt']) {
    assert.ok(existsSync(join(ROOT, license)), `missing ${license}`);
    assert.match(readText(license), /SIL Open Font License/);
  }
});

test('theme-boot uses the same storage key as the app config', () => {
  const prefix = readJson('config/app.config.json').storageKeyPrefix;
  assert.match(readText('src/js/theme-boot.js'), new RegExp(`'${prefix}theme'`));
});

test('P10: UI copy has no template chrome (middle-dot meta strings, spaced em dashes, arrows on buttons)', () => {
  for (const locale of ['he', 'en']) {
    for (const [key, value] of Object.entries(readJson(`locales/${locale}.json`))) {
      if (typeof value !== 'string') continue;
      assert.doesNotMatch(value, /\s·\s| — |→|←/, `${locale}.json ${key}: "${value}"`);
    }
  }
  assert.doesNotMatch(readText('index.html'), /\s·\s/, 'index.html has a middle-dot meta string');
});
