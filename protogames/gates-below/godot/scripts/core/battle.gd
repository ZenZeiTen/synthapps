## Round-based battle (SOUBOJE.C). Exploration is real time; when a monster engages,
## the party plans one action per character, every action point becomes a token, the
## tokens are shuffled uniformly (no stat decides initiative), and they resolve in order.
extends RefCounted

const Rules = preload("res://scripts/core/rules.gd")

var g   # the game (game.gd)


func _init(game) -> void:
	g = game


func active() -> bool:
	return g.s["mode"] == "battle"


func start(m: Dictionary, surprised: bool) -> void:
	if g.s["mode"] == "battle":
		m["in_battle"] = true
		return
	g.s["mode"] = "battle"
	g.s["battle"] = {"round": 0, "plans": {}, "surprised": surprised}
	m["in_battle"] = true
	m["hunt"] = true
	for o in g.ls["monsters"]:
		if not g.mflag(o, "npc") and g.mflag(o, "watch") and (bool(o["hunt"]) or g.sees_party(o)) and g.dist(int(o["cell"]), g.cur_cell()) <= 6:
			o["in_battle"] = true
	g.sfx("battle")
	g.events.append({"t": "battle_start", "surprised": surprised})
	g.msg("%s attacks!" % g.mname_cap(m))
	if surprised:
		g.msg("You are caught off guard!")
		resolve_round(-1, true)


func fighters() -> Array:
	var out = []
	for m in g.ls["monsters"]:
		if bool(m["in_battle"]):
			out.append(m)
	return out


## plan: {"act": "attack" | "cast" | "guard" | "throw" | "use", "spell", "target", "idx"}
func plan(ci: int, p: Dictionary) -> void:
	g.s["battle"]["plans"][str(ci)] = p


func plan_of(ci: int) -> Dictionary:
	return g.s["battle"]["plans"].get(str(ci), {})


## Every living character able to act has a plan.
func ready() -> bool:
	for ci in g.living():
		if int(g.s["party"][ci]["st"]) > 0 and plan_of(ci).is_empty():
			return false
	return true


func party_move(d: int) -> Dictionary:
	if not active():
		return {"ok": false}
	return resolve_round(d, false)


## One round. party_dir >= 0: the whole party moves one square instead of acting.
func resolve_round(party_dir: int = -1, party_idle: bool = false) -> Dictionary:
	var b: Dictionary = g.s["battle"]
	b["round"] = int(b["round"]) + 1
	g.events.append({"t": "round", "n": b["round"]})
	var result = {"ok": true}
	var tokens = []
	if party_dir >= 0:
		var r: Dictionary = g.move_party(party_dir)
		result = r
		if not r.get("ok", false):
			g.msg("The way is blocked.")
	elif not party_idle:
		for ci in g.living():
			var ch: Dictionary = g.s["party"][ci]
			var p = plan_of(ci)
			if p.is_empty() or int(ch["st"]) <= 0:
				p = {"act": "guard"}
				plan(ci, p)
			var n = Rules.ap(int(g.stats(ch)["mob"]))
			if p["act"] in ["cast", "use", "throw"]:
				n = 1   # one spell, one draught, one throw per round
			for i in maxi(n, 1):
				tokens.append(["c", ci])
	for m in fighters():
		for i in maxi(Rules.ap(int(g.mstats(m)["mob"])), 1):
			tokens.append(["m", int(m["uid"])])
	g.rng.shuffle(tokens)
	for t in tokens:
		if g.s["mode"] != "battle":
			break
		if t[0] == "c":
			char_token(int(t[1]))
		else:
			var m = g.monster_by_uid(int(t[1]))
			if m != null and bool(m["in_battle"]):
				monster_token(m)
	end_round()
	return result


func end_round() -> void:
	if g.s["mode"] == "dead":
		return
	g.magic.tick_effects()
	for ci in g.living():
		if "regen" in g.fx_of(g.s["party"][ci]):
			g.damage_char(ci, -3)
	g.s["time"] = int(g.s["time"]) + 1
	g.s["sleep"] = mini(Rules.MAX_SLEEP, int(g.s["sleep"]) + Rules.MAX_SLEEP / 12)
	var any = false
	for m in g.ls["monsters"]:
		if bool(m["in_battle"]):
			any = true
	if not any and g.s["mode"] == "battle":
		g.s["mode"] = "explore"
		g.s["battle"] = {}
		g.msg("The fight is over.")
		g.events.append({"t": "battle_end"})


# ------------------------------------------------------------------ the party's actions

func char_token(ci: int) -> void:
	var ch: Dictionary = g.s["party"][ci]
	if ch["dead"]:
		return
	var p = plan_of(ci)
	match String(p.get("act", "guard")):
		"attack":
			attack(ci)
		"cast":
			g.magic.cast(ci, String(p["spell"]), int(p.get("target", ci)))
		"throw":
			throw_held(ci)
		"use":
			g.use_item(ci, int(p.get("idx", -1)))
			plan(ci, {"act": "guard"})
		_:
			var st: Dictionary = g.stats(ch)
			ch["st"] = mini(int(st["st_max"]), int(ch["st"]) + ceili(int(st["st_reg"]) / 10.0))
			ch["mp"] = mini(int(st["mp_max"]), int(ch["mp"]) + ceili(int(st["mp_reg"]) / 10.0))


func front_monsters() -> Array:
	var c: int = g.cur_cell()
	var d: int = int(g.s["dir"])
	if not g.face_passable(c * 4 + d):
		return []
	var out = []
	for m in g.monsters_at(g.lv.neighbour(c, d)):
		if not g.mflag(m, "npc"):
			out.append(m)
	return out


## First monster along the facing line, up to 5 squares (trace_path, SOUBOJE.C:856).
func line_target():
	var c: int = g.cur_cell()
	var d: int = int(g.s["dir"])
	for i in 5:
		if not g.face_passable(c * 4 + d):
			return null
		c = g.lv.neighbour(c, d)
		if c < 0:
			return null
		for m in g.monsters_at(c):
			if not g.mflag(m, "npc"):
				return m
	return null


func attack(ci: int) -> void:
	var ch: Dictionary = g.s["party"][ci]
	var wf: int = g.weight_defect(ch) + 1
	if int(ch["st"]) < wf:
		g.msg("%s is too tired to fight." % ch["name"])
		return
	var weapon = ch["equip"].get("hand_r")
	var ranged: bool = weapon != null and String(g.item_def(weapon).get("type", "")) == "ranged"
	var target: Variant = null
	if ranged:
		if int(ch["quiver"]) <= 0:
			g.msg("%s has no arrows." % ch["name"])
			return
		target = line_target()
	else:
		var fm = front_monsters()
		if not fm.is_empty():
			target = fm[g.rng.rnd(fm.size())]
	if target == null:
		g.msg("%s finds nothing to strike." % ch["name"])
		return
	ch["st"] = int(ch["st"]) - wf
	var fam: String = g.weapon_family(ch)
	var skill: int = g.skill_level(ch, fam)
	var a: Dictionary = g.stats(ch)
	var bonus = 0
	if ranged:
		ch["quiver"] = int(ch["quiver"]) - 1
		bonus = skill   # the missile skill adds to the attack roll, not the damage
		skill = 0
		g.sfx("bow")
		if g.rng.rnd(2) == 0:
			var key: String = g.pile_key(int(target["cell"]), g.rng.rnd(4))
			if not g.ls["items"].has(key):
				g.ls["items"][key] = []
			g.ls["items"][key].append({"id": "arrows", "amount": 1})
	else:
		g.sfx("swing")
	var crowd: int = g.monsters_at(int(target["cell"])).size()
	var h: Dictionary = Rules.hit(g.rng, a, g.mstats(target), crowd, skill, g.fx_of(target), bonus)
	var dmg: int = int(h["total"])
	g.events.append({"t": "attack", "ci": ci, "uid": target["uid"], "dmg": dmg, "ranged": ranged})
	g.noise(g.cur_cell(), 5)
	if dmg <= 0:
		g.msg("%s misses %s." % [ch["name"], g.mname(target)])
		g.sfx("miss")
		return
	g.skill_hit(ch, "missile" if ranged else fam)
	g.msg("%s hits %s for %d." % [ch["name"], g.mname(target), dmg])
	damage_monster(target, dmg, ci)


func throw_held(ci: int) -> void:
	var ch: Dictionary = g.s["party"][ci]
	var it = g.s["held"]
	if it == null:
		g.msg("%s has nothing to throw." % ch["name"])
		return
	var d: Dictionary = g.item_def(it)
	var target: Variant = line_target()
	g.s["held"] = null
	g.sfx("throw")
	var land: int = g.front_cell() if target == null else int(target["cell"])
	if land < 0 or not g.face_passable(g.cur_cell() * 4 + int(g.s["dir"])):
		land = g.cur_cell()
	var key: String = g.pile_key(land, g.rng.rnd(4))
	if not g.ls["items"].has(key):
		g.ls["items"][key] = []
	g.ls["items"][key].append(it)
	g.update_plates()
	if target == null:
		g.msg("%s throws the %s." % [ch["name"], g.item_name(it)])
		return
	# zasah_veci: the item's own mods are the attacker; aim comes from DEX and STR
	var a = Rules.blank_stats()
	var mods: Dictionary = d.get("mods", {})
	for k in mods:
		a[k] = mods[k]
	if not d.get("throwable", false):
		a["atk_l"] = 0
		a["atk_h"] = maxi(1, int(d.get("weight", 1)))
	var st: Dictionary = g.stats(ch)
	var bonus: int = (int(st["dex"]) * 3 + int(st["str"]) * 2) / 30 + g.skill_level(ch, "dagger")
	var h: Dictionary = Rules.hit(g.rng, a, g.mstats(target), g.monsters_at(int(target["cell"])).size(), 0, g.fx_of(target), bonus)
	var dmg = int(h["total"])
	g.events.append({"t": "attack", "ci": ci, "uid": target["uid"], "dmg": dmg, "ranged": true})
	if dmg <= 0:
		g.msg("The %s misses." % g.item_name(it))
		return
	g.msg("The %s strikes %s for %d." % [g.item_name(it), g.mname(target), dmg])
	damage_monster(target, dmg, ci)


## Damage a monster; the hitter earns XP in proportion (SOUBOJE.C:2310).
func damage_monster(m: Dictionary, dmg: int, ci: int) -> void:
	var t: Dictionary = g.mtemplate(m)
	if dmg < 0:
		m["hp"] = mini(int(t["hp"]), int(m["hp"]) - dmg)
		return
	var dealt: int = mini(dmg, int(m["hp"]))
	m["hp"] = int(m["hp"]) - dmg
	m["taken"] = int(m["taken"]) + dealt
	if not bool(m["in_battle"]) and not g.mflag(m, "npc"):
		start(m, false)
	if ci >= 0:
		g.gain_xp(g.s["party"][ci], int(t["xp"]) * dealt / maxi(1, int(t["hp"])))
	g.events.append({"t": "mob_hurt", "uid": m["uid"], "dmg": dmg})
	if int(m["hp"]) <= 0:
		kill_monster(m)


func kill_monster(m: Dictionary) -> void:
	var t: Dictionary = g.mtemplate(m)
	g.ls["monsters"].erase(m)
	g.msg("%s is slain." % g.mname_cap(m))
	g.sfx("mob_die", int(m["cell"]))
	g.events.append({"t": "mob_die", "uid": m["uid"], "cell": m["cell"]})
	var drops: Array = (t.get("drops", []) as Array) + (m["drops"] as Array)
	var corner = 0
	for iid in drops:
		var key: String = g.pile_key(int(m["cell"]), corner % 4)
		corner += 1
		if not g.ls["items"].has(key):
			g.ls["items"][key] = []
		g.ls["items"][key].append({"id": iid})
	var money = int(t.get("money", 0))
	if money > 0:
		money = money * (80 + g.rng.rnd(41)) / 100
		var key: String = g.pile_key(int(m["cell"]), 2)
		if not g.ls["items"].has(key):
			g.ls["items"][key] = []
		g.ls["items"][key].append({"id": "coins", "amount": maxi(1, money)})
	for ci in g.living():
		g.gain_xp(g.s["party"][ci], int(t["bonus"]))
	g.update_plates()


# ------------------------------------------------------------------ the monsters' actions

## One monster action (akce_moba_zac, ENEMY.C:1888-1993), checked in the original order.
func monster_token(m: Dictionary) -> void:
	var t: Dictionary = g.mtemplate(m)
	var mc = int(m["cell"])
	var pc: int = g.cur_cell()
	var on_square: int = g.monsters_at(mc).size()
	if int(m["fear"]) > 0 or Rules.wants_to_flee(g.rng, int(t["flee"]), int(m["hp"]), int(t["hp"]), int(m["taken"]), on_square):
		if flee(m):
			return
	var d: int = g.dir_to(mc, pc)
	var adjacent: bool = g.dist(mc, pc) == 1 and g.face_passable(mc * 4 + d)
	if adjacent and int(m["dir"]) == d:
		if g.mflag(m, "cast") and g.rng.rnd(100) < int(t.get("cast_pct", 0)):
			g.magic.monster_cast(m, String(t["cast"]))
		else:
			monster_strike(m)
		return
	if adjacent:
		m["dir"] = d
		g.events.append({"t": "mob_turn", "uid": m["uid"]})
		return
	var aligned = (mc % g.lv.w == pc % g.lv.w or mc / g.lv.w == pc / g.lv.w)
	if (g.mflag(m, "cast") or g.mflag(m, "shoot")) and aligned and g.dist(mc, pc) <= int(t["reach"]) and g.line_clear(mc, pc, false):
		m["dir"] = d
		if g.mflag(m, "cast") and g.rng.rnd(100) < int(t.get("cast_pct", 0)) + 25:
			g.magic.monster_cast(m, String(t["cast"]))
			return
		if g.mflag(m, "shoot"):
			monster_strike(m)   # a missile: same formula, from range
			return
	var nx: int = -1 if g.mflag(m, "stay") else g.path_step(m, pc, 12)
	if nx >= 0 and nx != pc:
		g.move_monster(m, nx)
		return
	# no way to reach the party (a grate between, a full square): give up the fight
	m["in_battle"] = false
	m["hunt"] = false


func flee(m: Dictionary) -> bool:
	var mc = int(m["cell"])
	var pc: int = g.cur_cell()
	var best = -1
	var best_d: int = g.dist(mc, pc)
	for d in 4:
		var n: int = g.lv.neighbour(mc, d)
		if n >= 0 and g.face_passable(mc * 4 + d) and g.monster_can_enter(m, n) and g.dist(n, pc) > best_d:
			best = n
			best_d = g.dist(n, pc)
	if best < 0:
		return false
	g.move_monster(m, best)
	if g.dist(best, pc) >= 3:
		m["in_battle"] = false
		m["hunt"] = false
		m["fear"] = 0
		g.msg("%s flees." % g.mname_cap(m))
	return true


## A monster blow lands on one random living character (utok_na_sektor, ENEMY.C:2061).
func monster_strike(m: Dictionary) -> void:
	var t: Dictionary = g.mtemplate(m)
	var alive: Array = g.living()
	if alive.is_empty():
		return
	var ci: int = alive[g.rng.rnd(alive.size())]
	var ch: Dictionary = g.s["party"][ci]
	var h: Dictionary = Rules.hit(g.rng, g.mstats(m), g.stats(ch), alive.size(), 0, g.fx_of(ch))
	var dmg = int(h["total"])
	g.events.append({"t": "mob_attack", "uid": m["uid"], "ci": ci, "dmg": dmg})
	g.sfx("claw" if g.mflag(m, "big") == false else "slam", int(m["cell"]))
	if dmg <= 0:
		g.msg("%s misses %s." % [g.mname_cap(m), ch["name"]])
		return
	ch["st"] = maxi(0, int(ch["st"]) - 1)
	g.msg("%s hits %s for %d." % [g.mname_cap(m), ch["name"], dmg])
	if t.get("drain", false):
		m["hp"] = mini(int(t["hp"]), int(m["hp"]) + dmg)
	g.damage_char(ci, dmg, g.mname(m))
