// Unique ids for records. Uses crypto.randomUUID when the browser has it (secure pages), else a simple fallback.
let counter = 0;

export function makeId(cryptoObj = globalThis.crypto) {
  if (typeof cryptoObj?.randomUUID === 'function') return cryptoObj.randomUUID();
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `${Date.now().toString(36)}-${counter.toString(36)}-${rand}`;
}
