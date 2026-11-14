#!/usr/bin/env bash
# One command for the C++ rules core (Source/HyperBluff/Core):
#   1. builds the core, the tests and the parity dumper with -Wall -Wextra -Werror under g++
#      and, if installed, clang++;
#   2. runs the rules tests with each build ("CORE TESTS n/n passed");
#   3. runs the Godot rules (hyper-bluff/godot) and the C++ core over the same bot runs and
#      random hands and diffs the logs ("PARITY ok: <seeds> seeds, <steps> steps").
# Exits non-zero on any failure.
#
# Usage: bash hyper-bluff-ue/tests/run_core_tests.sh
# Environment: GODOT (Godot 4.7 binary; default from hyper-bluff/tests/env.sh),
#   PARITY_SEEDS (default 200), PARITY_EVALS (default 2000000), JOBS (default 4).
# The Godot side takes a few minutes, so its output is cached in tests/build/parity/<key>,
# keyed by the hash of the GDScript rules, dump.gd and the parameters. Change any of them and
# it is regenerated. With a cache hit Godot is not needed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
UE="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$UE/.." && pwd)"
CORE="$UE/Source/HyperBluff/Core"
GDPROJ="$REPO/hyper-bluff/godot"
BUILD="$HERE/build"
SEEDS="${PARITY_SEEDS:-200}"
EVALS="${PARITY_EVALS:-2000000}"
JOBS="${JOBS:-4}"
mkdir -p "$BUILD"

if [ -z "${GODOT:-}" ] && [ -f "$REPO/hyper-bluff/tests/env.sh" ]; then
  . "$REPO/hyper-bluff/tests/env.sh"
fi

FLAGS=(-std=c++17 -O2 -Wall -Wextra -Wpedantic -Wshadow -Werror -ffp-contract=off -fno-exceptions -fno-rtti -I"$CORE")
SOURCES=("$CORE/HBCards.cpp" "$CORE/HBData.cpp" "$CORE/HBGame.cpp" "$CORE/HBAi.cpp")

compilers=(g++)
if command -v clang++ >/dev/null 2>&1; then compilers+=(clang++); else echo "note: clang++ not found, g++ only"; fi

fail=0
for cxx in "${compilers[@]}"; do
  tag="${cxx%++}"
  "$cxx" "${FLAGS[@]}" "$HERE/core/test_core.cpp" "${SOURCES[@]}" -o "$BUILD/test_core_$tag"
  "$cxx" "${FLAGS[@]}" "$HERE/parity/parity_dump.cpp" "${SOURCES[@]}" -o "$BUILD/parity_dump_$tag"
  # The core alone must also build with no warnings under the stricter conversion checks.
  for src in "${SOURCES[@]}"; do
    "$cxx" "${FLAGS[@]}" -Wconversion -Wno-sign-conversion -c "$src" -o /dev/null
  done
  set +e
  out="$("$BUILD/test_core_$tag")"
  status=$?
  set -e
  printf '%s\n' "$out" | sed "s/^/[$tag] /"
  if [ $status -ne 0 ] || ! printf '%s\n' "$out" | grep -q '^CORE TESTS \([0-9]*\)/\1 passed$'; then
    echo "[$tag] core tests FAILED"
    fail=1
  fi
done
[ $fail -eq 0 ] || exit 1

# ---- parity with the Godot rules ---------------------------------------------------------
key="$( { cat "$GDPROJ/scripts/core/cards.gd" "$GDPROJ/scripts/core/game.gd" "$GDPROJ/scripts/core/ai.gd" \
          "$GDPROJ/scripts/core/data.gd" "$HERE/parity/dump.gd"; echo "$SEEDS $EVALS $JOBS"; } | sha256sum | cut -c1-16)"
GDOUT="$BUILD/parity/$key"
if [ ! -f "$GDOUT/complete" ]; then
  if [ -z "${GODOT:-}" ] || [ ! -x "$GODOT" ]; then
    echo "PARITY FAILED: no cached Godot output for these rules and GODOT is not set to a Godot 4.7 binary"
    exit 1
  fi
  echo "parity: running the Godot rules ($JOBS processes, cache $key) ..."
  rm -rf "$BUILD/parity"  # drop caches for older rules
  mkdir -p "$GDOUT"
  gd() {  # mode shard out
    PARITY_MODE="$1" PARITY_SHARD="$2" PARITY_SHARDS="$JOBS" PARITY_SEEDS="$SEEDS" PARITY_EVALS="$EVALS" \
      PARITY_OUT="$3" "$GODOT" --headless --path "$GDPROJ" --script "$HERE/parity/dump.gd" >"$3.log" 2>&1
  }
  pids=()
  gd data 0 "$GDOUT/data.txt" & pids+=($!)
  for ((i = 0; i < JOBS; i++)); do
    gd runs "$i" "$GDOUT/runs_$i.txt" & pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" || { echo "PARITY FAILED: a Godot run exited non-zero (see $GDOUT/*.log)"; exit 1; }; done
  pids=()
  for ((i = 0; i < JOBS; i++)); do
    gd eval "$i" "$GDOUT/eval_$i.txt" & pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" || { echo "PARITY FAILED: a Godot run exited non-zero (see $GDOUT/*.log)"; exit 1; }; done
  if grep -l "SCRIPT ERROR" "$GDOUT"/*.log >/dev/null 2>&1; then
    echo "PARITY FAILED: script error in the Godot dump (see $GDOUT/*.log)"
    exit 1
  fi
  touch "$GDOUT/complete"
fi

cmp_file() {  # name godot cpp
  if ! cmp -s "$2" "$3"; then
    echo "PARITY FAILED: $1 differs; first difference:"
    diff "$2" "$3" | head -6 || true
    return 1
  fi
}

for cxx in "${compilers[@]}"; do
  tag="${cxx%++}"
  COUT="$BUILD/parity_cpp_$tag"
  rm -rf "$COUT"
  mkdir -p "$COUT"
  dump="$BUILD/parity_dump_$tag"
  "$dump" data 0 "$JOBS" "$SEEDS" "$EVALS" "$COUT/data.txt"
  for ((i = 0; i < JOBS; i++)); do
    "$dump" runs "$i" "$JOBS" "$SEEDS" "$EVALS" "$COUT/runs_$i.txt" &
    "$dump" eval "$i" "$JOBS" "$SEEDS" "$EVALS" "$COUT/eval_$i.txt" &
  done
  wait  # exit codes are checked by comparing the files below
  cmp_file "data ($tag)" "$GDOUT/data.txt" "$COUT/data.txt" || fail=1
  for ((i = 0; i < JOBS; i++)); do
    cmp_file "runs shard $i ($tag)" "$GDOUT/runs_$i.txt" "$COUT/runs_$i.txt" || fail=1
    cmp_file "eval shard $i ($tag)" "$GDOUT/eval_$i.txt" "$COUT/eval_$i.txt" || fail=1
  done
done
[ $fail -eq 0 ] || exit 1

runs="$(cat "$GDOUT"/runs_*.txt | grep -c '^RUN ')"
steps="$(cat "$GDOUT"/runs_*.txt | grep -vc '^\(RUN\|init\|END\) ')"
hands="$(cat "$GDOUT"/runs_*.txt | grep -c '^\(pre\|hand_over\) ')"
evals="$(( (EVALS / JOBS) * JOBS ))"
ladder="$(grep -c . <<< "$(grep '^RIVALS ' "$GDOUT/data.txt" | cut -d' ' -f2 | tr ',' '\n')")"
expect_runs="$(( SEEDS * ladder ))"
if [ "$runs" -ne "$expect_runs" ] || [ "$steps" -lt 1000 ]; then
  echo "PARITY FAILED: expected $expect_runs runs, found $runs with $steps steps"
  exit 1
fi
echo "PARITY ok: $SEEDS seeds, $steps steps ($runs runs, $hands hands, all $ladder rivals, ${compilers[*]}); eval ok: $evals hands + 60000 short sets; data ok"
