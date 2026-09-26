#!/usr/bin/env bash
# Every check in one go. Needs godot (4.7) on PATH and python3 with numpy + pillow.
#   bash tests/run_all.sh
set -eo pipefail   # pipefail: a failing godot/python step fails the run even when piped into grep/tail
cd "$(dirname "$0")/.."
echo "== core suite (rules, levels, save/load, full playthrough)"
godot --headless --path godot --script res://tests/run_tests.gd 2>&1 | grep -E "passed|FAIL|playthrough"
echo "== balance (12 seeds; then 16 seeds with random parties made on the disc)"
# Seeds are fixed, so results are deterministic; the floors leave room for small content tweaks.
need_wins() {  # need_wins <min> <godot balance args...>
  local min=$1; shift
  local line; line=$(godot --headless --path godot --script res://tests/balance.gd -- "$@" 2>&1 | grep -E "^wins")
  echo "$line"
  local won; won=$(echo "$line" | sed -E 's/^wins ([0-9]+)\/.*/\1/')
  if [ "$won" -lt "$min" ]; then echo "FAIL balance: $won wins, need at least $min"; exit 1; fi
}
need_wins 12 12
need_wins 12 16 --made
echo "== mutation check"
python3 tests/mutation_core.py | tail -1
echo "== art"
python3 tests/verify_art.py | tail -1
echo "== audio"
python3 tests/verify_audio.py | tail -1
echo "== app smoke test (main scene, scripted input; each run must reach its closing dump)"
# Each run ends with `dump`: no DUMP line means the run stopped before its last command.
smoke() {
  local out; out=$(godot --headless --path godot --quit-after 600 -- --script="$1",dump 2>&1 || true)
  if echo "$out" | grep -qiE "script error|parse error|HARNESS unknown"; then echo "$out" | grep -iE "script error|parse error|HARNESS unknown"; exit 1; fi
  if ! echo "$out" | grep -q "^DUMP"; then echo "FAIL smoke run did not reach its last command: $1"; exit 1; fi
}
smoke seed:5,fw,left,touch,ov:inv,ov:,right,fw,fw,ov:map,ov:cast,ov:book,ov:menu,ov:help,ov:,tick:30
smoke create,pearl:315:70,croll,caccept,cadd,pearl:135:70,croll,caccept,cbegin,fw,ov:inv,ov:
echo "no script errors (explore session and the creation screen)"
echo "== mouse movement (pad, right-click zones, edge turns) from A = 1,1 facing east"
got=$(godot --headless --path godot --quit-after 3000 -- --script=seed:5,dump,click:495:150,wait,wait,dump,rclick:50:50,wait,wait,dump,click:10:100,wait,wait,dump,rclick:224:250,wait,wait,dump,click:523:170,wait,wait,dump,rclick:400:50,wait,dump 2>&1 | grep -oE "pos=[0-9]+,[0-9]+ dir=[0-9]" | tr '\n' ' ')
want="pos=1,1 dir=1 pos=2,1 dir=1 pos=2,1 dir=0 pos=2,1 dir=3 pos=2,1 dir=3 pos=2,0 dir=3 pos=2,0 dir=0 "
if [ "$got" != "$want" ]; then echo "FAIL mouse movement"; echo " got:  $got"; echo " want: $want"; exit 1; fi
echo "pad forward, zone turn left, edge turn left, zone back (door blocks), pad strafe right, zone turn right: all as expected"
echo "== peddler: talk, buy, stow by portrait and by inventory, then walk on"
got=$(godot --headless --path godot --quit-after 3000 -- --script=seed:5,dialog:tamsin,wait,click:100:94,wait,wait,dump,click:100:120,wait,dump,click:264:310,wait,dump,click:100:120,wait,click:560:150,wait,click:404:140,wait,dump,click:560:150,wait,click:495:150,wait,wait,dump 2>&1 | grep -oE "pos=[0-9]+,[0-9]+ .* overlay=[a-z]+ held=[a-z_]+ packs=[0-9,]+" | sed -E 's/ level=[a-z]+ seen=[0-9]+//' | tr '\n' '|')
want="pos=1,1 dir=1 overlay=shop held=none packs=1,1,2,1|pos=1,1 dir=1 overlay=shop held=bread packs=1,1,2,1|pos=1,1 dir=1 overlay=shop held=none packs=1,1,3,1|pos=1,1 dir=1 overlay=inv held=none packs=2,1,3,1|pos=2,1 dir=1 overlay=none held=none packs=2,1,3,1|"
if [ "$got" != "$want" ]; then echo "FAIL peddler"; echo " got:  $got"; echo " want: $want"; exit 1; fi
echo "bread bought, stowed by clicking a portrait in the shop, second loaf stowed from the inventory, party walks on"
