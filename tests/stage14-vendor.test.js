// Stage 14, step 1: the Supabase client library, kept as one local file (no CDN, no npm install, no node_modules).
// The file is pinned by SHA-256 and size: any change to it, even one byte, fails here. To move to another version,
// verify the new tarball first (registry integrity, npm signature, provenance, license) and update the pin together
// with CREDITS.md. Verification record: docs/evidence/stage14/step1-vendor/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readText } from './helpers.js';

const PIN = {
  version: '2.119.2',
  file: 'vendor/supabase/supabase-js-2.119.2.umd.js',
  bytes: 221417,
  sha256: '8816af04d9915dbba1882d6f84f0b402dc40268063a63d9c66d24f52f371c263',
};
const DIR = 'vendor/supabase';
const has = (rel) => existsSync(join(ROOT, rel));

test('V1: the vendored supabase-js file matches the pinned SHA-256 and size', () => {
  assert.ok(has(PIN.file), `${PIN.file} is missing`);
  const bytes = readFileSync(join(ROOT, PIN.file));
  assert.equal(bytes.length, PIN.bytes, 'size changed');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), PIN.sha256, 'content changed');
});

test('V2: exactly one library file, and it is the pinned version', () => {
  assert.ok(has(DIR), `${DIR} is missing`);
  const libs = readdirSync(join(ROOT, DIR)).filter((n) => n.endsWith('.js'));
  assert.deepEqual(libs, [PIN.file.split('/').pop()]);
  assert.match(readText(PIN.file), new RegExp(`supabase-js/${PIN.version.replaceAll('.', '\\.')}`));
});

test('V3: license notices travel with the file (MIT needs them)', () => {
  assert.ok(has(`${DIR}/LICENSE`), 'LICENSE is missing');
  const own = readText(`${DIR}/LICENSE`);
  assert.match(own, /MIT License/);
  assert.match(own, /Copyright \(c\) 2020 Supabase/);
  assert.ok(has(`${DIR}/THIRD_PARTY_LICENSES.txt`), 'THIRD_PARTY_LICENSES.txt is missing');
  const third = readText(`${DIR}/THIRD_PARTY_LICENSES.txt`);
  for (const needle of ['@supabase/phoenix', 'Chris McCord', 'iceberg-js', 'tslib', 'Microsoft Corporation']) {
    assert.ok(third.includes(needle), `THIRD_PARTY_LICENSES.txt lacks ${needle}`);
  }
});

test('V4: CREDITS.md records the file, version, license and hash', () => {
  const credits = readText('CREDITS.md');
  for (const needle of [PIN.file, `@supabase/supabase-js@${PIN.version}`, 'MIT', PIN.sha256]) {
    assert.ok(credits.includes(needle), `CREDITS.md lacks ${needle}`);
  }
});

// V5 moved to tests/stage14-rules.test.js when the app started to use the library (stage 14, step B): loaded only
// when needed, only from this site, with this same hash as subresource integrity.
