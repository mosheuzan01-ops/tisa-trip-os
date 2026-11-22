#!/bin/bash
# Stage 13 regression. usage: regress.sh <outroot> <runs...>
# Writes outside the repo (rule 20); only JSON and stdout are copied into the repo afterwards.
# Every browser script in scripts/qa (*-browser.cjs and qa-live-060.cjs), plus the static scan. The keyboard crawl
# is long (about 10 minutes), so it gets a longer timeout. After each script, leftover servers and temp copies of
# a crashed script are removed (seen 2026-11-22: a leftover server on port 8092 served an old copy to stage2 B17).
cd "$(dirname "$0")/../../../.."
OUTROOT=$1; shift
for run in "$@"; do
  mkdir -p "$OUTROOT/run$run"
  node --test > "$OUTROOT/run$run/npm-test.txt" 2>&1; echo "run$run npm test $(grep -E '^# (pass|fail)' "$OUTROOT/run$run/npm-test.txt" | tr '\n' ' ')"
  python3 -I scripts/qa/qa_scan.py index.html > "$OUTROOT/run$run/qa-scan-index.txt" 2>&1
  echo "run$run qa_scan index.html FAIL=$(grep -c '^FAIL' "$OUTROOT/run$run/qa-scan-index.txt") WARN=$(grep -c '^WARN' "$OUTROOT/run$run/qa-scan-index.txt")"
  for f in scripts/qa/*-browser.cjs scripts/qa/qa-live-060.cjs; do
    n=$(basename "$f" .cjs)
    out="$OUTROOT/run$run/$n"
    mkdir -p "$out"
    limit=300; case "$n" in stage13-keyboard-browser) limit=1500;; stage13-layout-browser|stage13-upgrade-browser) limit=600;; esac
    QA_OUT="$out" RUN=$run SHOTS=0 timeout $limit node "$f" > "$out/stdout.txt" 2>&1
    echo "run$run $n exit=$? $(tail -1 "$out/stdout.txt")"
    pkill -f "scripts/serve.js" 2>/dev/null; rm -rf /tmp/tisa-update-* /tmp/tisa-close-update-* /tmp/tisa-071-* 2>/dev/null # a script that crashed must not leave its server on a port the next one uses
  done
done
