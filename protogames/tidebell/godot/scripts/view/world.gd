## Draws a stage in play: two parallax backdrops, the tiles, every object and the hero,
## at the core's camera. It reads the core (scripts/core/game.gd) and changes nothing.
extends Node2D

const T := 16

var A
var g = null
var theme := "reach"
var frame := 0


func setup(assets) -> void:
	A = assets


func _process(_delta: float) -> void:
	frame += 1
	queue_redraw()


func _draw() -> void:
	if g == null:
		return
	var cx: int = g.cam_x
	var cy: int = g.cam_y
	draw_backdrop("far", cx, cy, 0.2)
	draw_backdrop("mid", cx, cy, 0.45)
	draw_set_transform(Vector2(-cx, -cy))
	draw_tiles(cx, cy)
	for o in g.objs:
		draw_obj(o)
	draw_player()
	draw_set_transform(Vector2.ZERO)


func draw_backdrop(layer: String, cx: int, cy: int, k: float) -> void:
	var t: Texture2D = A.tex("backdrops/%s_%s" % [theme, layer])
	if t == null:
		if layer == "far":
			draw_rect(Rect2(0, 0, 320, 224), Color(0.1, 0.12, 0.2))
		return
	var w := t.get_width()
	var ox := -posmod(int(cx * k), w)
	var span: int = maxi(0, g.lh * T - 224)
	var oy := -int(minf(float(cy) * k * 0.5, 0.0 + span)) if span > 0 else 0
	if layer == "far":
		oy = 0
	var x := ox
	while x < 320:
		draw_texture(t, Vector2(x, oy))
		x += w


func tile_at(tx: int, ty: int) -> int:
	return g.tile(tx, ty)


func is_solid(c: int) -> bool:
	return c == 35


func draw_tiles(cx: int, cy: int) -> void:
	var sheet: Texture2D = A.tex("tiles/" + theme)
	if sheet == null:
		return
	var cells: Array = A.manifest["tiles"]["cells"]
	var x0 := maxi(0, cx >> 4)
	var x1 := mini(g.lw - 1, (cx + 320) >> 4)
	var y0 := maxi(0, cy >> 4)
	var y1 := mini(g.lh - 1, (cy + 224) >> 4)
	var wall_col: int = (g.arena_left >> 4) if g.arena_left >= 0 else -1
	for ty in range(y0, y1 + 1):
		for tx in range(x0, x1 + 1):
			var c: int = g.rows[ty][tx]
			var name := ""
			match c:
				35:
					var up := tile_at(tx, ty - 1)
					if up != 35 and up != 76:
						var l := tile_at(tx - 1, ty) == 35
						var r := tile_at(tx + 1, ty) == 35
						name = "top_l" if not l and tx > 0 else ("top_r" if not r and tx < g.lw - 1 else
							("top_alt" if (tx * 7 + ty * 3) % 5 == 0 else "top"))
					elif tile_at(tx, ty + 1) != 35 and ty + 1 < g.lh:
						name = "under"
					else:
						name = "inner_alt" if (tx * 5 + ty * 11) % 7 == 0 else "inner"
				88:
					if tx == wall_col:
						continue          # the arena's wall is not drawn
					name = "crate"
				61:
					var l2 := tile_at(tx - 1, ty) == 61
					var r2 := tile_at(tx + 1, ty) == 61
					name = "ledge_l" if not l2 else ("ledge_r" if not r2 else "ledge")
				72:
					name = "climb_top" if tile_at(tx, ty - 1) != 72 else "climb"
				94:
					name = "spikes"
				76:
					name = "gate"
				126:
					name = "water_top" if tile_at(tx, ty - 1) != 126 else "water"
				_:
					# a tuft or ornament on open ground now and then
					if tile_at(tx, ty + 1) == 35 and (tx * 13 + ty * 7) % 9 == 0:
						name = "deco%d" % ((tx + ty) % 4)
					else:
						continue
			var i := cells.find(name)
			if i < 0:
				continue
			draw_texture_rect_region(sheet, Rect2(tx * T, ty * T, T, T), Rect2((i % 8) * T, (i / 8) * T, T, T))


func flash_mod(o: Dictionary) -> Color:
	if int(o.get("flash", 0)) > 0 and (int(o["flash"]) >> 1) % 2 == 0:
		return Color(2.4, 2.4, 2.4)
	return Color.WHITE


func draw_obj(o: Dictionary) -> void:
	var at := Vector2(o["x"] >> 16, o["y"] >> 16)
	var k: String = o["k"]
	var t: int = o["t"]
	var st: String = o["st"]
	var flip: bool = o["face"] < 0
	var mod := flash_mod(o)
	var spr := k
	var tag := ""
	var n := 0
	match k:
		"raider", "grane":
			match st:
				"windup": tag = "windup"
				"cut": tag = "cut"; n = mini(1, t >> 2)
				"knock": tag = "hurt"
				"back": tag = "back"
				_:
					tag = "walk" if o["vx"] != 0 else "stand"
					n = t >> 3
			if int(o.get("asleep", 0)) == 1:
				tag = "stand"
		"thrower":
			tag = "throw" if t < 12 and st != "knock" else ("hurt" if st == "knock" else ("walk" if o["vx"] != 0 else "stand"))
			n = t >> 3 if tag != "throw" else mini(1, t >> 2)
		"mudskip":
			tag = "stand" if o["ground"] else "hop"
			n = t >> 4
		"bat":
			tag = "hang" if st == "idle" else "fly"
			n = t >> 2
		"crab":
			tag = "walk"
			n = t >> 3
		"gull":
			tag = "fly"
			n = t >> 3
		"wisp":
			tag = "float"
			n = t >> 3
		"golem":
			tag = "windup" if st == "windup" else ("slam" if st == "cool" and t < 14 else "walk")
			n = t >> 4
		"vell":
			tag = {"leap": "leap", "throw": "throw"}.get(st, "walk" if o["vx"] != 0 else "stand")
			n = t >> 3 if tag != "throw" else mini(1, t / 14)
		"hullbreaker":
			tag = {"charge": "charge", "rest": "rest"}.get(st, "walk")
			n = t >> 2 if tag == "charge" else t >> 4
		"tallyman":
			tag = {"hop": "hop", "lob": "lob"}.get(st, "stand")
			n = t >> 3
		"oldgrey":
			tag = "dive" if st == "dive" else "fly"
			n = t >> 3
		"warden":
			if st == "vanish":
				if t > 6 and t < 34:
					return
				mod = Color(1, 1, 1, 0.5)
			tag = "cast" if st == "cast" and t > 35 and t < 60 else "float"
			n = t >> 3
		"siltking":
			tag = {"slam": "slam", "wave": "wave"}.get(st, "stand")
			n = (1 if t > 30 else 0) if tag == "slam" else t >> 4
		"chest":
			tag = "shut"
		"post":
			tag = "lit" if int(o.get("lit", 0)) == 1 else "dark"
			n = t >> 3
		"captive":
			tag = "wave" if st == "free" else "stand"
			n = t >> 3
			flip = false
		"pickup":
			spr = "items"
			tag = String(o["what"])
			if tag == "coin" and (frame >> 3) % 2 == 1:
				tag = "coin"
		"bell":
			tag = "shine"
			n = frame >> 3
		"knife":
			tag = "fly"
		"bottle", "bomb":
			tag = "spin"
			n = t >> 2
		"net":
			tag = "fly"
		"blast":
			tag = "burst"
			n = mini(2, t / 5)
		"feather":
			tag = "fall"
		"spark":
			tag = "glow"
			n = t >> 2
		"shock":
			tag = "run"
			n = t >> 2
		"wave":
			tag = "roll"
			n = t >> 3
		"fx", "coinfx":
			spr = "fx"
			tag = "poof"
			n = mini(3, t / 4)
		_:
			return
	A.draw_at(self, spr, A.frame(spr, tag, n), at, flip, mod)


func draw_player() -> void:
	var p: Dictionary = g.p
	var hero: String = g.hero
	var st: String = p["st"]
	var tag := st
	var n := 0
	match st:
		"stand":
			n = g.tick >> 5
		"walk":
			n = g.tick / 5
		"attack":
			tag = ["cut0", "cut1", "spin"][int(p["combo"])]
			n = mini(2, int(p["atk"]) * 3 / maxi(1, int(p["alen"])))
		"cattack":
			n = mini(2, int(p["atk"]) * 3 / maxi(1, int(p["alen"])))
		"jattack":
			n = mini(1, int(p["atk"]) * 2 / maxi(1, int(p["alen"])))
		"special":
			n = mini(3, int(p["atk"]) * 4 / maxi(1, int(p["alen"])))
		"climb":
			n = (p["y"] >> 19)
		"dead":
			n = 0 if g.mode_t > 60 else 1
		"crouch", "jump", "fall", "hurt":
			pass
		_:
			tag = "stand"
	if p["inv"] > 0 and st != "dead" and st != "hurt" and (p["inv"] >> 2) % 2 == 1:
		return
	var at := Vector2(p["x"] >> 16, p["y"] >> 16)
	A.draw_at(self, hero, A.frame(hero, tag, n), at, p["face"] < 0)
	if p["buff"] == "squall":
		A.draw_at(self, "gust", A.frame("gust", "spin", frame >> 2), at)
	elif p["buff"] == "stoneskin" and (frame >> 3) % 2 == 0:
		A.draw_at(self, hero, A.frame(hero, tag, n), at, p["face"] < 0, Color(0.7, 0.7, 0.8, 0.5))
