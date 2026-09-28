class_name Game
extends RefCounted
## The whole simulation. `s` is a plain Dictionary (ints, floats, strings, arrays,
## dictionaries, Vector2i keys) so it can be deep-copied for rewind and written with
## var_to_str for save-anywhere. Advance with step(input) at a fixed 60 Hz.

const T := 16
const VIEW_W := 320
const VIEW_H := 192          # play area; the HUD sits above it
const VERSION := 1
const STAGES := 6

# --- hero tuning (px, px/frame, frames) -------------------------------------------------
const PW := 10               # hurtbox width
const PH := 40               # standing height
const PH_CROUCH := 26
const WALK := 1.25
const JUMP_V := -4.45
const GRAV := 0.26
const MAX_FALL := 5.0
const STAIR_V := 0.85
const HP_MAX := 16
const WHIP_WIND := 7         # frames before the lash extends
const WHIP_ACTIVE := 8       # frames the lash can hit
const WHIP_REC := 7
const SUB_T := 18            # throw animation length
const INV_T := 100
const KB_VX := 1.1
const KB_VY := -2.7

const WHIP_LEN := [0, 26, 26, 42]
const WHIP_DMG := [0, 1, 2, 2]
const SUB_COST := {"dagger": 1, "axe": 1, "flask": 1, "cross": 1, "glass": 5}

static var _level_files: Dictionary = {}   # stage number -> {block id: Level}

var s: Dictionary = {}
var events: Array = []        # transient per-step events for audio/view: {"sfx": name} ...
var _lvl: Level = null
var _lvl_key := ""


# ======================================================================== setup / load

static func levels_for_stage(n: int) -> Dictionary:
	if not _level_files.has(n):
		var path := "res://content/levels/stage%d.txt" % n
		var text := FileAccess.get_file_as_string(path)
		_level_files[n] = Level.parse_file(text) if text != "" else {}
	return _level_files[n]


static func clear_level_cache() -> void:
	_level_files.clear()


func lvl() -> Level:
	var key: String = s.get("block", "")
	if key != _lvl_key or _lvl == null:
		var st: int = s.get("stage", 1)
		_lvl = levels_for_stage(st).get(key)
		_lvl_key = key
	return _lvl


func new_game(style: String = "classic", stage: int = 1, seed_value: int = 12345) -> void:
	s = {
		"ver": VERSION, "frame": 0, "rng": seed_value & 0x7fffffff,
		"style": style, "stage": stage, "block": "",
		"mode": "play", "mode_t": 0, "mode_next": "",
		"score": 0, "lives": 3, "time": 300, "time_sub": 0,
		"p": _fresh_player(),
		"ents": [], "next_id": 1, "broken": {},
		"cam": {"x": 0.0, "y": 0.0, "lock": false, "lx": 0.0},
		"boss": {"id": 0, "hp": 0, "max": 16, "name": ""},
		"prev_in": {}, "freeze": 0, "flash": 0, "check": "",
		"tally": 0, "cleared": 0, "kills": 0,
		"diff": "normal", "inf_lives": false, "practice": false,
	}
	start_stage(stage)


func _fresh_player() -> Dictionary:
	return {"x": 0.0, "y": 0.0, "vx": 0.0, "vy": 0.0, "face": 1, "st": "stand", "st_t": 0,
		"atk": 0, "atk_kind": "", "atk_id": 0, "hp": HP_MAX, "hearts": 5, "sub": "",
		"shot": 1, "whip": 1, "inv": 0, "ghost": 0, "stair": -1, "sp": 0.0,
		"crouch": false, "coyote": 0, "jbuf": 0, "tx": 0.0, "tdir": 0, "walk_t": 0,
		"sub_thrown": false}


func start_stage(n: int) -> void:
	s.stage = n
	var blocks := levels_for_stage(n)
	var first := "%d-1" % n
	if not blocks.has(first):
		push_error("stage %d has no block %s" % [n, first])
		return
	var l: Level = blocks[first]
	s.time = l.meta_int("time", 300)
	s.time_sub = 0
	s.check = first
	load_block(first)


func load_block(id: String) -> void:
	s.block = id
	s.ents = []
	s.broken = {}
	s.freeze = 0
	s.cam.lock = false
	s.boss = {"id": 0, "hp": 0, "max": 16, "name": ""}
	var l := lvl()
	if l == null:
		push_error("no block " + id)
		return
	var p: Dictionary = s.p
	p.st = "stand"
	p.vx = 0.0
	p.vy = 0.0
	p.atk = 0
	p.stair = -1
	var candle_drops := l.meta_list("candles")
	var hidden := l.meta_list("hidden")
	var ci := 0
	for m in l.marks:
		var c: String = m.c
		match c:
			"@":
				p.x = float(m.x)
				p.y = float(m.y)
				p.face = l.meta_int("face", 1)
			"i", "I", "j":
				var drop := candle_drops[ci] if ci < candle_drops.size() else "heart"
				ci += 1
				var cand := spawn("candle", m.x, m.y)
				cand.drop = drop
				cand.look = c
				cand.w = 10
				cand.h = 20 if c != "I" else 40   # braziers are tall stands, flame on top
			"G", "M", "F":
				var z := spawn("zone", m.x, m.y)
				z.kind = {"G": "ghoul", "M": "wisp", "F": "drowned"}[c]
				z.cd = 30
			"Z":
				var zb := spawn("bosstrig", m.x, m.y)
				zb.kind = l.meta.get("boss", "")
				zb.lx = float(l.meta_int("arena", 0) * T)
			"E":
				var ex := spawn("exit", m.x, m.y)
				ex.w = 16
				ex.h = 16
			_:
				if Actors.MARK_ENEMY.has(c):
					var sp := spawn("sp", m.x, m.y)
					sp.kind = Actors.MARK_ENEMY[c]
					sp.inview = false
					sp.child = 0
	# hidden items inside breakable blocks, reading order
	var hi := 0
	for cy in l.h:
		for cx in l.w:
			if l.rows[cy][cx] == "X":
				var d := hidden[hi] if hi < hidden.size() else "-"
				hi += 1
				if d != "-":
					s.broken[Vector2i(-1000 - cx, cy)] = d   # hidden-drop table, negative x key
	_snap_camera()


func _snap_camera() -> void:
	var l := lvl()
	var p: Dictionary = s.p
	s.cam.x = clampf(p.x - VIEW_W / 2.0, 0.0, maxf(0.0, l.px_w() - VIEW_W))
	s.cam.y = clampf(p.y - 124.0, 0.0, maxf(0.0, l.px_h() - VIEW_H))


# ======================================================================== utilities

func rand() -> int:
	s.rng = (int(s.rng) * 1103515245 + 12345) & 0x7fffffff
	return int(s.rng) >> 8


func randf01() -> float:
	return float(rand() % 65536) / 65536.0


func spawn(t: String, x: float, y: float) -> Dictionary:
	var e := {"id": s.next_id, "t": t, "x": float(x), "y": float(y), "vx": 0.0, "vy": 0.0,
		"w": 12, "h": 12, "hp": 1, "face": 1, "st": "", "tt": 0, "hit": -1, "dead": false}
	s.next_id += 1
	s.ents.append(e)
	return e


func find(id: int) -> Variant:
	for e in s.ents:
		if e.id == id and not e.dead:
			return e
	return null


func sfx(name: String) -> void:
	events.append({"sfx": name})


static func box(e: Dictionary) -> Rect2:
	var w: float = e.w
	var h: float = e.h
	return Rect2(e.x - w / 2.0, e.y - h, w, h)


func player_box() -> Rect2:
	var p: Dictionary = s.p
	var h := PH_CROUCH if p.crouch else PH
	return Rect2(p.x - PW / 2.0, p.y - h, PW, h)


func view_rect(margin: float = 0.0) -> Rect2:
	return Rect2(s.cam.x - margin, s.cam.y - margin, VIEW_W + margin * 2, VIEW_H + margin * 2)


# --- tile collision for any body: e has x (centre), y (feet) --------------------------

func solid_at(px: float, py: float) -> bool:
	return lvl().solid(floori(px / T), floori(py / T), s.broken)


func move_x(e: Dictionary, w: float, h: float) -> bool:
	e.x += e.vx
	var l := lvl()
	var top: float = e.y - h + 0.01
	var bot: float = e.y - 0.01
	var cy0 := floori(top / T)
	var cy1 := floori(bot / T)
	if e.vx > 0:
		var cx := floori((e.x + w / 2.0 - 0.001) / T)
		for cy in range(cy0, cy1 + 1):
			if l.solid(cx, cy, s.broken):
				e.x = cx * T - w / 2.0
				return true
	elif e.vx < 0:
		var cx2 := floori((e.x - w / 2.0) / T)
		for cy in range(cy0, cy1 + 1):
			if l.solid(cx2, cy, s.broken):
				e.x = (cx2 + 1) * T + w / 2.0
				return true
	return false


func move_y(e: Dictionary, w: float, h: float) -> int:
	## returns 1 = landed, 2 = bumped head, 0 = free
	e.y += e.vy
	var l := lvl()
	var cx0 := floori((e.x - w / 2.0 + 0.01) / T)
	var cx1 := floori((e.x + w / 2.0 - 0.01) / T)
	if e.vy > 0:
		var cy := floori((e.y - 0.001) / T)
		var prev_bot: float = e.y - e.vy
		# land only when the feet crossed this row's top edge during the move
		if prev_bot <= cy * T + 0.001:
			for cx in range(cx0, cx1 + 1):
				if l.solid(cx, cy, s.broken):
					e.y = float(cy * T)
					e.vy = 0.0
					return 1
	elif e.vy < 0:
		var cyh := floori((e.y - h) / T)
		for cx in range(cx0, cx1 + 1):
			if l.solid(cx, cyh, s.broken):
				e.y = float((cyh + 1) * T) + h
				e.vy = 0.0
				return 2
	return 0


func on_floor(e: Dictionary, w: float) -> bool:
	var l := lvl()
	var cy := floori((float(e.y) + 0.5) / T)
	var cx0 := floori((e.x - w / 2.0 + 0.01) / T)
	var cx1 := floori((e.x + w / 2.0 - 0.01) / T)
	for cx in range(cx0, cx1 + 1):
		if l.solid(cx, cy, s.broken):
			return true
	return false


# ======================================================================== step

func step(inp: Dictionary) -> void:
	events.clear()
	var prev: Dictionary = s.prev_in
	var ip := {}
	for k in ["l", "r", "u", "d", "jump", "atk", "sub", "start"]:
		var now: bool = inp.get(k, false)
		ip[k] = now
		ip[k + "_pr"] = now and not prev.get(k, false)
	s.prev_in = {"l": ip.l, "r": ip.r, "u": ip.u, "d": ip.d, "jump": ip.jump, "atk": ip.atk,
		"sub": ip.sub, "start": ip.start}
	s.mode_t += 1
	match s.mode:
		"play":
			_step_play(ip)
		"dying":
			_step_world(false)
			if s.mode_t >= 150:
				_after_death()
		"trans":
			if s.mode_t == 24:
				load_block(s.mode_next)
				s.check = s.block
			if s.mode_t >= 48:
				s.mode = "play"
				s.mode_t = 0
		"clear":
			_step_clear()
		"gameover", "ending":
			pass
		_:
			push_error("unknown mode " + str(s.mode))
			s.mode = "play"
	s.frame += 1


func _step_play(ip: Dictionary) -> void:
	# stage timer
	s.time_sub += 1
	if s.time_sub >= 60:
		s.time_sub = 0
		if s.time > 0:
			s.time -= 1
			if s.time <= 30 and s.time > 0:
				sfx("tick")
			if s.time == 0:
				kill_player()
	_step_player(ip)
	_step_world(true)
	_resolve_attacks()
	_resolve_player_touch()
	_update_camera()
	if s.flash > 0:
		s.flash -= 1


func _step_world(allow_freeze: bool) -> void:
	var frozen: bool = allow_freeze and s.freeze > 0
	if s.freeze > 0:
		s.freeze -= 1
	var list: Array = s.ents.duplicate()   # entities may spawn more during the loop
	for e in list:
		if e.dead:
			continue
		Actors.update(self, e, frozen)
	var keep: Array = []
	for e in s.ents:
		if not e.dead:
			keep.append(e)
	s.ents = keep


# ======================================================================== the hero

func _step_player(ip: Dictionary) -> void:
	var p: Dictionary = s.p
	if p.inv > 0:
		p.inv -= 1
	if p.ghost > 0:
		p.ghost -= 1
	p.st_t += 1
	if p.jbuf > 0:
		p.jbuf -= 1
	if ip.jump_pr:
		p.jbuf = 6 if s.style == "modern" else 1
	match p.st:
		"stand", "walk":
			_p_ground(ip)
		"air":
			_p_air(ip)
		"stair":
			_p_stair(ip)
		"approach":
			_p_approach(ip)
		"hurt":
			_p_hurt(ip)
		"land":
			p.vx = 0.0
			if p.st_t >= 8:
				p.st = "stand"
				p.crouch = false
		"dead":
			return
		_:
			push_error("unknown player state " + str(p.st))
			p.st = "stand"
	if p.atk > 0:
		_p_attack_tick()
	_p_hazards()


func _p_set(st: String) -> void:
	var p: Dictionary = s.p
	p.st = st
	p.st_t = 0


func _wants_sub(ip: Dictionary) -> bool:
	return ip.sub_pr or (ip.atk_pr and ip.u)


func _p_ground(ip: Dictionary) -> void:
	var p: Dictionary = s.p
	if p.atk > 0:
		p.vx = 0.0
	else:
		p.crouch = ip.d
		if ip.u and not ip.atk_pr and _try_mount(true):
			return
		if ip.d and _try_mount(false):
			return
		if _wants_sub(ip) and _can_throw():
			_start_attack("sub")
			p.vx = 0.0
		elif ip.atk_pr:
			_start_attack("whip")
			p.vx = 0.0
		elif p.jbuf > 0 and not p.crouch:
			p.jbuf = 0
			_jump(ip)
			# rise on the press step: no frame of input lag
			move_x(p, PW, PH)
			move_y(p, PW, PH)
			return
		else:
			var dir := int(ip.r) - int(ip.l)
			if p.crouch:
				p.vx = 0.0
				if dir != 0:
					p.face = dir
			else:
				p.vx = dir * WALK
				if dir != 0:
					p.face = dir
			p.st = "walk" if dir != 0 and not p.crouch else "stand"
			if dir != 0:
				p.walk_t += 1
	move_x(p, PW, PH_CROUCH if p.crouch else PH)
	if not on_floor(p, PW):
		p.crouch = false
		_p_set("air")
		p.vy = 0.0
		if s.style == "modern":
			p.coyote = 5
		else:
			p.vx = 0.0
			p.coyote = 0


func _jump(ip: Dictionary) -> void:
	var p: Dictionary = s.p
	p.crouch = false
	p.vy = JUMP_V
	var dir := int(ip.r) - int(ip.l)
	p.vx = dir * WALK
	if dir != 0:
		p.face = dir
	p.coyote = 0
	_p_set("air")
	sfx("jump")


func _p_air(ip: Dictionary) -> void:
	var p: Dictionary = s.p
	var modern: bool = s.style == "modern"
	if p.coyote > 0:
		p.coyote -= 1
		if p.jbuf > 0:
			p.jbuf = 0
			_jump(ip)
	if p.atk == 0:
		if _wants_sub(ip) and _can_throw():
			_start_attack("sub")
		elif ip.atk_pr:
			_start_attack("whip")
	if modern:
		var dir := int(ip.r) - int(ip.l)
		p.vx = move_toward(p.vx, dir * WALK, 0.2)
		if dir != 0 and p.atk == 0:
			p.face = dir
		if not ip.jump and p.vy < -1.6:
			p.vy = -1.6
	p.vy = minf(p.vy + GRAV, MAX_FALL)
	move_x(p, PW, PH)
	var r := move_y(p, PW, PH)
	if r == 1:
		p.vy = 0.0
		if not modern:
			p.vx = 0.0
		_p_set("stand")
		sfx("land")
		if p.jbuf > 0 and p.atk == 0:
			p.jbuf = 0
			_jump(ip)


func _try_mount(going_up: bool) -> bool:
	var p: Dictionary = s.p
	var l := lvl()
	for i in l.stairs.size():
		var st: Dictionary = l.stairs[i]
		var fx: float = st.x0 if going_up else st.x1
		var fy: float = st.y0 if going_up else st.y1
		if absf(fy - p.y) <= 1.0 and absf(fx - p.x) <= 12.0:
			p.stair = i
			p.tx = fx
			p.tdir = 1 if going_up else -1
			p.crouch = false
			_p_set("approach")
			return true
	return false


func _p_approach(ip: Dictionary) -> void:
	var p: Dictionary = s.p
	var dx: float = p.tx - p.x
	if absf(dx) <= WALK:
		p.x = p.tx
		var st: Dictionary = lvl().stairs[p.stair]
		p.sp = 0.0 if p.tdir == 1 else float(st.len)
		p.face = st.dir if p.tdir == 1 else -st.dir
		_p_set("stair")
	else:
		p.face = 1 if dx > 0 else -1
		p.x += p.face * WALK
		p.walk_t += 1
		if not (ip.u or ip.d):   # let go before reaching the step: cancel
			_p_set("stand")


func _p_stair(ip: Dictionary) -> void:
	var p: Dictionary = s.p
	var st: Dictionary = lvl().stairs[p.stair]
	var d: int = st.dir
	if p.atk == 0:
		if _wants_sub(ip) and _can_throw():
			_start_attack("sub")
		elif ip.atk_pr:
			_start_attack("whip")
	if p.atk == 0:
		var up: bool = ip.u or (ip.r if d == 1 else ip.l)
		var down: bool = ip.d or (ip.l if d == 1 else ip.r)
		if up and not (ip.d):
			p.sp += STAIR_V
			p.face = d
			p.walk_t += 1
		elif down:
			p.sp -= STAIR_V
			p.face = -d
			p.walk_t += 1
	if p.sp >= st.len:
		p.x = float(st.x1)
		p.y = float(st.y1)
		p.stair = -1
		_p_set("stand")
		return
	if p.sp <= 0.0:
		p.x = float(st.x0)
		p.y = float(st.y0)
		p.stair = -1
		_p_set("stand")
		return
	p.x = st.x0 + d * p.sp
	p.y = st.y0 - p.sp


func _p_hurt(ip: Dictionary) -> void:
	var p: Dictionary = s.p
	p.vy = minf(p.vy + GRAV, MAX_FALL)
	move_x(p, PW, PH)
	var r := move_y(p, PW, PH)
	if r == 1:
		p.vx = 0.0
		_p_set("land")
		p.crouch = true
	elif s.style == "modern" and p.st_t > 14:
		_p_set("air")   # modern: control returns mid-flight


func _can_throw() -> bool:
	var p: Dictionary = s.p
	if p.sub == "":
		return false
	var cost: int = SUB_COST.get(p.sub, 1)
	if p.hearts < cost:
		return false
	if p.sub != "glass":
		var live := 0
		for e in s.ents:
			if String(e.t).begins_with("pw_") and e.t != "pw_flame":
				live += 1
		if live >= p.shot:
			return false
	return true


func _start_attack(kind: String) -> void:
	var p: Dictionary = s.p
	p.atk = 1
	p.atk_kind = kind
	p.atk_id += 1
	p.sub_thrown = false
	sfx("whip" if kind == "whip" else "throw")


func _p_attack_tick() -> void:
	var p: Dictionary = s.p
	p.atk += 1
	if p.atk_kind == "sub":
		if p.atk == 6 and not p.sub_thrown:
			p.sub_thrown = true
			_throw_sub()
		if p.atk > SUB_T:
			p.atk = 0
	elif p.atk > WHIP_WIND + WHIP_ACTIVE + WHIP_REC:
		p.atk = 0


func whip_rect() -> Variant:
	## The lash's hit area this frame, or null when it cannot hit.
	var p: Dictionary = s.p
	if p.atk_kind != "whip" or p.atk <= WHIP_WIND or p.atk > WHIP_WIND + WHIP_ACTIVE:
		return null
	var len: int = WHIP_LEN[p.whip]
	var y0: float = p.y - (30.0 if p.crouch else 37.0)   # lash at the hand's height in the art
	var x0: float = p.x + p.face * 14.0
	if p.face > 0:
		return Rect2(x0, y0, len, 7)
	return Rect2(x0 - len, y0, len, 7)


func _throw_sub() -> void:
	var p: Dictionary = s.p
	var cost: int = SUB_COST.get(p.sub, 1)
	p.hearts -= cost
	var hy: float = p.y - (20.0 if p.crouch else 32.0)
	match p.sub:
		"dagger":
			var e := spawn("pw_dagger", p.x + p.face * 8, hy)
			e.vx = p.face * 4.5
			e.w = 12
			e.h = 4
			e.face = p.face
			e.dmg = 2
		"axe":
			var a := spawn("pw_axe", p.x + p.face * 6, hy)
			a.vx = p.face * 1.9
			a.vy = -5.2
			a.w = 14
			a.h = 14
			a.face = p.face
			a.dmg = 3
		"flask":
			var f := spawn("pw_flask", p.x + p.face * 6, hy)
			f.vx = p.face * 2.0
			f.vy = -1.8
			f.w = 8
			f.h = 8
			f.face = p.face
			f.dmg = 1
		"cross":
			var c := spawn("pw_cross", p.x + p.face * 8, hy + 2)
			c.vx = p.face * 3.6
			c.w = 14
			c.h = 14
			c.face = p.face
			c.dmg = 2
			c.back = false
		"glass":
			s.freeze = 180
			sfx("freeze")
	for e2 in s.ents:
		if String(e2.t).begins_with("pw_") and not e2.has("aid"):
			e2.aid = 100000 + int(e2.id)   # each projectile is its own attack


# ======================================================================== combat

func _resolve_attacks() -> void:
	var p: Dictionary = s.p
	var wr: Variant = whip_rect()
	if wr != null:
		var r: Rect2 = wr
		var dmg: int = WHIP_DMG[p.whip]
		for e in s.ents:
			if not e.dead and Actors.hittable(e) and r.intersects(box(e)):
				hit_entity(e, dmg, p.atk_id, p.x)
		_break_blocks(r)
	for pw in s.ents:
		if pw.dead or not String(pw.t).begins_with("pw_"):
			continue
		var pr := box(pw)
		for e in s.ents:
			if e.dead or e == pw or not Actors.hittable(e):
				continue
			if pr.intersects(box(e)):
				hit_entity(e, int(pw.dmg), int(pw.aid), pw.x)
				if pw.t == "pw_dagger":
					pw.dead = true
					break


func _break_blocks(r: Rect2) -> void:
	var l := lvl()
	var cx0 := floori(r.position.x / T)
	var cx1 := floori(r.end.x / T)
	var cy0 := floori(r.position.y / T)
	var cy1 := floori(r.end.y / T)
	for cy in range(cy0, cy1 + 1):
		for cx in range(cx0, cx1 + 1):
			if l.ch(cx, cy) == "X" and not s.broken.has(Vector2i(cx, cy)):
				s.broken[Vector2i(cx, cy)] = true
				sfx("crumble")
				var fx := spawn("fx_rubble", cx * T + 8, cy * T + 16)
				fx.tt = 0
				var hk := Vector2i(-1000 - cx, cy)
				if s.broken.has(hk):
					drop_item(String(s.broken[hk]), cx * T + 8, cy * T + 16)
					s.broken.erase(hk)


func hit_entity(e: Dictionary, dmg: int, attack_id: int, from_x: float) -> void:
	if e.hit == attack_id:
		return
	e.hit = attack_id
	Actors.on_hit(self, e, dmg, from_x)


func add_score(n: int, x: float, y: float) -> void:
	var before: int = s.score
	s.score += n
	if before / 20000 != int(s.score) / 20000:
		s.lives += 1
		sfx("oneup")
	if n >= 100:
		var f := spawn("fx_score", x, y)
		f.n = n


func drop_item(kind: String, x: float, y: float) -> void:
	if kind == "" or kind == "-" or kind == "none":
		return
	var p: Dictionary = s.p
	# shot upgrades only make sense with a throwing weapon in hand
	if (kind == "double" or kind == "triple") and (p.sub == "" or p.sub == "glass"):
		kind = "bigheart"
	if kind == "whip" and p.whip >= 3:
		kind = "bigheart"
	var it := spawn("item", x, y)
	it.kind = kind
	it.w = 10
	it.h = 10
	it.life = 300 if kind != "orb" else 999999
	it.vy = -1.5 if kind != "orb" else 0.0
	it.ground = false


func _resolve_player_touch() -> void:
	var p: Dictionary = s.p
	if p.st == "dead":
		return
	var pb := player_box()
	for e in s.ents:
		if e.dead:
			continue
		var t: String = e.t
		if t == "item":
			if pb.grow(2).intersects(box(e)):
				_pickup(e)
		elif t == "exit":
			if pb.intersects(box(e)) and s.mode == "play":
				goto_block(lvl().meta.get("next", ""))
				return
		elif Actors.hurts_player(e):
			if p.inv > 0 or p.ghost > 0:
				continue
			if s.freeze > 0 and not Actors.ignores_freeze(e):
				continue
			if pb.intersects(box(e)):
				hurt_player(int(e.get("dmg", 2)), e.x)
				if String(t).begins_with("ep_") and e.get("fragile", true):
					e.dead = true


func _pickup(e: Dictionary) -> void:
	var p: Dictionary = s.p
	e.dead = true
	var k: String = e.kind
	match k:
		"heart":
			p.hearts = mini(p.hearts + 1, 99)
			sfx("heart")
		"bigheart":
			p.hearts = mini(p.hearts + 5, 99)
			sfx("heart")
		"bag100", "bag400", "bag700", "bag1000":
			add_score(int(k.substr(3)), e.x, e.y - 10)
			sfx("coin")
		"whip":
			p.whip = mini(p.whip + 1, 3)
			sfx("power")
			s.freeze = maxi(s.freeze, 30)
		"dagger", "axe", "flask", "cross", "glass":
			if p.sub != k:
				p.shot = 1
			p.sub = k
			sfx("power")
		"double":
			p.shot = 2
			sfx("power")
		"triple":
			p.shot = 3
			sfx("power")
		"roast":
			p.hp = HP_MAX
			sfx("heal")
		"rosary":
			s.flash = 24
			sfx("rosary")
			for x in s.ents:
				if not x.dead and Actors.is_enemy(x) and not String(x.t).begins_with("boss_") and view_rect(8).has_point(Vector2(x.x, x.y - 4)):
					Actors.kill(self, x, false)
		"potion":
			p.ghost = 300
			sfx("power")
		"oneup":
			s.lives += 1
			sfx("oneup")
		"orb":
			p.hp = HP_MAX
			s.mode = "clear"
			s.mode_t = 0
			s.tally = 0
			sfx("orb")
		_:
			push_error("unknown item " + k)


func hurt_player(dmg: int, from_x: float) -> void:
	var p: Dictionary = s.p
	if p.inv > 0 or p.ghost > 0 or p.st == "dead" or s.mode != "play":
		return
	var mult: float = {"easy": 0.5, "normal": 1.0, "hard": 1.5}.get(s.diff, 1.0)
	p.hp -= maxi(1, int(ceil(dmg * mult)))
	p.inv = INV_T
	sfx("hurt")
	if p.hp <= 0:
		p.hp = 0
		kill_player()
		return
	if p.st != "stair":
		var side := 1 if from_x >= p.x else -1
		p.face = side
		var modern: bool = s.style == "modern"
		p.vx = -side * (KB_VX * (0.6 if modern else 1.0))
		p.vy = KB_VY * (0.75 if modern else 1.0)
		p.atk = 0
		p.crouch = false
		_p_set("hurt")


func kill_player() -> void:
	var p: Dictionary = s.p
	if p.st == "dead":
		return
	p.st = "dead"
	p.st_t = 0
	p.hp = 0
	p.atk = 0
	s.mode = "dying"
	s.mode_t = 0
	sfx("death")


func _after_death() -> void:
	if not s.inf_lives:
		s.lives -= 1
	if s.lives < 0:
		s.mode = "gameover"
		s.mode_t = 0
		return
	var p: Dictionary = s.p
	var keep_whip: int = p.whip if s.style == "modern" else maxi(1, p.whip - 1)
	var keep_sub: String = p.sub if s.style == "modern" else ""
	var np := _fresh_player()
	np.whip = keep_whip
	np.sub = keep_sub
	s.p = np
	var first: Level = levels_for_stage(s.stage)["%d-1" % s.stage]
	s.time = first.meta_int("time", 300)
	s.time_sub = 0
	load_block(s.check)
	s.mode = "play"
	s.mode_t = 0


func continue_game() -> void:
	## After a game over: same stage, from its first block; score resets.
	var style: String = s.style
	var st: int = s.stage
	var np := _fresh_player()
	if s.practice:
		np.whip = 3
		np.hearts = 30
	s.p = np
	s.score = 0
	s.lives = 3
	s.mode = "play"
	s.mode_t = 0
	s.style = style
	start_stage(st)


func _p_hazards() -> void:
	var p: Dictionary = s.p
	if p.st == "dead":
		return
	var l := lvl()
	if p.y - 8 > l.px_h():
		kill_player()
		return
	var hz := l.hazard(floori(p.x / T), floori((p.y - 6) / T))
	if hz != "":
		if hz == "~":
			var f := spawn("fx_splash", p.x, p.y)
			f.tt = 0
			sfx("splash")
		kill_player()


func goto_block(id: String) -> void:
	if id == "":
		return
	s.mode = "trans"
	s.mode_t = 0
	s.mode_next = id


func _step_clear() -> void:
	# tally: remaining time converts to score, then a pause, then the next stage
	var t: int = s.mode_t
	if t < 60:
		return
	if s.time > 0:
		var n := mini(2, s.time)
		s.time -= n
		s.score += 10 * n
		if t % 3 == 0:
			sfx("tick")
		return
	if s.tally == 0:
		s.tally = t
	if t - int(s.tally) < 90:
		return
	s.cleared = maxi(int(s.cleared), int(s.stage))
	if s.stage >= STAGES:
		s.mode = "ending"
		s.mode_t = 0
		return
	var p: Dictionary = s.p
	p.hp = HP_MAX
	p.st = "stand"
	s.mode = "play"
	s.mode_t = 0
	start_stage(int(s.stage) + 1)


# ======================================================================== camera

func _update_camera() -> void:
	var l := lvl()
	var p: Dictionary = s.p
	var cam: Dictionary = s.cam
	if cam.lock:
		cam.x = move_toward(cam.x, cam.lx, 2.0)
		# keep the hero inside the arena
		p.x = clampf(p.x, cam.x + 6, cam.x + VIEW_W - 6)
	else:
		cam.x = clampf(round(p.x - VIEW_W / 2.0), 0.0, maxf(0.0, l.px_w() - VIEW_W))
	var ty: float = clampf(round(p.y - 124.0), 0.0, maxf(0.0, l.px_h() - VIEW_H))
	if p.st == "air" or p.st == "hurt":
		# don't bob with every jump; follow only when the hero leaves the band
		if p.y - cam.y > 176 or p.y - cam.y < 56:
			cam.y = move_toward(cam.y, ty, 4.0)
	else:
		cam.y = move_toward(cam.y, ty, 3.0)


# ======================================================================== snapshots & saves

func snapshot() -> Dictionary:
	return s.duplicate(true)


func restore(snap: Dictionary) -> void:
	s = snap.duplicate(true)
	_lvl = null
	_lvl_key = ""


func save_text(label: String) -> String:
	return var_to_str({"label": label, "ver": VERSION, "state": s})


func load_text(text: String) -> bool:
	var v: Variant = str_to_var(text)
	if typeof(v) != TYPE_DICTIONARY or not v.has("state"):
		return false
	var st: Variant = v["state"]
	if typeof(st) != TYPE_DICTIONARY or int(st.get("ver", 0)) != VERSION:
		return false
	restore(st)
	return true
