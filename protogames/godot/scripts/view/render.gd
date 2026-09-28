class_name GameView
extends Node2D
## Draws the Game state: parallax backgrounds, tiles, entities, hero, weather and HUD.
## Holds presentation-only state (weather particles, lightning timer); never touches rules.

const HUD_H := 32
const T := 16

var game: Game = null
var scanlines := false
var frame := 0
var ambient: Dictionary = {}     # area -> weather config from content/art/areas.json
var _rain: Array = []
var _lightning := 0
var _bolt_seed := 0

# placeholder colours used until the art exists
const PH_COL := {"ghoul": Color(0.4, 0.55, 0.35), "bat": Color(0.45, 0.2, 0.5), "wisp": Color(0.8, 0.7, 0.5),
	"knight": Color(0.55, 0.55, 0.65), "skel": Color(0.85, 0.85, 0.8), "warg": Color(0.3, 0.25, 0.25),
	"drowned": Color(0.2, 0.5, 0.5), "raven": Color(0.15, 0.15, 0.2), "imp": Color(0.7, 0.3, 0.2),
	"ghost": Color(0.7, 0.8, 1.0, 0.6), "pillar": Color(0.5, 0.4, 0.3), "candle": Color(1, 0.8, 0.3),
	"item": Color(1, 0.3, 0.4), "boss_nightwing": Color(0.35, 0.1, 0.35)}


func _ready() -> void:
	var a: Variant = Assets.json("res://content/art/areas.json")
	if a is Dictionary:
		ambient = a
	for i in 70:
		_rain.append(Vector2(randf() * 320, randf() * 224))


func area() -> String:
	var l := game.lvl()
	return String(l.meta.get("area", "courtyard")) if l != null else "courtyard"


func _process(_d: float) -> void:
	frame += 1
	queue_redraw()


# ======================================================================== draw

func _draw() -> void:
	if game == null or game.s.is_empty():
		return
	var s: Dictionary = game.s
	var cam := Vector2(float(s.cam.x), float(s.cam.y))
	var shake := Vector2.ZERO
	if int(s.flash) > 0:
		shake = Vector2(0, 0)
	var ar := area()
	var cfg: Dictionary = ambient.get(ar, {})
	_draw_background(ar, cam, cfg)
	draw_set_transform(Vector2(-cam.x, HUD_H - cam.y).round() + shake)
	_draw_tiles(ar, cam)
	_draw_entities(false)
	_draw_hero()
	_draw_entities(true)
	draw_set_transform(Vector2.ZERO)
	_draw_weather(cfg)
	if int(s.flash) > 0 and int(s.flash) % 4 < 2:
		draw_rect(Rect2(0, HUD_H, 320, 192), Color(1, 1, 1, 0.55))
	if int(s.freeze) > 0 and int(s.freeze) % 30 < 20:
		draw_rect(Rect2(0, HUD_H, 320, 192), Color(0.4, 0.6, 1.0, 0.12))
	_draw_hud()
	var line: String = s.boss.get("line", "")
	if line != "":
		var w := Assets.text_width(line) + 16
		var r := Rect2(160 - w / 2.0, 188, w, 18)
		draw_rect(r, Color(0.03, 0.01, 0.03, 0.9))
		draw_rect(r, Color(0.5, 0.12, 0.12), false, 1.0)
		Assets.draw_text_centered(self, line, 160, 193, Color(0.95, 0.85, 0.85))
	_draw_mode_overlay()
	if scanlines:
		for y in range(0, 224, 2):
			draw_line(Vector2(0, y + 0.5), Vector2(320, y + 0.5), Color(0, 0, 0, 0.18))


func _draw_background(ar: String, cam: Vector2, cfg: Dictionary) -> void:
	draw_rect(Rect2(0, 0, 320, 224), Color.from_string(String(cfg.get("sky", "#0c0a1a")), Color.BLACK))
	var layers: Array = cfg.get("layers", [])
	for L in layers:
		var tex := Assets.texture("res://content/art/%s.png" % String(L.file))
		if tex == null:
			continue
		var fx: float = float(L.get("px", 0.5))
		var fy: float = float(L.get("py", 0.2))
		var drift: float = float(L.get("drift", 0.0)) * frame
		var tw := tex.get_width()
		var ox := -fposmod(cam.x * fx + drift, tw)
		var oy: float = HUD_H + float(L.get("y", 0)) - cam.y * fy
		var x := ox
		while x < 320:
			draw_texture(tex, Vector2(round(x), round(oy)))
			x += tw
	# background creatures: a few bats crossing the far sky
	if cfg.get("bats", false):
		for i in 3:
			var ph := float(frame + i * 700) / 900.0
			var bx := fposmod(ph * 420.0 + i * 131.0, 420.0) - 50.0
			var by := HUD_H + 30.0 + i * 18.0 + sin(ph * 40.0) * 6.0
			var wing := 2.0 if (frame / 6 + i) % 2 == 0 else -1.0
			var col := Color(0.12, 0.08, 0.16)
			draw_rect(Rect2(bx, by, 3, 2), col)
			draw_line(Vector2(bx, by + 1), Vector2(bx - 4, by - wing), col)
			draw_line(Vector2(bx + 3, by + 1), Vector2(bx + 7, by - wing), col)
	# lightning lights the sky from behind the castle
	if _lightning > 0 and _lightning % 6 < 3:
		draw_rect(Rect2(0, HUD_H, 320, 192), Color(0.8, 0.85, 1.0, 0.35))


func _tile_src(c: String, cx: int, cy: int, l: Level) -> int:
	var hsh := (cx * 7349 + cy * 1931) & 0xffff
	match c:
		"#":
			var above := l.ch(cx, cy - 1)
			if not Level.SOLID.contains(above) or above == "=":
				return 0 + hsh % 2
			return 2 + hsh % 3
		"%":
			return 8 + hsh % 2
		"=":
			var lft := l.ch(cx - 1, cy) == "="
			var rgt := l.ch(cx + 1, cy) == "="
			return 6 if lft and rgt else (5 if not lft else 7)
		"X":
			return 10
		"/":
			return 11
		"\\":
			return 12
		"~":
			return 13 + (frame / 12 + cx) % 2
		"^":
			return 15
	return -1


func _draw_tiles(ar: String, cam: Vector2) -> void:
	var l := game.lvl()
	var tex := Assets.texture("res://content/art/tiles_%s.png" % ar)
	var cx0 := maxi(0, floori(cam.x / T))
	var cx1 := mini(l.w - 1, floori((cam.x + 320) / T))
	var cy0 := maxi(0, floori(cam.y / T))
	var cy1 := mini(l.h - 1, floori((cam.y + 192) / T))
	var broken: Dictionary = game.s.broken
	for cy in range(cy0, cy1 + 1):
		var row: String = l.rows[cy]
		for cx in range(cx0, cx1 + 1):
			var c := row[cx]
			if c == ".":
				continue
			if c == "X" and broken.has(Vector2i(cx, cy)):
				continue
			var idx := _tile_src(c, cx, cy, l)
			if idx < 0:
				continue
			var dst := Rect2(cx * T, cy * T, T, T)
			if tex != null:
				draw_texture_rect_region(tex, dst, Rect2((idx % 8) * T, (idx / 8) * T, T, T))
			else:
				var col := Color(0.35, 0.33, 0.4)
				if c == "=": col = Color(0.5, 0.4, 0.35)
				elif c == "X": col = Color(0.45, 0.35, 0.3)
				elif c == "~": col = Color(0.1, 0.25, 0.5)
				elif c == "/" or c == "\\": col = Color(0.6, 0.55, 0.45)
				if c == "/":
					for i in 4:
						draw_rect(Rect2(cx * T + i * 4, cy * T + 12 - i * 4, 4, 4 + i * 4), col)
				elif c == "\\":
					for i in 4:
						draw_rect(Rect2(cx * T + 12 - i * 4, cy * T + 12 - i * 4, 4, 4 + i * 4), col)
				else:
					draw_rect(dst, col)
					draw_rect(dst, col.darkened(0.4), false, 1.0)


func _draw_entities(front: bool) -> void:
	for e in game.s.ents:
		var t: String = e.t
		if t == "sp" or t == "zone" or t == "bosstrig" or t == "exit":
			continue
		var is_front := t.begins_with("fx_") or t.begins_with("pw_") or t.begins_with("ep_")
		if is_front != front:
			continue
		if t == "item" and int(e.life) < 60 and int(e.life) % 6 < 3:
			continue
		if e.get("hidden", false) and String(e.get("st", "")) != "fade":
			continue
		_draw_links(e)
		var pos := Vector2(e.x, e.y)
		var anim := _entity_anim(e)
		var sh := Assets.sheet_for(anim)
		var fr := Assets.anim_frame(sh, anim, int(e.tt))
		if fr == "":
			sh = Assets.sheet_for(t)
			fr = Assets.anim_frame(sh, t, int(e.tt))
		var mod := Color.WHITE
		if e.get("flash", 0) > 0 and int(e.flash) % 4 < 2:
			mod = Color(3, 3, 3)
		if t == "ghost":
			mod.a = 0.75
		if fr != "" and Assets.draw_frame(self, sh, fr, pos, int(e.face) < 0, mod):
			if t == "fx_score":
				Assets.draw_text_centered(self, str(e.n), e.x, e.y - 8, Color(1, 0.9, 0.6))
			continue
		_draw_placeholder(e)


func _draw_links(e: Dictionary) -> void:
	## Chains, rods and spines that join a boss to its parts.
	var t: String = e.t
	if t == "boss_wyrm":
		var trail: Array = e.get("trail", [])
		# vertebrae along the path the skull took; smaller toward the tail
		var sh := Assets.sheet_for("wyrm_seg")
		var big := Assets.anim_frame(sh, "wyrm_seg", 0)
		var small := Assets.anim_frame(sh, "wyrm_seg_small", 0)
		var k := mini(trail.size() - 1, 54)
		while k >= 5:
			var v: Vector2 = trail[k]
			if v.y < float(e.fy) + 6:
				Assets.draw_frame(self, sh, small if k > 33 else big, v + Vector2(0, 4), false)
			k -= 5
	elif t == "ep_lantern" or t == "ep_blade":
		var owner: Variant = null
		if t == "ep_lantern":
			for b in game.s.ents:
				if String(b.t) == "boss_warden" and int(b.get("lantern", 0)) == int(e.id):
					owner = Vector2(b.x + int(b.face) * 10, b.y - 34)
		else:
			owner = Vector2(float(e.px), float(e.py))
		if owner != null:
			var a: Vector2 = owner
			var bpos := Vector2(e.x, e.y - 8)
			var n := int(a.distance_to(bpos) / 3.0)
			for i in n:
				var q := a.lerp(bpos, float(i) / maxf(1, n))
				draw_rect(Rect2(q.round(), Vector2(2, 2)), Color(0.48, 0.5, 0.56) if i % 2 == 0 else Color(0.24, 0.23, 0.3))


func _entity_anim(e: Dictionary) -> String:
	var t: String = e.t
	match t:
		"candle":
			return {"i": "candle", "I": "brazier", "j": "lamp"}.get(e.look, "candle")
		"item":
			return "item_" + String(e.kind)
		"pw_flame":
			return "pw_flame"
		"fx_score":
			return "none"
	var st: String = e.get("st", "")
	if st != "":
		return t + "_" + st
	return t


func _draw_placeholder(e: Dictionary) -> void:
	var t: String = e.t
	var r := Game.box(e)
	if t == "fx_score":
		Assets.draw_text_centered(self, str(e.n), e.x, e.y - 8, Color(1, 0.9, 0.6))
		return
	if t.begins_with("fx_"):
		var k := float(e.tt) / 16.0
		draw_circle(Vector2(e.x, e.y), 3.0 + k * 6.0, Color(1, 0.8, 0.4, 1.0 - k))
		return
	var col: Color = PH_COL.get(t, Color(1, 0.4, 0.2) if t.begins_with("ep_") else Color(0.9, 0.9, 1.0))
	if t == "item":
		if e.kind == "heart" or e.kind == "bigheart":
			col = Color(0.95, 0.2, 0.3)
		elif e.kind == "orb":
			col = Color(0.4, 0.8, 1.0)
		else:
			col = Color(0.95, 0.85, 0.3)
	if e.get("flash", 0) > 0 and int(e.flash) % 4 < 2:
		col = Color.WHITE
	draw_rect(r, col)
	if t == "item":
		Assets.draw_text(self, String(e.kind).substr(0, 1).to_upper(), r.position + Vector2(2, 1), Color.BLACK, false, false)


# ------------------------------------------------------------------ hero

func hero_anim() -> Array:
	## [animation name, time into it in frames]
	var p: Dictionary = game.s.p
	var st: String = p.st
	if st == "dead":
		return ["hero_die", int(p.st_t)]
	if st == "hurt":
		return ["hero_hurt", int(p.st_t)]
	if int(p.atk) > 0:
		var a: int = int(p.atk) - 1
		if p.atk_kind == "sub":
			return ["hero_crouch_throw" if p.crouch else "hero_throw", a]
		if st == "air":
			return ["hero_jump_whip", a]
		if p.crouch:
			return ["hero_crouch_whip", a]
		if st == "stair":
			var d: int = game.lvl().stairs[int(p.stair)].dir
			return ["hero_stair_up_whip" if d == int(p.face) else "hero_stair_down_whip", a]
		return ["hero_whip", a]
	match st:
		"land":
			return ["hero_crouch", 99]
		"air":
			if float(p.vy) < -1.2:
				return ["hero_jump", int(p.st_t)]
			return ["hero_fall", int(p.st_t)]
		"stair":
			var sd: int = game.lvl().stairs[int(p.stair)].dir
			return ["hero_stair_up" if sd == int(p.face) else "hero_stair_down", int(p.walk_t)]
		"walk", "approach":
			return ["hero_walk", int(p.walk_t)]
	if p.crouch:
		return ["hero_crouch", 99]
	return ["hero_idle", frame]


func _draw_hero() -> void:
	var p: Dictionary = game.s.p
	if int(p.inv) > 0 and p.st != "hurt" and p.st != "dead" and (int(p.inv) / 2) % 2 == 0:
		return
	var mod := Color.WHITE
	if int(p.ghost) > 0:
		mod = Color(0.7, 0.8, 1.0, 0.45 if frame % 4 < 2 else 0.25)
	var sh := Assets.sheet("hero")
	var ha := hero_anim()
	var fr := Assets.anim_frame(sh, String(ha[0]), int(ha[1]))
	var pos := Vector2(p.x, p.y)
	var flip: bool = int(p.face) < 0
	_draw_whip(p, sh)
	if fr == "" or not Assets.draw_frame(self, sh, fr, pos, flip, mod):
		var h := Game.PH_CROUCH if p.crouch else Game.PH
		draw_rect(Rect2(p.x - 5, p.y - h, 10, h), Color(0.25, 0.5, 0.85, mod.a))
		draw_rect(Rect2(p.x - 3 + int(p.face) * 2, p.y - h + 2, 4, 4), Color(0.95, 0.8, 0.7, mod.a))


func _draw_whip(p: Dictionary, sh: Dictionary) -> void:
	if int(p.atk) == 0 or p.atk_kind != "whip":
		return
	var a: int = int(p.atk)
	var lv: int = int(p.whip)
	var phase := "back" if a <= 3 else ("mid" if a <= Game.WHIP_WIND else "out")
	if a > Game.WHIP_WIND + Game.WHIP_ACTIVE + 2:
		return
	# the lash hangs from the hand of the frame being shown
	var ha := hero_anim()
	var fr := Assets.anim_frame(sh, String(ha[0]), int(ha[1]))
	var face: int = int(p.face)
	var grip := Vector2(p.x, p.y - 34)
	if fr != "" and sh.frames.has(fr) and sh.frames[fr].has("hx"):
		var f: Dictionary = sh.frames[fr]
		grip = Vector2(p.x + face * float(f.hx), p.y + float(f.hy))
	if phase == "out":
		# level with the hitbox, whatever the arm is doing this frame
		var wr: Variant = game.whip_rect()
		var ly: float = p.y - (27.0 if p.crouch else 34.0)
		grip = Vector2(p.x + face * 20.0, ly)
	var name := "whip%d_%s" % [lv, phase]
	if not Assets.draw_frame(self, sh, name, grip, face < 0):
		var wr2: Variant = game.whip_rect()
		if wr2 != null:
			var r: Rect2 = wr2
			draw_rect(Rect2(r.position.x, r.position.y + 2, r.size.x, 3), Color(0.9, 0.75, 0.5))


# ------------------------------------------------------------------ weather

func _draw_weather(cfg: Dictionary) -> void:
	var rain: bool = cfg.get("rain", false)
	var fog: bool = cfg.get("fog", false)
	if cfg.get("lightning", false):
		if _lightning > 0:
			_lightning -= 1
		elif frame % 7 == 0 and (hash(frame / 7) & 1023) < 6:
			_lightning = 18
			_bolt_seed = frame
	if rain:
		for i in _rain.size():
			var r: Vector2 = _rain[i]
			r.x = fposmod(r.x - 2.0, 320.0)
			r.y += 6.0
			if r.y > 224:
				r.y = HUD_H + fposmod(r.y, 16.0)
			_rain[i] = r
			draw_line(Vector2(r.x, r.y), Vector2(r.x + 2, r.y - 6), Color(0.6, 0.65, 0.85, 0.45))
	if fog:
		var tex := Assets.texture("res://content/art/fog.png")
		if tex != null:
			var ox := -fposmod(frame * 0.25 + float(game.s.cam.x) * 1.1, tex.get_width())
			var x := ox
			while x < 320:
				draw_texture(tex, Vector2(round(x), 224 - tex.get_height()), Color(1, 1, 1, 0.8))
				x += tex.get_width()


# ------------------------------------------------------------------ HUD

func _draw_hud() -> void:
	var s: Dictionary = game.s
	var p: Dictionary = s.p
	draw_rect(Rect2(0, 0, 320, HUD_H), Color(0.02, 0.01, 0.03))
	draw_line(Vector2(0, HUD_H - 0.5), Vector2(320, HUD_H - 0.5), Color(0.35, 0.18, 0.12))
	var gold := Color(0.95, 0.82, 0.5)
	Assets.draw_text(self, "SCORE %06d" % int(s.score), Vector2(4, 2), gold)
	Assets.draw_text(self, "TIME %03d" % int(s.time), Vector2(98, 2), Color(1, 0.4, 0.3) if int(s.time) <= 30 else gold)
	var blk: String = s.block
	Assets.draw_text(self, "STAGE %s" % blk, Vector2(160, 2), gold)
	Assets.draw_text(self, "HERO", Vector2(4, 12), Color(0.9, 0.85, 0.8))
	Assets.draw_text(self, "FOE", Vector2(4, 21), Color(0.9, 0.85, 0.8))
	_bar(Vector2(32, 13), int(p.hp), Game.HP_MAX, Color(0.9, 0.35, 0.25))
	var bh: int = 16
	var boss: Dictionary = s.boss
	if int(boss.id) != 0:
		bh = int(round(float(boss.hp) * 16.0 / maxf(1.0, float(boss.max))))
	_bar(Vector2(32, 22), bh, 16, Color(0.95, 0.75, 0.3))
	# sub-weapon frame
	var box := Rect2(122, 11, 26, 19)
	draw_rect(box, Color(0.1, 0.05, 0.05))
	draw_rect(box, Color(0.7, 0.3, 0.2), false, 1.0)
	if p.sub != "":
		var sh := Assets.sheet_for("item_" + String(p.sub))
		if not Assets.draw_frame(self, sh, Assets.anim_frame(sh, "item_" + String(p.sub), 0), Vector2(135, 27), false):
			Assets.draw_text_centered(self, String(p.sub).substr(0, 3).to_upper(), 135, 16, Color.WHITE)
	Assets.draw_text(self, "~%02d" % int(p.hearts), Vector2(154, 13), Color(1, 0.45, 0.5))
	Assets.draw_text(self, "P%02d" % maxi(0, int(s.lives)) if not s.get("inf_lives", false) else "P--", Vector2(154, 22), gold)
	if int(p.shot) > 1:
		Assets.draw_text(self, "II" if int(p.shot) == 2 else "III", Vector2(180, 13), Color(0.6, 0.9, 1.0))
	# whip level pips
	for i in int(p.whip):
		draw_rect(Rect2(182 + i * 5, 24, 3, 3), Color(0.9, 0.8, 0.6))
	if int(boss.id) != 0:
		Assets.draw_text(self, String(boss.name), Vector2(212, 21), Color(0.95, 0.6, 0.4))
	else:
		var nm: String = game.lvl().meta.get("name", "")
		Assets.draw_text(self, nm.substr(0, 17), Vector2(212, 21), Color(0.7, 0.65, 0.6))


func _bar(pos: Vector2, n: int, of: int, col: Color) -> void:
	for i in of:
		var r := Rect2(pos.x + i * 5, pos.y, 4, 6)
		draw_rect(r, col if i < n else Color(0.18, 0.1, 0.1))
		if i < n:
			draw_rect(Rect2(r.position.x, r.position.y, 4, 1), col.lightened(0.4))


func _draw_mode_overlay() -> void:
	var s: Dictionary = game.s
	var m: String = s.mode
	var t: int = s.mode_t
	if m == "trans":
		var a := 1.0 - absf(float(t) - 24.0) / 24.0
		draw_rect(Rect2(0, HUD_H, 320, 192), Color(0, 0, 0, clampf(a * 1.4, 0, 1)))
	elif m == "dying" and t > 90:
		draw_rect(Rect2(0, HUD_H, 320, 192), Color(0, 0, 0, clampf((t - 90) / 50.0, 0, 1)))
	elif m == "clear":
		Assets.draw_text_centered(self, "STAGE CLEAR", 160, 100, Color(1, 0.85, 0.5), true)
		Assets.draw_text_centered(self, "TIME BONUS  %d" % int(s.time), 160, 130, Color.WHITE)
	elif m == "play" and t < 100 and s.block.ends_with("-1") and int(s.frame) < 100000000:
		var l := game.lvl()
		if t < 90:
			var al := clampf(minf(t / 15.0, (90 - t) / 15.0), 0, 1)
			Assets.draw_text_centered(self, "STAGE %d" % int(s.stage), 160, 90, Color(1, 0.85, 0.5, al), true)
			Assets.draw_text_centered(self, String(l.meta.get("title", l.meta.get("name", ""))), 160, 116, Color(0.9, 0.9, 0.9, al))
