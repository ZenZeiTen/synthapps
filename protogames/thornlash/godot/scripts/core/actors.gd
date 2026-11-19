class_name Actors
extends RefCounted
## Behaviour for every non-hero entity: candles, pickups, spawners, enemies, projectiles,
## bosses and effects. Entities are Dictionaries in Game.s.ents; all functions are static
## and take the Game so the whole world stays in one snapshot-able state.

const T := 16

# grid marker -> enemy kind (placed through respawning spawn points)
const MARK_ENEMY := {"B": "bat", "K": "knight", "S": "skel", "W": "warg", "R": "raven",
	"H": "imp", "N": "ghost", "O": "pillar", "P": "axeknight", "Q": "redskel"}

# kind: hp, contact damage, score, hitbox w/h
const ENEMY := {
	"ghoul":     {"hp": 1, "dmg": 2, "score": 100, "w": 12, "h": 38},
	"bat":       {"hp": 1, "dmg": 2, "score": 200, "w": 12, "h": 10},
	"wisp":      {"hp": 1, "dmg": 2, "score": 300, "w": 14, "h": 14},
	"drowned":   {"hp": 1, "dmg": 3, "score": 300, "w": 12, "h": 36},
	"knight":    {"hp": 4, "dmg": 3, "score": 400, "w": 16, "h": 42},
	"axeknight": {"hp": 8, "dmg": 4, "score": 600, "w": 18, "h": 46},
	"skel":      {"hp": 2, "dmg": 3, "score": 300, "w": 12, "h": 38},
	"redskel":   {"hp": 99, "dmg": 3, "score": 400, "w": 12, "h": 38},
	"warg":      {"hp": 1, "dmg": 3, "score": 200, "w": 24, "h": 18},
	"raven":     {"hp": 1, "dmg": 2, "score": 200, "w": 14, "h": 12},
	"imp":       {"hp": 1, "dmg": 2, "score": 300, "w": 12, "h": 14},
	"ghost":     {"hp": 3, "dmg": 2, "score": 300, "w": 14, "h": 16},
	"pillar":    {"hp": 6, "dmg": 3, "score": 400, "w": 16, "h": 44},
}

const BOSS := {
	"nightwing":   {"hp": 16, "dmg": 3, "score": 3000, "w": 34, "h": 20, "name": "THE NIGHTWING"},
	"wyrm":        {"hp": 20, "dmg": 4, "score": 4000, "w": 22, "h": 18, "name": "OSSUARY WYRM"},
	"warden":      {"hp": 24, "dmg": 4, "score": 5000, "w": 26, "h": 58, "name": "LANTERN WARDEN"},
	"chainmaster": {"hp": 28, "dmg": 5, "score": 6000, "w": 28, "h": 56, "name": "THE CHAINMASTER"},
	"horologist":  {"hp": 28, "dmg": 5, "score": 7000, "w": 26, "h": 34, "name": "THE HOROLOGIST"},
	"margrave":    {"hp": 16, "dmg": 5, "score": 8000, "w": 16, "h": 44, "name": "THE PALE MARGRAVE"},
	"beast":       {"hp": 32, "dmg": 6, "score": 20000, "w": 40, "h": 60, "name": "THE ASHEN BEAST"},
}

const MARGRAVE_LINES := [
	"So. The Ashdown line still breeds.",
	"Your blood stilled the thorn once.",
	"Tonight the ash takes it back.",
]


# ------------------------------------------------------------------ classification

static func is_enemy(e: Dictionary) -> bool:
	return ENEMY.has(e.t) or String(e.t).begins_with("boss_")


static func hittable(e: Dictionary) -> bool:
	var t: String = e.t
	if t == "candle" or ENEMY.has(t):
		return e.get("st", "") != "rise" or int(e.tt) > 8
	if t.begins_with("boss_"):
		var st: String = e.get("st", "")
		return st != "sleep" and st != "dying" and st != "intro" and st != "transform" and not e.get("hidden", false)
	return t == "ep_fire" or t == "ep_bone" or t == "ep_gear"


static func hurts_player(e: Dictionary) -> bool:
	var t: String = e.t
	if t.begins_with("ep_"):
		return true
	if ENEMY.has(t):
		return e.st != "rise" or int(e.tt) > 12
	if t.begins_with("boss_"):
		return e.st != "dying" and e.st != "intro" and e.st != "transform" and not e.get("hidden", false)
	return false


static func ignores_freeze(e: Dictionary) -> bool:
	var t: String = e.t
	if t == "boss_margrave" or t == "boss_beast" or t == "boss_horologist":
		return true
	return t.begins_with("ep_") and e.get("boss_owned", false)


# ------------------------------------------------------------------ helpers

static func make_enemy(g: Game, kind: String, x: float, y: float) -> Dictionary:
	var d: Dictionary = ENEMY[kind]
	var e := g.spawn(kind, x, y)
	var stage: int = g.s.stage
	e.hp = d.hp + (stage - 1) / 2 if kind == "knight" or kind == "axeknight" else d.hp
	e.dmg = d.dmg + (stage - 1) / 2
	e.w = d.w
	e.h = d.h
	e.face = -1 if g.s.p.x < x else 1
	e.ox = x
	e.oy = y
	e.st = "idle"
	e.flash = 0
	return e


static func face_player(g: Game, e: Dictionary) -> void:
	e.face = -1 if g.s.p.x < e.x else 1


static func offscreen_far(g: Game, e: Dictionary, margin: float = 96.0) -> bool:
	return not g.view_rect(margin).has_point(Vector2(e.x, e.y - 4))


static func gravity(g: Game, e: Dictionary, grav: float = 0.25) -> int:
	e.vy = minf(e.vy + grav, 5.0)
	g.move_x(e, e.w, e.h)
	return g.move_y(e, e.w, e.h)


static func floor_ahead(g: Game, e: Dictionary) -> bool:
	var fx: float = e.x + e.face * (e.w / 2.0 + 2.0)
	return g.solid_at(fx, e.y + 2.0)


static func wall_ahead(g: Game, e: Dictionary) -> bool:
	var fx: float = e.x + e.face * (e.w / 2.0 + 2.0)
	return g.solid_at(fx, e.y - 8.0)


static func fire(g: Game, t: String, x: float, y: float, vx: float, vy: float) -> Dictionary:
	var p := g.spawn(t, x, y)
	p.vx = vx
	p.vy = vy
	p.w = 8
	p.h = 8
	p.dmg = 2 + int(g.s.stage) / 3
	p.face = 1 if vx >= 0 else -1
	return p


static func fx(g: Game, t: String, x: float, y: float) -> Dictionary:
	var f := g.spawn(t, x, y)
	f.tt = 0
	return f


# ------------------------------------------------------------------ hit & kill

static func on_hit(g: Game, e: Dictionary, dmg: int, from_x: float) -> void:
	var t: String = e.t
	if t == "candle":
		e.dead = true
		fx(g, "fx_burst", e.x, e.y - 6)
		g.sfx("candle")
		g.drop_item(String(e.drop), e.x, e.y - 4)
		return
	if t.begins_with("ep_"):
		e.dead = true
		fx(g, "fx_burst", e.x, e.y)
		g.sfx("tink")
		return
	if t == "redskel":
		# cannot be destroyed: it collapses and reassembles
		if e.st != "down":
			e.st = "down"
			e.tt = 0
			g.sfx("bones")
			g.add_score(100, e.x, e.y - 30)
		return
	e.hp -= dmg
	e.flash = 10
	fx(g, "fx_spark", (e.x + from_x) / 2.0, e.y - e.h / 2.0)
	if t.begins_with("boss_"):
		g.s.boss.hp = maxi(0, int(e.hp))
		g.sfx("bosshit")
		if e.hp <= 0:
			boss_die(g, e)
		return
	if e.hp <= 0:
		kill(g, e, true)
	else:
		g.sfx("hit")


static func kill(g: Game, e: Dictionary, may_drop: bool) -> void:
	if e.dead:
		return
	e.dead = true
	var d: Dictionary = ENEMY.get(e.t, {"score": 100})
	g.add_score(int(d.score), e.x, e.y - e.h - 4)
	fx(g, "fx_burst", e.x, e.y - e.h / 2.0)
	g.sfx("kill")
	g.s.kills += 1
	if may_drop and g.rand() % 4 == 0:
		g.drop_item("heart", e.x, e.y - e.h / 2.0)


static func boss_die(g: Game, e: Dictionary) -> void:
	e.st = "dying"
	e.tt = 0
	e.vx = 0.0
	e.vy = 0.0
	g.sfx("bossdie")
	g.add_score(int(BOSS.get(String(e.t).substr(5), {"score": 3000}).score), e.x, e.y - 30)
	# clear the arena of minions and shots
	for x in g.s.ents:
		if x != e and not x.dead and (ENEMY.has(x.t) or String(x.t).begins_with("ep_")):
			x.dead = true
			fx(g, "fx_burst", x.x, x.y - 6)


# ------------------------------------------------------------------ dispatcher

static func update(g: Game, e: Dictionary, frozen: bool) -> void:
	var t: String = e.t
	e.tt += 1
	if e.has("flash") and e.flash > 0:
		e.flash -= 1
	if frozen and (ENEMY.has(t) or t.begins_with("ep_") or t.begins_with("boss_")) and not ignores_freeze(e):
		e.tt -= 1
		return
	match t:
		"candle", "exit":
			pass
		"item":
			_item(g, e)
		"sp":
			_spawn_point(g, e)
		"zone":
			_zone(g, e)
		"bosstrig":
			_boss_trigger(g, e)
		"ghoul":
			_ghoul(g, e)
		"bat":
			_bat(g, e)
		"wisp":
			_wisp(g, e)
		"drowned":
			_drowned(g, e)
		"knight", "axeknight":
			_knight(g, e)
		"skel", "redskel":
			_skel(g, e)
		"warg":
			_warg(g, e)
		"raven":
			_raven(g, e)
		"imp":
			_imp(g, e)
		"ghost":
			_ghost(g, e)
		"pillar":
			_pillar(g, e)
		"ep_fire", "ep_bone", "ep_axe", "ep_ball", "ep_wave", "ep_gear", "ep_flame":
			_enemy_shot(g, e)
		"ep_lantern", "ep_blade":
			pass    # moved by the boss that owns them
		"pw_dagger", "pw_axe", "pw_flask", "pw_flame", "pw_cross":
			_player_shot(g, e)
		"boss_nightwing":
			_nightwing(g, e)
		"boss_wyrm":
			_wyrm(g, e)
		"boss_warden":
			_warden(g, e)
		"boss_chainmaster":
			_chainmaster(g, e)
		"boss_horologist":
			_horologist(g, e)
		"boss_margrave":
			_margrave(g, e)
		"boss_beast":
			_beast(g, e)
		_:
			if t.begins_with("fx_"):
				_fx(e)
			else:
				push_error("no behaviour for " + t)
				e.dead = true


# ------------------------------------------------------------------ world objects

static func _item(g: Game, e: Dictionary) -> void:
	if not e.ground:
		e.vy = minf(e.vy + 0.15, 2.5)
		if g.move_y(e, e.w, e.h) == 1:
			e.ground = true
		if e.y > g.lvl().px_h() + 32:
			e.dead = true
	e.life -= 1
	if e.life <= 0:
		e.dead = true


static func _spawn_point(g: Game, e: Dictionary) -> void:
	var inv := g.view_rect(8).has_point(Vector2(e.x, e.y - 8))
	if inv and not e.inview:
		var alive: Variant = g.find(int(e.child)) if int(e.child) != 0 else null
		if alive == null:
			var m := make_enemy(g, String(e.kind), e.x, e.y)
			e.child = m.id
			m.from = e.id
	e.inview = inv


static func _zone(g: Game, e: Dictionary) -> void:
	# a spawner active while its marker is within about a screen of the view
	if not g.view_rect(160).has_point(Vector2(e.x, e.y - 8)):
		return
	e.cd -= 1
	if e.cd > 0:
		return
	var kind: String = e.kind
	var count := 0
	for x in g.s.ents:
		if x.t == kind and not x.dead:
			count += 1
	var cam: Dictionary = g.s.cam
	var p: Dictionary = g.s.p
	match kind:
		"ghoul":
			e.cd = 50 + g.rand() % 70
			if count >= 3:
				return
			var side := -1 if g.rand() % 2 == 0 else 1
			var sx: float = cam.x - 8 if side < 0 else cam.x + Game.VIEW_W + 8
			if not g.solid_at(sx, e.y + 2):
				side = -side
				sx = cam.x - 8 if side < 0 else cam.x + Game.VIEW_W + 8
				if not g.solid_at(sx, e.y + 2):
					return
			var z := make_enemy(g, "ghoul", sx, e.y)
			z.face = -side
			z.st = "walk"
		"wisp":
			e.cd = 80 + g.rand() % 60
			if count >= 3:
				return
			var fromleft: bool = p.face < 0
			var wx: float = cam.x - 10 if fromleft else cam.x + Game.VIEW_W + 10
			var w := make_enemy(g, "wisp", wx, p.y - 14 - float(g.rand() % 24))
			w.face = 1 if fromleft else -1
			w.oy = w.y
		"drowned":
			e.cd = 70 + g.rand() % 80
			if count >= 2:
				return
			var off := 40 + g.rand() % 90
			var dx: float = p.x + (off if g.rand() % 2 == 0 else -off)
			dx = clampf(dx, cam.x + 16, cam.x + Game.VIEW_W - 16)
			var d := make_enemy(g, "drowned", dx, e.y)
			d.st = "leap"
			d.vy = -6.6
			g.sfx("splash")
			fx(g, "fx_splash", dx, e.y)
		_:
			push_error("unknown zone " + kind)


static func _boss_trigger(g: Game, e: Dictionary) -> void:
	var p: Dictionary = g.s.p
	if p.x < e.x or p.st == "stair":
		return
	e.dead = true
	var cam: Dictionary = g.s.cam
	cam.lock = true
	cam.lx = e.lx
	var kind: String = e.kind
	var d: Dictionary = BOSS[kind]
	var b := g.spawn("boss_" + kind, e.lx + Game.VIEW_W / 2.0, g.s.cam.y + 60)
	b.hp = d.hp
	b.dmg = d.dmg + int(g.s.stage) / 3
	b.w = d.w
	b.h = d.h
	b.st = "sleep"
	b.flash = 0
	b.ax = e.lx
	b.cyc = 0
	g.s.boss = {"id": b.id, "hp": d.hp, "max": d.hp, "name": d.name}
	g.sfx("bossstart")
	b.fy = e.y        # the arena floor
	match kind:
		"nightwing":
			b.x = e.lx + Game.VIEW_W - 60
			b.y = g.s.cam.y + 40
		"wyrm":
			b.st = "burrow"
			b.hidden = true
			b.trail = []
			b.y = e.y + 30
		"warden", "chainmaster":
			b.x = e.lx + Game.VIEW_W - 50
			b.y = e.y
			b.face = -1
			if kind == "warden":
				var ln := g.spawn("ep_lantern", b.x, b.y - 40)
				ln.w = 14
				ln.h = 14
				ln.dmg = b.dmg
				ln.fragile = false
				ln.boss_owned = true
				b.lantern = ln.id
				b.ang = 0.0
		"horologist":
			b.x = e.lx + Game.VIEW_W - 60
			b.y = e.y - 60
		"margrave":
			b.x = e.lx + Game.VIEW_W - 60
			b.y = e.y
			b.st = "intro"
			b.face = -1
			g.s.boss.line = ""
		_:
			pass


static func _fx(e: Dictionary) -> void:
	var life := 16
	match String(e.t):
		"fx_score":
			life = 45
			e.y -= 0.5
		"fx_rubble", "fx_splash":
			life = 30
		"fx_spark":
			life = 8
		"fx_boom":
			life = 24
	if e.tt >= life:
		e.dead = true


# ------------------------------------------------------------------ enemies

static func _despawn(g: Game, e: Dictionary) -> bool:
	if offscreen_far(g, e) or e.y > g.lvl().px_h() + 32:
		e.dead = true
		return true
	return false


static func _ghoul(g: Game, e: Dictionary) -> void:
	if e.st == "idle":
		e.st = "walk"
	if e.st == "rise":
		if e.tt > 24:
			e.st = "walk"
		return
	e.vx = e.face * 0.55
	var r := gravity(g, e)
	if g.move_x(e, e.w, e.h) or wall_ahead(g, e):
		e.face = -e.face
	if r == 1:
		pass
	_despawn(g, e)


static func _bat(g: Game, e: Dictionary) -> void:
	var p: Dictionary = g.s.p
	if e.st == "idle":
		if absf(p.x - e.x) < 96 and absf(p.y - e.y) < 90:
			e.st = "fly"
			e.tt = 0
			face_player(g, e)
			e.oy = e.y + 8
		return
	# swoop down toward the hero's head height, then wave along
	var target_y: float = p.y - 30
	e.oy = move_toward(e.oy, target_y, 0.6)
	e.x += e.face * 1.15
	e.y = e.oy + sin(e.tt * 0.11) * 12.0
	_despawn(g, e)


static func _wisp(g: Game, e: Dictionary) -> void:
	e.x += e.face * 1.0
	e.y = e.oy + sin(e.tt * 0.055) * 30.0
	if e.tt > 30:
		_despawn(g, e)


static func _drowned(g: Game, e: Dictionary) -> void:
	match String(e.st):
		"leap":
			e.vy += 0.25
			e.y += e.vy
			if e.vy > 0:
				# falling: land on solid ground, or sink back
				e.y -= e.vy
				if g.move_y(e, e.w, e.h) == 1:
					e.st = "walk"
					e.tt = 0
					face_player(g, e)
				elif e.y > g.lvl().px_h():
					e.dead = true
		"walk":
			e.vx = e.face * 0.45
			if g.move_x(e, e.w, e.h) or not floor_ahead(g, e):
				e.face = -e.face
			gravity(g, e)
			if e.tt % 110 == 60:
				e.st = "spit"
				e.tt = 0
				face_player(g, e)
		"spit":
			if e.tt == 16:
				fire(g, "ep_fire", e.x + e.face * 8, e.y - 28, e.face * 1.6, 0.0)
				g.sfx("spit")
			if e.tt > 30:
				e.st = "walk"
				e.tt = 0
	if e.y > g.lvl().px_h() + 32 or offscreen_far(g, e, 64):
		e.dead = true


static func _knight(g: Game, e: Dictionary) -> void:
	var p: Dictionary = g.s.p
	var heavy: bool = e.t == "axeknight"
	if e.st == "idle":
		e.st = "walk"
	if heavy and e.st == "walk" and e.tt % 140 == 100 and absf(p.x - e.x) < 180:
		e.st = "throw"
		e.tt = 0
		face_player(g, e)
	if e.st == "throw":
		if e.tt == 14:
			var hy: float = e.y - (26.0 if g.rand() % 2 == 0 else 10.0)
			var a := fire(g, "ep_axe", e.x + e.face * 10, hy, e.face * 2.0, 0.0)
			a.w = 12
			a.h = 12
			a.ox = e.x
			a.fragile = false
			g.sfx("throw")
		if e.tt > 28:
			e.st = "walk"
			e.tt = 0
		return
	var spd := 0.35 if not heavy else 0.3
	e.vx = e.face * spd
	if g.move_x(e, e.w, e.h) or not floor_ahead(g, e):
		e.face = -e.face
	gravity(g, e)
	# turn to face the hero now and then, like a patrol that has noticed you
	if e.tt % 90 == 0 and absf(p.x - e.x) < 120:
		face_player(g, e)
	_despawn(g, e)


static func _skel(g: Game, e: Dictionary) -> void:
	var p: Dictionary = g.s.p
	if e.st == "idle":
		e.st = "walk"
	if e.st == "down":
		if e.tt > 150 and absf(p.x - e.x) > 24:
			e.st = "walk"
			e.tt = 0
			g.sfx("bones")
		return
	# shuffle back and forth around the post, facing the hero
	face_player(g, e)
	var dir := 1.0 if int(e.tt / 48) % 2 == 0 else -1.0
	e.vx = dir * 0.5
	var saved: int = e.face
	e.face = 1 if dir > 0 else -1
	if not floor_ahead(g, e) or absf(e.x + e.vx - e.ox) > 28:
		e.vx = 0.0
	e.face = saved
	gravity(g, e)
	if e.t == "skel" and e.tt % 96 == 50 and absf(p.x - e.x) < 200:
		var b := fire(g, "ep_bone", e.x, e.y - 34, e.face * (0.8 + absf(p.x - e.x) / 110.0), -4.2)
		b.grav = 0.15
		g.sfx("throw")
	_despawn(g, e)


static func _warg(g: Game, e: Dictionary) -> void:
	var p: Dictionary = g.s.p
	match String(e.st):
		"idle":
			if absf(p.x - e.x) < 120 and absf(p.y - e.y) < 64:
				face_player(g, e)
				e.st = "leap"
				e.vy = -3.2
				e.vx = e.face * 2.0
				g.sfx("growl")
		"leap":
			e.vy = minf(e.vy + 0.22, 5.0)
			g.move_x(e, e.w, e.h)
			if g.move_y(e, e.w, e.h) == 1:
				e.st = "run"
				e.tt = 0
		"run":
			e.vx = e.face * 2.1
			if g.move_x(e, e.w, e.h):
				e.face = -e.face
			var r := gravity(g, e)
			if r == 0 and e.vy > 1.0:
				e.st = "leap"
	if e.st != "idle":
		_despawn(g, e)


static func _raven(g: Game, e: Dictionary) -> void:
	var p: Dictionary = g.s.p
	match String(e.st):
		"idle":
			if absf(p.x - e.x) < 130:
				e.st = "dive"
				e.tt = 0
				face_player(g, e)
				g.sfx("caw")
		"dive":
			if e.tt == 1 or e.tt == 45:
				var d := Vector2(p.x - e.x, p.y - 16 - e.y).normalized() * 2.1
				e.vx = d.x
				e.vy = d.y
				e.face = 1 if d.x >= 0 else -1
			e.x += e.vx
			e.y += e.vy
			if e.tt > 90:
				e.vy -= 0.05
			_despawn(g, e)


static func _imp(g: Game, e: Dictionary) -> void:
	var p: Dictionary = g.s.p
	if e.st == "idle":
		e.st = "wait"
		e.tt = 0
	if e.st == "wait":
		if e.tt > 18 + int(e.id) % 17 and absf(p.x - e.x) < 200:
			face_player(g, e)
			e.vy = -3.8 if g.rand() % 3 != 0 else -2.0
			e.vx = e.face * 1.3
			e.st = "hop"
	elif e.st == "hop":
		e.vy = minf(e.vy + 0.22, 5.0)
		if g.move_x(e, e.w, e.h):
			e.vx = -e.vx
		if g.move_y(e, e.w, e.h) == 1:
			e.st = "wait"
			e.tt = 0
			e.vx = 0.0
	_despawn(g, e)


static func _ghost(g: Game, e: Dictionary) -> void:
	var p: Dictionary = g.s.p
	if e.st == "idle":
		e.st = "drift"
	var d := Vector2(p.x - e.x, p.y - 18 - e.y)
	e.vx = clampf(e.vx + signf(d.x) * 0.03, -0.8, 0.8)
	e.vy = clampf(e.vy + signf(d.y) * 0.02, -0.6, 0.6)
	e.x += e.vx
	e.y += e.vy
	e.face = 1 if e.vx >= 0 else -1
	_despawn(g, e)


static func _pillar(g: Game, e: Dictionary) -> void:
	var p: Dictionary = g.s.p
	face_player(g, e)
	if e.tt % 120 == 80 and absf(p.x - e.x) < 220:
		fire(g, "ep_fire", e.x + e.face * 8, e.y - 26, e.face * 1.4, 0.0)
		g.sfx("spit")
	if e.tt % 120 == 100 and absf(p.x - e.x) < 220:
		fire(g, "ep_fire", e.x + e.face * 8, e.y - 12, e.face * 1.4, 0.0)


# ------------------------------------------------------------------ projectiles

static func _enemy_shot(g: Game, e: Dictionary) -> void:
	if e.t == "ep_bone":
		e.vy += float(e.get("grav", 0.15))
	if e.t == "ep_ball":
		e.vy += float(e.get("grav", 0.16))
		if e.y + e.vy >= float(e.fy) and e.vy > 0:
			if int(e.bounces) > 0:
				e.bounces = int(e.bounces) - 1
				e.vy = -e.vy * 0.55
				g.sfx("land")
			else:
				e.dead = true
				fx(g, "fx_rubble", e.x, e.fy)
				return
	if e.t == "ep_axe":
		# thrown axes fly out and curve back to the knight's line
		e.vx -= e.face * 0.035
	e.x += e.vx
	e.y += e.vy
	if e.t == "ep_fire" and g.solid_at(e.x, e.y - 4):
		e.dead = true
		return
	if offscreen_far(g, e, 24) or e.tt > 600:
		e.dead = true


static func _player_shot(g: Game, e: Dictionary) -> void:
	match String(e.t):
		"pw_dagger":
			e.x += e.vx
			if g.solid_at(e.x + e.face * 6, e.y - 2):
				e.dead = true
		"pw_axe":
			e.vy += 0.2
			e.x += e.vx
			e.y += e.vy
		"pw_flask":
			e.vy = minf(e.vy + 0.25, 5.0)
			g.move_x(e, e.w, e.h)
			if g.move_y(e, e.w, e.h) == 1:
				e.t = "pw_flame"
				e.tt = 0
				e.w = 18
				e.h = 14
				e.vx = 0.0
				g.sfx("flame")
		"pw_flame":
			# the flames hit again every 14 frames
			e.aid = 200000 + int(e.id) * 100 + int(e.tt / 14)
			if e.tt > 72:
				e.dead = true
		"pw_cross":
			if e.tt > 22:
				e.vx -= e.face * 0.14
			if not e.back and signf(e.vx) != signf(e.face):
				e.back = true
				e.aid = int(e.aid) + 50000   # the return trip can hit again
			e.x += e.vx
			if e.back and g.player_box().grow(4).has_point(Vector2(e.x, e.y - 6)):
				e.dead = true
	if offscreen_far(g, e, 16):
		e.dead = true


# ------------------------------------------------------------------ bosses

static func _boss_common(g: Game, e: Dictionary) -> bool:
	## Handles the death sequence. Returns true when the boss behaviour should run.
	if e.st != "dying":
		return true
	if e.t == "boss_margrave":
		# the first form falls; the Ashen Beast rises from its cinders
		if e.tt % 8 == 0:
			fx(g, "fx_boom", e.x + float(g.rand() % 20) - 10.0, e.y - float(g.rand() % 40))
		if e.tt >= 100:
			e.dead = true
			var d: Dictionary = BOSS["beast"]
			var b := g.spawn("boss_beast", e.x, e.fy)
			b.hp = d.hp
			b.dmg = d.dmg
			b.w = d.w
			b.h = d.h
			b.st = "transform"
			b.flash = 0
			b.fy = e.fy
			b.ax = e.ax
			b.cyc = 0
			b.face = e.face
			g.s.boss = {"id": b.id, "hp": d.hp, "max": d.hp, "name": d.name}
			g.sfx("bossstart")
		return false
	if e.tt % 6 == 0:
		fx(g, "fx_boom", e.x + float(g.rand() % 40) - 20.0, e.y - float(g.rand() % 30))
		g.sfx("boom")
	if e.tt >= 90:
		e.dead = true
		# the soul orb falls to the arena floor
		var cam: Dictionary = g.s.cam
		var ox: float = cam.lx + Game.VIEW_W / 2.0
		g.drop_item("orb", ox, cam.y + 40)
	return false


static func _nightwing(g: Game, e: Dictionary) -> void:
	## Giant bat. Hangs, then alternates: glide to a perch point high up, pause, swoop at
	## the hero. Below half health it spits a fireball from the perch before each swoop.
	if not _boss_common(g, e):
		return
	var p: Dictionary = g.s.p
	var cam: Dictionary = g.s.cam
	match String(e.st):
		"sleep":
			if e.tt > 70:
				e.st = "rise"
				e.tt = 0
				g.sfx("screech")
		"rise":
			e.y -= 0.6
			if e.tt > 30:
				_nw_pick(g, e)
		"glide":
			var d := Vector2(e.tx - e.x, e.ty - e.y)
			if d.length() < 2.0:
				e.st = "perch"
				e.tt = 0
			else:
				var v := d.normalized() * 1.3
				e.x += v.x
				e.y += v.y + sin(e.tt * 0.15) * 0.6
			e.face = 1 if p.x > e.x else -1
		"perch":
			e.face = 1 if p.x > e.x else -1
			if e.hp <= 8 and e.tt == 20:
				var d2 := Vector2(p.x - e.x, p.y - 16 - e.y).normalized() * 1.9
				fire(g, "ep_fire", e.x, e.y - 6, d2.x, d2.y)
				g.sfx("spit")
			if e.tt > 44:
				# swoop: aim below the hero so the arc comes up through him
				e.st = "swoop"
				e.tt = 0
				e.sx = e.x
				e.sy = e.y
				e.tx = p.x
				e.ty = p.y - 10
				g.sfx("screech")
		"swoop":
			# a parabola from the perch through the target and back up the other side
			var k: float = e.tt / 70.0
			var endx: float = e.sx + (e.tx - e.sx) * 2.0
			endx = clampf(endx, cam.x + 24, cam.x + Game.VIEW_W - 24)
			e.x = lerpf(e.sx, endx, k)
			var dip: float = e.ty - e.sy
			e.y = e.sy + dip * (1.0 - pow(2.0 * k - 1.0, 2.0))
			e.face = 1 if endx > e.sx else -1
			if e.tt >= 70:
				_nw_pick(g, e)
	e.x = clampf(e.x, cam.x + 16, cam.x + Game.VIEW_W - 16)
	e.y = clampf(e.y, cam.y + 22, cam.y + Game.VIEW_H - 8)


static func _nw_pick(g: Game, e: Dictionary) -> void:
	var cam: Dictionary = g.s.cam
	e.st = "glide"
	e.tt = 0
	e.cyc += 1
	var side := 1 if int(e.cyc) % 2 == 0 else -1
	e.tx = cam.x + Game.VIEW_W / 2.0 + side * (60.0 + float(g.rand() % 60))
	e.ty = cam.y + 36.0 + float(g.rand() % 20)


# ------------------------------------------------------------------ bosses 2-6

static func _arena(g: Game) -> Vector2:
	var cam: Dictionary = g.s.cam
	return Vector2(float(cam.lx), float(cam.lx) + Game.VIEW_W)


static func _wyrm(g: Game, e: Dictionary) -> void:
	## Ossuary Wyrm: a skeletal serpent that burrows, bursts out of the floor in an arc
	## (skull first, spine following) and dives back in. Only the skull can be struck.
	if not _boss_common(g, e):
		return
	var p: Dictionary = g.s.p
	var ar := _arena(g)
	var trail: Array = e.trail
	trail.push_front(Vector2(e.x, e.y))
	if trail.size() > 60:
		trail.pop_back()
	match String(e.st):
		"burrow":
			e.hidden = true
			e.y = e.fy + 30
			if e.tt == 30:
				g.sfx("crumble")
			if e.tt > 55:
				# surface on the far side from the hero and arc across toward him
				var from_left: bool = p.x > (ar.x + ar.y) / 2.0
				e.sx = ar.x + (40.0 if from_left else Game.VIEW_W - 40.0)
				e.ex = clampf(p.x + (30.0 if from_left else -30.0), ar.x + 30, ar.y - 30)
				e.face = 1 if from_left else -1
				e.st = "arc"
				e.tt = 0
				e.hidden = false
				g.sfx("screech")
				fx(g, "fx_rubble", e.sx, e.fy)
		"arc":
			var k: float = e.tt / 110.0
			e.x = lerpf(e.sx, e.ex, k)
			e.y = e.fy + 10.0 - sin(k * PI) * 72.0   # apex within a jumping whip's reach
			if e.tt == 55:
				var spread: Array = [-0.35, 0.0, 0.35] if e.hp <= 10 else [0.0]
				for a in spread:
					var d := Vector2(p.x - e.x, p.y - 20 - e.y).normalized().rotated(a) * 1.8
					fire(g, "ep_fire", e.x, e.y, d.x, d.y).boss_owned = true
				g.sfx("spit")
			if e.tt >= 110:
				e.st = "burrow"
				e.tt = 0
				fx(g, "fx_rubble", e.x, e.fy)
				g.sfx("crumble")


static func _warden(g: Game, e: Dictionary) -> void:
	## Lantern Warden: an armoured giant whirling a chained lantern around himself. Every
	## few seconds he slams it into the floor and two fires run out along the ground.
	var ln: Variant = g.find(int(e.get("lantern", 0)))
	if not _boss_common(g, e):
		if ln != null:
			ln.dead = true
		return
	var ar := _arena(g)
	face_player(g, e)
	match String(e.st):
		"sleep":
			e.ang = float(e.ang) + 0.04
			if e.tt > 40:
				e.st = "walk"
				e.tt = 0
		"walk":
			e.x = clampf(e.x + e.face * 0.35, ar.x + 30, ar.y - 30)
			e.ang = float(e.ang) + 0.055 * (1.4 if e.hp <= 12 else 1.0)
			if e.tt > 200:
				e.st = "slam"
				e.tt = 0
				e.a0 = fposmod(float(e.ang), TAU)
				g.sfx("growl")
		"slam":
			# the lantern swings over and down in front of him (telegraphed for 30 frames)
			var k := clampf(e.tt / 30.0, 0.0, 1.0)
			var target: float = PI / 2.0 - e.face * 0.9
			e.ang = lerpf(float(e.a0), target + TAU, k) if e.a0 > target else lerpf(float(e.a0), target, k)
			if e.tt == 30:
				g.sfx("boom")
				g.s.flash = 4
				for dir in [-1, 1]:
					var f := fire(g, "ep_flame", e.x + e.face * 36, e.fy, dir * 1.6, 0.0)
					f.w = 12
					f.h = 14
					f.fragile = false
					f.boss_owned = true
			if e.tt > 60:
				e.st = "walk"
				e.tt = 0
	if ln != null:
		var r := 40.0
		ln.x = e.x + cos(e.ang) * r
		ln.y = e.y - 30.0 + sin(e.ang) * r


static func _chainmaster(g: Game, e: Dictionary) -> void:
	## The Chainmaster: a hulking gaoler. Walks at the hero, hurls iron balls that bounce
	## once, and leaps to stomp the floor, sending shockwaves both ways (jump them).
	if not _boss_common(g, e):
		return
	var p: Dictionary = g.s.p
	var ar := _arena(g)
	match String(e.st):
		"sleep":
			if e.tt > 40:
				e.st = "walk"
				e.tt = 0
		"walk":
			face_player(g, e)
			e.x = clampf(e.x + e.face * 0.5, ar.x + 30, ar.y - 30)
			if e.tt > 110:
				e.st = "throw" if int(e.cyc) % 3 != 2 else "leap"
				e.cyc += 1
				e.tt = 0
				if e.st == "leap":
					e.vy = -5.2
					e.vx = clampf((p.x - e.x) / 60.0, -2.0, 2.0)
					g.sfx("growl")
		"throw":
			if e.tt == 20:
				var b := fire(g, "ep_ball", e.x + e.face * 16, e.y - 44, e.face * (1.2 + absf(p.x - e.x) / 150.0), -3.6)
				b.w = 14
				b.h = 14
				b.grav = 0.16
				b.bounces = 1
				b.fy = e.fy
				b.fragile = false
				b.boss_owned = true
				g.sfx("throw")
			if e.tt > 44:
				e.st = "walk"
				e.tt = 0
		"leap":
			e.vy += 0.22
			e.x = clampf(e.x + e.vx, ar.x + 30, ar.y - 30)
			e.y += e.vy
			if e.y >= e.fy and e.vy > 0:
				e.y = e.fy
				e.st = "stomp"
				e.tt = 0
				g.sfx("boom")
				g.s.flash = 3
				for dir in [-1, 1]:
					var w := fire(g, "ep_wave", e.x + dir * 18, e.fy, dir * 2.2, 0.0)
					w.w = 14
					w.h = 10
					w.fragile = false
					w.boss_owned = true
		"stomp":
			if e.tt > 40:
				e.st = "walk"
				e.tt = 0


static func _horologist(g: Game, e: Dictionary) -> void:
	## The Horologist: a floating clockwork automaton outside time (the hourglass does not
	## stop it). Blinks between perches, drops pendulum blades over the hero, fires gears.
	if not _boss_common(g, e):
		return
	var p: Dictionary = g.s.p
	var ar := _arena(g)
	e.hidden = e.st == "blink" and e.tt > 10 and e.tt < 40
	match String(e.st):
		"sleep":
			if e.tt > 50:
				e.st = "hover"
				e.tt = 0
				g.sfx("screech")
		"hover":
			face_player(g, e)
			e.y += sin(e.tt * 0.08) * 0.5
			if e.tt == 50:
				var att := int(e.cyc) % 3
				e.cyc += 1
				if att == 0:
					# a pendulum blade drops from the ceiling above the hero and swings
					var bl := g.spawn("ep_blade", p.x, g.s.cam.y + 20)
					bl.w = 16
					bl.h = 16
					bl.dmg = e.dmg
					bl.fragile = false
					bl.boss_owned = true
					bl.px = p.x
					bl.py = g.s.cam.y + 8
					bl.life = 200
					e.blade = bl.id
					g.sfx("tick")
				elif att == 1:
					var n := 8 if e.hp > 14 else 12
					for k in n:
						var a := TAU * k / n
						fire(g, "ep_gear", e.x, e.y - 16, cos(a) * 1.4, sin(a) * 1.4).boss_owned = true
					g.sfx("spit")
				else:
					e.st = "blink"
					e.tt = 0
					g.sfx("freeze")
			if e.tt > 110:
				e.tt = 0
		"blink":
			if e.tt == 25:
				var slots := [ar.x + 50, (ar.x + ar.y) / 2.0, ar.y - 50]
				e.x = float(slots[g.rand() % 3])
				e.y = e.fy - 50 - float(g.rand() % 40)
			if e.tt > 50:
				e.st = "hover"
				e.tt = 0
	# the pendulum: lowers from its pivot, swings, then is gone
	var blade: Variant = g.find(int(e.get("blade", 0)))
	if blade != null:
		blade.life = int(blade.life) - 1
		var age := 200 - int(blade.life)
		var L := 110.0 * clampf(float(age) / 30.0, 0.0, 1.0)
		var sw := sin(age * 0.06) * 0.9
		blade.x = blade.px + sin(sw) * L
		blade.y = blade.py + cos(sw) * L + 8
		if int(blade.life) <= 0:
			blade.dead = true


static func _margrave(g: Game, e: Dictionary) -> void:
	## The Pale Margrave, first form: speaks, then blinks around his throne room and casts
	## fans of embers. Visible and vulnerable only while standing.
	if not _boss_common(g, e):
		return
	var p: Dictionary = g.s.p
	var ar := _arena(g)
	match String(e.st):
		"intro":
			var li := int(e.tt / 90)
			g.s.boss.line = MARGRAVE_LINES[li] if li < MARGRAVE_LINES.size() else ""
			if e.tt >= 90 * MARGRAVE_LINES.size():
				g.s.boss.line = ""
				e.st = "stand"
				e.tt = 0
		"stand":
			e.hidden = false
			face_player(g, e)
			if e.tt == 36:
				var spread: Array = [-0.4, -0.2, 0.0, 0.2, 0.4] if e.hp <= 10 else [-0.3, 0.0, 0.3]
				for a in spread:
					var d := Vector2(p.x - e.x, p.y - 22 - (e.y - 30)).normalized().rotated(a) * 1.7
					fire(g, "ep_fire", e.x + e.face * 8, e.y - 30, d.x, d.y).boss_owned = true
				g.sfx("spit")
			if e.tt > 100:
				e.st = "fade"
				e.tt = 0
				g.sfx("freeze")
		"fade":
			e.hidden = e.tt > 12
			if e.tt == 30:
				var nx: float = p.x
				var tries := 0
				while absf(nx - p.x) < 50 and tries < 20:
					nx = ar.x + 30 + float(g.rand() % int(Game.VIEW_W - 60))
					tries += 1
				e.x = nx
			if e.tt > 44:
				e.st = "stand"
				e.tt = 0
				e.hidden = false


static func _beast(g: Game, e: Dictionary) -> void:
	## The Ashen Beast, final form: leaps across the throne room and breathes fire.
	if not _boss_common(g, e):
		return
	var p: Dictionary = g.s.p
	var ar := _arena(g)
	match String(e.st):
		"transform":
			if e.tt % 10 == 0:
				fx(g, "fx_boom", e.x + float(g.rand() % 40) - 20.0, e.y - float(g.rand() % 60))
			if e.tt > 90:
				e.st = "stand"
				e.tt = 0
				g.sfx("screech")
		"stand":
			face_player(g, e)
			if e.tt > 50:
				e.st = "breathe" if int(e.cyc) % 2 == 0 else "leap"
				e.cyc += 1
				e.tt = 0
				if e.st == "leap":
					e.vy = -6.0
					var target := clampf(p.x, ar.x + 40, ar.y - 40)
					e.vx = clampf((target - e.x) / 55.0, -3.0, 3.0)
					g.sfx("growl")
		"breathe":
			if e.tt > 20 and e.tt < 80 and e.tt % 6 == 0:
				var ang: float = -0.25 + (e.tt - 20) / 60.0 * 0.5
				fire(g, "ep_fire", e.x + e.face * 22, e.y - 44, e.face * 2.2 * cos(ang), 2.2 * sin(ang) + 0.6).boss_owned = true
				if e.tt % 12 == 0:
					g.sfx("flame")
			if e.tt > 100:
				e.st = "stand"
				e.tt = 0
		"leap":
			e.vy += 0.2
			e.x = clampf(e.x + e.vx, ar.x + 30, ar.y - 30)
			e.y += e.vy
			if e.y >= e.fy and e.vy > 0:
				e.y = e.fy
				e.st = "stand"
				e.tt = 0
				g.sfx("boom")
				g.s.flash = 3
