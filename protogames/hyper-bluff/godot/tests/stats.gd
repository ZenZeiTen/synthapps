extends SceneTree
## Bot playouts: how long matches last and how each rival behaves. Not a pass/fail test.
const Game = preload("res://scripts/core/game.gd")
const Ai = preload("res://scripts/core/ai.gd")
const Data = preload("res://scripts/core/data.gd")
func _initialize() -> void:
	for rival_i in 5:
		var hands := 0; var matches := 0; var wins := 0; var folds := 0; var shows := 0; var allins := 0; var score := 0
		for seed_value in 60:
			var s := Game.new_run(seed_value + 100, "rin")
			s["bot"] = {"loose": 0.5, "aggr": 0.55, "bluff": 0.15}
			s["match"] = rival_i
			Game.start_match(s)
			while s["phase"] != "match_over":
				match s["phase"]:
					"pre", "hand_over":
						Game.start_hand(s); hands += 1
					"bet": Ai.play(s, s["to_act"])
					"advance": Game.advance(s)
					"showdown":
						Game.settle(s)
						if s["result"]["showdown"]: shows += 1
						else: folds += 1
						if s["allin_seen"]: allins += 1
			matches += 1; score += s["score"]
			if s["winner"] == 0: wins += 1
		print("%-6s hands/match %.1f  bot wins %d/%d  folds %d%%  showdowns %d%%  all-ins %d%%  avg score %d" % [Data.RIVALS[rival_i], float(hands)/matches, wins, matches, 100*folds/hands, 100*shows/hands, 100*allins/hands, score/matches])
	quit(0)
