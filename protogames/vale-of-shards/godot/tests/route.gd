## Route checker: proves a stage can be finished with real inputs, and records them.
##
##   godot --headless --path godot --script res://tests/route.gd -- level=hollow [write]
##
## The level header's "route:" line lists goals in order (tests/router.gd parse):
##   "x,y"        a cell to touch
##   "x,y!"       a cell to touch when the fire button may be needed
##   "ride"       board a moving plank
##   "until:col"  ride until that column
##   "have:item"  pick an item up, breaking its crate
##   "hunt:kind"  fight a boss
## Starting at the stage's start checkpoint, each goal is searched with per-step inputs
## through the real rules (scripts/core), with creatures unable to hurt (god mode). Hazard
## tiles still kill, so a route through lava or spikes is rejected. The last goal must end
## the stage: its exit, or the heart crystal.
##
## "write" saves godot/content/routes/<level>.json: {"inputs": [...], "segments": [...]}.
## The inputs are indices into scripts/core/demo.gd INPUTS, one per step from the stage start.
## They are used three ways:
## - main.gd replays them through synthesized key and gamepad events (--script=replay:...);
## - tests/playthrough.gd chains them across the whole game;
## - the title screen plays them as its attract-mode demo.
extends SceneTree

const Game = preload("res://scripts/core/game.gd")
const Router = preload("res://tests/router.gd")


static func stage_game(level: String) -> Game:
	var g := Game.new()
	g.god = true
	g.load_level(level)
	g.pl["level"] = g.level.get("stage", 0)
	g.init_inv()
	g.stats(1)
	g.p_reenter(false)
	g.modal = {}
	for i in 41:          # the 40-step entry (st_begin) takes no input
		g.step({})
		Router.settle(g)
	return g


func _init() -> void:
	var args := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=")
		args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var level: String = args.get("level", "hollow")
	var g := stage_game(level)
	var goals := Router.parse(String(g.level.get("route", "")))
	if goals.is_empty():
		print("FAIL %s has no route: line" % level)
		quit(1)
		return
	var r := Router.new()
	var all: Array = []
	var segs: Array = []
	var t0 := Time.get_ticks_msec()
	for i in goals.size():
		var res := r.run(g, goals[i], i == goals.size() - 1)
		if res.is_empty():
			print("FAIL route %s blocked before %s,%s" % [level, goals[i][0], goals[i][1]])
			quit(1)
			return
		all.append_array(res[0])
		var hunt: bool = goals[i][0] is String and goals[i][0] == "hunt"
		segs.append({"t": "hunt" if hunt else "path", "kind": goals[i][1] if hunt else 0, "inputs": res[0]})
		g = res[1]
	print("route %s: %d steps (%.1f s of play), searched in %.1f s" % [level, all.size(), all.size() / Game.STEP_HZ,
		(Time.get_ticks_msec() - t0) / 1000.0])
	if args.has("write"):
		DirAccess.make_dir_recursive_absolute("res://content/routes")
		var f := FileAccess.open("res://content/routes/%s.json" % level, FileAccess.WRITE)
		f.store_string(JSON.stringify({"level": level, "inputs": all, "segments": segs}))
	quit(0)
