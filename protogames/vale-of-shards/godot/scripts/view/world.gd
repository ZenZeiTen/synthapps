## Draws the play view (320x148): parallax backdrop, tiles, objects and the hero, between two
## core steps (alpha), with the source's draw order (X_OBJMAN.C refresh): background objects,
## then normal objects from last to first (the hero, object 0, on top of them), then front objects.
extends Node2D

const T = preload("res://scripts/core/tiles.gd")
const D = preload("res://scripts/core/defs.gd")

const VIEW_W := 320
const VIEW_H := 148
const BLINK_ART := [12, 13, 14, 15, 16, 17, 18, 19, 19, 19, 18, 17, 16, 15, 14, 13]

var A
var g
var alpha := 1.0
var cam := Vector2.ZERO
var layout: Dictionary = {}
var map_layout: Dictionary = {}
var anim := 0          # display frames, for idle animation between steps
var hide_player := false


func setup(assets, manifest: Dictionary) -> void:
	A = assets
	layout = manifest.get("side_layout", {})
	map_layout = manifest.get("map_layout", {})


func lerp_pos(o) -> Vector2:
	var a := alpha
	if absi(o.x - o.px) > 40 or absi(o.y - o.py) > 40:
		a = 1.0
	return Vector2(lerpf(o.px, o.x, a), lerpf(o.py, o.y, a))


func _draw() -> void:
	if g == null or g.w == 0:
		return
	var cx := lerpf(g.pvpox, g.vpox, alpha)
	var cy := lerpf(g.pvpoy, g.vpoy, alpha)
	cam = Vector2(roundf(cx), roundf(cy))
	draw_rect(Rect2(0, 0, VIEW_W, VIEW_H), Color(0.078, 0.063, 0.11))
	var theme: String = g.level.get("theme", "moss")
	var overworld: bool = g.level.get("overworld", false)
	if not overworld:
		_backdrop(theme)
	_tiles(theme, overworld)
	_objects(overworld)


func _backdrop(theme: String) -> void:
	var t: Texture2D = A.sprite("bg_" + theme)
	if t == null:
		return
	var w := t.get_width()
	var ox := -posmod(int(cam.x * 0.25), w)
	var oy := -clampi(int(cam.y * 0.1), 0, maxi(0, t.get_height() - VIEW_H))
	var x := ox
	while x < VIEW_W:
		draw_texture(t, Vector2(x, oy))
		x += w


# ------------------------------------------------------------------ tiles
func _tiles(theme: String, overworld: bool) -> void:
	var sheet: Texture2D = A.tex("tiles/" + theme)
	if sheet == null:
		return
	var sx := int(cam.x) >> 4
	var sy := int(cam.y) >> 4
	for y in range(sy, mini(sy + 11, g.h)):
		for x in range(sx, mini(sx + 21, g.w)):
			var t: int = g.tile(x, y)
			if t == T.AIR or t == T.DOORWAY:
				continue
			var slot := _slot_map(t, x, y) if overworld else _slot(t, x, y)
			if slot.x < 0:
				continue
			draw_texture_rect_region(sheet, Rect2(x * 16 - cam.x, y * 16 - cam.y, 16, 16),
				Rect2(slot.y * 16, slot.x * 16, 16, 16))


func _at(name: String, off: int = 0) -> Vector2i:
	var s: Array = layout.get(name, [-1, 0])
	return Vector2i(s[0], s[1] + off)


func _solidish(t: int) -> bool:
	return T.is_solid(t) and t != T.DOORWAY

func _mask(x: int, y: int, fam: Callable) -> int:
	var m := 0
	if fam.call(g.tile(x, y - 1)):
		m |= 1
	if fam.call(g.tile(x + 1, y)):
		m |= 2
	if fam.call(g.tile(x, y + 1)):
		m |= 4
	if fam.call(g.tile(x - 1, y)):
		m |= 8
	return m


func _hash(x: int, y: int) -> int:
	return absi((x * 73856093) ^ (y * 19349663))


func _slot(t: int, x: int, y: int) -> Vector2i:
	match t:
		T.SOLID, T.SOLID_DECO:
			var m := _mask(x, y, _solidish)
			if m == 15 and (t == T.SOLID_DECO or _hash(x, y) % 5 == 0):
				return _at("solid_var", _hash(x, y) % 8)
			return _at("solid", m)
		T.BACKWALL:
			return _at("backwall", _mask(x, y, func(n): return n == T.BACKWALL or _solidish(n)))
		T.LEDGE:
			var l: bool = g.tile(x - 1, y) == T.LEDGE
			var r: bool = g.tile(x + 1, y) == T.LEDGE
			if l and r:
				return _at("ledge_m")
			if r:
				return _at("ledge_l")
			if l:
				return _at("ledge_r")
			return _at("ledge_one")
		T.VINE:
			return _at("vine")
		T.VINE_TOP:
			return _at("vine_top")
		T.BREAKABLE:
			return _at("breakable")
		T.BLINK:
			return _at("blink", clampi((BLINK_ART[g.blink_phase] - 12) / 2, 0, 3))
		T.BRIDGE:
			return _at("bridge")
		T.BEAM:
			return _at("beam")
		T.WATER_TOP:
			return _at("water_top", (g.gamecount / 2) % 4)
		T.WATER:
			return _at("water", (g.gamecount / 4) % 2)
		T.LAVA_TOP:
			return _at("lava_top", (g.gamecount / 2) % 4)
		T.LAVA:
			return _at("lava", (g.gamecount / 4) % 2)
		T.SPIKES:
			return _at("spikes")
		T.THORNS:
			return _at("thorns")
		T.NODE:
			return _at("node")
		T.NODE_BROKEN:
			return _at("node_broken")
		T.LIFT_L:
			return _at("shaft_l")
		T.LIFT_R:
			return _at("shaft_r")
		T.DART_R:
			return _at("dart_r")
		T.DART_L:
			return _at("dart_l")
	if T.is_crumble(t):
		return _at("crumble", (t - T.CRUMBLE) / 3)
	if t >= T.DECO_A and t < T.DECO_A + 10:
		return _at("deco_a", t - T.DECO_A)
	if t >= T.DECO_B and t < T.DECO_B + 8:
		return _at("deco_b", t - T.DECO_B)
	return Vector2i(-1, 0)


func _mat(name: String, off: int = 0) -> Vector2i:
	var s: Array = map_layout.get(name, [-1, 0])
	return Vector2i(s[0], s[1] + off)


func _slot_map(t: int, x: int, y: int) -> Vector2i:
	match t:
		T.GRASS:
			return _mat("grass", _hash(x, y) % 4)
		T.FLOWERS:
			return _mat("flowers", _hash(x, y) % 4)
		T.SAND:
			return _mat("sand", _hash(x, y) % 4)
		T.REEDS:
			return _mat("reeds", _hash(x, y) % 4)
		T.PATH:
			return _mat("path", _mask(x, y, func(n): return n in [T.PATH, T.BRIDGE_H, T.BRIDGE_V, T.GATE]))
		T.MWATER:
			return _mat("water", _mask(x, y, func(n): return n in [T.MWATER, T.BRIDGE_H, T.BRIDGE_V]))
		T.FOREST:
			return _mat("forest", _mask(x, y, func(n): return n == T.FOREST))
		T.ROCK:
			return _mat("rock", _mask(x, y, func(n): return n == T.ROCK))
		T.GATE:
			return _mat("gate", (g.gamecount >> 2) & 3)
		T.BRIDGE_H:
			return _mat("bridge_h")
		T.BRIDGE_V:
			return _mat("bridge_v")
		T.HOUSE:
			return _mat("house")
		T.TOWER:
			return _mat("tower")
		T.WELL:
			return _mat("well")
		T.STUMP:
			return _mat("stump")
		T.MDECO:
			return _mat("deco", _hash(x, y) % 4)
	return Vector2i(-1, 0)


# ------------------------------------------------------------------ objects
func _objects(overworld: bool) -> void:
	var objs: Array = g.objs
	var back: Array = []
	var normal: Array = []
	var front: Array = []
	for i in range(objs.size() - 1, -1, -1):
		var o = objs[i]
		if o.kind == D.KILLME:
			continue
		var f: int = D.KINDS[o.kind][4]
		if f & D.F_BACK:
			back.append(o)
		elif f & D.F_FRONT:
			front.append(o)
		else:
			normal.append(o)
	back.reverse()
	front.reverse()
	for o in back:
		_obj(o)
	for o in normal:
		_obj(o)
	for o in front:
		_obj(o)
	if overworld:
		_markers()


func _markers() -> void:
	# overworld stage markers: open ones glow; finished ones stay as a done marker
	for m in g.level.get("markers", []):
		pass


func _obj(o) -> void:
	var pos := lerp_pos(o) - cam
	if pos.x < -96 or pos.x > VIEW_W + 32 or pos.y < -96 or pos.y > VIEW_H + 32:
		return
	var gc: int = g.gamecount
	match o.kind:
		D.PLAYER:
			if not hide_player:
				_hero(o, pos)
		D.TINY:
			var dir := "down"
			if o.xd < 0:
				dir = "left"
			elif o.xd > 0:
				dir = "right"
			elif o.yd < 0:
				dir = "up"
			A.draw_at(self, "tiny", A.frame("tiny", dir, o.statecount / 2), pos)
		D.MOTH:
			if o.state == D.ST_DIE:
				A.draw_at(self, "moth", A.frame("moth", "fall"), pos)
			else:
				var tag := "hover" if o.xd == 0 else ("fly_r" if o.xd > 0 else "fly_l")
				A.draw_at(self, "moth", A.frame("moth", tag, o.counter / 2), pos, false, _tint())
		D.BELL:
			var tag := "still"
			if o.state == D.ST_DIE:
				tag = "sink"
			elif o.xd < 0:
				tag = "left"
			elif o.xd > 0:
				tag = "right"
			elif o.yd < 0:
				tag = "up"
			elif o.yd > 0:
				tag = "down"
			A.draw_at(self, "bell", A.frame("bell", tag), pos, false, _tint())
		D.CHECKPT:
			if o.p.get("exit", false):
				A.draw_at(self, "portal", A.frame("portal", "swirl", gc / 2), pos)
			elif g.level.get("overworld", false) and o.counter != 127:
				A.draw_frame(self, "marker", A.frame("marker", "open", gc / 4), pos)
		D.FLAG:
			A.draw_at(self, "torch", A.frame("torch", "burn", gc / 2) if o.state else 0, pos + Vector2(0, 16))
		D.GATE:
			pass
		D.DOOR:
			var f: int = A.frame("door", D.KEY_COLORS[o.state])
			var base := Vector2(o.x, o.y - 16) - cam
			if o.statecount == 0:
				A.draw_frame(self, "door", f, base)
			else:
				# the halves part upward and downward (X_OBJ.C msg_door)
				var s: int = o.statecount
				var t: Texture2D = A.sprite("door")
				if t:
					draw_texture_rect_region(t, Rect2(base + Vector2(0, -s), Vector2(16, 24)), Rect2(f * 16, 0, 16, 24))
					draw_texture_rect_region(t, Rect2(base + Vector2(0, 24 + s), Vector2(16, 24)), Rect2(f * 16, 24, 16, 24))
		D.PAD:
			if o.xd == 1:
				A.draw_frame(self, "pad", A.frame("pad", "glow", o.statecount / 4), pos)
		D.SPRING:
			var tag := "rest"
			if o.statecount > 6:
				tag = "pressed"
			elif o.statecount > 3:
				tag = "mid"
			A.draw_frame(self, "spring", A.frame("spring", tag), pos)
		D.DART:
			A.draw_frame(self, "dart", A.frame("dart", "right" if o.xd > 0 else "left"), pos)
		D.MASHER:
			A.draw_frame(self, "masher", A.frame("masher", "stage", o.counter), pos)
		D.PLATFORM:
			A.draw_at(self, "platform", A.frame("platform", "glint", o.statecount / 2), pos)
		D.LIFT:
			A.draw_frame(self, "lift", 0, pos)
		D.KEY:
			A.draw_at(self, "key", A.frame("key", D.KEY_COLORS[o.state], o.counter / 4), pos)
		D.HEART:
			A.draw_frame(self, "heart", A.frame("heart", "beat", [0, 1, 2, 1][o.counter / 2]), pos)
		D.SHARD:
			A.draw_frame(self, "shard", A.frame("shard", "sparkle", o.counter / 2), pos)
		D.OWL:
			if o.info1 > 0:
				var tag := "perch" if o.info1 == 1 or o.substate == 0 else "fly"
				A.draw_at(self, "owl", A.frame("owl", tag, o.statecount / 4), pos, o.xd < 0 and tag == "fly")
		D.CRATE:
			if o.substate == 1:
				A.draw_frame(self, "crate", A.frame("crate", "kind", o.state % 4), pos)
		D.SCORE:
			_digits(str(o.state), pos, o.counter)
		D.TOKEN:
			_token(o, pos)
		D.SWITCH:
			A.draw_frame(self, "switch", A.frame("switch", "up" if o.state == 0 else "down"), pos)
		D.BUTTON:
			A.draw_frame(self, "button", A.frame("button", "up" if o.state == 0 else "down"), pos)
		D.POKER:
			A.draw_at(self, "poker", A.frame("poker", "stab" if o.statecount > 0 else "rest"), pos)
		D.PELLET:
			if o.state == 0:
				A.draw_frame(self, "pellet", A.frame("pellet", "slug"), pos, o.xd < 0)
			else:
				A.draw_frame(self, "pellet", A.frame("pellet", "orb", o.counter / 2), pos)
		D.BONUS:
			_bonus(o, pos)
		D.STONE:
			A.draw_frame(self, "stone", A.frame("stone", "spin", o.substate / 2), pos)
		D.EMBER:
			A.draw_at(self, "ember", A.frame("ember", "right" if o.xd > 0 else "left", o.counter / 2), pos)
		D.BOLT:
			A.draw_at(self, "bolt", A.frame("bolt", "rapid" if g.invcount(D.INV_BOLT) >= 5 else "normal"), pos, o.xd < 0)
		D.TORPEDO:
			A.draw_at(self, "torpedo", A.frame("torpedo", "right" if o.xd > 0 else "left"), pos)
		D.FRAG:
			if o.state >= 0:
				A.draw_at(self, "frag", A.frame("frag", "bits", o.state), pos)
			else:
				A.draw_at(self, "frag", A.frame("frag", "pebble"), pos)
		D.BURST:
			A.draw_frame(self, "burst", A.frame("burst", "boom", [0, 1, 0, 1, 0, 1, 2, 3, 4][mini(o.counter, 8)]), pos)
		D.FLASH:
			var tab := [3, 3, 2, 2, 1, 1, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3]
			A.draw_at(self, "flash", A.frame("flash", "star" if o.yd == 0 else "ring", tab[mini(o.counter, 15)]), pos)
		D.SPARK:
			A.draw_at(self, "spark", A.frame("spark", "pop", o.counter / 2), pos)
		D.IMPACT:
			A.draw_frame(self, "impact", A.frame("impact", "hit", [4, 4, 3, 2, 1, 0, 1, 2, 3, 4, 4][mini(o.counter, 10)]), pos)
		D.SPEAR:
			A.draw_at(self, "spear", A.frame("spear", "up" if o.yd > 0 else "down", o.counter), pos)
		D.STALACTITE:
			A.draw_frame(self, "stalactite", 0, pos)
		D.GEODE:
			A.draw_frame(self, "geode", A.frame("geode", "roll", o.counter), pos)
		D.FIRE:
			A.draw_frame(self, "fire", A.frame("fire", "drip" if o.yd > 0 else "burn", o.counter / 2), pos)
		D.TORCH:
			A.draw_at(self, "torch", A.frame("torch", "burn", o.counter / 2), pos)
		D.SNAPJAW:
			var side := "r" if o.xd > 0 else "l"
			var tag: String = ["rest_", "snap_", "open_"][o.counter] + side
			var px: float = pos.x if o.xd > 0 else pos.x + o.xl - 24
			A.draw_frame(self, "snapjaw", A.frame("snapjaw", tag), Vector2(px, pos.y))
		D.SEGMENTER:
			_segmenter(o, pos)
		D.SEGBIT:
			A.draw_frame(self, "segmenter", A.frame("segmenter", "body", o.state), pos)
		D.CAIRNBRUTE:
			A.draw_at(self, "cairnbrute", A.frame("cairnbrute", "walk_r" if o.xd > 0 else "walk_l", o.counter / 4), pos)
		D.SLICK:
			if o.state == 0:
				A.draw_at(self, "slick", A.frame("slick", "crawl", o.counter / 4), pos, o.xd > 0)
			else:
				A.draw_at(self, "slick_leap", A.frame("slick_leap", "leap", o.counter / 4), pos, o.state == 2)
		D.NEWT:
			A.draw_at(self, "newt", A.frame("newt", "walk_r" if o.xd > 0 else "walk_l", o.counter / 2), pos)
		D.SPIKES:
			A.draw_frame(self, "spikes", A.frame("spikes", "down" if o.yd == 1 else "up", o.state), pos)
		D.DRONE:
			var names := ["left", "hover", "right"]
			var tag: String = names[clampi(o.substate, 0, 2)]
			if o.state == 2:
				tag = "armored_" + tag
			if o.info1 == 1:
				tag = "fall"
			A.draw_at(self, "drone", A.frame("drone", tag), pos)
		D.SHADE:
			A.draw_at(self, "shade", A.frame("shade", "fade_r" if o.xd > 0 else "fade_l", o.state), pos)
		D.BUBBLE:
			A.draw_frame(self, "bubble", A.frame("bubble", "size", o.counter), pos)
		D.EEL:
			A.draw_at(self, "eel", A.frame("eel", "swim_r" if o.xd > 0 else "swim_l", o.counter / 2), pos)
		D.GAR:
			var dir := "r" if o.xd > 0 else "l"
			if o.state >= 2:
				A.draw_at(self, "gar", A.frame("gar", "dead_" + dir), pos)
			else:
				A.draw_at(self, "gar", A.frame("gar", "swim_" + dir, o.counter / 2), pos)
		D.MINNOW:
			A.draw_at(self, "minnow", A.frame("minnow", "swim_r" if o.xd > 0 else "swim_l", o.counter / 2), pos)
		D.DUSKWING:
			A.draw_at(self, "duskwing", A.frame("duskwing", "fly", o.counter / 2), pos)
		D.PIPTOAD:
			var dir := "r" if o.xd >= 0 else "l"
			var tag := "sit_"
			if o.state == 1:
				tag = "down_" if o.yd > 0 else "up_"
			A.draw_at(self, "piptoad", A.frame("piptoad", tag + dir), pos)
		D.SIGNPOST:
			A.draw_frame(self, "signpost", 0, pos)
		D.HEARTCRYSTAL:
			if o.statecount < 59:
				A.draw_frame(self, "heartcrystal", A.frame("heartcrystal", "cracked" if o.info1 >= 20 else "whole"), pos)
		D.TURRET:
			A.draw_at(self, "turret", A.frame("turret", "glow" if o.statecount > 32 else "aim", o.xd + 2), pos)
		D.STINGMOTE:
			var tag := "hover" if o.xd == 0 else ("fly_r" if o.xd > 0 else "fly_l")
			A.draw_at(self, "stingmote", A.frame("stingmote", tag, o.counter / 2), pos)
		D.CREEPER:
			var n: int = o.counter / 2
			A.draw_at(self, "creeper", A.frame("creeper", "climb", n if o.yd < 0 else 7 - n), pos)
		D.LOOMSPIDER:
			A.draw_at(self, "loomspider", A.frame("loomspider", "walk_r" if o.xd > 0 else "walk_l", o.counter / 2), pos)
		D.GLASSBOLT:
			A.draw_at(self, "glassbolt", A.frame("glassbolt", "spin", o.counter / 4), pos, o.xd > 0)
		D.SIGIL:
			A.draw_at(self, "sigil", o.state, pos + Vector2(0, [0, -1, -2, -1][(gc / 3) % 4]))
		D.REGENT:
			if o.statecount < 59:
				var tag := "idle"
				if o.substate >= 50 or o.zaphold > 0:
					tag = "hurt"
				elif o.state > 0:
					tag = "cast"
				A.draw_at(self, "regent", A.frame("regent", tag, gc / 6), pos)
		D.SENTRY:
			A.draw_at(self, "sentry", A.frame("sentry", "walk_r" if o.xd > 0 else "walk_l", o.counter / 4), pos)
		D.BURROWHOG:
			var dir := "r" if o.xd >= 0 else "l"
			if o.state >= 4:
				A.draw_at(self, "burrowhog", A.frame("burrowhog", "hit", o.statecount), pos, dir == "l")
			elif o.xd == 0:
				A.draw_at(self, "burrowhog", A.frame("burrowhog", "idle_" + dir, o.counter / 5), pos)
			else:
				A.draw_at(self, "burrowhog", A.frame("burrowhog", "walk_" + dir, o.counter / 2), pos)
		D.URCHIN:
			A.draw_at(self, "urchin", A.frame("urchin", "float", (gc / 4) % 2), pos)
		_:
			pass


func _tint() -> Color:
	var ou: int = g.pl["ouched"]
	if ou > 0:
		return Color(1.0, 0.45, 0.4)
	if ou < 0 or g.invcount(D.INV_WARD):
		return Color(0.55, 0.7, 1.0) if (g.gamecount / 3) % 2 == 0 or ou < 0 else Color.WHITE
	if g.pl["health"] == 1 and (g.gamecount / 3) % 2 == 0:
		return Color(1.0, 0.5, 0.45)
	return Color.WHITE


func _hero(p, pos: Vector2) -> void:
	# X_PLAYER.C msg_player (draw)
	var face := "r" if p.info1 >= 0 else "l"
	var tag := "stand_" + face
	var n := 0
	var mod := _tint()
	if g.pl["ouched"] > 0 and p.state != D.ST_DIE:
		tag = "hurt_" + face
	else:
		match p.state:
			D.ST_STAND:
				if p.statecount < 0:
					tag = "land"
				elif p.yd == 3:
					tag = "squat"
				elif p.yd == -3:
					tag = "look_up"
				elif p.xd == 0 and p.statecount >= 3:
					if p.statecount >= 60:
						tag = "front"
						n = 1 if (p.statecount / 6) % 9 == 0 else 0
				else:
					if p.substate != 7:
						tag = "run_" + ("r" if p.xd > 0 else "l")
						n = (p.substate & 7) / 2
			D.ST_JUMPING:
				if p.xd == 0:
					tag = "jump_up" if p.yd <= 0 else "fall_down"
				else:
					tag = ("jump_" if p.yd <= 0 else "fall_") + ("r" if p.xd > 0 else "l")
			D.ST_CLIMBING:
				tag = "climb"
				n = [0, 0, 1, 2, 2, 1, 1][clampi(p.substate, 0, 6)]
			D.ST_BEGIN:
				# rising out of the ground, clipped at the feet line (X_PLAYER.C st_begin)
				var t: Texture2D = A.sprite("hero")
				var f: int = A.frame("hero", "front")
				var m: Dictionary = A.meta("hero")
				var rise: int = mini(p.statecount, 40)
				var top := pos + Vector2(-m["origin"][0], -m["origin"][1] + 41 - rise)
				var feet := pos.y + 40
				var vis := clampf(feet - top.y, 0, 48)
				if t and vis > 0:
					draw_texture_rect_region(t, Rect2(top, Vector2(32, vis)), Rect2(f * 32, 0, 32, vis))
				return
			D.ST_DIE:
				if p.substate == D.DIE_MOTH:
					A.draw_at(self, "moth", A.frame("moth", "fall"), pos)
					return
				if p.substate == D.DIE_BELL:
					A.draw_at(self, "bell", A.frame("bell", "sink"), pos)
					return
				tag = "ash"
				n = mini(p.statecount / 4, 4)
				mod = Color.WHITE
			D.ST_TRANSPORT:
				tag = "warp"
				n = mini(p.statecount / 4, 3)
			D.ST_PLATFORM:
				tag = "squat" if g.dy1 > 0 else ("stand_" + ("r" if p.xd > 0 else "l") if p.xd != 0 else "front")
			D.ST_STILL:
				tag = "front"
	A.draw_at(self, "hero", A.frame("hero", tag, n), pos, false, mod)
	if p.counter > 0 and p.state == D.ST_STAND:
		A.draw_frame(self, "dust", A.frame("dust", "puff", 2 - p.counter / 2), pos + Vector2(4, 32))


func _token(o, pos: Vector2) -> void:
	if o.substate != 0:
		return
	match o.state:
		D.INV_BELL:
			A.draw_frame(self, "bell", A.frame("bell", "still"), pos)
		_:
			var names := {D.INV_LAMP: "lamp", D.INV_GATEKEY: "gatekey", D.INV_BOLT: "bolt", D.INV_MOTH: "moth",
				D.INV_STONES: "stones", D.INV_BOOTS: "boots", D.INV_WARD: "ward"}
			A.draw_frame(self, "token", A.frame("token", names.get(o.state, "bolt")), pos + Vector2(0, [0, -1, -1, 0][(g.gamecount / 3) % 4]))


func _bonus(o, pos: Vector2) -> void:
	match o.state:
		2:
			A.draw_frame(self, "berry", A.frame("berry", "sunberry"), pos)
		6:
			A.draw_frame(self, "berry", A.frame("berry", "plum"), pos)
		8:
			A.draw_frame(self, "berry", A.frame("berry", "fig"), pos)
		14:
			A.draw_frame(self, "berry", A.frame("berry", "starfruit"), pos)
		23:
			A.draw_at(self, "gem", 0, pos)
		3:
			A.draw_at(self, "gem", 1, pos)
		7:
			A.draw_at(self, "gem", 2, pos)
		19:
			A.draw_at(self, "gem", 3, pos)
		9, 10, 11, 12:
			A.draw_frame(self, "rune", o.state - 9, pos)
		13:
			A.draw_frame(self, "note", 0, pos)
		28:
			A.draw_frame(self, "token", A.frame("token", "embers"), pos)
		1:
			A.draw_frame(self, "token", A.frame("token", "bolt"), pos)
		_:
			A.draw_at(self, "gem", 0, pos)


func _digits(s: String, pos: Vector2, counter: int) -> void:
	for i in s.length():
		var d := s.unicode_at(i) - 48
		A.draw_frame(self, "digits", clampi(d, 0, 9), pos + Vector2(i * 5, 0))


func _segmenter(o, pos: Vector2) -> void:
	# X_OBJ2.C msg_centipede (draw): head, body segments, tail
	const MID := [[1, 2, 3, 4, 5, 6], [2, 3, 4, 5, 6, 1], [3, 4, 5, 6, 1, 2], [4, 5, 6, 1, 2, 3], [5, 6, 1, 2, 3, 4], [6, 1, 2, 3, 4, 5]]
	var nseg: int = maxi(0, (o.xl - 28) / 8)
	var ph: int = o.counter / 2
	var headbob := 1 if o.counter < 4 else 0
	if o.xd > 0:
		A.draw_frame(self, "segmenter", A.frame("segmenter", "tail_r"), pos + Vector2(0, 6))
		for s in range(1, nseg + 1):
			A.draw_frame(self, "segmenter", A.frame("segmenter", "body", MID[(s - 1) % 6][ph % 6] - 1), pos + Vector2(4 + s * 8, 5))
		A.draw_frame(self, "segmenter", A.frame("segmenter", "head_r", headbob), pos + Vector2(o.xl - 16, headbob))
	else:
		A.draw_frame(self, "segmenter", A.frame("segmenter", "head_l", headbob), pos + Vector2(0, headbob))
		for s in range(1, nseg + 1):
			A.draw_frame(self, "segmenter", A.frame("segmenter", "body", MID[(s - 1) % 6][ph % 6] - 1), pos + Vector2(8 * (s + 1), 5))
		A.draw_frame(self, "segmenter", A.frame("segmenter", "tail_l"), pos + Vector2(o.xl - 12, 6))
