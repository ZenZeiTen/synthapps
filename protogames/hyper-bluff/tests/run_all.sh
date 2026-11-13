#!/usr/bin/env bash
# One command for every check. Usage: bash tests/run_all.sh   (reads tests/env.sh for tool paths)
set -eo pipefail
cd "$(dirname "$0")/.."
. tests/env.sh
"$GODOT" --headless --path godot --import >/dev/null 2>&1 || true
"$GODOT" --headless --path godot --script res://tests/run_tests.gd 2>&1 | tee /tmp/hb_tests.log | tail -1
grep -q "^TESTS \([0-9]*\)/\1 passed" /tmp/hb_tests.log
bash godot/tests/harness.sh "$GODOT" | tail -1
python3 tests/verify_audio.py | tail -1
python3 tools/art/sheets.py export >/dev/null && python3 tools/art/export_portraits.py >/dev/null
git diff --quiet -- godot/assets/art/cards.png godot/assets/art/icons.png godot/assets/art/portraits.png \
  && echo "ART sheets match their .aseprite sources" || { echo "ART sheets differ from sources"; exit 1; }
python3 tools/art/ase_crosscheck.py | tail -1
if [ -f dist/HyperBluff/HyperBluff.exe ]; then
  bash godot/tests/harness.sh "$GODOT" --main-pack "$PWD/dist/HyperBluff/HyperBluff.exe" | tail -1
fi
echo "ALL OK"
