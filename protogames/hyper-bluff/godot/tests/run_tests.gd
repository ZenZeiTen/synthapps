extends SceneTree
## Rules tests. Run: godot --headless --path godot --script res://tests/run_tests.gd
## Prints "TESTS n/n passed" and exits 1 on any failure. ONLY=name filters by substring.

const Cards = preload("res://scripts/core/cards.gd")
const Data = preload("res://scripts/core/data.gd")
const Game = preload("res://scripts/core/game.gd")
const Ai = preload("res://scripts/core/ai.gd")

var _fail := ""

func _initialize() -> void:
	var only := OS.get_environment("ONLY")
	var names := []
	for m in get_method_list():
		if m["name"].begins_with("t_") and (only == "" or only in m["name"]):
			names.append(m["name"])
	names.sort()
	var passed := 0
	for n in names:
		_fail = ""
		var finished = call(n)
		if finished != true and _fail == "":
			_fail = "stopped early (script error above)"
		if _fail == "":
			passed += 1
		else:
			print("FAIL ", n, ": ", _fail)
	print("TESTS %d/%d passed" % [passed, names.size()])
	quit(0 if passed == names.size() and names.size() > 0 else 1)

func ok(cond: bool, msg: String) -> void:
	if not cond and _fail == "":
		_fail = msg

func eq(a, b, msg: String) -> void:
	if a != b and _fail == "":
		_fail = "%s: got %s, want %s" % [msg, str(a), str(b)]

func ev(text: String) -> int:
	return Cards.eval(Cards.cards(text))

## A hand with chosen cards: hole0, hole1, board (5 cards), player on the button or not.
func rig(hole0: String, hole1: String, board: String, seed_value: int = 5) -> Dictionary:
	var s := Game.new_run(seed_value, "rin")
	Game.start_hand(s)
	s["hole"] = [Cards.cards(hole0), Cards.cards(hole1)]
	s["runout"] = Cards.cards(board)
	var used := {}
	for c in s["hole"][0] + s["hole"][1] + s["runout"]:
		used[c] = true
	var deck := []
	for c in 52:
		if not used.has(c):
			deck.append(c)
	s["deck"] = deck
	s["fever"] = false
	s["mission"] = {}
	s["powers"] = [[], []]
	return s

func check_down(s: Dictionary) -> void:
	for _i in 12:
		if s["phase"] == "bet":
			Game.act(s, s["to_act"], "call")
		elif s["phase"] == "advance":
			Game.advance(s)
		else:
			break

func chips(s: Dictionary) -> int:
	return s["stack"][0] + s["stack"][1] + Game.pot(s)

# ---- evaluator ----------------------------------------------------------------

func t_eval_categories() -> bool:
	eq(Cards.category(ev("As Kd 7h 5c 3s 9d 2c")), 0, "high card")
	eq(Cards.category(ev("As Ad 7h 5c 3s 9d 2c")), 1, "pair")
	eq(Cards.category(ev("As Ad 7h 7c 3s 9d 2c")), 2, "two pair")
	eq(Cards.category(ev("As Ad Ah 7c 3s 9d 2c")), 3, "trips")
	eq(Cards.category(ev("5s 6d 7h 8c 9s Kd 2c")), 4, "straight")
	eq(Cards.category(ev("As Ks 7s 5s 3s 9d 2c")), 5, "flush")
	eq(Cards.category(ev("As Ad Ah 7c 7s 9d 2c")), 6, "full house")
	eq(Cards.category(ev("As Ad Ah Ac 7s 9d 2c")), 7, "quads")
	eq(Cards.category(ev("5s 6s 7s 8s 9s Kd 2c")), 8, "straight flush")
	ok(Cards.is_royal(ev("Ts Js Qs Ks As 2d 2c")), "royal flush")
	ok(not Cards.is_royal(ev("9s Ts Js Qs Ks 2d 2c")), "king-high straight flush is not royal")
	return true

func t_eval_order_and_kickers() -> bool:
	ok(ev("As Ad Kh 5c 3s 9d 2c") > ev("As Ad Qh 5c 3s 9d 2c"), "pair kicker")
	ok(ev("As Ad 7h 7c Ks 9d 2c") > ev("As Ad 7h 7c Qs 9d 2c"), "two pair kicker")
	ok(ev("Ks Kd 7h 7c 2s 9d 3c") > ev("Qs Qd Jh Jc As 9d 3c"), "two pair top pair rules")
	ok(ev("2s 2d 2h 3c 4s 9d Tc") > ev("As Ad Kh Kc Qs 9d 3c"), "trips beat two pair")
	ok(ev("As 2d 3h 4c 5s 9d 9c") > ev("9s 9d 9h 4c 5s Kd 2c"), "wheel beats trips")
	ok(ev("2s 3d 4h 5c 6s 9d Kc") > ev("As 2d 3h 4c 5s 9d 9c"), "six-high straight beats wheel")
	eq(ev("As Kd Qh Jc Ts 2d 2c"), ev("Ah Kc Qs Jd Tc 3d 3c"), "same straight ties")
	ok(ev("As Ks 7s 5s 3s 9d 2c") > ev("As Qs Js 9s 8s 9d 2c"), "flush second card")
	ok(ev("As Ad Ah Kc Ks 9d 2c") > ev("Ks Kd Kh Ac As 9d 2c"), "full house trips rule")
	ok(ev("As Ad Ah Kc Ks Kd 2c") > ev("As Ad Ah Qc Qs 9d 2c"), "two trips make the best full house")
	ok(ev("7s 7d 7h 7c As 9d 2c") > ev("7s 7d 7h 7c Ks 9d 2c"), "quads kicker")
	ok(ev("As Ad 3h 3c 2s 2d Kc") > ev("As Ad 3h 3c 2s 2d Qc"), "three pairs use the best kicker")
	return true

func t_eval_six_card_flush_and_hidden_straight() -> bool:
	eq(Cards.category(ev("As Ks Qs 9s 5s 2s 3d")), 5, "six suited cards")
	ok(ev("As Ks Qs 9s 5s 2s 3d") == ev("As Ks Qs 9s 5s 4d 3d"), "flush uses its top five")
	eq(Cards.category(ev("4s 5d 6h 7c 8s 8d 8c")), 4, "straight over trips")
	eq(Cards.category(ev("5s 6s 7s 8s 9d 9s 9c")), 8, "straight flush found among extras")
	return true

func t_names_fit() -> bool:
	eq(Cards.name_of(ev("Ks Kd 7h 5c 3s")), "Pair of Kings", "pair name")
	eq(Cards.name_of(ev("Ts Js Qs Ks As")), "Royal Flush", "royal name")
	eq(Cards.name_of(ev("As Kd")), "Ace high", "two cards")
	for a in 52:
		for b in range(a + 1, 52, 5):
			for c in range(b + 1, 52, 7):
				var n := Cards.name_of(Cards.eval([a, b, c, (c + 11) % 52, (c + 23) % 52]))
				ok(n.length() <= 24, "name too long: " + n)
	return true

# ---- win chance -----------------------------------------------------------------

func t_equity_known_values() -> bool:
	var box := {"k": 99}
	var aa := Cards.equity(Cards.cards("As Ad"), [], [], [], 4000, box, "k")
	ok(absf(aa - 0.852) < 0.03, "AA preflop %.3f" % aa)
	var low := Cards.equity(Cards.cards("7s 2d"), [], [], [], 4000, box, "k")
	ok(absf(low - 0.346) < 0.03, "72o preflop %.3f" % low)
	var nuts := Cards.equity(Cards.cards("As Ks"), Cards.cards("Qs Js Ts 2d 3c"), [], [], 300, box, "k")
	eq(nuts, 1.0, "royal on the river")
	var dead := Cards.equity(Cards.cards("2s 3d"), Cards.cards("As Ad Ah Kc Kd"), [], [], 500, box, "k")
	ok(dead <= 0.5, "playing the board can only tie or lose")
	return true

func t_equity_uses_peeked_card() -> bool:
	var box := {"k": 7}
	var blind := Cards.equity(Cards.cards("Ks Kd"), [], [], [], 3000, box, "k")
	var seen := Cards.equity(Cards.cards("Ks Kd"), [], Cards.cards("Ah"), [], 3000, box, "k")
	ok(seen < blind - 0.08, "a peeked ace lowers the kings: %.3f vs %.3f" % [seen, blind])
	return true

func t_equity_is_deterministic() -> bool:
	var a := Cards.equity_batch(Cards.cards("Qs Jd"), Cards.cards("Th 9c 2s"), [], [], 200, {"k": 5}, "k")
	var b := Cards.equity_batch(Cards.cards("Qs Jd"), Cards.cards("Th 9c 2s"), [], [], 200, {"k": 5}, "k")
	eq(a, b, "same seed, same estimate")
	return true

# ---- betting --------------------------------------------------------------------

func t_blinds_and_button() -> bool:
	var s := Game.new_run(1, "rin")
	Game.start_hand(s)
	eq(s["button"], 0, "player has the button first")
	eq(s["bet"], [10, 20], "button posts the small blind")
	eq(s["to_act"], 0, "button acts first before the flop")
	Game.act(s, 0, "fold")
	Game.settle(s)
	eq(s["stack"], [790, 810], "blind lost on a fold")
	Game.start_hand(s)
	eq(s["button"], 1, "button moves")
	eq(s["bet"], [20, 10], "blinds swap")
	eq(s["to_act"], 1, "rival acts first")
	return true

func t_blinds_rise() -> bool:
	var s := Game.new_run(1, "rin")
	var seen := []
	for i in 10:
		Game.start_hand(s)
		seen.append(s["blind"][1])
		s["stack"] = [800, 800]
		Game.act(s, s["to_act"], "fold")
		Game.settle(s)
	eq(seen, [20, 20, 20, 30, 30, 30, 50, 50, 50, 80], "blind schedule")
	return true

func t_limp_gives_big_blind_the_option() -> bool:
	var s := rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h")
	Game.act(s, 0, "call")
	eq(s["phase"], "bet", "big blind still to act")
	eq(s["to_act"], 1, "option goes to the big blind")
	Game.act(s, 1, "call")
	eq(s["phase"], "advance", "check closes the round")
	Game.advance(s)
	eq(s["board"].size(), 3, "flop")
	eq(s["to_act"], 1, "non-button acts first after the flop")
	return true

func t_min_raise_and_options() -> bool:
	var s := rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h")
	eq(Game.min_raise_to(s, 0), 40, "min raise is one big blind more")
	Game.act(s, 0, "raise", 25)
	eq(s["bet"][0], 40, "a short raise is lifted to the minimum")
	Game.act(s, 1, "raise", 100)
	eq(Game.min_raise_to(s, 0), 160, "re-raise must match the last raise size")
	var opts := Game.raise_options(s, 0)
	ok(opts.size() >= 3, "several sizes offered")
	eq(opts[0], 160, "first option is the minimum")
	eq(opts[-1], 800, "last option is all-in")
	for i in range(1, opts.size()):
		ok(opts[i] > opts[i - 1], "options ascend")
	return true

func t_fold_awards_pot_without_showdown() -> bool:
	var s := rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h")
	Game.act(s, 0, "raise", 60)
	Game.act(s, 1, "fold")
	eq(s["phase"], "showdown", "fold ends the hand")
	Game.settle(s)
	eq(s["result"]["showdown"], false, "no showdown")
	eq(s["result"]["winner"], 0, "raiser wins")
	eq(s["stack"], [820, 780], "wins the big blind")
	eq(s["phase"], "hand_over", "next hand")
	return true

func t_checking_cannot_fold() -> bool:
	var s := rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h")
	Game.act(s, 0, "call")
	Game.act(s, 1, "fold")
	eq(s["folded"], -1, "a free check is never a fold")
	return true

func t_showdown_best_hand_wins() -> bool:
	var s := rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h")
	check_down(s)
	eq(s["phase"], "showdown", "river checked through")
	Game.settle(s)
	eq(s["result"]["winner"], 0, "pair of aces wins")
	eq(s["stack"], [820, 780], "pot paid")
	return true

func t_split_pot() -> bool:
	var s := rig("As 2d", "Ah 3c", "Ks Kd Qh Qc Jd")
	check_down(s)
	Game.settle(s)
	eq(s["result"]["winner"], -1, "board plays, tie")
	eq(s["stack"], [800, 800], "chips returned")
	return true

func t_all_in_and_call_runs_out() -> bool:
	var s := rig("As Ad", "Ks Kd", "2h 7c 9d Jc 3s")
	Game.act(s, 0, "raise", 800)
	eq(s["events"][-1]["a"], "allin", "shown as all-in")
	Game.act(s, 1, "call")
	eq(s["phase"], "advance", "no more betting")
	Game.advance(s)
	eq(s["phase"], "advance", "flop dealt, still running out")
	Game.advance(s)
	Game.advance(s)
	eq(s["phase"], "showdown", "river reached")
	Game.settle(s)
	eq(s["stack"], [1600, 0], "aces hold")
	eq(s["phase"], "match_over", "rival is out")
	eq(s["winner"], 0, "player wins the match")
	return true

func t_short_blind_all_in_refund() -> bool:
	var s := Game.new_run(3, "rin")
	s["stack"] = [1588, 12]
	Game.start_hand(s)
	eq(s["button"], 0, "player on the button")
	eq(s["stack"][1], 0, "rival is all-in on the big blind")
	eq(s["to_act"], 0, "player still owes two chips")
	Game.act(s, 0, "call")
	eq(s["phase"], "advance", "runs out")
	eq(s["total"], [12, 12], "only the matched part is in the pot")
	eq(chips(s), 1600, "chips conserved")
	return true

func t_small_blind_all_in_refunds_big_blind() -> bool:
	var s := Game.new_run(3, "rin")
	s["stack"] = [5, 1595]
	Game.start_hand(s)
	eq(s["phase"], "advance", "no action possible")
	eq(s["total"], [5, 5], "big blind excess returned")
	eq(s["stack"], [0, 1590], "stacks after refund")
	return true

func t_bots_conserve_chips_and_finish() -> bool:
	for seed_value in [11, 12, 13, 14]:
		var s := Game.new_run(seed_value, "rin")
		s["bot"] = {"loose": 0.6, "aggr": 0.6, "bluff": 0.2}
		var hands := 0
		var guard := 0
		while s["phase"] != "run_won" and guard < 20000:
			guard += 1
			match s["phase"]:
				"pre", "hand_over":
					Game.start_hand(s)
					hands += 1
				"bet":
					Ai.play(s, s["to_act"])
				"advance":
					Game.advance(s)
				"showdown":
					Game.settle(s)
				"match_over":
					if s["winner"] == 0:
						Game.next_match(s)
					else:
						Game.continue_run(s)
			if s["phase"] != "run_won":
				ok(chips(s) == 2 * Data.CAST[s["rival"]].get("stack", Game.START_STACK), "chips drifted at seed %d hand %d: %d" % [seed_value, hands, chips(s)])
				ok(s["stack"][0] >= 0 and s["stack"][1] >= 0, "negative stack")
				ok(s["powers"][0].size() <= Game.MAX_POWERS, "too many powers")
		eq(s["phase"], "run_won", "seed %d never finished" % seed_value)
		ok(hands >= 5, "a run takes at least five hands")
	return true

func t_same_seed_same_game() -> bool:
	var out := []
	for _k in 2:
		var s := Game.new_run(77, "aya")
		s["bot"] = Ai.DEFAULT
		for _i in 400:
			match s["phase"]:
				"pre", "hand_over":
					Game.start_hand(s)
				"bet":
					Ai.play(s, s["to_act"])
				"advance":
					Game.advance(s)
				"showdown":
					Game.settle(s)
				_:
					break
		out.append(var_to_str(s))
	eq(out[0], out[1], "replay differs")
	return true

func t_save_round_trip_mid_hand() -> bool:
	var s := Game.new_run(21, "mako")
	Game.start_hand(s)
	Game.act(s, 0, "call")
	var copy: Dictionary = str_to_var(var_to_str(s))
	for st in [s, copy]:
		st["bot"] = Ai.DEFAULT
		for _i in 60:
			match st["phase"]:
				"hand_over":
					Game.start_hand(st)
				"bet":
					Ai.play(st, st["to_act"])
				"advance":
					Game.advance(st)
				"showdown":
					Game.settle(st)
	eq(var_to_str(s), var_to_str(copy), "saved game diverged")
	return true

# ---- powers ---------------------------------------------------------------------

func t_power_hawk_reveals_one_then_the_other() -> bool:
	var s := rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h")
	s["powers"][0] = ["hawk", "hawk", "hawk"]
	ok(Game.use_power(s, 0, 0), "first hawk")
	eq(Game.known_opp(s, 0).size(), 1, "one card seen")
	ok(Game.use_power(s, 0, 0), "second hawk")
	var seen := Game.known_opp(s, 0)
	seen.sort()
	var want: Array = s["hole"][1].duplicate()
	want.sort()
	eq(seen, want, "both cards seen")
	ok(not Game.use_power(s, 0, 0), "nothing left to see")
	eq(s["powers"][0].size(), 1, "a refused power is kept")
	return true

func t_power_swap_replaces_low_card() -> bool:
	var s := rig("As 4d", "7h 2c", "Qs Js 3d 4c 8h")
	s["powers"][0] = ["swap"]
	var top: int = s["deck"][-1]
	ok(Game.use_power(s, 0, 0), "swap")
	eq(s["hole"][0], [Cards.card("As"), top], "low card replaced from the deck")
	eq(s["powers"][0], [], "power spent")
	ok(not s["deck"].has(top), "card left the deck")
	return true

func t_power_guard_keeps_half_at_showdown() -> bool:
	var s := rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h")
	s["powers"][0] = ["guard"]
	Game.use_power(s, 0, 0)
	Game.act(s, 0, "raise", 200)
	Game.act(s, 1, "call")
	check_down(s)
	Game.settle(s)
	eq(s["result"]["winner"], 1, "aces win")
	eq(s["stack"], [700, 900], "loser keeps half of the 200")
	ok(s["result"]["guarded"], "result records the guard")
	return true

func t_power_guard_does_not_cover_a_fold() -> bool:
	var s := rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h")
	s["powers"][0] = ["guard"]
	Game.use_power(s, 0, 0)
	Game.act(s, 0, "raise", 200)
	Game.act(s, 1, "raise", 600)
	Game.act(s, 0, "fold")
	Game.settle(s)
	eq(s["stack"], [600, 1000], "a fold loses everything bet")
	return true

func t_power_overdrive_and_fever_multiply() -> bool:
	var base := rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h")
	check_down(base)
	base["star_pot"] = 0
	Game.settle(base)
	var plain: int = base["result"]["points"]
	eq(plain, 20 + 100, "pot won plus pair bonus")
	var s := rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h")
	s["powers"][0] = ["over"]
	Game.use_power(s, 0, 0)
	s["fever"] = true
	check_down(s)
	s["star_pot"] = 0
	Game.settle(s)
	eq(s["result"]["points"], plain * 6, "overdrive x2 and fever x3")
	eq(s["score"], plain * 6, "score counts it")
	return true

func t_power_sight_shows_next_card() -> bool:
	var s := rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h")
	s["powers"][0] = ["sight", "sight"]
	Game.use_power(s, 0, 0)
	eq(Game.known_board(s, 0), [Cards.card("Qs")], "first flop card known")
	eq(Game.known_board(s, 1), [], "rival knows nothing")
	ok(not Game.can_use(s, 0, "sight"), "one look per card")
	check_down(s)
	eq(s["street"], 3, "river")
	ok(not Game.can_use(s, 0, "sight") or s["phase"] != "bet", "no card left to see on the river")
	return true

func t_power_glare_blocks_raise_for_the_round() -> bool:
	var s := rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h")
	s["powers"][1] = ["glare"]
	Game.act(s, 0, "call")
	ok(Game.use_power(s, 1, 0), "rival glares")
	Game.act(s, 1, "raise", 80)
	eq(Game.raise_options(s, 0), [], "player cannot raise")
	Game.act(s, 0, "raise", 300)
	eq(s["total"], [80, 80], "a raise becomes a call")
	Game.advance(s)
	Game.act(s, 1, "call")
	ok(Game.raise_options(s, 0).size() > 0, "next round is free again")
	return true

func t_glared_rival_folds_to_a_bet_unless_strong() -> bool:
	var folds := 0
	for seed_value in 30:
		var s := rig("As Kd", "9h 8c", "Qs 5s 3d 4c 2h", seed_value + 1)
		s["rival"] = "goro"
		Game.act(s, 0, "call")
		Game.act(s, 1, "call")
		Game.advance(s)
		Game.act(s, 1, "call")
		s["powers"][0] = ["glare"]
		Game.use_power(s, 0, 0)
		Game.act(s, 0, "raise", 40)
		Ai.play(s, 1)
		ok(s["bet"][1] <= 40, "a glared rival never raises")
		if s["folded"] == 1:
			folds += 1
	ok(folds >= 24, "nine-high should usually fold under the glare: %d/30" % folds)
	return true

func t_powers_only_on_your_turn_and_capped() -> bool:
	var s := rig("As Kd", "7h 2c", "Qs Js 3d 4c 8h")
	s["powers"][1] = ["hawk"]
	ok(not Game.use_power(s, 1, 0), "not the rival's turn")
	s["powers"][0] = ["hawk", "swap", "guard"]
	eq(Game._grant_power(s, 0), "", "no fourth power")
	ok(not Game.use_power(s, 0, 5), "bad slot")
	return true

func t_showdown_win_grants_a_power() -> bool:
	var s := rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h")
	check_down(s)
	Game.settle(s)
	ok(s["result"]["power"] != "", "power granted")
	eq(s["powers"][0].size(), 1, "inventory grew")
	return true

# ---- bonus points ---------------------------------------------------------------

func mission_points(id: String, hole0: String, board: String, how: String) -> int:
	var s := rig(hole0, "7h 2c", board)
	for m in Data.MISSIONS:
		if m[0] == id:
			s["mission"] = {"id": id, "text": m[1], "points": m[2], "suit": 1}
	if how == "fold":
		Game.act(s, 0, "raise", 60)
		Game.act(s, 1, "fold")
	elif how == "allin":
		Game.act(s, 0, "raise", 800)
		Game.act(s, 1, "call")
		check_down(s)
	else:
		check_down(s)
	Game.settle(s)
	for line in s["result"]["lines"]:
		if line[0] == "BONUS MISSION":
			return line[1]
	return 0

func t_missions() -> bool:
	eq(mission_points("win", "As Kd", "Ah Js 3d 4c 8h", "show"), 200, "win")
	eq(mission_points("pair", "As Kd", "Ah Js 3d 4c 8h", "show"), 300, "pair at showdown")
	eq(mission_points("pair", "As Kd", "Qh Js 3d 4c 8h", "fold"), 0, "ace high is no pair")
	eq(mission_points("pair", "As Ad", "Qh Js 3d 4c 8h", "fold"), 300, "pocket pair counts on a fold win")
	eq(mission_points("twopair", "As Kd", "Ah Ks 3d 4c 8h", "show"), 800, "two pair")
	eq(mission_points("twopair", "As Kd", "Ah Js 3d 4c 8h", "show"), 0, "one pair is not enough")
	eq(mission_points("bluff", "As Kd", "Ah Js 3d 4c 8h", "fold"), 400, "no showdown")
	eq(mission_points("bluff", "As Kd", "Ah Js 3d 4c 8h", "show"), 0, "showdown")
	eq(mission_points("suit", "Ah Kh", "As Jh 3d 4c 8h", "show"), 4 * 150, "four hearts")
	eq(mission_points("allin", "As Ad", "Qh Js 3d 4c 8h", "allin"), 1500, "all-in win")
	eq(mission_points("allin", "As Ad", "Qh Js 3d 4c 8h", "show"), 0, "no all-in")
	eq(mission_points("big", "As Ad", "Qh Js 3d 4c 8h", "allin"), 600, "big pot")
	eq(mission_points("big", "As Ad", "Qh Js 3d 4c 8h", "show"), 0, "small pot")
	eq(mission_points("pure", "As Ad", "Qh Js 3d 4c 8h", "show"), 350, "no power used")
	return true

func t_no_points_for_losing() -> bool:
	var s := rig("7s 2d", "As Ad", "Qs Js 3d 4c 8h")
	s["mission"] = {"id": "win", "text": "", "points": 200, "suit": -1}
	s["star_pot"] = 500
	check_down(s)
	Game.settle(s)
	eq(s["result"]["points"], 0, "loser scores nothing")
	eq(s["score"], 0, "score unchanged")
	return true

func t_mission_is_random_and_always_set() -> bool:
	var seen := {}
	var s := Game.new_run(9, "rin")
	for _i in 300:
		Game.start_hand(s)
		ok(not s["mission"].is_empty(), "mission missing")
		ok(s["mission"]["text"].length() <= 34, "mission text too long: " + s["mission"]["text"])
		seen[s["mission"]["id"]] = true
		s["stack"] = [800, 800]
	eq(seen.size(), Data.MISSIONS.size(), "every mission comes up")
	return true

func t_star_cards_fill_the_star_pot() -> bool:
	var stars := 0
	var hands := 0
	var powers := 0
	var values := {}
	for seed_value in 400:
		var s := rig("As Kd", "7h 2c", "Ah Js 3d 4c 8h", seed_value + 1)
		check_down(s)
		hands += 1
		var sum := 0
		for idx in s["stars"]:
			ok(idx >= 0 and idx < 5, "star on a real board card")
			sum += s["stars"][idx]
			values[s["stars"][idx]] = true
			stars += 1
		eq(s["star_pot"], sum, "star pot adds up")
		for e in s["events"]:
			if e["t"] == "star" and e["value"] == 777:
				ok(e["power"] != "", "777 grants a power")
				powers += 1
		Game.settle(s)
		if sum > 0:
			var found := false
			for line in s["result"]["lines"]:
				if line[0] == "STAR CARDS":
					found = line[1] == sum
			ok(found, "star points paid to the winner")
	var rate := float(stars) / float(hands * 5)
	ok(rate > 0.10 and rate < 0.20, "about 15%% of board cards sparkle: %.3f" % rate)
	ok(values.size() >= 5, "star values vary: " + str(values.keys()))
	ok(powers >= 1, "a 777 came up")
	return true

func t_fever_comes_and_goes() -> bool:
	var s := Game.new_run(4, "rin")
	var fevers := 0
	for i in 500:
		Game.start_hand(s)
		if i == 0:
			ok(not s["fever"], "never on the first hand")
		if s["fever"]:
			fevers += 1
		s["stack"] = [800, 800]
		s["powers"][0] = []
	ok(fevers > 30 and fevers < 95, "about 12%% of hands: %d/500" % fevers)
	return true

# ---- run flow -------------------------------------------------------------------

func t_match_ladder_and_continue() -> bool:
	var s := Game.new_run(2, "rin")
	eq(s["rival"], "pochi", "first rival")
	eq(s["powers"][0].size(), 2, "two starting powers")
	s["score"] = 1000
	s["stack"] = [0, 1600]
	s["phase"] = "match_over"
	s["winner"] = 1
	Game.continue_run(s)
	eq(s["score"], 500, "continue halves the score")
	eq(s["rival"], "pochi", "same rival again")
	eq(s["stack"], [800, 800], "fresh stacks")
	for i in Data.RIVALS.size():
		eq(s["rival"], Data.RIVALS[i], "ladder order")
		var want: int = 500 if i % 2 == 1 else 800
		eq(s["stack"], [want, want], "stack for " + s["rival"])
		eq(s["powers"][1], Data.CAST[s["rival"]]["powers"], "rival powers set")
		s["phase"] = "match_over"
		s["winner"] = 0
		Game.next_match(s)
	eq(s["phase"], "run_won", "nine wins end the run")
	return true

func t_match_bonus_scales() -> bool:
	var s := rig("As Ad", "Ks Kd", "2h 7c 9d Jc 3s")
	s["match"] = 2
	Game.act(s, 0, "raise", 800)
	Game.act(s, 1, "call")
	check_down(s)
	Game.settle(s)
	eq(s["result"]["match_bonus"], 6000, "third match pays 3 x 2000")
	return true

func t_rivals_play_differently() -> bool:
	var raised := {}
	for rival in ["pochi", "goro"]:
		raised[rival] = 0
		for seed_value in 120:
			var s := Game.new_run(seed_value + 1, "rin")
			s["rival"] = rival
			s["powers"][1] = []
			Game.start_hand(s)
			Game.start_hand(s)
			Ai.play(s, 1)
			if s["bet"][1] > 20:
				raised[rival] += 1
	ok(raised["goro"] > raised["pochi"] * 2, "the biker opens far more than the rookie: " + str(raised))
	return true

func t_ladder_story() -> bool:
	eq(Data.RIVALS.size(), 9, "five floors and four mini-bosses")
	for i in Data.RIVALS.size():
		var c: Dictionary = Data.CAST[Data.RIVALS[i]]
		eq(c.get("mini", false), i % 2 == 1, "mini-bosses sit between floors")
		ok(c.has("lore") and c["lore"].size() > 0, "lore for " + Data.RIVALS[i])
		ok(c["room"] >= 1 and c["room"] <= 5, "room for " + Data.RIVALS[i])
		ok(Data.episode_label(i).length() <= 32, "episode label fits: " + Data.episode_label(i))
	eq(Data.episode_label(0), "EPISODE 1: THE LOBBY PIT", "first episode")
	eq(Data.episode_label(1), "INTERLUDE: THE STAIRWELL", "first interlude")
	eq(Data.episode_label(8), "EPISODE 5: THE STARLIGHT TABLE", "final episode")
	return true

## Every story page, after the game splits long ones, fits the 5-line box; every rival
## line fits the speech bubble and the match-end panel.
func t_story_pages_fit() -> bool:
	var M = load("res://scripts/main.gd")
	var all := [Data.STORY_OPEN, Data.STORY_BOSS, Data.STORY_END]
	for id in Data.RIVALS:
		var c: Dictionary = Data.CAST[id]
		all.append(c.get("lore", []) + c["intro"])
		all.append(c["beaten"])
		for line in c["gloat"]:
			ok(M.wrap_lines(line, 46).size() <= 4, "gloat too long for the panel: " + line)
		for k in ["win", "lose", "allin"]:
			for line in c[k]:
				ok(M.wrap_lines(line, 38).size() <= 3, "bubble too long: " + line)
	for list in all:
		for page in M.split_pages(list):
			var lines: Array = M.wrap_lines(page, M.PAGE_CHARS)
			ok(lines.size() <= M.PAGE_LINES, "page runs past its box: " + page)
			for line in lines:
				ok(line.length() <= M.PAGE_CHARS, "line too wide: " + line)
	var long_text := "word ".repeat(200).strip_edges()
	ok(M.split_pages([long_text]).size() > 1, "a long page is split, not cut off")
	return true

func t_text_lengths() -> bool:
	for id in Data.CAST:
		ok(Data.CAST[id]["name"].length() <= 20, "name too long: " + id)
		ok(Data.CAST[id]["title"].length() <= 18, "title too long: " + id)
		ok(Data.CAST[id]["shout"].length() <= 24, "shout too long: " + id)
	for id in Data.POWERS:
		ok(Data.POWERS[id]["name"].length() <= 12, "power name too long: " + id)
		ok(Data.POWERS[id]["desc"].length() <= 40, "power text too long: " + id)
	for id in Data.RIVALS:
		for k in ["intro", "win", "lose", "allin", "beaten", "gloat"]:
			ok(Data.CAST[id].has(k) and Data.CAST[id][k].size() > 0, "%s has no %s line" % [id, k])
	return true

