"""Dev-only: builds the LATISA brand files from the two approved sources in docs/brand-source/.

  latisa-icon-source.png   the app icon on a magenta background (approved 2026-11-21)
  latisa-logo-source.webp  the full logo "Latisa · Tripilot" with the slogan, on black (approved 2026-11-21)

The artwork itself is never redrawn. The script only removes the backgrounds (the method approved with the
previews: soft edges, magenta spill removed), resizes, and places the icon on its own dark navy for the
home-screen icons. The one approved change: a light-background logo whose white slogan is recoloured dark,
and whose glow behind the dot (a dark smudge on light) is dropped. Writes docs/brand-source/geometry.json
(plane, pin and slogan boxes) for tests/stage9-brand.test.js.

Needs Python 3 with Pillow and NumPy on the developer's machine; the app itself has no dependencies.
Run: python3 scripts/brand/build-brand.py
"""
import json
import os
import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'docs', 'brand-source')
ASSETS = os.path.join(ROOT, 'assets', 'brand')
ICONS = os.path.join(ROOT, 'icons')
os.makedirs(ASSETS, exist_ok=True)

MAGENTA = np.array([247, 0, 243], np.float32)  # the icon background (sampled at the corner)
SLOGAN_DARK = (13, 59, 71)                     # --title (light theme) in src/css/tokens.css
# Measured (2026-11-21): at the earlier 72% the plane's nose lies outside the 80% safe circle, and at 100% the
# iOS rounded corner clips it. These scales keep every plane and pin pixel inside, with a small margin.
MASKABLE_SCALE = 0.62                          # plane nose needs <= 0.645 for the 80% circle
APPLE_SCALE = 0.94                             # plane nose needs <= 0.98 for the iOS rounded square
NAVY = (12, 20, 44, 255)                       # approved: the icon's dark outer edge, sampled in the preview (#0C142C)


def key_icon():
    im = np.asarray(Image.open(os.path.join(SRC, 'latisa-icon-source.png')).convert('RGB')).astype(np.float32)
    mag = np.minimum(im[..., 0], im[..., 2]) - im[..., 1]           # how magenta a pixel is
    a = np.clip(1 - (mag - 60) / (200 - 60), 0, 1)                  # >=200 see-through, <=60 solid
    fg = np.clip((im - (1 - a)[..., None] * MAGENTA) / np.maximum(a, 1e-3)[..., None], 0, 255)
    fg[a == 0] = 0
    icon = Image.fromarray(np.dstack([fg, a * 255]).astype(np.uint8), 'RGBA')
    return icon.crop(icon.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())


def key_logo():
    w = np.asarray(Image.open(os.path.join(SRC, 'latisa-logo-source.webp')).convert('RGB')).astype(np.float32)
    a = np.clip((w.max(axis=2) - 10) / (70 - 10), 0, 1)             # black background to see-through
    fg = np.clip(w / np.maximum(a, 1e-3)[..., None], 0, 255)
    fg[a == 0] = 0
    logo = Image.fromarray(np.dstack([fg, a * 255]).astype(np.uint8), 'RGBA')
    return logo.crop(logo.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())


def dense_box(mask, min_count):
    """Bounding box of the rows and columns that hold at least min_count marked pixels (drops the thin dotted path)."""
    rows = np.where(mask.sum(axis=1) >= min_count)[0]
    cols = np.where(mask.sum(axis=0) >= min_count)[0]
    return [int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1]


def part_boxes(icon):
    """Plane (top right) and pin (bottom right), found as the dense bright gold shapes in those areas."""
    px = np.asarray(icon).astype(np.float32)
    h, w = px.shape[:2]
    lum = 0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2]
    bright = (lum > 140) & (px[..., 3] > 200)
    m = int(w * 0.034)  # inside the glowing frame line (about 2.5% in), but outside the plane's wing tip
    out = {}
    for name, (y0, y1) in {'plane': (m, int(h * 0.42)), 'pin': (int(h * 0.58), h - m)}.items():
        x0 = int(w * 0.55)
        region = np.zeros_like(bright)
        region[y0:y1, x0:w - m] = bright[y0:y1, x0:w - m]
        bx = dense_box(region, 12)
        out[name] = bx
    return out


def place(icon, size, scale, bg):
    """The icon scaled to `scale` of a size x size square, centred; returns the image and the mapping."""
    can = Image.new('RGBA', (size, size), bg)
    side = round(size * scale)
    k = side / max(icon.size)
    art = icon.resize((round(icon.size[0] * k), round(icon.size[1] * k)), Image.LANCZOS)
    ox, oy = (size - art.size[0]) / 2, (size - art.size[1]) / 2
    can.alpha_composite(art, (round(ox), round(oy)))
    return can, (k, round(ox), round(oy))


def map_box(b, mapping):
    k, ox, oy = mapping
    return [round(b[0] * k + ox, 1), round(b[1] * k + oy, 1), round(b[2] * k + ox, 1), round(b[3] * k + oy, 1)]


def save_png(img, path, colors=None):
    if colors:
        img = img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    img.save(path, optimize=True)
    print('wrote', os.path.relpath(path, ROOT), os.path.getsize(path), 'bytes')


def main():
    icon = key_icon()
    parts = part_boxes(icon)
    navy = NAVY
    geo = {'navy': '#%02X%02X%02X' % navy[:3], 'source': {'icon': list(icon.size), **parts}, 'icons': {}}
    jobs = [
        ('icons/icon-512.png', 512, 1.0, (0, 0, 0, 0)),
        ('icons/icon-192.png', 192, 1.0, (0, 0, 0, 0)),
        ('icons/favicon-32.png', 32, 1.0, (0, 0, 0, 0)),
        ('icons/apple-touch-icon-180.png', 180, APPLE_SCALE, navy),   # iOS rounds the corners itself
        ('icons/icon-maskable-512.png', 512, MASKABLE_SCALE, navy),
        ('assets/brand/latisa-mark.png', 128, 1.0, (0, 0, 0, 0)),
    ]
    for rel, size, scale, bg in jobs:
        img, mapping = place(icon, size, scale, bg)
        save_png(img, os.path.join(ROOT, rel))
        geo['icons'][rel] = {p: map_box(b, mapping) for p, b in parts.items()}

    logo = key_logo()
    k = 1000 / logo.size[0]
    logo = logo.resize((1000, round(logo.size[1] * k)), Image.LANCZOS)
    px = np.asarray(logo).astype(np.float32)
    h = px.shape[0]
    sat = px[..., :3].max(axis=2) - px[..., :3].min(axis=2)
    lum = px[..., :3].mean(axis=2)
    white = (sat < 40) & (lum > 150) & (px[..., 3] > 0)
    slogan_rows = np.zeros_like(white)
    slogan_rows[int(h * 0.85):] = white[int(h * 0.85):]
    sx0, sy0, sx1, sy1 = dense_box(slogan_rows, 2)
    geo['logo'] = {'size': [1000, h], 'slogan': [sx0, sy0, sx1, sy1]}
    save_png(logo, os.path.join(ASSETS, 'latisa-logo-dark.png'))

    light = px.copy()
    zone = np.zeros(white.shape, bool)
    zone[sy0:sy1, sx0:sx1] = True
    soft = zone & (sat < 60) & (px[..., 3] > 0)            # the slogan and its anti-aliased edge
    light[soft, 0], light[soft, 1], light[soft, 2] = SLOGAN_DARK
    # The glow around the dot between the two words: dark, half see-through pixels that read as a smudge on light.
    glow = (light[..., 3] < 200) & (lum < 90) & ~zone
    light[glow, 3] = 0
    save_png(Image.fromarray(light.astype(np.uint8), 'RGBA'), os.path.join(ASSETS, 'latisa-logo-light.png'))

    with open(os.path.join(SRC, 'geometry.json'), 'w', encoding='utf8') as f:
        json.dump(geo, f, indent=2)
        f.write('\n')
    print(json.dumps(geo))


if __name__ == '__main__':
    main()
