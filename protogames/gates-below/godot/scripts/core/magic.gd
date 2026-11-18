## Rune magic (KOUZLA.C). A spell is a rune at a power level; its effect is a small op
## list interpreted here, modelled on the original bytecode (call_spell): damage, heal,
## timed stat changes, flags, duration, stamina/mana, map reveal, raising the dead.
extends RefCounted

const Rules = preload("res://scripts/core/rules.gd")

var g


func _init(game) -> void:
	g = game


func spell(id: String) -> Dictionary:
	return g.content["spells"]["spells"][id]


func element_of(sp: Dictionary) -> int:
	if sp.has("element"):
		return Rules.ELEMENTS.find(String(sp["element"]))
	var r = String(sp.get("rune", ""))
	if r == "":
		return 0
	return Rules.ELEMENTS.find(String(g.content["spells"]["runes"][r]["element"]))


## Spells the party can cast: every power level of every known rune.
func known_spells() -> Array:
	var out = []
	for id in g.content["spells"]["spells"]:
		var sp: Dictionary = g.content["spells"]["spells"][id]
		if String(sp["rune"]) in g.s["runes"]:
			out.append(id)
	return out


## A character casts. In battle this runs on the character's token; outside, at once.
func cast(ci: int, id: String, target: int = -1) -> Dictionary:
	var ch: Dictionary = g.s["party"][ci]
	var sp = spell(id)
	if ch["dead"]:
		return {"ok": false}
	if not String(sp["rune"]) in g.s["runes"]:
		g.msg("The party does not know that rune.")
		return {"ok": false}
	var mana = int(sp["mana"])
	if int(ch["mp"]) < mana:
		g.msg("%s has too little mana for %s." % [ch["name"], sp["name"]])
		return {"ok": false, "why": "mana"}
	var st: Dictionary = g.stats(ch)
	var o: Dictionary = Rules.cast_outcome(g.rng, int(st["mag"]), int(sp["need"]), sp.has("backfire"))
	match String(o["result"]):
		"impossible":
			g.msg("%s lacks the skill to cast %s." % [ch["name"], sp["name"]])
			return {"ok": false, "why": "skill"}
		"fizzle":
			ch["mp"] = int(ch["mp"]) - mana / 2
			g.msg("%s's %s fizzles." % [ch["name"], sp["name"]])
			g.sfx("fizzle")
			return {"ok": false, "why": "fizzle"}
		"backfire":
			ch["mp"] = int(ch["mp"]) - mana
			g.msg("%s's %s backfires!" % [ch["name"], sp["name"]])
			apply(spell(String(sp["backfire"])), String(sp["backfire"]), ci, ci, -1)
			return {"ok": false, "why": "backfire"}
	ch["mp"] = int(ch["mp"]) - mana
	g.gain_xp(ch, mana)   # casting pays its mana cost in XP (KOUZLA.C:1717)
	if bool(o["learn"]):
		ch["base"]["mag"] = int(ch["base"]["mag"]) + 1
		g.msg("%s's grasp of magic improves." % ch["name"])
	g.msg("%s casts %s." % [ch["name"], sp["name"]])
	var ok = apply(sp, id, ci, target, -1)
	return {"ok": ok}


## Potions and food spells: no mana, no risk.
func item_spell(id: String, ci: int) -> void:
	apply(spell(id), id, ci, ci, -1)


func monster_cast(m: Dictionary, id: String) -> void:
	var sp = spell(id)
	g.msg("%s casts %s." % [g.mname_cap(m), sp["name"]])
	apply(sp, id, -1, -1, int(m["uid"]))


## Resolve targets and run the ops. caster_ci >= 0 for a character, caster_uid for a monster.
func apply(sp: Dictionary, id: String, caster_ci: int, target_ci: int, caster_uid: int) -> bool:
	g.events.append({"t": "spell", "fx": sp.get("fx", ""), "id": id, "ci": caster_ci, "uid": caster_uid})
	g.sfx("spell_" + String(sp.get("fx", "heal")))
	var chars = []
	var mobs = []
	match String(sp["target"]):
		"self":
			chars = [caster_ci]
		"ally":
			var t = target_ci if target_ci >= 0 else caster_ci
			if g.s["party"][t]["dead"]:
				g.msg("%s is past such help." % g.s["party"][t]["name"])
				return false
			chars = [t]
		"party":
			chars = g.living()
		"dead":
			if target_ci < 0 or not g.s["party"][target_ci]["dead"]:
				g.msg("The spell finds no one to call back.")
				return false
			chars = [target_ci]
		"front":
			var fm: Array = g.battle.front_monsters()
			if not fm.is_empty():
				mobs = [fm[g.rng.rnd(fm.size())]]
		"front_all":
			mobs = g.battle.front_monsters()
		"line":
			var m = g.battle.line_target()
			if m != null:
				mobs = [m]
		"enemy":
			var alive: Array = g.living()
			if not alive.is_empty():
				chars = [alive[g.rng.rnd(alive.size())]]
		"enemy_all":
			chars = g.living()
		"none":
			run_ops(sp, id, null, -1, caster_ci)
			return true
	if String(sp["target"]) in ["front", "front_all", "line"] and mobs.is_empty():
		g.msg("The spell strikes nothing.")
		return false
	for ci in chars:
		run_ops(sp, id, null, ci, caster_ci)
	for m in mobs:
		if g.ls["monsters"].has(m):
			run_ops(sp, id, m, -1, caster_ci)
	return true


func run_ops(sp: Dictionary, id: String, m, ci: int, caster_ci: int) -> void:
	var el = element_of(sp)
	var who: Dictionary = m if m != null else ({} if ci < 0 else g.s["party"][ci])
	var effect = {"spell": id, "name": sp["name"], "mods": {}, "flags": [], "ticks": 0}
	for op in sp["ops"]:
		match String(op["op"]):
			"dmg", "dmg_el":
				var lo = mini(int(op["min"]), int(op["max"]))
				var hi = maxi(int(op["min"]), int(op["max"]))
				var v: int = lo + g.rng.rnd(hi - lo + 1)
				if String(op["op"]) == "dmg_el" and v > 0:
					var res: int = int((g.mstats(m) if m != null else g.stats(who))[Rules.RESIST[el]])
					v = v * (100 - res) / 100
				if m != null:
					if v > 0:
						g.msg("%s takes %d." % [g.mname_cap(m), v])
					g.battle.damage_monster(m, v, caster_ci)
					if not g.ls["monsters"].has(m):
						return
				elif ci >= 0:
					if v < 0:
						g.msg("%s is healed." % who["name"])
					elif v > 0:
						g.msg("%s takes %d." % [who["name"], v])
					g.damage_char(ci, v, String(sp["name"]).to_lower())
			"stat":
				if sp.get("resist", false) and m != null and not _resisted_ok(m, el):
					g.msg("%s resists." % g.mname_cap(m))
					continue
				effect["mods"][op["stat"]] = int(effect["mods"].get(op["stat"], 0)) + int(op["amount"])
			"flag":
				effect["flags"].append(String(op["set"]))
			"duration":
				effect["ticks"] = int(op["ticks"])
				if who.is_empty():
					continue
				# one instance per spell and target: recasting replaces it (accnum)
				for e in (who["effects"] as Array).duplicate():
					if String(e["spell"]) == id:
						who["effects"].erase(e)
				who["effects"].append(effect)
				if ci >= 0:
					g.clamp_pools(who)
			"stamina":
				if ci >= 0:
					var st: Dictionary = g.stats(who)
					who["st"] = clampi(int(who["st"]) + int(op["amount"]), 0, int(st["st_max"]))
			"mana":
				if ci >= 0:
					var st: Dictionary = g.stats(who)
					who["mp"] = mini(int(st["mp_max"]), int(who["mp"]) + int(op["amount"]))
			"reveal":
				reveal(int(op["radius"]))
			"truesight":
				truesight()
			"omen":
				g.s["omen"] = int(op["ticks"])
			"raise":
				if ci >= 0 and who["dead"]:
					var st: Dictionary = g.stats(who)
					who["dead"] = false
					who["hp"] = maxi(1, int(float(st["hp_max"]) * float(op["frac"])))
					who["st"] = int(st["st_max"]) / 3
					g.msg("%s draws breath again." % who["name"])
					g.events.append({"t": "raise", "ci": ci})


func _resisted_ok(m: Dictionary, el: int) -> bool:
	var res = int(g.mstats(m)[Rules.RESIST[el]])
	return g.rng.rnd(100) <= 100 - res


## Map reveal (special codes 1-3): squares within the radius on this level.
func reveal(radius: int) -> void:
	var pc: int = g.cur_cell()
	for c in g.lv.cells.size():
		if not g.lv.cells[c].is_empty() and g.dist(c, pc) <= radius:
			g.ls["seen"][str(c)] = true
	g.events.append({"t": "reveal"})


## True Sight: every illusion wall within 8 squares shows as what it is.
func truesight() -> void:
	var pc: int = g.cur_cell()
	for fi in g.lv.faces.size():
		var f: Dictionary = g.lv.faces[fi]
		if not f.is_empty() and f["kind"] == "secret" and g.dist(fi >> 2, pc) <= 8:
			g.ls["found"][str(g.lv.edge_key(fi))] = true
	g.msg("Hidden ways shimmer into view.")


## Durations count battle rounds in a fight and 10 s ticks outside (trvani).
func tick_effects() -> void:
	for ch in g.s["party"]:
		_tick_list(ch, true)
	for m in g.ls.get("monsters", []):
		_tick_list(m, false)


func _tick_list(who: Dictionary, is_char: bool) -> void:
	for e in (who["effects"] as Array).duplicate():
		e["ticks"] = int(e["ticks"]) - 1
		if int(e["ticks"]) <= 0:
			who["effects"].erase(e)
			if is_char:
				g.msg("%s: %s wears off." % [who["name"], e["name"]])
				g.clamp_pools(who)
