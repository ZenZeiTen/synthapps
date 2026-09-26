## Balance probe: the scripted playthrough over several seeds. Not a pass/fail test;
## it prints wins, deaths and party levels per seed.
##   godot --headless --path godot --script res://tests/balance.gd -- [seeds] [--made]
## --made plays with four characters rolled at random pearl positions on the disc.
extends SceneTree

const Content = preload("res://scripts/core/content.gd")
const Game = preload("res://scripts/core/game.gd")
const Bot = preload("res://tests/bot.gd")
const Walk = preload("res://tests/walkthrough.gd")
const Rules = preload("res://scripts/core/rules.gd")
const Rng = preload("res://scripts/core/rng.gd")


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
		var seed_value: int = 1000 + (i + int(OS.get_environment("SEED_OFFSET") if OS.get_environment("SEED_OFFSET") != "" else "0")) * 7919
		if "--made" in OS.get_cmdline_user_args():
			# four characters with random pearl positions on the creation disc
			var r := Rng.new(seed_value)
			var specs := []
			var faces := ["garrow", "vesna", "sefa", "brann"]
			for k in 4:
				var ranges: Dictionary = Rules.disc_ranges(r.rnd(360), 30 + r.rnd(46))
				specs.append({"name": faces[k].capitalize(), "portrait": faces[k], "sex": "m", "stats": Rules.disc_roll(r, ranges)})
			g.new_game_custom(seed_value, specs)
		else:
			g.new_game(seed_value)
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
