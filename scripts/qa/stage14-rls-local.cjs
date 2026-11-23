// Stage 14: runs supabase/migrations/0001 + supabase/tests/rls_check.sql on a throwaway LOCAL PostgreSQL.
// Sample users only, nothing leaves the machine, the database folder is deleted at the end.
// This checks the SQL logic (RLS, privileges, functions) against a stand-in for Supabase's auth schema
// (supabase/tests/local-auth-stub.sql). It is NOT proof that a real Supabase project is secure: the owner runs
// rls_check.sql in the real project for that (docs/BACKEND_HE.md).
// Usage: QA_OUT=<dir> RUN=<n> node scripts/qa/stage14-rls-local.cjs
//        RLS_RED=1 ... runs the migration WITHOUT its security section (TDD red: the checks must fail).
const { execFileSync, spawnSync } = require('node:child_process');
const { pgBin } = require('./lib/pg-local.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.QA_OUT || path.join(ROOT, 'docs/evidence/stage14/rls-local');
const RUN = process.env.RUN || '1';
const RED = process.env.RLS_RED === '1';
fs.mkdirSync(OUT, { recursive: true });

const bin = pgBin();
if (!bin || !fs.existsSync(path.join(bin, 'initdb'))) {
  console.log('SKIP: no local PostgreSQL server found (initdb). Nothing was run.');
  fs.writeFileSync(path.join(OUT, `rls-local-run${RUN}.json`), JSON.stringify({ skipped: true }, null, 2));
  process.exit(2);
}

const isRoot = process.getuid?.() === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latisa-rls-'));
const port = String(55000 + Math.floor(Math.random() * 900));
const as = (cmd, args) => (isRoot ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args]);
const run = (cmd, args, opts = {}) => { const [c, a] = as(cmd, args); return spawnSync(c, a, { encoding: 'utf8', ...opts }); };
if (isRoot) execFileSync('chown', ['postgres', dir]);

let migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0001_stage14_init.sql'), 'utf8');
if (RED) migration = `${migration.split('-- ==== SECURITY')[0]}\ncommit;\n`;
for (const [name, text] of [
  ['stub.sql', fs.readFileSync(path.join(ROOT, 'supabase/tests/local-auth-stub.sql'), 'utf8')],
  ['migration.sql', migration],
  ['check.sql', fs.readFileSync(path.join(ROOT, 'supabase/tests/rls_check.sql'), 'utf8')],
]) fs.writeFileSync(path.join(dir, name), text, { mode: 0o644 });

const result = { run: RUN, red: RED, postgres: path.basename(path.dirname(bin)), steps: {} };
let started = false;
try {
  const init = run(path.join(bin, 'initdb'), ['-D', path.join(dir, 'data'), '-A', 'trust', '-U', 'postgres']);
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  const start = run(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', path.join(dir, 'log'), '-w', 'start']);
  if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stderr}`);
  started = true;
  const psql = (file, stop = true) => run(path.join(bin, 'psql'), ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-q', '-v', `ON_ERROR_STOP=${stop ? 1 : 0}`, '-f', path.join(dir, file)]);
  for (const f of ['stub.sql', 'migration.sql']) {
    const r = psql(f);
    result.steps[f] = r.status === 0 ? 'ok' : r.stderr.trim();
    if (r.status !== 0) throw new Error(`${f} failed: ${r.stderr}`);
  }
  const check = psql('check.sql', false);
  const text = `${check.stdout}\n${check.stderr}`;
  const m = /RLS CHECK RESULT: (\d+) PASS, (\d+) FAIL/.exec(text);
  result.pass = m ? Number(m[1]) : null;
  result.fail = m ? Number(m[2]) : null;
  result.failures = [...text.matchAll(/FAIL: ([^\n]+)/g)].map((x) => x[1].trim());
  if (!m) result.error = text.trim();
  // The check must leave nothing behind (its final error undoes everything).
  const left = run(path.join(bin, 'psql'), ['-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-At', '-c', "select (select count(*) from auth.users)+(select count(*) from public.trips)+(select count(*) from public.trip_records)"]);
  result.rowsLeftAfterCheck = Number(left.stdout.trim());
} catch (e) {
  result.error = String(e.message ?? e);
} finally {
  if (started) run(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'fast', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
}

fs.writeFileSync(path.join(OUT, `rls-local-run${RUN}${RED ? '-red' : ''}.json`), JSON.stringify(result, null, 2));
const ok = !result.error && result.fail === 0 && result.pass > 0 && result.rowsLeftAfterCheck === 0;
console.log(`RLS local (${RED ? 'RED: migration without its security section' : 'full migration'}): ${result.pass ?? '?'} PASS, ${result.fail ?? '?'} FAIL, rows left after check: ${result.rowsLeftAfterCheck ?? '?'}`);
for (const f of result.failures ?? []) console.log(`  FAIL ${f}`);
if (result.error) console.log(`  ERROR ${result.error.slice(0, 2000)}`);
console.log(ok ? 'ALL PASS' : 'FAILED');
process.exit(ok ? 0 : 1);
