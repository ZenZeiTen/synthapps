extends SceneTree
## Headless core tests. Run:
##   godot --headless --path godot --script res://tests/run_tests.gd --quit-after 100000
## Prints "TESTS n/m passed" as its last line; a missing summary line is a failure.

var passed := 0
var failed := 0


func _init() -> void:
	var tests := [
		"t_levels_parse", "t_stairs_found", "t_walk_and_wall", "t_jump_arc", "t_classic_no_air_control",
		"t_modern_air_control", "t_whip_breaks_candle_and_drops", "t_stair_climb_1_2",
		"t_breakable_wall_hides_roast", "t_pit_kills", "t_hurt_knockback", "t_snapshot_determinism",
		"t_save_load_roundtrip", "t_subweapon_dagger", "t_exit_goes_to_next_block",
		"t_boss_triggers_and_dies", "t_timer_runs_out", "t_all_stages_parse", "t_all_blocks_reachable",
		"t_lint_catches_a_wall", "t_every_boss_fights_and_falls", "t_final_boss_reaches_ending",
		"t_flipped_frames_sample_the_mirror", "t_every_named_animation_exists", "t_whip_reach_by_level",
	]
	for name in tests:
		var ok: bool = call(name)
		if ok:
			passed += 1
		else:
			failed += 1
			print("FAIL ", name)
	print("TESTS %d/%d passed" % [passed, passed + failed])
	quit(0 if failed == 0 else 1)


# ------------------------------------------------------------------ helpers

func game(style := "classic", block := "1-1") -> Game:
	var g := Game.new()
	g.new_game(style, 1, 777)
	if block != "1-1":
		g.load_block(block)
	return g


func run(g: Game, inp: Dictionary, frames: int) -> void:
	for i in frames:
		g.step(inp)


func check(cond: bool, msg: String) -> bool:
	if not cond:
		print("  expected: ", msg)
	return cond


# ------------------------------------------------------------------ tests

func t_levels_parse() -> bool:
	var ok := true
	var blocks := Game.levels_for_stage(1)
	ok = check(blocks.has("1-1") and blocks.has("1-2") and blocks.has("1-3"), "three blocks") and ok
	for id in blocks:
		var l: Level = blocks[id]
		ok = check(l.h == 12, "%s is 12 rows (got %d)" % [id, l.h]) and ok
		ok = check(l.errors.is_empty(), "%s parses cleanly %s" % [id, l.errors]) and ok
		var starts := 0
		for m in l.marks:
			if m.c == "@":
				starts += 1
		ok = check(starts == 1, "%s has one @" % id) and ok
	return ok


func t_stairs_found() -> bool:
	var l: Level = Game.levels_for_stage(1)["1-2"]
	if not check(l.stairs.size() == 2, "two stairs in 1-2, got %d" % l.stairs.size()):
		return false
	var up: Dictionary = l.stairs[0]
	# '/' bottom cell (14,9) -> foot (224,160); top cell (17,6) -> (288,96)
	return check(up.x0 == 224 and up.y0 == 160 and up.x1 == 288 and up.y1 == 96 and up.dir == 1, "stair geometry %s" % up)


func t_walk_and_wall() -> bool:
	var g := game()
	var x0: float = g.s.p.x
	run(g, {"r": true}, 40)
	var ok := check(absf(g.s.p.x - (x0 + 40 * Game.WALK)) < 0.01, "walked 50 px, got %.2f" % (g.s.p.x - x0))
	run(g, {"l": true}, 400)
	ok = check(absf(g.s.p.x - Game.PW / 2.0) < 0.01, "stopped at left edge x=5, got %.2f" % g.s.p.x) and ok
	return ok


func t_jump_arc() -> bool:
	var g := game()
	var y0: float = g.s.p.y
	g.step({"jump": true})
	var ok := check(g.s.p.y < y0, "rises on the press step")
	var top := y0
	var frames := 1
	while g.s.p.st == "air" and frames < 200:
		g.step({"jump": true})
		top = minf(top, g.s.p.y)
		frames += 1
	ok = check(y0 - top > 34 and y0 - top < 42, "apex 34..42 px, got %.1f" % (y0 - top)) and ok
	ok = check(g.s.p.y == y0, "lands back on the floor") and ok
	return ok


func t_classic_no_air_control() -> bool:
	var g := game("classic")
	g.step({"jump": true, "r": true})
	var x1: float = g.s.p.x
	run(g, {"l": true}, 10)
	return check(g.s.p.x > x1, "classic keeps the takeoff direction (x %.1f > %.1f)" % [g.s.p.x, x1])


func t_modern_air_control() -> bool:
	var g := game("modern")
	g.step({"jump": true, "r": true})
	var x1: float = g.s.p.x
	run(g, {"l": true, "jump": true}, 20)
	return check(g.s.p.x < x1, "modern steers in the air")


func t_whip_breaks_candle_and_drops() -> bool:
	var g := game()
	# first brazier is at column 8 (x=136); hero starts at x=56 facing right
	run(g, {"r": true}, 44)   # to x = 111, lash reaches 111+7+26 = 144
	var candles_before := _count(g, "candle")
	g.step({"atk": true})
	run(g, {}, 20)
	var ok := check(_count(g, "candle") == candles_before - 1, "brazier destroyed")
	ok = check(_count(g, "item") == 1, "one item dropped") and ok
	run(g, {}, 40)
	# walk into it
	run(g, {"r": true}, 30)
	ok = check(g.s.p.whip == 2, "first brazier's drop is the whip upgrade, whip=%d" % g.s.p.whip) and ok
	return ok


func t_stair_climb_1_2() -> bool:
	var g := game("classic", "1-2")
	# walk to the stair base (x=224) then hold up
	run(g, {"r": true}, 145)
	run(g, {"u": true}, 200)
	var ok := check(g.s.p.st == "stand" and g.s.p.y == 96.0, "reached the ledge at y=96 (st=%s y=%.1f)" % [g.s.p.st, g.s.p.y])
	# walk along the ledge and down the far stair
	run(g, {"r": true}, 200)
	ok = check(g.s.p.y == 96.0, "still on the ledge before the down stair (y=%.1f x=%.1f)" % [g.s.p.y, g.s.p.x]) and ok
	return ok


func t_breakable_wall_hides_roast() -> bool:
	var g := game("classic", "1-2")
	# stand left of the X wall at columns 50-51 (x=800)
	g.s.p.x = 780.0
	g.s.p.face = 1
	g.s.p.hp = 5
	g.step({"atk": true})
	run(g, {}, 24)
	var ok := check(g.s.broken.has(Vector2i(50, 9)) or g.s.broken.has(Vector2i(50, 8)), "wall cell broken")
	var roast := false
	for e in g.s.ents:
		if e.t == "item" and e.kind == "roast":
			roast = true
	ok = check(roast, "roast dropped from the wall") and ok
	return ok


func t_pit_kills() -> bool:
	var g := game("classic", "1-3")
	# first pit is columns 14-15
	g.s.p.x = 236.0
	run(g, {"r": true}, 60)
	return check(g.s.mode == "dying", "fell into the pit, mode=%s" % g.s.mode)


func t_hurt_knockback() -> bool:
	var g := game()
	var x0: float = g.s.p.x
	g.hurt_player(3, x0 + 10)
	var ok := check(g.s.p.hp == Game.HP_MAX - 3, "hp reduced")
	ok = check(g.s.p.st == "hurt" and g.s.p.vx < 0, "knocked away from the source") and ok
	run(g, {}, 60)
	ok = check(g.s.p.x < x0 and g.s.p.st != "hurt", "landed behind the start") and ok
	g.hurt_player(3, x0)
	ok = check(g.s.p.hp == Game.HP_MAX - 3, "invulnerable right after a hit") and ok
	return ok


func t_snapshot_determinism() -> bool:
	# the same inputs from the same snapshot give the same state: the basis of rewind
	var g := game()
	run(g, {"r": true}, 30)
	var snap := g.snapshot()
	var script := []
	for i in 300:
		script.append({"r": i % 50 < 30, "l": i % 50 >= 40, "jump": i % 37 == 0, "atk": i % 23 == 0})
	for inp in script:
		g.step(inp)
	var a := var_to_str(g.s)
	g.restore(snap)
	for inp in script:
		g.step(inp)
	var b := var_to_str(g.s)
	return check(a == b, "replay from snapshot is identical")


func t_save_load_roundtrip() -> bool:
	var g := game()
	run(g, {"r": true}, 50)
	var text := g.save_text("test")
	var g2 := Game.new()
	var ok := check(g2.load_text(text), "save text loads")
	ok = check(var_to_str(g2.s) == var_to_str(g.s), "loaded state equals saved state") and ok
	run(g, {"r": true, "jump": true}, 40)
	run(g2, {"r": true, "jump": true}, 40)
	ok = check(var_to_str(g2.s) == var_to_str(g.s), "loaded game continues identically") and ok
	ok = check(not g2.load_text("garbage"), "garbage refused") and ok
	return ok


func t_subweapon_dagger() -> bool:
	var g := game("classic", "1-3")   # open ground, no candles in the dagger's path
	g.s.p.sub = "dagger"
	g.s.p.hearts = 5
	g.step({"sub": true})
	run(g, {}, 8)
	var ok := check(_count(g, "pw_dagger") == 1, "dagger thrown")
	ok = check(g.s.p.hearts == 4, "cost one heart") and ok
	run(g, {}, 12)   # throw animation over, dagger still flying
	g.step({"atk": true, "u": true})
	run(g, {}, 8)
	ok = check(_count(g, "pw_dagger") == 1 and g.s.p.hearts == 4, "shot limit 1 holds (%d daggers)" % _count(g, "pw_dagger")) and ok
	run(g, {}, 80)
	g.step({"sub": true})
	run(g, {}, 8)
	ok = check(_count(g, "pw_dagger") == 1 and g.s.p.hearts == 3, "can throw again once it is gone") and ok
	return ok


func t_exit_goes_to_next_block() -> bool:
	var g := game()
	g.s.p.x = 1000.0
	run(g, {"r": true}, 30)
	run(g, {}, 50)
	return check(g.s.block == "1-2" and g.s.mode == "play", "moved to 1-2 (block=%s mode=%s)" % [g.s.block, g.s.mode])


func t_boss_triggers_and_dies() -> bool:
	var g := game("classic", "1-3")
	g.s.p.x = 63 * 16 + 2.0
	g.s.p.y = 160.0
	g.s.cam.x = 60 * 16.0
	run(g, {"r": true}, 10)
	var boss: Variant = null
	for e in g.s.ents:
		if e.t == "boss_nightwing":
			boss = e
	if not check(boss != null and g.s.cam.lock, "boss spawned and camera locked"):
		return false
	var b: Dictionary = boss
	for i in 16:
		Actors.on_hit(g, b, 2, g.s.p.x)
	var ok := check(b.st == "dying", "boss dying after 16 damage")
	g.s.p.inv = 9999
	run(g, {}, 200)
	var orb := false
	for e in g.s.ents:
		if e.t == "item" and e.kind == "orb":
			orb = true
			g.s.p.x = e.x
			g.s.p.y = e.y
	ok = check(orb, "soul orb dropped") and ok
	run(g, {}, 5)
	ok = check(g.s.mode == "clear", "orb pickup clears the stage, mode=%s" % g.s.mode) and ok
	return ok


func t_timer_runs_out() -> bool:
	var g := game()
	g.s.time = 1
	run(g, {}, 61)
	return check(g.s.mode == "dying", "time up kills")


func t_all_stages_parse() -> bool:
	var ok := true
	for n in range(1, Game.STAGES + 1):
		var blocks := Game.levels_for_stage(n)
		ok = check(blocks.has("%d-1" % n), "stage %d has a first block" % n) and ok
		for id in blocks:
			var l: Level = blocks[id]
			var starts := 0
			var goals := 0
			for m in l.marks:
				if m.c == "@": starts += 1
				if m.c == "E" or m.c == "Z": goals += 1
			ok = check(starts == 1, "%s has one start" % id) and ok
			ok = check(goals >= 1, "%s has an exit or boss" % id) and ok
			if l.meta.get("boss", "") != "":
				ok = check(Actors.BOSS.has(l.meta.boss), "%s boss %s is implemented" % [id, l.meta.boss]) and ok
			var nx: String = l.meta.get("next", "")
			if nx != "":
				ok = check(blocks.has(nx), "%s next %s exists" % [id, nx]) and ok
			var drops := l.meta_list("candles")
			var n_candles := 0
			for m in l.marks:
				if m.c == "i" or m.c == "I" or m.c == "j": n_candles += 1
			ok = check(drops.size() == n_candles, "%s: %d candles, %d drops listed" % [id, n_candles, drops.size()]) and ok
	return ok


# --- reachability lint: BFS over standing spots (column, floor row) ---------------------

static func stand_ok(l: Level, cx: int, r: int) -> bool:
	if cx < 0 or cx >= l.w or r <= 0 or r > l.h:
		return false
	if r < l.h and not l.solid(cx, r, {}):
		return false
	if r >= l.h:
		return false
	for k in range(1, 3):   # the hero is 40 px: two clear tiles above the floor (plus the head)
		if l.solid(cx, r - k, {}):
			return false
	return true


static func fall_to(l: Level, cx: int, r: int) -> int:
	## Drop straight down in column cx from above row r; the floor row reached, or -1 (pit/water).
	var y := r
	while y < l.h:
		if l.solid(cx, y, {}):
			return y if stand_ok(l, cx, y) else -1
		if l.hazard(cx, y) != "":
			return -1
		y += 1
	return -1


static func reachable(l: Level) -> Dictionary:
	var start := Vector2i(-1, -1)
	var goals: Array = []
	for m in l.marks:
		if m.c == "@":
			start = Vector2i(m.cx, m.cy + 1)
		elif m.c == "E" or m.c == "Z":
			goals.append(Vector2i(m.cx, m.cy))
	var seen := {start: true}
	var q: Array = [start]
	# stairs: connect the spots next to each foot point
	var links: Dictionary = {}
	for st in l.stairs:
		var bot := []
		var top := []
		for dc in [0, -1]:
			var b := Vector2i(floori(st.x0 / 16.0) + dc, int(st.y0) / 16)
			var tp := Vector2i(floori(st.x1 / 16.0) + dc, int(st.y1) / 16)
			if stand_ok(l, b.x, b.y): bot.append(b)
			if stand_ok(l, tp.x, tp.y): top.append(tp)
		for b in bot:
			for tp in top:
				links[b] = links.get(b, []) + [tp]
				links[tp] = links.get(tp, []) + [b]
	while not q.is_empty():
		var c: Vector2i = q.pop_front()
		var nexts: Array = links.get(c, []).duplicate()
		for dx in [-1, 1]:
			var nx: int = c.x + int(dx)
			if stand_ok(l, nx, c.y):
				nexts.append(Vector2i(nx, c.y))
			elif not l.solid(nx, c.y - 1, {}) and not l.solid(nx, c.y, {}):
				var fr := fall_to(l, nx, c.y)
				if fr > 0:
					nexts.append(Vector2i(nx, fr))
		# jumps: up to 2 rows up within 3 columns, level or down within 4 columns
		if not l.solid(c.x, c.y - 3, {}):
			for dx2 in range(-4, 5):
				for dr in range(-2, 7):
					if dx2 == 0:
						continue
					if dr < 0 and absi(dx2) > 3:
						continue
					var tgt := Vector2i(c.x + dx2, c.y + dr)
					if stand_ok(l, tgt.x, tgt.y) and _arc_clear(l, c, tgt):
						nexts.append(tgt)
		for nn in nexts:
			if not seen.has(nn):
				seen[nn] = true
				q.append(nn)
	var reached := []
	for gpos in goals:
		for s in seen:
			var sv: Vector2i = s
			if absi(sv.x - gpos.x) <= 1 and sv.y - gpos.y >= 1 and sv.y - gpos.y <= 3:
				reached.append(gpos)
				break
	return {"goals": goals.size(), "reached": reached.size(), "spots": seen.size()}


static func _arc_clear(l: Level, a: Vector2i, b: Vector2i) -> bool:
	## The columns between take-off and landing must be open where the hero's body
	## passes: the three rows above the higher of the two floors.
	var top := mini(a.y, b.y)
	var step := 1 if b.x > a.x else -1
	var x := a.x + step
	while x != b.x:
		for r in range(top - 3, top):
			if l.solid(x, r, {}):
				return false
		x += step
	return true


func t_all_blocks_reachable() -> bool:
	var ok := true
	for n in range(1, Game.STAGES + 1):
		for id in Game.levels_for_stage(n):
			var l: Level = Game.levels_for_stage(n)[id]
			var r := reachable(l)
			ok = check(r.reached >= 1, "%s: goal reachable from start (%d spots explored)" % [id, r.spots]) and ok
	return ok


func t_lint_catches_a_wall() -> bool:
	# the lint must be able to fail: wall off 1-1 and it has to notice
	var text := FileAccess.get_file_as_string("res://content/levels/stage1.txt")
	var blocks := Level.parse_file(text)
	var l: Level = blocks["1-1"]
	for cy in range(0, 10):
		var row: String = l.rows[cy]
		row[30] = "#"
		l.rows[cy] = row
	var r := reachable(l)
	return check(r.reached == 0, "a full-height wall makes 1-1 unreachable (reached %d)" % r.reached)


# --- boss bot: fight each boss with the real attack code -------------------------------

func _boss_block(n: int) -> String:
	for id in Game.levels_for_stage(n):
		if Game.levels_for_stage(n)[id].meta.get("boss", "") != "":
			return id
	return ""


func _enter_arena(g: Game, n: int) -> Dictionary:
	var id := _boss_block(n)
	g.s.stage = n
	g.load_block(id)
	var trig: Dictionary = {}
	for e in g.s.ents:
		if e.t == "bosstrig":
			trig = e
	g.s.p.x = float(trig.x) + 2.0
	g.s.p.y = float(trig.y)
	g._snap_camera()
	g.step({})
	return g.find(int(g.s.boss.id)) if int(g.s.boss.id) != 0 else {}


func _bot_input(g: Game, b: Dictionary, f: int) -> Dictionary:
	var p: Dictionary = g.s.p
	var inp := {}
	# keep whip distance: the lash starts 14 px ahead and reaches 42 px further
	var dx: float = b.x - p.x
	var reach: float = 14.0 + float(b.w) / 2.0
	if absf(dx) > reach + 30:
		inp["r" if dx > 0 else "l"] = true
	elif absf(dx) < reach and f % 60 < 40:
		inp["l" if dx > 0 else "r"] = true      # back off
	elif p.st != "air" and float(p.face) * dx < 0:
		inp["r" if dx > 0 else "l"] = true
	if b.y < p.y - 60 and f % 40 == 0:
		inp["jump"] = true
	if f % 8 == 0:
		inp["atk"] = true
	if f % 30 == 15:
		inp["sub"] = true
	return inp


func _fight(g: Game, frames: int) -> String:
	for f in frames:
		var b: Variant = g.find(int(g.s.boss.id))
		if b == null:
			return "gone"
		g.s.p.hearts = 50
		g.step(_bot_input(g, b, f))
		if g.s.mode != "play":
			return g.s.mode
	return "timeout"


func t_every_boss_fights_and_falls() -> bool:
	var ok := true
	for n in range(1, Game.STAGES + 1):
		var g := Game.new()
		g.new_game("classic", n, 99 + n)
		g.s.p.whip = 3
		g.s.p.sub = "axe"
		var b := _enter_arena(g, n)
		if not check(not b.is_empty(), "stage %d: boss spawns" % n):
			ok = false
			continue
		var name: String = b.t
		# 1) it must be dangerous: an unprotected hero standing still takes damage
		var g2 := Game.new()
		g2.new_game("classic", n, 99 + n)
		_enter_arena(g2, n)
		var hurt := false
		for f in 1800:
			g2.step({})
			if int(g2.s.p.hp) < Game.HP_MAX or g2.s.mode == "dying":
				hurt = true
				break
		ok = check(hurt, "%s hurts a hero who stands still" % name) and ok
		# 2) it must be beatable: the bot, made invulnerable, wins within a minute each form
		var res := ""
		var forms := 0
		for form in 2:
			g.s.p.inv = 999999
			res = _fight(g, 3600 * 3)
			forms += 1
			if int(g.s.boss.id) == 0 or g.find(int(g.s.boss.id)) == null or String(g.find(int(g.s.boss.id)).t) != "boss_beast":
				break
			if res != "gone" and res != "timeout":
				break
		var won := false
		for i in 400:
			g.s.p.inv = 999999
			g.step({})
			for e in g.s.ents:
				if e.t == "item" and e.kind == "orb":
					won = true
		ok = check(won, "%s dies and drops the soul orb (fight ended: %s, forms %d, boss hp %d)" % [name, res, forms, int(g.s.boss.hp)]) and ok
	return ok


func t_final_boss_reaches_ending() -> bool:
	var g := Game.new()
	g.new_game("classic", 6, 7)
	g.s.p.whip = 3
	g.s.p.sub = "axe"
	var b := _enter_arena(g, 6)
	var saw_line := false
	var saw_beast := false
	for f in 60 * 240:
		g.s.p.inv = 999999
		g.s.p.hearts = 50
		if String(g.s.boss.get("line", "")) != "":
			saw_line = true
		var bb: Variant = g.find(int(g.s.boss.id))
		if bb != null and bb.t == "boss_beast":
			saw_beast = true
		if bb != null:
			g.step(_bot_input(g, bb, f))
		else:
			# walk to the orb when it lands
			var orb_x := -1.0
			for e in g.s.ents:
				if e.t == "item" and e.kind == "orb":
					orb_x = e.x
			g.step({"r": orb_x > g.s.p.x, "l": orb_x >= 0 and orb_x < g.s.p.x})
		if g.s.mode == "ending":
			break
	var ok := check(saw_line, "the Margrave speaks before the fight")
	ok = check(saw_beast, "the Ashen Beast appears after the first form") and ok
	ok = check(g.s.mode == "ending", "killing the Beast and taking the orb reaches the ending (mode=%s)" % g.s.mode) and ok
	return ok


func t_flipped_frames_sample_the_mirror() -> bool:
	# regression: left-facing sprites used a negative-width rect, which draws nothing on the
	# Compatibility renderer. They now sample a mirrored sheet; check the region maths
	# against a pixel-by-pixel mirror of the original frame.
	var ok := true
	for name in ["hero", "enemies", "bosses"]:
		var sh := Assets.sheet(name)
		var img: Image = sh.tex.get_image()
		var fimg: Image = sh.tex_flip.get_image()
		var fr: String = sh.anims[sh.anims.keys()[0]].frames[0]
		var f: Dictionary = sh.frames[fr]
		var tw: int = sh.tw
		var bad := 0
		for y in range(int(f.y), int(f.y) + int(f.h), 3):
			for x in range(0, int(f.w), 3):
				var a := img.get_pixel(int(f.x) + x, y)
				var b := fimg.get_pixel(tw - int(f.x) - int(f.w) + (int(f.w) - 1 - x), y)
				if a.a == 0.0 and b.a == 0.0:
					continue      # transparent pixels may keep any RGB
				if not a.is_equal_approx(b):
					bad += 1
		ok = check(bad == 0, "%s: mirrored region matches (%d mismatches)" % [name, bad]) and ok
	return ok


func t_every_named_animation_exists() -> bool:
	# every enemy/boss state the rules can enter has art (else it draws as a placeholder box)
	var want := ["ghoul_rise", "ghoul_walk", "bat_idle", "bat_fly", "wisp_idle", "drowned_leap", "drowned_walk",
		"drowned_spit", "knight_walk", "axeknight_walk", "axeknight_throw", "skel_walk", "skel_down",
		"redskel_walk", "redskel_down", "warg_idle", "warg_leap", "warg_run", "raven_idle", "raven_dive",
		"imp_wait", "imp_hop", "ghost_drift", "pillar_idle", "candle", "brazier", "lamp",
		"ep_fire", "ep_bone", "ep_axe", "ep_ball", "ep_wave", "ep_gear", "ep_flame", "ep_lantern", "ep_blade",
		"pw_dagger", "pw_axe", "pw_flask", "pw_flame", "pw_cross", "fx_burst", "fx_spark", "fx_rubble",
		"fx_splash", "fx_boom", "item_orb", "wyrm_seg", "wyrm_seg_small"]
	for it in ["heart", "bigheart", "bag100", "bag400", "bag700", "bag1000", "whip", "dagger", "axe", "flask",
			"cross", "glass", "roast", "rosary", "potion", "double", "triple", "oneup"]:
		want.append("item_" + it)
	var boss_states := {"nightwing": ["sleep", "rise", "glide", "perch", "swoop", "dying"], "wyrm": ["arc", "dying"],
			"warden": ["sleep", "walk", "slam", "dying"], "chainmaster": ["sleep", "walk", "throw", "leap", "stomp", "dying"],
			"horologist": ["sleep", "hover", "blink", "dying"], "margrave": ["intro", "stand", "fade", "dying"],
			"beast": ["transform", "stand", "breathe", "leap", "dying"]}
	for bname in boss_states:
		for st in boss_states[bname]:
			want.append("boss_%s_%s" % [bname, st])
	var missing := []
	for a in want:
		if Assets.sheet_for(a).is_empty():
			missing.append(a)
	return check(missing.is_empty(), "animations missing: %s" % [missing])


func _swing_at(level: int, dist: float) -> bool:
	## A candle whose near edge is `dist` px ahead of the hero: does one lash break it?
	var g := game("classic", "1-3")
	g.s.ents = []
	g.s.p.x = 100.0
	g.s.p.face = 1
	g.s.p.whip = level
	var c := g.spawn("candle", 100.0 + dist + 5.0, g.s.p.y - 30)
	c.w = 10
	c.h = 20
	c.drop = "none"
	g.step({"atk": true})
	run(g, {}, 24)
	return c.dead


func t_whip_reach_by_level() -> bool:
	# the lash spans 14 px ahead of the feet to 14 + WHIP_LEN (26, 26, 42)
	var ok := check(_swing_at(1, 38.0), "level 1 reaches 38 px")
	ok = check(not _swing_at(1, 42.0), "level 1 stops short of 42 px") and ok
	ok = check(_swing_at(3, 54.0), "level 3 reaches 54 px") and ok
	ok = check(not _swing_at(3, 58.0), "level 3 stops short of 58 px") and ok
	ok = check(not _swing_at(1, -20.0), "nothing behind the hero is struck") and ok
	return ok


func _count(g: Game, t: String) -> int:
	var n := 0
	for e in g.s.ents:
		if e.t == t and not e.dead:
			n += 1
	return n
