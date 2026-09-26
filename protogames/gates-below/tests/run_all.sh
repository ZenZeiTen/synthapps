#!/usr/bin/env bash
# Every check in one go. Needs godot (4.7) on PATH and python3 with numpy + pillow.
#   bash tests/run_all.sh
set -e
cd "$(dirname "$0")/.."
echo "== core suite (rules, levels, save/load, full playthrough)"
godot --headless --path godot --script res://tests/run_tests.gd 2>&1 | grep -E "passed|FAIL|playthrough"
echo "== balance (12 seeds; then 16 seeds with random parties made on the disc)"
godot --headless --path godot --script res://tests/balance.gd -- 12 2>&1 | grep -E "^wins"
godot --headless --path godot --script res://tests/balance.gd -- 16 --made 2>&1 | grep -E "^wins"
echo "== mutation check"
python3 tests/mutation_core.py | tail -1
echo "== art"
python3 tests/verify_art.py | tail -1
echo "== audio"
python3 tests/verify_audio.py | tail -1
echo "== app smoke test (main scene, scripted input, 200 frames)"
out=$(godot --headless --path godot --quit-after 200 -- --script=seed:5,fw,left,touch,ov:inv,ov:,right,fw,fw,ov:map,ov:cast,ov:book,ov:menu,ov:help,ov:,tick:30 2>&1 || true)
if echo "$out" | grep -qiE "script error|parse error"; then echo "$out" | grep -iE "script error|parse error"; exit 1; fi
out=$(godot --headless --path godot --quit-after 200 -- --script=create,pearl:315:70,croll,caccept,cadd,pearl:135:70,croll,caccept,cbegin,fw,ov:inv,ov: 2>&1 || true)
if echo "$out" | grep -qiE "script error|parse error"; then echo "$out" | grep -iE "script error|parse error"; exit 1; fi
echo "no script errors (explore session and the creation screen)"
