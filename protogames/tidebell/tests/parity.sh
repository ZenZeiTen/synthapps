#!/usr/bin/env bash
# The two builds' cores give the same state, step for step: both replay every route (and a
# version with items used) and print a state hash every 30 steps; the lists must match.
set -eo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/parity
node web/tests/parity.mjs > build/parity/js.txt
timeout 900 godot --headless --path godot --script res://tests/parity.gd -- "$PWD/build/parity/gd.txt" > build/parity/gd.log 2>&1
n=$(wc -l < build/parity/js.txt)
if ! diff build/parity/js.txt build/parity/gd.txt > build/parity/diff.txt; then
  # (not `diff | head`: under pipefail, head closing early kills diff and hides this message)
  sed -n 1,6p build/parity/diff.txt
  echo "PARITY FAIL: the cores differ (first differences above; all in build/parity/diff.txt)"
  exit 1
fi
echo "PARITY ok ($n hashes match)"
