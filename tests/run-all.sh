#!/bin/sh
# Every screen test, in one go. Exit 0 means everything passed.
# Run from the repo root:  sh tests/run-all.sh
set -e
export NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}"
fail=0
node tests/check-no-positional-cells.js || fail=1
node tests/check-page-set.js  || fail=1
node tests/check-rpc-calls.js || fail=1
for t in tests/*.test.js; do
  node "$t" || fail=1
done
# Last, and loudest: is any of this on the branch the site actually serves?
# Four rounds of work were reported done while sitting on a branch nobody
# visits. This asks GitHub what main holds rather than trusting the local copy.
node tests/check-live.js || fail=1
exit $fail
