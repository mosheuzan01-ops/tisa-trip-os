// Minimal PNG reader for tests (Node zlib only, no dependencies): 8-bit RGB, RGBA, grey, grey+alpha and
// palette images, non-interlaced. Returns { width, height, px(x, y) -> [r, g, b, a] }.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function readPng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
  let pos = 8; let width; let height; let depth; let type; let interlace; let palette; let trns;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`${file}: only 8-bit non-interlaced PNGs are supported`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch; const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]; const src = y * (stride + 1) + 1; const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[row + i - ch] : 0; const b = y ? out[row - stride + i] : 0; const c = y && i >= ch ? out[row - stride + i - ch] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[row + i] = v & 255;
    }
  }
  const px = (x, y) => {
    const i = y * stride + x * ch;
    if (type === 6) return [out[i], out[i + 1], out[i + 2], out[i + 3]];
    if (type === 2) return [out[i], out[i + 1], out[i + 2], 255];
    if (type === 4) return [out[i], out[i], out[i], out[i + 1]];
    if (type === 0) return [out[i], out[i], out[i], 255];
    const k = out[i]; return [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255];
  };
  return { width, height, px };
}
