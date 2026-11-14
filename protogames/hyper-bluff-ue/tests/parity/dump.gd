extends SceneTree
## Parity dump for the C++ port (hyper-bluff-ue). Plays bot runs with the Godot rules and
## writes one canonical line per step; parity_dump.cpp writes the same lines from the C++
## core and run_core_tests.sh diffs them. Keep the two files in step.
##
## Run: godot --headless --path hyper-bluff/godot --script /abs/path/dump.gd
## Environment: PARITY_MODE (runs | eval | data), PARITY_SHARD, PARITY_SHARDS, PARITY_SEEDS,
## PARITY_EVALS, PARITY_OUT (output file).

const Cards = preload("res://scripts/core/cards.gd")
const Data = preload("res://scripts/core/data.gd")
const Game = preload("res://scripts/core/game.gd")
const Ai = preload("res://scripts/core/ai.gd")

const MAX_ENDS := 2      # a capped run stops at its third match_over
const FULL_EVERY := 25   # seeds divisible by this play start 0 to the end, uncapped
const MAX_STEPS := 20000

var f: FileAccess

func _initialize() -> void:
	var mode := OS.get_environment("PARITY_MODE")
	var shard := int(OS.get_environment("PARITY_SHARD"))
	var shards := maxi(int(OS.get_environment("PARITY_SHARDS")), 1)
	f = FileAccess.open(OS.get_environment("PARITY_OUT"), FileAccess.WRITE)
	if f == null:
		printerr("cannot open PARITY_OUT")
		quit(2)
		return
	match mode:
		"runs":
			var seeds := int(OS.get_environment("PARITY_SEEDS"))
			for seed_value in range(1, seeds + 1):
				if (seed_value - 1) % shards != shard:
					continue
				for start in 5:
					play(seed_value, start)
		"eval":
			evals(shard, int(OS.get_environment("PARITY_EVALS")) / shards)
		"data":
			dump_data()
	f.close()
	quit(0)

func b01(v: bool) -> String:
	return "1" if v else "0"

func ints(a: Array) -> String:
	var parts := PackedStringArray()
	for x in a:
		parts.append(str(x))
	return ",".join(parts)

func labels(a: Array) -> String:
	if a.is_empty():
		return "-"
	var parts := PackedStringArray()
	for c in a:
		parts.append(Cards.label(c))
	return ",".join(parts)

func names(a: Array) -> String:
	if a.is_empty():
		return "-"
	return ",".join(PackedStringArray(a))

func pw(p: String) -> String:
	return "-" if p == "" else p

func events(s: Dictionary) -> String:
	var parts := PackedStringArray()
	for e in s["events"]:
		match e["t"]:
			"hand":
				parts.append("hand")
			"fever":
				parts.append("fever:" + pw(e["power"]))
			"act":
				parts.append("act:%s:%s:%s" % [str(e["who"]), e["a"], str(e["amt"])])
			"star":
				parts.append("star:%s:%s:%s" % [str(e["idx"]), str(e["value"]), pw(e["power"])])
			"street":
				parts.append("street:" + str(e["n"]))
			"power":
				parts.append("power:%s:%s" % [str(e["who"]), e["id"]])
			"settle":
				parts.append("settle:" + str(e["winner"]))
	if parts.is_empty():
		return "-"
	return ";".join(parts)

func stars(s: Dictionary) -> String:
	var parts := PackedStringArray()
	for idx in s["stars"]:
		parts.append(str(idx) + ":" + str(s["stars"][idx]))
	if parts.is_empty():
		return "-"
	return ";".join(parts)

func mission(s: Dictionary) -> String:
	var m: Dictionary = s["mission"]
	if m.is_empty():
		return "-"
	return "%s:%s:%s:%s" % [m["id"], str(m["suit"]), str(m["points"]), m["text"]]

func fx(s: Dictionary) -> String:
	var x: Dictionary = s["fx"]
	return "pk=%s/%s g=%s,%s o=%s,%s si=%s gl=%s u=%s ps=%s" % [ints(x["peek"][0]), ints(x["peek"][1]),
		b01(x["guard"][0]), b01(x["guard"][1]), b01(x["over"][0]), b01(x["over"][1]),
		ints(x["sight"]), ints(x["glare"]), ints(x["used"]), ints(x["pstreet"])]

func state(s: Dictionary) -> String:
	return "ph=%s st=%s ta=%s stk=%s bet=%s tot=%s brd=%s stars=%s sp=%s fev=%s mis=%s sc=%s m=%s r=%s c=%s pw=%s|%s %s rng=%s,%s,%s ev=%s" % [
		s["phase"], str(s.get("street", 0)), str(s.get("to_act", 0)), ints(s["stack"]), ints(s["bet"]),
		ints(s["total"]), labels(s["board"]), stars(s), str(s["star_pot"]), b01(s["fever"]), mission(s),
		str(s["score"]), str(s["match"]), s["rival"], str(s["continues"]), names(s["powers"][0]),
		names(s["powers"][1]), fx(s), str(s["rng_deck"]), str(s["rng_ai"]), str(s["rng_bonus"]), events(s)]

func eq_text(r: Array) -> String:
	return str(r[0]) + "/" + str(r[1])

func deal_info(s: Dictionary, seed_value: int, start: int) -> String:
	var box := {"k": seed_value * 7919 + s["hand_no"] * 31 + start}
	var e0 := Cards.equity_batch(s["hole"][0], [], [], [], 50, box, "k")
	var e1 := Cards.equity_batch(s["hole"][1], s["runout"].slice(0, 3), [s["hole"][0][0]], [s["deck"][0]], 50, box, "k")
	return " | hole=%s|%s run=%s deck=%s:%s blind=%s btn=%s hand=%s al=%s eq=%s,%s,%s" % [labels(s["hole"][0]),
		labels(s["hole"][1]), labels(s["runout"]), str(s["deck"].size()), labels(s["deck"].slice(-3)), ints(s["blind"]),
		str(s["button"]), str(s["hand_no"]), b01(s["allin_seen"]), eq_text(e0), eq_text(e1), str(box["k"])]

func result_info(s: Dictionary, seed_value: int) -> String:
	var r: Dictionary = s["result"]
	var parts := PackedStringArray()
	for line in r["lines"]:
		parts.append(line[0] + "=" + str(line[1]))
	var box := {"k": seed_value * 104729 + s["hand_no"]}
	var e := Cards.equity_batch(s["hole"][0], s["board"], [], [], 40, box, "k")
	return " | res=%s,%s,%s vals=%s pay=%s pts=%s pwr=%s gd=%s mb=%s w=%s lines=%s name=%s/%s eq=%s" % [
		str(r["pot"]), b01(r["showdown"]), str(r["winner"]), ints(r["vals"]), ints(r["pay"]), str(r["points"]),
		pw(r["power"]), b01(r["guarded"]), str(r["match_bonus"]), str(s["winner"]), ";".join(parts),
		Cards.name_of(r["vals"][0]), Cards.name_of(r["vals"][1]), eq_text(e)]

func play(seed_value: int, start: int) -> void:
	var s := Game.new_run(seed_value, Data.AVATARS[seed_value % 4])
	s["bot"] = Ai.DEFAULT
	if start > 0:
		s["match"] = start
		Game.start_match(s)
	var full := start == 0 and seed_value % FULL_EVERY == 0
	f.store_line("RUN %d %d full=%s" % [seed_value, start, b01(full)])
	f.store_line("init " + state(s))
	var steps := 0
	var ends := 0
	while s["phase"] != "run_won" and steps < MAX_STEPS:
		if s["phase"] == "match_over" and not full and ends >= MAX_ENDS:
			break
		s["events"] = []
		var ph: String = s["phase"]
		var extra := ""
		match ph:
			"pre", "hand_over":
				Game.start_hand(s)
				extra = deal_info(s, seed_value, start)
			"bet":
				# ai.gd never picks Overdrive; seat 0 fires it when it can so the x2 path is compared.
				var slot: int = s["powers"][0].find("over")
				if s["to_act"] == 0 and slot >= 0 and Game.can_use(s, 0, "over"):
					Game.use_power(s, 0, slot)
				Ai.play(s, s["to_act"])
			"advance":
				Game.advance(s)
			"showdown":
				Game.settle(s)
				extra = result_info(s, seed_value)
			"match_over":
				ends += 1
				if s["winner"] == 0:
					Game.next_match(s)
				else:
					Game.continue_run(s)
		steps += 1
		f.store_line(ph + " " + state(s) + extra)
	f.store_line("END %d %d steps=%d ends=%d phase=%s score=%s" % [seed_value, start, steps, ends, s["phase"], str(s["score"])])

func evals(shard: int, count: int) -> void:
	var box := {"k": 1000 + shard}
	var perm := []
	for c in 52:
		perm.append(c)
	var h := 17
	var cats := [0, 0, 0, 0, 0, 0, 0, 0, 0]
	for i in count:
		var size := 5 + Cards.roll(box, "k", 3)
		for j in size:
			var k := j + Cards.roll(box, "k", 52 - j)
			var t = perm[j]
			perm[j] = perm[k]
			perm[k] = t
		var hand := perm.slice(0, size)
		var v := Cards.eval(hand)
		cats[v >> 20] += 1
		h = h * 1000003 + v
		if i % 499 == 0:
			f.store_line("N %d %s %d %s" % [i, labels(hand), v, Cards.name_of(v)])
		if (i + 1) % 100000 == 0:
			f.store_line("H %d %s" % [i, str(h)])
	f.store_line("C %s" % ints(cats))
	f.store_line("H end %s" % str(h))
	# Every 2- to 4-card set kind the meter can show early in a hand.
	for n: int in [2, 3, 4]:
		var h2 := 5
		for i in 20000:
			for j in n:
				var k := j + Cards.roll(box, "k", 52 - j)
				var t = perm[j]
				perm[j] = perm[k]
				perm[k] = t
			var v := Cards.eval(perm.slice(0, n))
			h2 = h2 * 1000003 + v
			if i % 997 == 0:
				f.store_line("S %d %d %s" % [n, v, Cards.name_of(v)])
		f.store_line("HS %d %s" % [n, str(h2)])

func dump_data() -> void:
	f.store_line("AVATARS " + ",".join(PackedStringArray(Data.AVATARS)))
	f.store_line("RIVALS " + ",".join(PackedStringArray(Data.RIVALS)))
	f.store_line("EXPR " + ",".join(PackedStringArray(Data.EXPR)))
	for id in Data.CAST:
		var c: Dictionary = Data.CAST[id]
		f.store_line("CAST %s|%s|%s|%s|%s" % [id, c["name"], c["title"], c["shout"], c.get("blurb", "")])
		if c.has("loose"):
			f.store_line("PROF %s %d %d %d %s" % [id, roundi(c["loose"] * 1000000.0), roundi(c["aggr"] * 1000000.0),
				roundi(c["bluff"] * 1000000.0), names(c["powers"])])
			for k in ["intro", "win", "lose", "allin", "beaten", "gloat"]:
				for line in c[k]:
					f.store_line("LINE %s %s %s" % [id, k, line])
	for id in Data.POWER_IDS:
		f.store_line("POWER %s|%s|%s" % [id, Data.POWERS[id]["name"], Data.POWERS[id]["desc"]])
	for m in Data.MISSIONS:
		f.store_line("MISSION %s|%s|%d|%d" % [m[0], m[1], m[2], m[3]])
	f.store_line("SUITS " + ",".join(PackedStringArray(Data.SUIT_NAME)))
	for line in Data.STORY_OPEN:
		f.store_line("OPEN " + line)
	for line in Data.STORY_BOSS:
		f.store_line("BOSS " + line)
	for line in Data.STORY_END:
		f.store_line("END " + line)
	for line in Data.CREDITS:
		f.store_line("CREDIT " + line)
	f.store_line("BLINDS " + str(Game.BLINDS))
	f.store_line("CONST %d %d %d %s %d %s %s %d %d %d %d %d" % [Game.START_STACK, Game.HANDS_PER_LEVEL, Game.MAX_POWERS,
		ints(Game.HAND_POINTS), Game.ROYAL_POINTS, ints(Game.STAR_VALUES), ints(Game.STAR_WEIGHTS), Game.STAR_CHANCE,
		Game.STAR_CHANCE_FEVER, Game.FEVER_CHANCE, Game.MATCH_BONUS, Ai.SAMPLES])
	f.store_line("DEFAULT %d %d %d" % [roundi(Ai.DEFAULT["loose"] * 1000000.0), roundi(Ai.DEFAULT["aggr"] * 1000000.0),
		roundi(Ai.DEFAULT["bluff"] * 1000000.0)])
