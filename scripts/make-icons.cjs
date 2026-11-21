// Dev-only: draws the app icons (PNG) from the approved design language: a platinum card with an
// aircraft window at sunset. Colors are read from src/css/tokens.css (light theme), so the icon follows the palette.
// Needs a Chromium through Playwright on the developer's machine; the app itself has no dependencies.
// Run: node scripts/make-icons.cjs
// RETIRED in 0.8.2 (Stage 9 PR 3): the icons now come from the approved LATISA artwork, built by
// scripts/brand/build-brand.py. Running this would overwrite them with the old window icon, so it stops unless forced.
if (process.env.FORCE_OLD_ICONS !== '1') {
  console.error('Retired: use python3 scripts/brand/build-brand.py (set FORCE_OLD_ICONS=1 to draw the old icons anyway).');
  process.exit(1);
}
const { readFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const ROOT = join(__dirname, '..');
const tokens = readFileSync(join(ROOT, 'src/css/tokens.css'), 'utf8');
const light = tokens.slice(0, tokens.indexOf('[data-theme="dark"]'));
const tok = (name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(light);
  if (!m) throw new Error(`token --${name} not found`);
  return m[1];
};

function svg(size, { maskable }) {
  // Maskable icons keep everything inside the central 80% safe circle.
  const s = maskable ? 0.74 : 0.86;
  const w = 100 * s * 0.56;
  const h = 100 * s * 0.8;
  const x = 50 - w / 2;
  const y = 50 - h / 2;
  const r = w / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="m" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${tok('metal-2')}"/><stop offset=".35" stop-color="${tok('metal-1')}"/>
      <stop offset=".6" stop-color="${tok('metal-4')}"/><stop offset="1" stop-color="${tok('metal-5')}"/>
    </linearGradient>
    <linearGradient id="trim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${tok('trim-1')}"/><stop offset=".5" stop-color="${tok('trim-3')}"/><stop offset="1" stop-color="${tok('trim-4')}"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${tok('sky-1')}"/><stop offset=".45" stop-color="${tok('sky-2')}"/>
      <stop offset=".8" stop-color="${tok('sky-3')}"/><stop offset="1" stop-color="${tok('sky-4')}"/>
    </linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${tok('sea-1')}"/><stop offset="1" stop-color="${tok('sea-3')}"/>
    </linearGradient>
    <clipPath id="win"><rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="${r - 3}"/></clipPath>
  </defs>
  <rect width="100" height="100" ${maskable ? '' : 'rx="22"'} fill="url(#m)"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#trim)"/>
  <g clip-path="url(#win)">
    <rect x="0" y="0" width="100" height="${y + h * 0.62}" fill="url(#sky)"/>
    <rect x="0" y="${y + h * 0.62}" width="100" height="100" fill="url(#sea)"/>
    <circle cx="50" cy="${y + h * 0.62}" r="${w * 0.17}" fill="${tok('sun-core')}"/>
    <rect x="${50 - w * 0.22}" y="${y + h * 0.67}" width="${w * 0.44}" height="1.2" rx=".6" fill="${tok('sun-glow')}" opacity=".8"/>
    <rect x="${50 - w * 0.14}" y="${y + h * 0.72}" width="${w * 0.28}" height="1.2" rx=".6" fill="${tok('sun-glow')}" opacity=".55"/>
  </g>
</svg>`;
}

const OUT = join(ROOT, 'icons');
mkdirSync(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon-180.png', 180, { maskable: true }], // iOS rounds the corners itself
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, opts] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:transparent">${svg(size, opts)}</body>`);
    await page.locator('svg').screenshot({ path: join(OUT, name), omitBackground: !opts.maskable });
    console.log('wrote icons/' + name);
  }
  await browser.close();
})();
