#!/bin/bash
# usage: redgreen.sh <label> ; runs smart-bag and tips QA scripts behind the slow proxy, prints results
L=$1; R=/home/user/tisa-trip-os; S=$(cd "$(dirname "$0")" && pwd); O=$S/out-$L; mkdir -p $O
cd $R
echo "HEAD $(git rev-parse --short HEAD) dirty=$(git status --porcelain scripts/qa | wc -l)"
for pair in smart-bag-browser:8173 tips-browser:8172; do
  n=${pair%%:*}; p=${pair##*:}
  PORT=$p DELAY=${DELAY:-1500} node $S/slowproxy.cjs > $O/$n-proxy.txt & PX=$!; sleep 1
  PORT=$p SHOTS=0 QA_OUT=$O/$n node scripts/qa/$n.cjs > $O/$n-output.txt 2>&1; echo "$n exit=$?"
  kill $PX; wait $PX 2>/dev/null
  cat $O/$n-proxy.txt; grep -E "FAIL|L10|K9|message" $O/$n-output.txt
done
