## Replays every recorded route (content/routes/*.json) in a fresh stage and checks that it
## still finishes the stage. Fast (no search); run after any change to rules or levels.
## A failure means a route must be re-recorded (tests/make_routes.sh) or a level got harder.
##   godot --headless --path godot --script res://tests/replay_routes.gd
extends SceneTree

const Game = preload("res://scripts/core/game.gd")
const Demo = preload("res://scripts/core/demo.gd")
const Route = preload("res://tests/route.gd")
const Router = preload("res://tests/router.gd")


func _init() -> void:
	var bad := 0
	var n := 0
	var d := DirAccess.open("res://content/routes")
	var files := d.get_files() if d else PackedStringArray()
	for f in files:
		if not f.ends_with(".json"):
			continue
		var level := f.get_basename()
		var rec = JSON.parse_string(FileAccess.get_file_as_string("res://content/routes/" + f))
		var g: Game = Route.stage_game(level)
		for i in rec["inputs"]:
			g.step(Demo.INPUTS[int(i)])
			Router.settle(g)
		var ok: bool = g.newlevel.begins_with("!") or g.gameover == 2
		n += 1
		if not ok:
			bad += 1
			var p = g.player()
			print("FAIL route %s no longer finishes (ends at %d,%d state %d)" % [level, p.x, p.y, p.state])
	print("routes: %d replayed, %d failed" % [n, bad])
	quit(1 if bad or n < 6 else 0)
