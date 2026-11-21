#!/bin/bash
cd /home/user/tisa-trip-os
OUTROOT=docs/evidence/stage9/pr3/regression
for run in 1 2 3; do
  node --test > $OUTROOT-npm-test-run$run.txt 2>&1; echo "run$run npm test $(grep -E '^# (pass|fail)' $OUTROOT-npm-test-run$run.txt | tr '\n' ' ')"
  for f in scripts/qa/*-browser.cjs scripts/qa/qa-live-060.cjs; do
    n=$(basename "$f" .cjs)
    out=$OUTROOT/run$run/$n
    mkdir -p "$out"
    QA_OUT=$out RUN=$run SHOTS=0 timeout 300 node "$f" > "$out/stdout.txt" 2>&1
    echo "run$run $n exit=$? $(tail -1 "$out/stdout.txt")"
  done
done
