## Balance probe: the scripted playthrough over several seeds. Not a pass/fail test;
## it prints wins, deaths and party levels per seed.
##   godot --headless --path godot --script res://tests/balance.gd -- [seeds]
extends SceneTree

const Content = preload("res://scripts/core/content.gd")
const Game = preload("res://scripts/core/game.gd")
const Bot = preload("res://tests/bot.gd")
const Walk = preload("res://tests/walkthrough.gd")


func _init() -> void:
	var n := 6
	for a in OS.get_cmdline_user_args():
		if a.is_valid_int():
			n = int(a)
	var c: Dictionary = Content.load_all()
	var wins := 0
	var deaths := 0
	for i in n:
		var g := Game.new(c)
		g.new_game(1000 + (i + int(OS.get_environment("SEED_OFFSET") if OS.get_environment("SEED_OFFSET") != "" else "0")) * 7919)
		var b := Bot.new(g)
		var won: bool = Walk.play(b)
		var dead: int = g.s["party"].filter(func(ch): return ch["dead"]).size()
		wins += 1 if won else 0
		if not won and "--why" in OS.get_cmdline_user_args():
			var w = g.ls["monsters"].filter(func(m): return m["id"] == "warden")
			print("  warden: ", w.map(func(m): return [m["cell"] % 13, m["cell"] / 13, m["hp"]]), " floor: ", g.ls["items"], " held ", g.s["held"])
			for l in b.log_lines.slice(maxi(0, b.log_lines.size() - 12)):
				print("   ", l)
		deaths += dead
		print("seed %d: %s, dead %d, levels %s, rounds %d, %s" % [i, "WIN " if won else "LOSS", dead,
			str(g.s["party"].map(func(ch): return ch["level"])), b.rounds, "" if won else String(g.s["level"]) + " " + str(g.s["x"]) + "," + str(g.s["y"])])
	print("wins %d/%d, average deaths %.1f" % [wins, n, float(deaths) / n])
	quit()
