// Shared helper for local PostgreSQL checks (stage 14): where the server programs are. No data here.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function pgBin() {
  try { return execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(); } catch { /* fall through */ }
  const base = '/usr/lib/postgresql';
  if (!fs.existsSync(base)) return null;
  const v = fs.readdirSync(base).sort((a, b) => Number(b) - Number(a))[0];
  return v ? path.join(base, v, 'bin') : null;
}

module.exports = { pgBin };
