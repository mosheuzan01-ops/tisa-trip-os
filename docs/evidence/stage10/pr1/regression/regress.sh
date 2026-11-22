#!/bin/bash
# usage: regress.sh <outroot> <runs...> ; writes outside the repo (rule 20)
cd /home/user/tisa-trip-os
OUTROOT=$1; shift
for run in "$@"; do
  mkdir -p $OUTROOT/run$run
  node --test > $OUTROOT/run$run/npm-test.txt 2>&1; echo "run$run npm test $(grep -E '^# (pass|fail)' $OUTROOT/run$run/npm-test.txt | tr '\n' ' ')"
  for f in scripts/qa/*-browser.cjs scripts/qa/qa-live-060.cjs; do
    n=$(basename "$f" .cjs)
    out=$OUTROOT/run$run/$n
    mkdir -p "$out"
    QA_OUT=$out RUN=$run SHOTS=0 timeout 300 node "$f" > "$out/stdout.txt" 2>&1
    echo "run$run $n exit=$? $(tail -1 "$out/stdout.txt")"
  done
done
