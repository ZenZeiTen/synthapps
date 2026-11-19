#!/usr/bin/env bash
# Re-record every stage's route (content/routes/*.json). Run after changing a level or the rules.
#   bash tests/make_routes.sh [level ...]
set -eo pipefail
cd "$(dirname "$0")/../godot"
levels=("$@")
[ ${#levels[@]} -eq 0 ] && levels=(hollow mines aqueduct canopy foundry spire)
for l in "${levels[@]}"; do
  out=$(timeout 1800 godot --headless --path . --script res://tests/route.gd -- level="$l" write 2>&1)
  echo "$out" | grep -E "^route|FAIL" || true
  if ! echo "$out" | grep -q "^route $l"; then echo "FAIL no route for $l"; exit 1; fi
done
