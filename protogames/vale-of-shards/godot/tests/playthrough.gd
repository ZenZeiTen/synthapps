## The whole game, played through the real rules from "New Game" to the ending.
##
##   godot --headless --path godot --script res://tests/playthrough.gd
##
## On the Vale map the tiny walker is steered by the route search (tests/router.gd) to each
## gate and stage marker in turn, so the gates must open with the keys the stages give.
## Inside a stage the recorded route (content/routes/<stage>.json) is replayed segment by
## segment; boss fights are fought live by the hunt policy, since creatures move at random.
## Each replayed segment must reach its goal (the level's route: line, one goal per segment).
## The recording was made from a fresh stage, and random events (a stone's bounce, a creature's
## turn) can differ here, so a segment that misses its goal is searched again live from the
## real state; the count of re-searched segments is printed.
## Creatures cannot hurt Orrin (god mode); hazard tiles still can.
## Passes when all six stages are done, the three sigils are held and the game is won.
extends SceneTree

const Game = preload("res://scripts/core/game.gd")
const D = preload("res://scripts/core/defs.gd")
const Router = preload("res://tests/router.gd")
const Demo = preload("res://scripts/core/demo.gd")

const PLAN := [
	["hollow", "11,22"],
	["mines", "13,20; 20,18"],
	["aqueduct", "28,17; 34,22"],
	["canopy", "34,12"],
	["foundry", "38,17; 43,22"],
	["spire", "43,10; 43,4"],
]

var failed := false


func fail(msg: String) -> void:
	print("FAIL ", msg)
	failed = true


func _init() -> void:
	var r := Router.new()
	r.quiet = true
	var g := Game.new()
	g.god = true
	g.new_game()
	Router.settle(g)
	var total := 0
	for step in PLAN:
		var stage: String = step[0]
		# walk the map to the marker (through the gates)
		for goal in Router.parse(step[1]):
			var res := r.run(g, goal, false)
			if res.is_empty():
				fail("map walk to %s blocked before %s,%s" % [stage, goal[0], goal[1]])
				_end()
				return
			g = res[1]
			total += res[0].size()
		for i in 10:
			g.step({})
			Router.settle(g)
			if g.curlevel == stage:
				break
		if g.curlevel != stage:
			fail("the %s marker did not start the stage (on %s)" % [stage, g.curlevel])
			_end()
			return
		for i in 41:
			g.step({})
			Router.settle(g)
		var rec = JSON.parse_string(FileAccess.get_file_as_string("res://content/routes/%s.json" % stage))
		var goals := Router.parse(String(g.level.get("route", "")))
		if goals.size() != rec["segments"].size():
			fail("%s: %d route goals but %d recorded segments (re-record: tests/make_routes.sh)" % [stage, goals.size(),
				rec["segments"].size()])
			_end()
			return
		var searched := 0
		for si in goals.size():
			var seg: Dictionary = rec["segments"][si]
			var last: bool = si == goals.size() - 1
			if seg["t"] == "hunt":
				var res := r.hunt(g, int(seg["kind"]), false)
				if res.is_empty():
					fail("%s: lost the fight" % stage)
					_end()
					return
				total += res[0].size()
				g = res[1]
				continue
			var before: Game = g.clone()
			for i in seg["inputs"]:
				g.step(Demo.INPUTS[int(i)])
				Router.settle(g)
			if r.reached(g, goals[si], last):
				total += seg["inputs"].size()
				continue
			searched += 1
			var res := r.run(before, goals[si], last)
			if res.is_empty():
				fail("%s: goal %d (%s) cannot be reached from the playthrough's state" % [stage, si + 1, str(goals[si])])
				_end()
				return
			g = res[1]
			total += res[0].size()
		# finish: the exit (or, in the Spire, the heart crystal) ends the stage
		var n := 0
		while g.curlevel == stage and g.gameover == 0 and n < 3000:
			if stage == "spire":
				var res := r.hunt(g, D.HEARTCRYSTAL, true)
				if res.is_empty():
					break
				continue
			g.step({})
			Router.settle(g)
			n += 1
		print("stage %-9s done at step %d; score %d, shards %d, sigils %d; %d of %d segments re-searched" % [stage, total,
			g.pl["score"], g.pl["shards"], g.invcount(D.INV_SIGIL1) + g.invcount(D.INV_SIGIL2) + g.invcount(D.INV_SIGIL3),
			searched, goals.size()])
		if stage != "spire" and g.curlevel != "vale":
			fail("%s did not return to the Vale" % stage)
			_end()
			return
	if g.gameover != 2:
		fail("the game was not won")
	if g.done_stages.size() != 5:
		fail("stages finished on the map: %s" % str(g.done_stages))
	for k in 3:
		if not g.invcount(D.INV_SIGIL1 + k):
			fail("sigil %d missing" % k)
	if not failed:
		print("playthrough won in %d steps (%.1f minutes of play)" % [total, total / Game.STEP_HZ / 60.0])
	_end()


func _end() -> void:
	quit(1 if failed else 0)
