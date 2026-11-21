// Stage 9 PR 3: the LATISA brand (docs/GOALS_STAGE9.md, PR 3). Visible name, icon in the top bar, full logo in
// Settings > About and in brand.html, dark logo on dark and the light-background logo with a dark slogan,
// site and PWA icons (favicon, 192/512, Apple touch, maskable) with the plane and the pin inside every mask.
// Technical identifiers (storage keys, DB names, backup formats, cache prefix) must not change (rule 19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readText, readJson } from './helpers.js';
import { readPng } from './png.js';
import { contrastRatio, parseThemes } from '../src/js/core/contrast.js';

const png = (f) => readPng(join(ROOT, f));
const geo = () => {
  assert.ok(existsSync(join(ROOT, 'docs/brand-source/geometry.json')), 'the icons are not built from the approved LATISA sources yet');
  return readJson('docs/brand-source/geometry.json');
};
const built = (f) => assert.ok(existsSync(join(ROOT, f)), `${f} is missing`);
const VISIBLE = ['index.html', 'brand.html', 'manifest.webmanifest', 'locales/he.json', 'locales/en.json', 'config/app.config.json', 'package.json'];
const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('L-1: the visible name is LATISA everywhere a person sees it', () => {
  assert.equal(readJson('config/app.config.json').appName, 'LATISA');
  const m = readJson('manifest.webmanifest');
  assert.equal(m.short_name, 'LATISA');
  assert.match(m.name, /^LATISA/);
  assert.match(readText('index.html'), /<title>LATISA[^<]*<\/title>/);
  assert.match(readText('brand.html'), /<title>LATISA[^<]*<\/title>/);
  for (const f of VISIBLE) assert.doesNotMatch(readText(f).replace(/<!--[\s\S]*?-->/g, ''), /\bTISA\b/, `${f} still shows "TISA"`);
});

test('L-2: technical identifiers are unchanged (rule 19)', () => {
  assert.equal(readJson('config/app.config.json').storageKeyPrefix, 'tisa:');
  assert.match(readText('src/js/theme-boot.js'), /'tisa:v1'/);
  assert.match(readText('src/js/photo-store.js'), /const DB = 'tisa-photos';/);
  assert.match(readText('src/js/core/backup.js'), /BACKUP_FORMAT = 'tisa-backup';/);
  assert.match(readText('src/js/core/photo-backup.js'), /PHOTO_FORMAT = 'tisa-photos';/);
  assert.match(readText('sw.js'), /const CACHE = `tisa-\$\{VERSION\}`;/);
  assert.equal(readJson('package.json').name, 'tisa-trip-os');
});

test('L-3: the top bar shows the LATISA icon next to the word LATISA', () => {
  const html = readText('index.html');
  const brand = /<a class="brand"[\s\S]*?<\/a>/.exec(html)[0];
  assert.match(brand, /<img class="brand-mark" src="\.\/assets\/brand\/latisa-mark\.png" alt="" width="\d+" height="\d+">/);
  assert.match(brand, /<span class="brand-word ltr">LATISA<\/span>/);
  assert.match(brand, /aria-label="LATISA, מסך הבית"/);
  assert.ok(existsSync(join(ROOT, 'assets/brand/latisa-mark.png')));
});

test('L-4: Settings has an About card with the full logo on a dark card', () => {
  const html = readText('index.html');
  const about = /<section class="card about-card"[\s\S]*?<\/section>/.exec(html)?.[0];
  assert.ok(about, 'no About card');
  assert.match(about, /data-i18n="settings\.about\.title">אודות</);
  assert.match(about, /<img class="about-logo" src="\.\/assets\/brand\/latisa-logo-dark\.png" alt="[^"]*LATISA[^"]*"/);
  assert.match(readText('src/css/main.css'), /\.about-card\s*\{[^}]*background:\s*var\(--deep\)/);
  assert.ok(readJson('locales/he.json')['settings.about.title']);
  assert.ok(readJson('locales/en.json')['settings.about.title']);
});

test('L-5: brand.html shows the full logo: dark original on dark, the approved light version on light', () => {
  const html = readText('brand.html');
  assert.match(html, /data-theme="light"[^>]*>\s*<img class="bk-full" src="\.\/assets\/brand\/latisa-logo-light\.png"/);
  assert.match(html, /data-theme="dark"[^>]*>\s*<img class="bk-full" src="\.\/assets\/brand\/latisa-logo-dark\.png"/);
});

test('L-6: icon files have the right sizes; home-screen icons are fully opaque (no black corners on iOS)', () => {
  const html = readText('index.html');
  assert.match(html, /<link rel="icon" href="\.\/icons\/favicon-32\.png" sizes="32x32" type="image\/png">/);
  assert.match(html, /<link rel="icon" href="\.\/icons\/icon-192\.png" sizes="192x192" type="image\/png">/);
  const want = { 'icons/favicon-32.png': 32, 'icons/icon-192.png': 192, 'icons/icon-512.png': 512, 'icons/icon-maskable-512.png': 512, 'icons/apple-touch-icon-180.png': 180 };
  for (const [f, s] of Object.entries(want)) { built(f); const p = png(f); assert.deepEqual([p.width, p.height], [s, s], f); }
  for (const f of ['icons/icon-maskable-512.png', 'icons/apple-touch-icon-180.png']) {
    const p = png(f);
    for (let y = 0; y < p.height; y += 3) for (let x = 0; x < p.width; x += 3) assert.equal(p.px(x, y)[3], 255, `${f} has a see-through pixel at ${x},${y}`);
  }
});

test('L-7: the plane and the pin stay inside every mask (maskable 80% circle, iOS rounded square, the icon itself)', () => {
  const g = geo();
  const masks = {
    'icons/icon-maskable-512.png': (x, y, s) => Math.hypot(x - s / 2, y - s / 2) <= 0.4 * s,
    'icons/apple-touch-icon-180.png': (x, y, s) => { const r = 0.2237 * s; const dx = Math.max(r - x, x - (s - r), 0); const dy = Math.max(r - y, y - (s - r), 0); return Math.hypot(dx, dy) <= r; },
    'icons/icon-512.png': (x, y, s) => x >= 0 && y >= 0 && x <= s && y <= s,
    'icons/icon-192.png': (x, y, s) => x >= 0 && y >= 0 && x <= s && y <= s,
  };
  for (const [f, inside] of Object.entries(masks)) {
    const p = png(f);
    for (const part of ['plane', 'pin']) {
      const [x0, y0, x1, y1] = g.icons[f][part];
      // Every bright pixel of the part (the gold plane or pin) must survive the mask.
      for (let y = Math.max(0, Math.floor(y0)); y < Math.min(p.height, Math.ceil(y1)); y++) {
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(p.width, Math.ceil(x1)); x++) {
          if (lum(p.px(x, y)) > 140 && p.px(x, y)[3] > 200) assert.ok(inside(x + 0.5, y + 0.5, p.width), `${f}: the ${part} is cut by the mask at ${x},${y}`);
        }
      }
      // The box really holds the bright gold artwork, not the dark background.
      let bright = 0; let n = 0;
      for (let y = Math.ceil(y0); y < y1; y++) for (let x = Math.ceil(x0); x < x1; x++) { n++; if (lum(p.px(x, y)) > 140) bright++; }
      assert.ok(bright / n > 0.15, `${f}: ${part} box is mostly background (${bright}/${n})`);
    }
  }
});

test('L-8: the slogan is readable: dark slogan on the light logo, light slogan on the dark logo (AA 4.5:1)', () => {
  const themes = parseThemes(readText('src/css/tokens.css'));
  const g = geo();
  const cases = [['assets/brand/latisa-logo-light.png', themes.light['--bg']], ['assets/brand/latisa-logo-dark.png', themes.light['--deep']]];
  for (const [f, bg] of cases) {
    const p = png(f); const [x0, y0, x1, y1] = g.logo.slogan; const sum = [0, 0, 0]; let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const c = p.px(x, y); if (c[3] > 230) { sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; n++; } }
    assert.ok(n > 200, `${f}: no slogan pixels`);
    const ink = hex(sum.map((v) => v / n));
    assert.ok(contrastRatio(ink, bg) >= 4.5, `${f}: slogan ${ink} on ${bg} is ${contrastRatio(ink, bg)}`);
  }
});

test('L-9: no pink or purple in the app icons (the approved teal and gold stay)', () => {
  for (const f of ['icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon-180.png', 'assets/brand/latisa-mark.png']) {
    built(f); const p = png(f); let pinkish = 0; let n = 0;
    for (let y = 0; y < p.height; y += 2) for (let x = 0; x < p.width; x += 2) {
      const [r, gr, b, a] = p.px(x, y); if (a < 128) continue; n++;
      const mx = Math.max(r, gr, b); const mn = Math.min(r, gr, b); if (mx - mn < 60) continue;
      let h; if (mx === r) h = (60 * ((gr - b) / (mx - mn)) + 360) % 360; else if (mx === gr) h = 60 * ((b - r) / (mx - mn)) + 120; else h = 60 * ((r - gr) / (mx - mn)) + 240;
      if (h >= 265 && h <= 345) pinkish++;
    }
    assert.ok(pinkish / n < 0.005, `${f}: ${pinkish}/${n} pink or purple pixels`);
  }
});

test('L-10: brand files are cached for offline use and the version moves to 0.8.2 for the update banner', () => {
  const sw = readText('sw.js');
  for (const f of ['assets/brand/latisa-mark.png', 'assets/brand/latisa-logo-dark.png', 'assets/brand/latisa-logo-light.png', 'icons/favicon-32.png']) assert.ok(sw.includes(`'./${f}'`), f);
  // 0.8.3 (pre-stage-10 PR A) and later keep the brand files; the version only moves forward.
  assert.match(readJson('config/app.config.json').appVersion, /^0\.(8\.[2-9]|9\.\d+)$/);
});
