#!/usr/bin/env bash
# Finds and writes the route through each stage (all of them, or the ones named), in
# parallel. Run it after any stage or rules change; tests/replay_routes.gd then proves
# every stage can still be finished.
set -eo pipefail
cd "$(dirname "$0")/.."
python3 pipeline/sync_content.py
stages=("$@")
[ ${#stages[@]} -eq 0 ] && stages=(reach harbor village cliffs abbey brinecrow)
mkdir -p build/routes
pids=()
for s in "${stages[@]}"; do
  timeout 3000 godot --headless --path godot --script res://tests/route.gd -- "stage=$s" write \
    > "build/routes/$s.log" 2>&1 &
  pids+=($!)
done
fail=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    echo "route FAILED: ${stages[$i]} (see build/routes/${stages[$i]}.log)"
    fail=1
  fi
  grep "^ROUTE" "build/routes/${stages[$i]}.log" || true
done
python3 pipeline/sync_content.py
exit $fail
