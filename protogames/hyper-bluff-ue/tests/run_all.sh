#!/usr/bin/env bash
# Everything that can be checked without Unreal, in one command. Ends with "ALL OK".
#   1. the rules core: tests/run_core_tests.sh (CORE TESTS n/n passed, PARITY ok)
#   2. the app layer (Source/HyperBluff/App): every file builds with g++ and clang++ under
#      -std=c++20 -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror
#   3. the app tests (tests/app/test_app.cpp), with both compilers: the harness.sh checks,
#      Director's Cut checks, text fit with real data, input, letterbox, decoders
#      (the PNG decoder is compared pixel for pixel with Python/PIL); it also writes
#      tests/harness_checks.tsv, the checks tools/harness.ps1 runs against the Unreal build
#   4. lint of the Unreal wrappers (Source/HyperBluff/Game): headers they need are included,
#      no identifiers that collide with Windows/Unreal macros
# Usage: bash hyper-bluff-ue/tests/run_all.sh     (ONLY=regex limits the app checks)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
UE="$(cd "$HERE/.." && pwd)"
S="$UE/Source/HyperBluff"
BUILD="$HERE/build"
mkdir -p "$BUILD"

echo "== rules core"
set +e
core_out="$(bash "$HERE/run_core_tests.sh" 2>&1)"
core_status=$?
set -e
printf '%s\n' "$core_out" | grep -E 'CORE TESTS|PARITY|FAILED' || true
if [ $core_status -ne 0 ] || ! printf '%s\n' "$core_out" | grep -q '^PARITY ok'; then
  echo "core tests FAILED"; exit 1
fi

echo "== app layer: strict builds"
compilers=(g++)
if command -v clang++ >/dev/null 2>&1; then compilers+=(clang++); fi
STRICT=(-std=c++20 -O1 -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Wno-sign-conversion -Werror
        -ffp-contract=off -fno-exceptions -fno-rtti -I"$S/Core" -I"$S/App")
for cxx in "${compilers[@]}"; do
  for f in "$S"/App/*.cpp; do
    "$cxx" "${STRICT[@]}" -c "$f" -o /dev/null
  done
  echo "[$cxx] app layer builds clean"
done

echo "== app tests"
python3 - "$UE/Content/Raw/Art" > "$BUILD/png_ref.txt" <<'PY'
import sys, glob, os
from PIL import Image
M = (1 << 64) - 1
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.png"))):
    im = Image.open(f).convert("RGBA")
    h = 0
    for b in im.tobytes():
        h = ((h * 1099511628211) & M) ^ b
    print(os.path.basename(f), h)
PY
fail=0
for cxx in "${compilers[@]}"; do
  tag="${cxx%++}"
  "$cxx" -std=c++20 -O2 -Wall -Wextra -Wshadow -Werror -ffp-contract=off -I"$S/Core" -I"$S/App" \
    "$HERE/app/test_app.cpp" "$S"/App/*.cpp "$S"/Core/*.cpp -o "$BUILD/test_app_$tag"
  set +e
  out="$(PNG_REF="$BUILD/png_ref.txt" "$BUILD/test_app_$tag" "$UE" --write-checks "$HERE/harness_checks.tsv")"
  status=$?
  set -e
  printf '%s\n' "$out" | grep -v '^ok ' | sed "s/^/[$tag] /"
  if [ $status -ne 0 ] || ! printf '%s\n' "$out" | grep -q '^APP TESTS \([0-9]*\)/\1 passed$'; then
    echo "[$tag] app tests FAILED"; fail=1
  fi
done
[ $fail -eq 0 ] || exit 1

echo "== Unreal wrapper lint"
bash "$HERE/lint_game.sh"

echo "ALL OK"
