#!/usr/bin/env bash
# End-to-end checks through the real input path (InputEventAction / key events).
# Usage: bash tests/harness.sh [godot-binary] [--main-pack game.exe]
set -eo pipefail
G="${1:-${GODOT:-$HOME/Downloads/Godot_v4.7.2-stable_win64.exe/Godot_v4.7.2-stable_win64_console.exe}}"
shift || true
SRC=(--path "$(dirname "$0")/..")
if [ "${1:-}" = "--main-pack" ]; then SRC=(--main-pack "$2"); fi
fails=0
run() {   # run <name> <want-regex-of-DUMP-lines joined by ;> <script>
  local name="$1" want="$2" script="$3"
  if [ -n "${ONLY:-}" ] && ! [[ "$name" =~ $ONLY ]]; then return; fi
  local out
  out=$(timeout 240 "$G" --headless "${SRC[@]}" --audio-driver Dummy --quit-after 200000 -- --script="$script" 2>&1) || true
  if echo "$out" | grep -q "HARNESS unknown command"; then echo "FAIL $name: unknown command"; fails=$((fails+1)); return; fi
  local got
  got=$(echo "$out" | grep "^DUMP" | sed 's/^DUMP //' | tr '\n' ';')
  if [[ "$got" =~ $want ]]; then echo "ok   $name"; else echo "FAIL $name"; echo "  got:  $got"; echo "  want: $want"; fails=$((fails+1)); fi
}

run "title -> menu -> start game" \
  "^screen=play mode=play block=1-1 .*" \
  "wait:30,tap:jump,wait:10,tap:jump,wait:10,dump"

run "pause menu opens and resumes with the back button" \
  "^screen=pause .*;screen=play .*" \
  "new:classic,wait:10,tap:pause,wait:5,dump,tap:sub,wait:5,dump"

run "quick save and quick load restore position" \
  "^screen=play mode=play block=1-1 x=56 .*;screen=play mode=play block=1-1 x=1(0[0-9]|1[0-9]) .*;screen=play mode=play block=1-1 x=56 .*" \
  "new:classic,wait:5,dump,tap:quicksave,wait:3,hold:right,wait:40,up:right,dump,tap:quickload,wait:3,dump"

run "save to slot 2 through the pause menu, load it from the title" \
  "^screen=play .*x=(8[0-9]|9[0-9]|1[0-9][0-9]) .*;screen=title .*;screen=play .*x=(8[0-9]|9[0-9]|1[0-9][0-9]) .*" \
  "new:classic,hold:right,wait:30,up:right,wait:5,dump,tap:pause,wait:5,tap:down,tap:jump,wait:5,tap:down,tap:down,tap:jump,wait:5,tap:pause,wait:5,tap:down,tap:down,tap:down,tap:down,tap:down,tap:jump,wait:10,dump,wait:30,tap:jump,wait:10,tap:down,tap:down,tap:jump,wait:10,tap:down,tap:down,tap:down,tap:jump,wait:10,dump"

run "rewind undoes a death" \
  "^screen=play mode=dying .*;screen=play mode=play .*hp=1[0-9] .*" \
  "new:classic,wait:60,hurt:99,wait:30,dump,hold:rewind,wait:60,up:rewind,wait:2,dump"

run "rewind off: holding it does nothing" \
  "^screen=play mode=dying .*;screen=play mode=(dying|play) .*hp=0 .*" \
  "set:rewind:0,new:classic,wait:60,hurt:99,wait:30,dump,hold:rewind,wait:60,up:rewind,wait:2,dump"

run "game over offers continue, continue restarts the stage" \
  "^screen=gameover .*;screen=play mode=play block=1-1 .*lives=3 .*" \
  "set:rewind:0,new:classic,hurt:99,wait:200,hurt:99,wait:200,hurt:99,wait:200,hurt:99,wait:200,dump,tap:jump,wait:10,dump"

run "infinite lives never reach game over" \
  "^screen=play .*lives=3 .*" \
  "set:inf_lives:true,set:rewind:0,new:classic,hurt:99,wait:200,hurt:99,wait:200,hurt:99,wait:200,hurt:99,wait:200,dump"

run "half game speed runs half the steps" \
  "^screen=play .*x=(8[0-9]|9[0-9]) .*" \
  "set:speed:50,new:classic,hold:right,wait:60,up:right,dump"

run "rebind jump to K, K jumps" \
  "^screen=play mode=play block=1-1 x=56 y=1[0-5][0-9] st=air .*" \
  "new:classic,wait:5,tap:pause,wait:5,tap:down,tap:down,tap:down,tap:jump,wait:5,tap:up,tap:up,tap:jump,wait:5,tap:down,tap:down,tap:down,tap:down,tap:jump,wait:3,key:K,wait:5,tap:sub,wait:3,tap:sub,wait:3,tap:sub,wait:5,keydown:K,wait:3,dump,keyup:K"

run "music follows the game: stage, boss, then clear" \
  "^screen=play .*music=stage1_16;screen=play .*music=boss_16;screen=play mode=clear .*music=clear_16" \
  "new:classic,wait:10,dump,block:1-3,at:1010:160,hold:right,wait:10,up:right,wait:20,dump,killboss,wait:120,toorb,wait:10,dump"

run "soundtrack option swaps to the 8-bit set" \
  "^screen=play .*music=stage1_8" \
  "set:soundtrack:\"8\",new:classic,wait:10,dump"

run "the whole ending plays and returns to the title (fire held through it)" \
  "^screen=ending .*;screen=title .*" \
  "new:classic,stage:6,boss,hold:right,wait:30,up:right,wait:300,killboss,wait:120,hold:attack,killboss,wait:120,toorb,wait:400,dump,wait:120,up:attack,tap:jump,wait:60,tap:jump,wait:60,tap:jump,wait:60,tap:jump,wait:60,dump"

run "story pages ignore buttons for 0.8 s" \
  "^screen=ending .*;screen=ending .*" \
  "new:classic,stage:6,boss,hold:right,wait:30,up:right,wait:300,killboss,wait:120,killboss,wait:120,toorb,wait:400,dump,tap:jump,wait:2,tap:jump,wait:2,tap:jump,wait:2,tap:jump,wait:2,dump"

echo "HARNESS $fails failure(s)"
[ "$fails" -eq 0 ]
