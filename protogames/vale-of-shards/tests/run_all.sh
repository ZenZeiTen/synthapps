#!/usr/bin/env bash
# Every check in one go. Needs godot 4.7 on PATH (with export templates for the last
# step), xvfb-run, and python3 with numpy, pillow and soundfile.
#   bash tests/run_all.sh            (about 10 minutes; stops at the first failure)
#   bash tests/run_all.sh --quick    (skips the whole-game playthrough and the export)
set -eo pipefail   # pipefail: a failing godot/python step fails the run even when piped into grep
cd "$(dirname "$0")/.."
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

# run_godot <expect-regex> <args...>: the output must match, and must not hold a script error
run_godot() {
  local want=$1; shift
  local out
  out=$(timeout 1500 godot --headless --path godot "$@" 2>&1) || { echo "$out" | tail -20; echo "FAIL godot exited non-zero: $*"; exit 1; }
  if echo "$out" | grep -qE "SCRIPT ERROR|Parse Error|HARNESS unknown"; then
    echo "$out" | grep -E "SCRIPT ERROR|Parse Error|HARNESS unknown" | head -5; echo "FAIL script error: $*"; exit 1
  fi
  if ! echo "$out" | grep -qE "$want"; then echo "$out" | tail -20; echo "FAIL expected /$want/: $*"; exit 1; fi
  echo "$out" | grep -E "$want"
}

echo "== core suite (the source's numbers, levels parse, saves round-trip)"
run_godot "^[0-9]+ passed, 0 failed" --script res://tests/run_tests.gd
echo "== recorded routes still finish every stage"
run_godot "routes: 6 replayed, 0 failed" --script res://tests/replay_routes.gd

echo "== stage 1 driven through the real input path"
# synthesized device events -> InputMap -> Controls.held() -> core, as a player's would be
for dev in kb pad; do
  run_godot "REPLAY hollow ok" --quit-after 30000 -- --script=replay:hollow:$dev
done
echo "== the Glass Spire from the gamepad: Sable, the meeting with the Regent, the fight, the ending"
# a "talk" replay stops at each dialog; the script pages it with the A button (the script only
# runs while a dialog is open or its button is still down; otherwise the replay plays on).
# After the heart crystal, fire pressed during the fade and on the first page must not skip the
# ending; then A pages it, a held A runs the credits, and the game must reach the title (it once
# froze here). The replay also fails if closing a dialog with A makes Orrin jump (it once did).
spire_script="replay:spire:pad:talk,\
waitmodal,wait:20,dump,ptap:a,wait:20,ptap:a,\
waitmodal,wait:20,dump,ptap:a,wait:20,dump,ptap:a,wait:20,dump,ptap:a,\
waitmodal,ptap:x,ptap:x,ptap:x,wait:30,dump,wait:34,ptap:x,ptap:x,wait:40,dump,\
ptap:a,wait:60,ptap:a,wait:60,ptap:a,wait:60,dump,\
pad:a,wait:600,padup:a,wait:10,dump,ptap:a,wait:10,ptap:start,wait:10,ptap:a,wait:10,dump,quit"
out=$(timeout 600 godot --headless --path godot --quit-after 90000 -- --script="$spire_script" 2>&1) \
  || { echo "$out" | tail -20; echo "FAIL godot exited non-zero: the Spire and the ending"; exit 1; }
got=$(echo "$out" | grep -E "^REPLAY|^DUMP|^HARNESS|SCRIPT ERROR" | sed -E 's/ level=[a-z]+ pos=.* modal=/ modal=/; s/ inv=.*//' | tr '\n' ';')
want="DUMP mode=play modal=dialog:sable;DUMP mode=play modal=dialog:regent;DUMP mode=play modal=dialog:orrin;\
DUMP mode=play modal=dialog:regent;REPLAY spire ok steps=[0-9]+;\
HARNESS waitmodal: the replay ended without another dialog;DUMP mode=ending phase=white page=0;\
DUMP mode=ending phase=pages page=0;DUMP mode=ending phase=credits page=3;DUMP mode=ending phase=end page=3;\
DUMP mode=title;"
if ! echo "$got" | grep -qxE "$want"; then echo "FAIL the Spire and the ending"; echo " got:  $got"; echo " want: $want"; exit 1; fi
echo "Sable speaks, the Regent meets Orrin before the fight, the crystal falls, the ending and credits play, the title returns"

echo "== menus with a gamepad: title -> new game -> story pages -> pause menu -> items -> shop refusal"
got=$(timeout 120 godot --headless --path godot --quit-after 900 -- \
  --script=dump,ptap:a,wait:20,dump,ptap:a,wait:20,ptap:a,wait:20,ptap:a,wait:20,dump,ptap:start,wait:5,dump,ptap:down,ptap:a,wait:5,dump,ptap:b,wait:5,dump,ptap:back,wait:5,dump 2>&1 \
  | grep -oE "^DUMP mode=[a-z]+( level=[a-z]+)?( .* modal=[a-z]+)?" | sed -E 's/ pos=.* modal=/ modal=/' | tr '\n' '|')
want="DUMP mode=title|DUMP mode=play level=vale modal=dialog|DUMP mode=play level=vale modal=none|DUMP mode=pause level=vale modal=none|DUMP mode=items level=vale modal=none|DUMP mode=play level=vale modal=none|DUMP mode=play level=vale modal=none|"
if [ "$got" != "$want" ]; then echo "FAIL gamepad menus"; echo " got:  $got"; echo " want: $want"; exit 1; fi
echo "A starts a new game, A pages the story, Start pauses, down+A opens items, B closes, Back is refused on the map"

echo "== menus with the keyboard: pause, options, relaxed speed toggles"
got=$(timeout 120 godot --headless --path godot --quit-after 900 -- \
  --script=stage:hollow,tap:esc,wait:5,dump,tap:down,tap:down,tap:down,tap:down,tap:down,tap:enter,wait:5,dump,tap:enter,wait:5,dump,tap:esc,wait:5,dump 2>&1 \
  | grep -oE "^DUMP mode=[a-z]+" | tr '\n' '|')
want="DUMP mode=pause|DUMP mode=options|DUMP mode=options|DUMP mode=pause|"
if [ "$got" != "$want" ]; then echo "FAIL keyboard menus"; echo " got:  $got"; echo " want: $want"; exit 1; fi
echo "Esc pauses, the fifth item opens Options, Enter toggles, Esc goes back"

echo "== art"
python3 tests/verify_art.py | tail -1
echo "== audio"
python3 tests/verify_audio.py | tail -1

if [ $QUICK -eq 1 ]; then echo "quick run: skipped the playthrough and the export"; exit 0; fi
echo "== the whole game: new game -> Vale map -> gates -> six stages -> the ending"
run_godot "^playthrough won" --script res://tests/playthrough.gd
echo "== exported Linux build, run from a temporary folder"
python3 tests/verify_export.py | tail -2
echo "all checks passed"
