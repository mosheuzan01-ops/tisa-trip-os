// Stage 7: a small ZIP writer and reader for the photo backup. "Stored" entries only (JPEGs are already compressed),
// UTF-8 names, CRC-32 checked on read. Pure functions on Uint8Array, no DOM; tested in tests/stage7-core.test.js.
// Limits: no ZIP64, so one archive stays under 4 GB and 65,535 files (far above a trip's photos).

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

/** The archive as a list of byte chunks (so a large backup can become a Blob without one huge copy). */
export function zipParts(entries, when = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = e.data;
    const crc = crc32(data);
    const head = new Uint8Array(30 + name.length);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(8, 0, true); // stored
    v.setUint16(10, time, true);
    v.setUint16(12, date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    head.set(name, 30);
    parts.push(head, data);
    const c = new Uint8Array(46 + name.length);
    const w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint16(10, 0, true);
    w.setUint16(12, time, true);
    w.setUint16(14, date, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, data.length, true);
    w.setUint32(24, data.length, true);
    w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    c.set(name, 46);
    central.push(c);
    offset += head.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const z = new DataView(end.buffer);
  z.setUint32(0, 0x06054b50, true);
  z.setUint16(8, entries.length, true);
  z.setUint16(10, entries.length, true);
  z.setUint32(12, size, true);
  z.setUint32(16, offset, true);
  return [...parts, ...central, end];
}

/** The whole archive in one Uint8Array. */
export function zipStore(entries, when) {
  const parts = zipParts(entries, when);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Entries of a stored ZIP, [{ name, data }], or null when it is not one, uses compression, or fails its check. */
export function unzipStore(bytes) {
  try {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = b.length - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e -= 1;
    if (e < 0) return null;
    const count = v.getUint16(e + 10, true);
    let p = v.getUint32(e + 16, true);
    const dec = new TextDecoder();
    const out = [];
    for (let k = 0; k < count; k += 1) {
      if (v.getUint32(p, true) !== 0x02014b50) return null;
      const method = v.getUint16(p + 10, true);
      const crc = v.getUint32(p + 16, true);
      const size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true);
      const extra = v.getUint16(p + 30, true);
      const comment = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
      if (method !== 0 || v.getUint32(local, true) !== 0x04034b50) return null;
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = b.slice(start, start + size);
      if (data.length !== size || crc32(data) !== crc) return null;
      out.push({ name, data });
      p += 46 + nameLen + extra + comment;
    }
    return out;
  } catch {
    return null;
  }
}
