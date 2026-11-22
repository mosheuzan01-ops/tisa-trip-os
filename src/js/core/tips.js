// Stage 12 PR 1 (0.11.0): the places that have an info button ("ⓘ"), approved by the owner on 2026-11-22.
// Each key has tip.<key>.name and tip.<key>.text in locales (checked in tests/stage12-tips.test.js). No DOM here.
export const TIP_KEYS = ['freeBefore', 'freeAfter', 'planned', 'committed', 'today', 'base', 'emergency', 'rates',
  'backup', 'photoBackup', 'unverified', 'userProvided', 'verify', 'flex', 'placeDates'];

export const isTipKey = (key) => TIP_KEYS.includes(key);
