extends RefCounted
## Heads-up no-limit hold'em with spirit powers, bonus missions, star cards and fever
## hands. Pure rules: the whole game is one Dictionary `s`, so it can be saved with
## var_to_str and replayed from a seed. Seat 0 is the player, seat 1 the rival.
##
## Phases: "pre" (call start_hand) -> "bet" (call act / use_power for s.to_act)
## -> "advance" (call advance: deals the next street) -> "showdown" (call settle)
## -> "hand_over" (call start_hand) or "match_over" (call next_match / continue_run)
## -> "run_won" after the last rival.

const Cards = preload("res://scripts/core/cards.gd")
const Data = preload("res://scripts/core/data.gd")

const START_STACK := 800
const BLINDS := [[10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300], [200, 400]]
const HANDS_PER_LEVEL := 3
const MAX_POWERS := 3
const HAND_POINTS := [0, 100, 250, 500, 1000, 1500, 2500, 5000, 10000]
const ROYAL_POINTS := 25000
const STAR_VALUES := [100, 200, 300, 500, 777, 1000]
const STAR_WEIGHTS := [30, 25, 20, 15, 7, 3]
const STAR_CHANCE := 15
const STAR_CHANCE_FEVER := 40
const FEVER_CHANCE := 12
const MATCH_BONUS := 2000

static func new_run(seed_value: int, avatar: String) -> Dictionary:
	var s := {
		"seed": seed_value,
		"rng_deck": seed_value * 2654435761 + 1,
		"rng_ai": seed_value * 40503 + 7,
		"rng_bonus": seed_value * 69069 + 3,
		"avatar": avatar, "match": 0, "score": 0, "continues": 0,
		"powers": [[], []], "events": [],
	}
	for _i in 2:
		_grant_power(s, 0)
	start_match(s)
	return s

static func start_match(s: Dictionary) -> void:
	s["rival"] = Data.RIVALS[s["match"]]
	var start: int = Data.CAST[s["rival"]].get("stack", START_STACK)
	s["stack"] = [start, start]
	s["hand_no"] = 0
	s["button"] = 1
	s["powers"][1] = Data.CAST[s["rival"]]["powers"].duplicate()
	s["phase"] = "pre"
	s["winner"] = -1
	s["result"] = {}
	s["board"] = []
	s["hole"] = [[], []]
	s["bet"] = [0, 0]
	s["total"] = [0, 0]
	s["fever"] = false
	s["mission"] = {}
	s["stars"] = {}
	s["star_pot"] = 0
	s["events"] = []
	_new_fx(s)

static func _new_fx(s: Dictionary) -> void:
	s["fx"] = {"peek": [[], []], "guard": [false, false], "over": [false, false],
		"sight": [0, 0], "glare": [-1, -1], "used": [0, 0], "pstreet": [-1, -1]}

static func pot(s: Dictionary) -> int:
	return s["total"][0] + s["total"][1] + s["bet"][0] + s["bet"][1]

static func blind_level(s: Dictionary) -> int:
	return mini(maxi(s["hand_no"] - 1, 0) / HANDS_PER_LEVEL, BLINDS.size() - 1)

static func _put(s: Dictionary, who: int, amount: int) -> void:
	amount = mini(amount, s["stack"][who])
	s["stack"][who] -= amount
	s["bet"][who] += amount

static func _grant_power(s: Dictionary, who: int) -> String:
	if s["powers"][who].size() >= MAX_POWERS:
		return ""
	var id: String = Data.POWER_IDS[Cards.roll(s, "rng_bonus", Data.POWER_IDS.size())]
	s["powers"][who].append(id)
	return id

static func _pick_mission(s: Dictionary) -> Dictionary:
	var total := 0
	for m in Data.MISSIONS:
		total += m[3]
	var r := Cards.roll(s, "rng_bonus", total)
	for m in Data.MISSIONS:
		r -= m[3]
		if r < 0:
			var out := {"id": m[0], "text": m[1], "points": m[2], "suit": -1}
			if m[0] == "suit":
				out["suit"] = Cards.roll(s, "rng_bonus", 4)
				out["text"] = "LUCKY " + Data.SUIT_NAME[out["suit"]] + ": 150 EACH ON A WIN"
			return out
	return {}

static func start_hand(s: Dictionary) -> void:
	s["hand_no"] += 1
	s["button"] = 1 - s["button"]
	s["blind"] = BLINDS[blind_level(s)]
	var deck := []
	for c in 52:
		deck.append(c)
	for i in range(51, 0, -1):
		var j := Cards.roll(s, "rng_deck", i + 1)
		var t = deck[i]
		deck[i] = deck[j]
		deck[j] = t
	s["hole"] = [[deck[0], deck[2]], [deck[1], deck[3]]]
	s["runout"] = deck.slice(4, 9)
	s["deck"] = deck.slice(9)
	s["board"] = []
	s["street"] = 0
	s["bet"] = [0, 0]
	s["total"] = [0, 0]
	s["acted"] = [false, false]
	s["folded"] = -1
	s["stars"] = {}
	s["star_pot"] = 0
	s["result"] = {}
	s["events"] = []
	_new_fx(s)
	s["fever"] = s["hand_no"] > 1 and Cards.roll(s, "rng_bonus", 100) < FEVER_CHANCE
	s["mission"] = _pick_mission(s)
	s["allin_seen"] = false
	var b: int = s["button"]
	_put(s, b, s["blind"][0])
	_put(s, 1 - b, s["blind"][1])
	s["last_raise"] = s["blind"][1]
	s["to_act"] = b
	s["phase"] = "bet"
	s["events"].append({"t": "hand"})
	if s["fever"]:
		var got := _grant_power(s, 0)
		s["events"].append({"t": "fever", "power": got})
	if _round_done(s):
		_close_round(s)

static func _round_done(s: Dictionary) -> bool:
	if s["folded"] >= 0:
		return true
	for i in 2:
		var o := 1 - i
		if s["stack"][i] == 0:
			if s["bet"][o] >= s["bet"][i] or s["stack"][o] == 0:
				return true
	return s["acted"][0] and s["acted"][1] and s["bet"][0] == s["bet"][1]

static func _close_round(s: Dictionary) -> void:
	if s["folded"] < 0:
		var d: int = s["bet"][0] - s["bet"][1]
		if d > 0:
			s["bet"][0] -= d
			s["stack"][0] += d
		elif d < 0:
			s["bet"][1] += d
			s["stack"][1] -= d
	s["total"][0] += s["bet"][0]
	s["total"][1] += s["bet"][1]
	s["bet"] = [0, 0]
	if s["stack"][0] == 0 or s["stack"][1] == 0:
		s["allin_seen"] = true
	if s["folded"] >= 0 or s["street"] == 3:
		s["phase"] = "showdown"
	else:
		s["phase"] = "advance"

static func to_call(s: Dictionary, who: int) -> int:
	return maxi(s["bet"][0], s["bet"][1]) - s["bet"][who]

static func max_raise_to(s: Dictionary, who: int) -> int:
	var o := 1 - who
	return mini(s["bet"][who] + s["stack"][who], s["bet"][o] + s["stack"][o])

static func min_raise_to(s: Dictionary, who: int) -> int:
	var cur := maxi(s["bet"][0], s["bet"][1])
	return mini(cur + maxi(s["last_raise"], s["blind"][1]), max_raise_to(s, who))

static func can_raise(s: Dictionary, who: int) -> bool:
	if s["phase"] != "bet" or s["fx"]["glare"][1 - who] == s["street"]:
		return false
	return max_raise_to(s, who) > maxi(s["bet"][0], s["bet"][1])

## Legal raise-to amounts offered by the buttons: minimum, half pot, pot, two pots, all-in.
static func raise_options(s: Dictionary, who: int) -> Array:
	if not can_raise(s, who):
		return []
	var cur := maxi(s["bet"][0], s["bet"][1])
	var lo := min_raise_to(s, who)
	var hi := max_raise_to(s, who)
	var p := pot(s) + to_call(s, who)
	var out := [lo]
	for num in [1, 2, 4]:
		var x: int = cur + (p * num) / 2
		x -= x % 5
		if x > lo and x < hi:
			out.append(x)
	if hi > lo:
		out.append(hi)
	return out

## a is "fold", "call" (also a check) or "raise" with amount = the new street bet.
static func act(s: Dictionary, who: int, a: String, amount: int = 0) -> void:
	if s["phase"] != "bet" or s["to_act"] != who:
		return
	var o := 1 - who
	var cur := maxi(s["bet"][0], s["bet"][1])
	var need: int = cur - s["bet"][who]
	var shown := a
	if a == "raise" and not can_raise(s, who):
		a = "call"
	if a == "fold" and need == 0:
		a = "call"
	match a:
		"fold":
			s["folded"] = who
			shown = "fold"
		"call":
			_put(s, who, need)
			s["acted"][who] = true
			shown = "check" if need == 0 else "call"
			if need > 0 and s["stack"][who] == 0:
				shown = "allin"
		"raise":
			var lo := min_raise_to(s, who)
			var hi := max_raise_to(s, who)
			amount = clampi(amount, lo, hi)
			var inc := amount - cur
			if inc >= s["last_raise"]:
				s["last_raise"] = inc
			_put(s, who, amount - s["bet"][who])
			s["acted"][who] = true
			s["acted"][o] = false
			shown = "bet" if cur == 0 else "raise"
			if s["stack"][who] == 0 or amount == s["bet"][o] + s["stack"][o]:
				shown = "allin"
	s["events"].append({"t": "act", "who": who, "a": shown, "amt": s["bet"][who]})
	if _round_done(s):
		_close_round(s)
	else:
		s["to_act"] = o

## Deal the next street. With a player all-in the phase stays "advance" until the river.
static func advance(s: Dictionary) -> void:
	if s["phase"] != "advance":
		return
	s["street"] += 1
	var n := 3 if s["street"] == 1 else 1
	var chance := STAR_CHANCE_FEVER if s["fever"] else STAR_CHANCE
	for _i in n:
		var idx: int = s["board"].size()
		s["board"].append(s["runout"][idx])
		if Cards.roll(s, "rng_bonus", 100) < chance:
			var total := 0
			for w in STAR_WEIGHTS:
				total += w
			var r := Cards.roll(s, "rng_bonus", total)
			var k := 0
			while r >= STAR_WEIGHTS[k]:
				r -= STAR_WEIGHTS[k]
				k += 1
			var value: int = STAR_VALUES[k]
			s["stars"][idx] = value
			s["star_pot"] += value
			var got := ""
			if value == 777:
				got = _grant_power(s, 0)
			s["events"].append({"t": "star", "idx": idx, "value": value, "power": got})
	s["events"].append({"t": "street", "n": s["street"]})
	s["acted"] = [false, false]
	s["last_raise"] = s["blind"][1]
	s["to_act"] = 1 - s["button"]
	if s["stack"][0] == 0 or s["stack"][1] == 0:
		s["phase"] = "showdown" if s["street"] == 3 else "advance"
	else:
		s["phase"] = "bet"

static func _mission_points(s: Dictionary, showdown: bool, cat: int, pot_size: int) -> int:
	var m: Dictionary = s["mission"]
	if m.is_empty():
		return 0
	match m["id"]:
		"win":
			return m["points"]
		"pair":
			return m["points"] if cat >= 1 else 0
		"twopair":
			return m["points"] if showdown and cat >= 2 else 0
		"bluff":
			return 0 if showdown else m["points"]
		"suit":
			var n := 0
			for c in s["hole"][0] + s["board"]:
				if Cards.suit(c) == m["suit"]:
					n += 1
			return n * m["points"]
		"allin":
			return m["points"] if s["allin_seen"] else 0
		"big":
			return m["points"] if pot_size >= 10 * s["blind"][1] else 0
		"pure":
			return m["points"] if s["fx"]["used"][0] == 0 else 0
	return 0

## Pay the pot, score the hand for the player and decide whether the match is over.
static func settle(s: Dictionary) -> void:
	if s["phase"] != "showdown":
		return
	var pot_size: int = s["total"][0] + s["total"][1]
	var showdown: bool = s["folded"] < 0
	var vals := [Cards.eval(s["hole"][0] + s["board"]), Cards.eval(s["hole"][1] + s["board"])]
	var w := -1
	if not showdown:
		w = 1 - s["folded"]
	elif vals[0] > vals[1]:
		w = 0
	elif vals[1] > vals[0]:
		w = 1
	var pay := [0, 0]
	var guarded := false
	if w < 0:
		pay[0] = pot_size / 2
		pay[1] = pot_size / 2
		pay[1 - s["button"]] += pot_size % 2
	else:
		var loser := 1 - w
		var refund := 0
		if showdown and s["fx"]["guard"][loser]:
			refund = s["total"][loser] / 2
			guarded = true
		pay[w] = pot_size - refund
		pay[loser] = refund
	s["stack"][0] += pay[0]
	s["stack"][1] += pay[1]
	var paid_in: int = s["total"][0]
	var lines := []
	var points := 0
	var power := ""
	if w == 0 or (w < 0 and showdown):
		var base := maxi(pay[0] - paid_in, 0)
		lines.append(["POT WON", base])
		var sum := base
		if w == 0:
			var cat := Cards.category(vals[0])
			if showdown:
				var hp: int = ROYAL_POINTS if Cards.is_royal(vals[0]) else HAND_POINTS[cat]
				if hp > 0:
					lines.append([Cards.name_of(vals[0]).to_upper(), hp])
					sum += hp
			var mp := _mission_points(s, showdown, cat, pot_size)
			if mp > 0:
				lines.append(["BONUS MISSION", mp])
				sum += mp
			if s["star_pot"] > 0:
				lines.append(["STAR CARDS", s["star_pot"]])
				sum += s["star_pot"]
		var mult := 1
		if s["fx"]["over"][0]:
			mult *= 2
		if s["fever"]:
			mult *= 3
		if mult > 1:
			lines.append(["MULTIPLIER x" + str(mult), sum * (mult - 1)])
		points = sum * mult
		s["score"] += points
		if w == 0 and showdown:
			power = _grant_power(s, 0)
	s["result"] = {"pot": pot_size, "showdown": showdown, "winner": w, "vals": vals, "pay": pay,
		"points": points, "lines": lines, "power": power, "guarded": guarded, "match_bonus": 0}
	s["total"] = [0, 0]
	s["events"].append({"t": "settle", "winner": w})
	if s["stack"][0] == 0 or s["stack"][1] == 0:
		s["phase"] = "match_over"
		s["winner"] = 0 if s["stack"][1] == 0 else 1
		if s["winner"] == 0:
			var bonus: int = MATCH_BONUS * (s["match"] + 1)
			s["score"] += bonus
			s["result"]["match_bonus"] = bonus
	else:
		s["phase"] = "hand_over"

static func next_match(s: Dictionary) -> void:
	if s["phase"] != "match_over" or s["winner"] != 0:
		return
	if s["match"] + 1 >= Data.RIVALS.size():
		s["phase"] = "run_won"
		return
	s["match"] += 1
	start_match(s)

static func continue_run(s: Dictionary) -> void:
	if s["phase"] != "match_over" or s["winner"] != 1:
		return
	s["score"] = s["score"] / 2
	s["continues"] += 1
	if s["powers"][0].is_empty():
		_grant_power(s, 0)
	start_match(s)

# ---- spirit powers -----------------------------------------------------------

static func known_board(s: Dictionary, who: int) -> Array:
	var b: Array = s["board"].duplicate()
	if s["fx"]["sight"][who] > b.size() and b.size() < 5:
		b.append(s["runout"][b.size()])
	return b

static func known_opp(s: Dictionary, who: int) -> Array:
	var out := []
	for i in s["fx"]["peek"][who]:
		out.append(s["hole"][1 - who][i])
	return out

static func can_use(s: Dictionary, who: int, id: String) -> bool:
	if s["phase"] != "bet" or s["to_act"] != who:
		return false
	var fx: Dictionary = s["fx"]
	match id:
		"hawk":
			return fx["peek"][who].size() < 2
		"swap":
			return s["deck"].size() > 0
		"guard":
			return not fx["guard"][who]
		"over":
			return not fx["over"][who]
		"sight":
			return s["street"] < 3 and fx["sight"][who] <= s["board"].size()
		"glare":
			return fx["glare"][who] != s["street"]
	return false

static func use_power(s: Dictionary, who: int, slot: int) -> bool:
	var inv: Array = s["powers"][who]
	if slot < 0 or slot >= inv.size():
		return false
	var id: String = inv[slot]
	if not can_use(s, who, id):
		return false
	var fx: Dictionary = s["fx"]
	var o := 1 - who
	match id:
		"hawk":
			var seen: Array = fx["peek"][who]
			var idx := Cards.roll(s, "rng_bonus", 2)
			if seen.has(idx):
				idx = 1 - idx
			seen.append(idx)
		"swap":
			var h: Array = s["hole"][who]
			var low := 0 if Cards.rank(h[0]) < Cards.rank(h[1]) else 1
			h[low] = s["deck"].pop_back()
			fx["peek"][o].erase(low)
		"guard":
			fx["guard"][who] = true
		"over":
			fx["over"][who] = true
		"sight":
			fx["sight"][who] = s["board"].size() + 1
		"glare":
			fx["glare"][who] = s["street"]
	inv.remove_at(slot)
	fx["used"][who] += 1
	fx["pstreet"][who] = s["street"]
	s["events"].append({"t": "power", "who": who, "id": id})
	return true
