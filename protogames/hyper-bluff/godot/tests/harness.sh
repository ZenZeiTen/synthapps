#!/usr/bin/env bash
# End-to-end checks through the real input path (action, key, pad and mouse events).
# Usage: bash godot/tests/harness.sh [godot-binary] [--main-pack game.pck]
# ONLY=regex runs matching checks. Harness runs save under user://harness/, which starts empty.
set -eo pipefail
G="${1:-${GODOT:?set GODOT or pass the binary}}"
shift || true
SRC=(--path "$(dirname "$0")/..")
if [ "${1:-}" = "--main-pack" ]; then SRC=(--main-pack "$2"); fi
fails=0
run() {   # run <name> <regex over the DUMP lines joined by ;> <script>
  local name="$1" want="$2" script="$3"
  if [ -n "${ONLY:-}" ] && ! [[ "$name" =~ $ONLY ]]; then return; fi
  local out
  out=$(timeout 240 "$G" --headless "${SRC[@]}" --audio-driver Dummy -- --script="$script" 2>&1) || true
  if echo "$out" | grep -q "HARNESS\|SCRIPT ERROR"; then
    echo "FAIL $name: $(echo "$out" | grep -m3 'HARNESS\|SCRIPT ERROR')"; fails=$((fails+1)); return; fi
  local got
  got=$(echo "$out" | grep "^DUMP" | sed 's/^DUMP //' | tr '\n' ';')
  if [[ "$got" =~ $want ]]; then echo "ok   $name"; else echo "FAIL $name"; echo "  got:  $got"; echo "  want: $want"; fails=$((fails+1)); fi
}
# shared script pieces: every step is a real key press
SKIP="wait:16,tap:ok,tap:ok"                                  # finish typing a page, then next page
TO_PLAY="until:title:60,tap:ok,until:avatar:60,tap:ok,until:story:60,$SKIP,$SKIP,$SKIP,until:versus:60,$SKIP,$SKIP,until:play:60"

run "title to first hand with the keyboard" \
  "^screen=title .*music=title .*;screen=avatar .*;screen=story .*page=0/3 .*save=1 .*;screen=versus .*rival=pochi .*music=match .*;screen=play .*phase=bet hand=1 .*to_act=0 pot=30 stack=790/780 .*" \
  "until:title:60,dump,tap:ok,until:avatar:60,dump,tap:ok,until:story:60,dump,$SKIP,$SKIP,$SKIP,until:versus:60,dump,$SKIP,$SKIP,until:play:60,until:mine:400,dump"

run "the same path with mouse clicks only" \
  "^screen=avatar cur=0 .*;screen=avatar cur=2 .*;screen=story .*;screen=play .*phase=bet hand=1 .*;screen=play .*(street=1|to_act=1|phase=(advance|showdown|hand_over)).*" \
  "until:title:60,click:menu:0,until:avatar:60,dump,click:avatar:2,wait:2,dump,click:avatar:2,until:story:60,dump,wait:16,click:next,click:next,wait:16,click:next,click:next,wait:16,click:next,click:next,until:versus:60,wait:16,click:next,click:next,wait:16,click:next,click:next,until:play:60,until:mine:400,dump,click:btn:1,wait:3,dump"

run "a held confirm does not carry into the next screen" \
  "^screen=avatar cur=0 .*" \
  "until:title:60,tap:ok,tap:ok,tap:ok,wait:40,dump"

run "cursor answers on the same step as the press" \
  "^screen=play .*btn=1 .*;screen=play .*btn=2 .*;screen=play .*btn=0 .*" \
  "$TO_PLAY,until:mine:400,dump,tap:right,dump,tap:right,dump"

run "fold key gives up the blind" \
  "^screen=play .*phase=hand_over hand=1 .*stack=790/810 .*sfx=(fold|lose_hand).*" \
  "$TO_PLAY,until:mine:400,key:F,until:over:400,dump"

run "raise sizes: arrows and wheel step the amount, R commits it" \
  "^screen=play .*pot=30 .*btn=1 .*;screen=play .*btn=2 .*;screen=play .*(pot=(8[0-9]|9[0-9]|[1-9][0-9][0-9]+)|phase=(hand_over|showdown|advance)).*" \
  "$TO_PLAY,until:mine:400,dump,tap:up,wheel:up,dump,key:R,wait:3,dump"

run "all-in from the top raise size ends with a showdown or a fold" \
  "^screen=play .*phase=(hand_over|match_over) .*" \
  "$TO_PLAY,until:mine:400,tap:up,tap:up,tap:up,tap:up,tap:up,tap:up,tap:raise,until:over:900,dump"

run "power keys spend a power and show the cut-in; pad button works too" \
  "^screen=play .*powers=3/0 .*;screen=play .*powers=2/0 .*sfx=(powerup|cutin).*;screen=play .*powers=1/0 .*" \
  "$TO_PLAY,until:mine:400,give:hawk+guard+over,dump,key:1,wait:2,dump,until:mine:300,pad:2,wait:2,dump"

run "a power that cannot be used is kept" \
  "^screen=play .*powers=1/0 .*sfx=error.*" \
  "$TO_PLAY,until:mine:400,give:hawk,key:1,until:mine:300,give:hawk,key:1,until:mine:300,give:hawk,key:1,wait:2,dump"

run "pause opens over the table, blocks play, and resumes" \
  "^screen=pause .*;screen=pause .*phase=bet hand=1 .*pot=30 .*;screen=play .*pot=30 .*;screen=play .*phase=hand_over .*" \
  "$TO_PLAY,until:mine:400,tap:pause,wait:14,dump,key:F,wait:5,dump,tap:pause,wait:14,dump,key:F,until:over:300,dump"

run "pause during a cut-in keeps the hand intact" \
  "^screen=pause .*powers=0/0 .*;screen=play .*phase=bet .*powers=0/0 .*" \
  "$TO_PLAY,until:mine:400,give:guard,key:1,wait:3,tap:pause,wait:30,dump,tap:ok,wait:14,until:mine:300,dump"

run "options from the pause menu and back to the table" \
  "^screen=options .*opts=7/8.*;screen=options .*opts=5/8.*;screen=pause .*;screen=play .*" \
  "$TO_PLAY,until:mine:400,tap:pause,wait:14,tap:down,tap:ok,wait:14,dump,tap:left,tap:left,dump,tap:cancel,wait:14,dump,tap:cancel,wait:14,dump"

run "quit to title keeps the run; continue resumes the same floor" \
  "^screen=title .*save=1 .*;screen=versus .*rival=pochi .*;screen=play .*hand=1 .*" \
  "$TO_PLAY,until:mine:400,tap:pause,wait:14,tap:up,tap:ok,until:title:60,dump,tap:down,tap:ok,until:versus:60,dump,$SKIP,$SKIP,until:play:60,until:mine:400,dump"

run "winning a floor: result, rival's last word, next rival" \
  "^screen=play .*phase=match_over .*stack=1600/0 .*score=[1-9][0-9]+ .*winner=0.*;screen=matchend .*music=victory.*;screen=versus .*page=0/1 .*;screen=versus .*rival=goro .*powers=[0-9]/1 .*" \
  "$TO_PLAY,rig:win,until:over:900,dump,tap:ok,until:matchend:60,dump,tap:ok,until:versus:60,dump,$SKIP,until:versus:60,dump"

run "losing a floor: continue halves the score, same rival" \
  "^screen=matchend .*score=4000 .*winner=1 .*music=defeat.*;screen=versus .*rival=pochi .*score=2000 .*" \
  "$TO_PLAY,rig:lose,score:4000,until:over:900,tap:ok,until:matchend:60,dump,tap:ok,until:versus:60,dump"

run "giving up records the score and returns to the title" \
  "^screen=scores .*save=0 scores=1 .*;screen=title .*" \
  "$TO_PLAY,rig:lose,until:over:900,tap:ok,until:matchend:60,tap:down,tap:ok,until:scores:60,dump,tap:ok,until:title:60,dump"

run "boss floor gets its own scene and music" \
  "^screen=story .*page=0/3 .*rival=onyx .*;screen=versus .*rival=onyx .*music=boss.*" \
  "$TO_PLAY,floor:3,rig:win,until:over:900,tap:ok,until:matchend:60,tap:ok,until:versus:60,$SKIP,until:story:60,dump,$SKIP,$SKIP,$SKIP,until:versus:60,dump"

run "beating the boss: ending, credits, score table, title again" \
  "^screen=story .*page=0/3 .*phase=run_won .*music=ending.*save=0.*;screen=credits .*;screen=scores .*scores=1 .*;screen=title .*music=title.*;screen=avatar .*" \
  "$TO_PLAY,floor:4,rig:win,until:over:900,tap:ok,until:matchend:60,tap:ok,until:versus:60,$SKIP,until:story:60,dump,$SKIP,$SKIP,$SKIP,until:credits:60,dump,tap:ok,until:scores:60,dump,tap:ok,until:title:60,dump,tap:ok,until:avatar:60,dump"

run "credits also end by themselves" \
  "^screen=scores .*scores=1 .*" \
  "$TO_PLAY,floor:4,rig:win,until:over:900,tap:ok,until:matchend:60,tap:ok,until:versus:60,$SKIP,until:story:60,$SKIP,$SKIP,$SKIP,until:credits:60,until:scores:2400,dump"

run "text stays inside its boxes on every screen" \
  "^fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;\$" \
  "until:title:60,fit,tap:ok,until:avatar:60,tap:left,fit,tap:ok,until:story:60,wait:200,fit,$SKIP,$SKIP,$SKIP,until:versus:60,wait:200,fit,$SKIP,$SKIP,until:play:60,until:mine:400,give:glare+sight+over,score:9999999,fit,floor:3,rig:win,fever,until:over:900,fit,tap:ok,until:matchend:60,fit,tap:ok,until:versus:60,wait:200,fit,$SKIP,until:story:60,wait:200,fit,tap:pause,wait:2,$SKIP,$SKIP,$SKIP,until:versus:60,wait:200,fit"

run "text fits on the lost-floor, options, pause and score screens" \
  "^fit=0 ;fit=0 ;fit=0 ;fit=0 ;fit=0 ;\$" \
  "$TO_PLAY,until:mine:400,tap:pause,wait:14,fit,tap:down,tap:ok,wait:14,fit,tap:cancel,wait:14,tap:ok,wait:14,rig:lose,score:9999999,key:F,until:over:900,tap:ok,until:over:900,fit,tap:ok,until:matchend:60,fit,tap:down,tap:ok,until:scores:60,fit"

echo "HARNESS $fails failure(s)"
[ "$fails" -eq 0 ]
