#!/usr/bin/env bash
# Every check for Tidebell, in one command. It stops at the first failure.
#   bash tests/run_all.sh            # everything (about 15 minutes)
#   bash tests/run_all.sh --quick    # skips the whole-game playthrough, the export and the browser
#
# Each Godot run writes its output to build/checks/<name>.log. A check passes only if the
# lines it expects are there, and no "SCRIPT ERROR" or "HARNESS unknown" line is.
set -eo pipefail
cd "$(dirname "$0")/.."
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1
LOGS=build/checks
mkdir -p "$LOGS"
G="godot --headless --path godot"

fail() { echo "FAIL: $*"; exit 1; }

# expect NAME 'pattern' ['pattern' ...] -- command...
expect() {
  local name=$1; shift
  local pats=()
  while [ "$1" != "--" ]; do pats+=("$1"); shift; done
  shift
  local log="$LOGS/$name.log"
  if ! timeout 1800 "$@" > "$log" 2>&1; then
    tail -20 "$log"; fail "$name exited with an error (see $log)"
  fi
  if grep -E "SCRIPT ERROR|HARNESS unknown|Parse Error" "$log" > /dev/null; then
    grep -E "SCRIPT ERROR|HARNESS unknown|Parse Error" "$log" | head -5; fail "$name: script error (see $log)"
  fi
  for p in "${pats[@]}"; do
    grep -E -- "$p" "$log" > /dev/null || { tail -20 "$log"; fail "$name: missing '$p' (see $log)"; }
  done
  echo "ok   $name"
}

echo "== files"
python3 tests/verify_content.py
python3 tests/verify_art.py 2> /dev/null
python3 tests/verify_audio.py

echo "== core"
expect parse 'PARSE ok' -- $G --script res://tests/check_parse.gd
expect core 'TESTS [0-9]+ passed, 0 failed' -- $G --script res://tests/run_tests.gd
expect routes 'REPLAYS ok' -- $G --script res://tests/replay_routes.gd

echo "== every stage through the real input path (keyboard and pad)"
for s in reach harbor village cliffs abbey brinecrow; do
  for d in kb pad; do
    expect "replay_${s}_$d" "REPLAY $s ok" -- $G --quit-after 40000 -- "--script=replay:$s:$d"
  done
done

echo "== screens: title, opening, hub, talk, map, wardens, stage, pause, title"
WALK="tap:enter,wait:30,dump,tap:z,wait:30,tap:z,wait:30,tap:z,wait:30,tap:z,wait:10,dump,tap:down,tap:enter,wait:30,dump,tap:z,wait:10,dump,tap:down,tap:enter,dump,tap:c,dump,tap:down,tap:enter,dump,tap:right,tap:enter,dump,tap:up,tap:up,tap:up,tap:enter,wait:20,dump,key:right,wait:30,keyup:right,dump,tap:enter,dump,tap:esc,wait:6,dump,tap:enter,tap:down,tap:down,dump,tap:enter,wait:6,dump,quit"
expect walk 'mode=pages page=0/4' 'mode=hub cur=1' 'mode=map' 'mode=hub cur=2' 'mode=heroes' 'mode=hub cur=3 .*hero=june' \
  'mode=pause cur=2' 'DUMP mode=title' -- $G --quit-after 8000 -- "--script=$WALK"
# the hero walked after setting out from the hub
grep -E "DUMP mode=play stage=reach pos=(1[0-9][0-9]|[2-9][0-9][0-9])," "$LOGS/walk.log" > /dev/null || fail "walk: the hero did not move"

echo "== story pages open after landing; closing buttons do not carry over; past the win to the title"
FINAL="replay:brinecrow:pad:talk:end,waittalk,dump,wait:30,ptap:start,waittalk,dump,wait:30,ptap:start,wait:30,ptap:start,waittalk,dump,wait:30,ptap:start,wait:30,ptap:start,wait:30,ptap:start,wait:200,dump,pad:x,wait:120,padup:x,wait:60,dump,ptap:a,wait:30,ptap:a,wait:30,ptap:a,wait:30,ptap:a,wait:30,dump,wait:60,ptap:a,wait:30,dump,wait:200,dump,quit"
expect final 'who=villager' 'who=grane' 'page=0/3 who=grane' 'REPLAY brinecrow ok' 'phase=bells' 'phase=credits' 'DUMP mode=title' \
  -- $G --quit-after 40000 -- "--script=$FINAL"
TALK="replay:reach:kb:talk,waittalk,dump,wait:30,tap:enter,waittalk,dump,wait:30,tap:enter"
expect talk_reach 'who=villager' 'who=vell' 'REPLAY reach ok' -- $G --quit-after 40000 -- "--script=$TALK"

echo "== text fits with the longest real data"
FIT="fitall,fit,tap:enter,wait:30,tap:z,wait:30,tap:z,wait:30,tap:z,wait:30,tap:z,wait:10,set:score:9999999,set:done:4,wait:6,fit,set:done:5,wait:6,fit,tap:down,tap:down,tap:down,tap:enter,wait:6,fit,tap:right,wait:6,tap:right,wait:6,fit,quit"
expect fit 'FIT ok' -- $G --quit-after 8000 -- "--script=$FIT"
if grep -E "^FIT [0-9]" "$LOGS/fit.log"; then fail "fit: text outside its frame"; fi
expect assets 'ASSETS ok' -- $G --quit-after 200 -- "--script=assets,quit"

if [ $QUICK = 1 ]; then
  echo "quick run: skipped the playthrough, the export and the browser checks"
  echo "ALL CHECKS PASSED (quick)"
  exit 0
fi

echo "== the whole game, stage after stage, with progress carried"
expect playthrough 'PLAYTHROUGH ok' -- $G --script res://tests/playthrough.gd

echo "== the exported build"
python3 tests/verify_export.py

echo "== the browser build"
bash tests/run_web.sh

echo "ALL CHECKS PASSED"
