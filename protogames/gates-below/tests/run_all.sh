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
echo "== mouse movement (pad, right-click zones, edge turns) from A = 1,1 facing east"
got=$(godot --headless --path godot --quit-after 3000 -- --script=seed:5,dump,click:495:150,wait,wait,dump,rclick:50:50,wait,wait,dump,click:10:100,wait,wait,dump,rclick:224:250,wait,wait,dump,click:523:170,wait,wait,dump,rclick:400:50,wait,dump 2>&1 | grep -oE "pos=[0-9]+,[0-9]+ dir=[0-9]" | tr '\n' ' ')
want="pos=1,1 dir=1 pos=2,1 dir=1 pos=2,1 dir=0 pos=2,1 dir=3 pos=2,1 dir=3 pos=2,0 dir=3 pos=2,0 dir=0 "
if [ "$got" != "$want" ]; then echo "FAIL mouse movement"; echo " got:  $got"; echo " want: $want"; exit 1; fi
echo "pad forward, zone turn left, edge turn left, zone back (door blocks), pad strafe right, zone turn right: all as expected"
