## Object behaviours: update, touch and trigger for every kind. These are ports of the
## source's msg_* functions (SOURCE/X_PLAYER.C, X_OBJ.C, X_OBJ2.C), which are named in
## each comment. Drawing lives in the view. Numbers are the source's; names are the remake's.
extends RefCounted

const D = preload("res://scripts/core/defs.gd")
const T = preload("res://scripts/core/tiles.gd")

const FIDGET_MAX := 300
# adapted jump feel (DESIGN rows 9, 10, 66, 67); the arc, heights and air control are the source's
const JUMP_BUFFER := 3         # steps a jump pressed in the air waits for the landing
const LEDGE_GRACE := 3         # steps after walking off an edge in which a jump still works
const CLIMBY := [4, 0, 0, 6, 4, 4, 0]

static func sgn(v: int) -> int:
	return (1 if v > 0 else 0) - (1 if v < 0 else 0)

static func count_on_screen(g, kind: int) -> int:
	var n := 0
	for o in g.scrn:
		if o.kind == kind:
			n += 1
	return n

# ================================================================ dispatch
static func update(g, o) -> void:
	match o.kind:
		D.PLAYER: upd_player(g, o)
		D.TINY: upd_tiny(g, o)
		D.BELL: upd_bell(g, o)
		D.MOTH: upd_moth(g, o)
		D.URCHIN: upd_urchin(g, o)
		D.DOOR: upd_door(g, o)
		D.ADDSTEP: upd_addstep(g, o)
		D.PAD: upd_pad(g, o)
		D.SPRING:
			if o.statecount > 0:
				o.statecount -= 1
		D.DART: upd_dart(g, o)
		D.MASHER: upd_masher(g, o)
		D.PLATFORM: upd_platform(g, o)
		D.CHECKPT: upd_checkpt(g, o)
		D.LIFT: upd_lift(g, o)
		D.KEY: o.counter = (o.counter + 1) % 16
		D.HEART: o.counter = (o.counter + 1) & 7
		D.SHARD: o.counter = (o.counter + 1) % 6
		D.OWL: upd_owl(g, o)
		D.BURROWHOG: upd_burrowhog(g, o)
		D.CRATE: upd_crate(g, o)
		D.SCORE: upd_score(g, o)
		D.TOKEN: upd_token(g, o)
		D.POKER:
			if o.statecount > 0:
				o.statecount -= 1
		D.PELLET: upd_pellet(g, o)
		D.STONE: upd_stone(g, o)
		D.EMBER: upd_ember(g, o)
		D.BOLT: upd_bolt(g, o)
		D.TORPEDO: upd_torpedo(g, o)
		D.FRAG: upd_frag(g, o)
		D.BURST: _age(g, o, 9)
		D.FLASH: upd_flash(g, o)
		D.SPARK: _age(g, o, 7)
		D.IMPACT: _age(g, o, 11)
		D.SPEAR: upd_spear(g, o)
		D.STALACTITE: upd_stalactite(g, o)
		D.GEODE: upd_geode(g, o)
		D.FIRE: upd_fire(g, o)
		D.TORCH: o.counter = (o.counter + 1) & 7
		D.SNAPJAW: upd_snapjaw(g, o)
		D.SEGMENTER: upd_segmenter(g, o)
		D.SEGBIT: upd_segbit(g, o)
		D.CAIRNBRUTE: upd_cairnbrute(g, o)
		D.SLICK: upd_slick(g, o)
		D.NEWT: upd_newt(g, o)
		D.SPIKES: upd_spikes(g, o)
		D.DRONE: upd_drone(g, o)
		D.TRANSPAD:
			if o.state > 0:
				o.state -= 1
		D.SHADE: upd_shade(g, o)
		D.BUBBLE: upd_bubble(g, o)
		D.EEL: upd_swimmer(g, o, 10, 10)
		D.GAR: upd_gar(g, o)
		D.MINNOW: upd_swimmer(g, o, 8, 14)
		D.DUSKWING: upd_duskwing(g, o)
		D.PIPTOAD: upd_piptoad(g, o)
		D.HEARTCRYSTAL: upd_heartcrystal(g, o)
		D.TIMERPAD: upd_timerpad(g, o)
		D.TURRET: upd_turret(g, o)
		D.STINGMOTE: upd_stingmote(g, o)
		D.CREEPER: upd_creeper(g, o)
		D.LOOMSPIDER: upd_loomspider(g, o)
		D.GLASSBOLT: upd_glassbolt(g, o)
		D.REGENT: upd_regent(g, o)
		D.SENTRY: upd_sentry(g, o)
		D.FLAG: o.counter = (o.counter + 1) & 7
		_: pass

static func touch(g, o, z) -> void:
	# o is touched by z (both directions are called by upd_objs, as in the source)
	var zp: bool = z == g.player()
	match o.kind:
		D.URCHIN: touch_urchin(g, o, z, zp)
		D.PAD: touch_pad(g, o, zp)
		D.SPRING: touch_spring(g, o, z)
		D.DART:
			if zp:
				g.hitplayer(o, false)
				g.killobj(o)
		D.MASHER:
			if zp:
				g.hitplayer(o, false)
		D.PLATFORM: touch_platform(g, o, z)
		D.CHECKPT:
			if zp:
				touch_checkpt(g, o)
		D.LIFT:
			if zp and z.kind == D.PLAYER:
				touch_lift(g, o)
		D.KEY:
			if zp:
				touch_key(g, o)
		D.HEART:
			if zp:
				touch_heart(g, o)
		D.SHARD:
			if zp:
				touch_shard(g, o)
		D.OWL:
			if zp and o.info1 == 1:
				o.info1 = 2
		D.BURROWHOG: touch_tough(g, o, z, zp, 4, "hit4")
		D.CRATE: touch_crate(g, o, z, zp)
		D.TOKEN:
			if zp:
				touch_token(g, o)
		D.SWITCH:
			if zp:
				touch_switch(g, o)
		D.BUTTON: touch_button(g, o)
		D.POKER:
			if zp:
				touch_poker(g, o)
		D.PELLET: touch_pellet(g, o, z, zp)
		D.BONUS:
			if zp:
				touch_bonus(g, o)
		D.STONE: touch_stone(g, o, z, zp)
		D.EMBER: touch_ember(g, o, z)
		D.BOLT: touch_bolt(g, o, z)
		D.TORPEDO: touch_torpedo(g, o, z)
		D.SPEAR:
			if zp:
				g.hitplayer(o, o.state == 1)
		D.STALACTITE:
			if zp:
				touch_stalactite(g, o)
		D.GEODE: touch_geode(g, o, z, zp)
		D.FIRE: touch_fire(g, o, zp)
		D.SNAPJAW:
			if zp:
				g.hitplayer(o, false)
		D.SEGMENTER: touch_segmenter(g, o, z, zp)
		D.SEGBIT:
			if zp:
				g.snd("shard", 3)
				g.addobj(D.FLASH, o.x - 3, o.y - 1, 0, 1)
				g.playerkill(o)
		D.CAIRNBRUTE: touch_brute(g, o, z, zp)
		D.SLICK:
			if zp:
				g.hitplayer(o, false)
		D.NEWT:
			if zp:
				g.hitplayer(o, false)
		D.SPIKES:
			if zp and o.state > 0:
				g.hitplayer(o, false)
		D.DRONE: touch_drone(g, o, z, zp)
		D.TRANSPAD:
			if zp:
				touch_transpad(g, o)
		D.SHADE: touch_shade(g, o, z, zp)
		D.EEL:
			if zp:
				g.hitplayer(o, true)
		D.GAR: touch_gar(g, o, z, zp)
		D.DUSKWING:
			if zp:
				g.hitplayer(o, false)
		D.PIPTOAD:
			if zp:
				g.hitplayer(o, false)
		D.SIGNPOST:
			if zp:
				touch_signpost(g, o)
		D.HEARTCRYSTAL: touch_heartcrystal(g, o, z, zp)
		D.TURRET: touch_turret(g, o, z, zp)
		D.STINGMOTE:
			if zp:
				g.hitplayer(o, false)
		D.CREEPER:
			if zp:
				touch_creeper(g, o)
		D.LOOMSPIDER: touch_spider(g, o, z, zp)
		D.GLASSBOLT:
			if zp:
				g.hitplayer(o, false)
				g.killobj(o)
		D.MINNOW:
			if zp:
				g.hitplayer(o, true)
				g.explode1(o.x + 4, o.y + 4, 5, false)
				g.killobj(o)
		D.SIGIL:
			if zp:
				touch_sigil(g, o)
		D.REGENT: touch_regent(g, o, z, zp)
		D.SENTRY: touch_sentry(g, o, z, zp)
		D.FLAG:
			if zp:
				touch_flag(g, o)
		D.GATE:
			if zp:
				touch_gate(g, o)
		_: pass

static func trigger(g, o, msg: int, from) -> void:
	match o.kind:
		D.BRIDGER: trig_bridger(g, o, msg, from)
		D.DOOR:
			if msg == D.MSG_TRIGGER:
				trig_door(g, o, from)
		D.ADDSTEP: trig_addstep(g, o, from)
		D.PLATFORM:
			if o.state != -1:
				o.state = 1 - o.state
		D.OWL: trig_owl(g, o, from)
		D.CRATE:
			o.substate = 1
			if from != null and from.kind == D.PAD:
				g.killobj(from)
		D.TOKEN: o.substate = 0
		D.POKER: o.statecount = 15
		D.STALACTITE: trig_stalactite(g, o, from)
		D.TRANSPORT: trig_transport(g, o)
		D.TURRET: o.state = 1 - o.state
		_: pass

static func _age(g, o, life: int) -> void:
	o.counter += 1
	if o.counter >= life or not g.onscreen(o):
		g.killobj(o)

# ================================================================ player (X_PLAYER.C msg_player)
static func upd_player(g, p) -> void:
	var peeky := 0
	if g.jump_buffer > 0:
		g.jump_buffer -= 1
	if g.ledge_grace > 0:
		g.ledge_grace -= 1
	var dx1: int = g.dx1
	var dy1: int = g.dy1
	match p.state:
		D.ST_STAND:
			_stand(g, p)
			if p.state == D.ST_JUMPING and p.yd < 0:
				_jump(g, p, true)          # adapted: a jump rises on the step it is pressed
			if p.state == D.ST_STAND and dx1 == 0 and dy1 != 0 and p.xd == 0:
				if p.yd > 1:
					peeky = 2
				elif p.yd < -1:
					peeky = -2
		D.ST_BEGIN:
			p.xl = 24
			p.yl = 40
			if p.statecount >= 40:
				p.state = D.ST_STAND
				p.statecount = 60
				p.info1 = 1
				p.xd = 0
				p.yd = 0
		D.ST_DIE:
			if p.substate == D.DIE_MOTH:
				p.yd = mini(p.yd + 1, 8)
				p.xd = g.rnd(7) - 3
				g.justmove(p, p.x + p.xd, p.y + p.yd)
			elif p.substate == D.DIE_BELL:
				g.fishdo(p, p.x, p.y - p.statecount)
			if p.statecount >= 19:
				g.p_reenter(true)
			p.statecount += 1
			return
		D.ST_TRANSPORT:
			if p.statecount >= 15:
				p.state = D.ST_STAND
				g.sendtrig(p.substate, D.MSG_TRIGGER, p)
			p.statecount += 1
			return
		D.ST_PLATFORM:
			if p.yd != 0:
				p.yd = clampi(p.yd + dy1 * 2, -3, 3)
				if p.yd > 1:
					peeky = 2
				elif p.yd < -1:
					peeky = -2
		D.ST_JUMPING:
			_jump(g, p)
		D.ST_CLIMBING:
			_climb(g, p)
		D.ST_STILL:
			_still_fall(g, p)
	if p.xd != 0:
		p.info1 = sgn(p.xd)
	if g.fire1 and D.STATEINFO[p.state] & D.STI_CANFIRE:
		g.fire1off = 1
		if p.info1 != 0:
			_fire(g, p)
	p.statecount += 1
	if p.counter != 0:
		p.counter -= 1
	g.touchbkgnd(p)
	g.calc_scroll(peeky)

## Adapted: a hold (the Regent's meeting, the Regent's and the heart crystal's blasts) that
## begins in mid-air lets Orrin fall to the floor. The source left him hanging in the air for
## the whole 60-step blast, which a player took for a freeze. Only the Spire holds Orrin
## still, and it has no moving platforms, so the tile floor is the floor.
static func _still_fall(g, p) -> void:
	p.xd = 0
	if g.standfloor(p, 0, 0):
		p.yd = 0
		return
	p.yd = clampi(p.yd + 2, 0, 16)      # a rise stops: the hold is not a jump
	if not g.trymovey(p, p.x, p.y + p.yd):
		g.trymovey(p, p.x, ((p.y + p.yl) & ~15) + 16 - p.yl)
		p.yd = 0

static func _stand(g, p) -> void:
	var dx1: int = g.dx1
	var dy1: int = g.dy1
	var FL: int = T.PLAYERTHRU | T.NOTSTAIR
	if g.cando(p, p.x, p.y, T.PLAYERTHRU) == 0:
		p.substate = -1
	if p.yd != 0:
		p.yd -= sgn(p.yd)
	if p.statecount < 0:
		if p.statecount == -1:
			p.statecount = 3
	elif p.xd == 0:
		if dx1 != 0:
			# the first press only turns (the source breaks out of the case here)
			p.substate = 7
			p.xd = dx1
			p.statecount = 0
			return
		elif p.statecount > FIDGET_MAX:
			p.statecount = 20
		elif p.statecount == FIDGET_MAX - 42:
			g.fidget_line = g.rnd(4)
			g.txt(g.tr_text("fidget_%d" % g.fidget_line), 6)
		if g.cando(p, p.x, (p.y & ~15) + 16, FL) == FL:
			p.state = D.ST_JUMPING
			p.yd = 0
			p.substate = 2
			g.ledge_grace = LEDGE_GRACE
	elif dx1 != 0:
		if dx1 == p.xd:
			if g.cando(p, p.x + dx1 * 8, p.y, T.PLAYERTHRU) != 0:
				p.x += dx1 * 8
				p.yd = 0
			p.substate = (p.substate + 1) & 7
			p.statecount = 0
		else:
			p.info1 = p.xd
			p.xd = 0
			p.statecount = 4
	else:
		if p.statecount >= 2 and p.substate != 0:
			p.xd = 0
			p.substate = 0
			p.statecount = 0
	if g.cando(p, p.x, (p.y & ~15) + 16, FL) == FL:
		p.state = D.ST_JUMPING
		p.yd = 0
		p.substate = 0
		g.ledge_grace = LEDGE_GRACE
	if g.fire2 or (g.jump_buffer > 0 and p.state == D.ST_STAND):
		if g.fire2:
			g.fire2off = 1
		_launch(g, p, dx1)
	elif dy1 != 0:
		if p.x & 15 == 0:
			if g.cando(p, p.x, p.y + dy1 * 4, T.PLAYERTHRU) != 0:
				if g.cando(p, p.x, p.y + dy1 * 4, T.NOTVINE) == 0 and g.cando(p, p.x - 8, p.y + dy1 * 4, T.NOTVINE) == 0:
					g.moveobj(p, p.x, p.y + dy1 * 4)
					p.state = D.ST_CLIMBING
					p.substate = 3
		if p.state == D.ST_STAND and dx1 == 0:
			p.yd = clampi(p.yd + dy1 * 2, -3, 3)
			p.xd = 0
			p.substate = 0
			p.statecount = 3

static func _jump(g, p, launched: bool = false) -> void:
	var dx1: int = g.dx1
	p.counter = 0
	if p.x & 15 == 0:
		if g.cando(p, p.x, p.y, T.NOTVINE) == 0 and g.cando(p, p.x - 8, p.y, T.NOTVINE) == 0:
			p.state = D.ST_CLIMBING
			p.substate = 6
			return
	if g.fire2 and not launched:
		g.fire2off = 1
		if g.ledge_grace > 0 and p.yd >= 0:
			_launch(g, p, dx1)         # just walked off an edge: still a jump
		else:
			g.jump_buffer = JUMP_BUFFER
	p.substate += 1
	if p.substate > 2:
		p.yd = mini(p.yd + 2, 16)
		if dx1 != 0:
			p.substate = 2
			p.xd = dx1
		if p.substate > 8:
			p.xd = 0
		if not g.trymovey(p, p.x + dx1 * 8, p.y + p.yd):
			if p.yd >= 0:
				var landed: bool = ((p.y + p.yl) & 15) == 0
				if not landed and not g.trymovey(p, p.x + dx1 * 8, ((p.y + p.yl) & ~15) + 16 - p.yl):
					landed = true
				if landed:
					# adapted: the source holds a landing for 4 (7 after a full fall) steps before
					# Orrin can run; here a held direction runs straight on, and only a hard
					# landing with the stick centred keeps a short 2-step crouch
					var hard: bool = p.yd >= 16
					p.state = D.ST_STAND
					p.counter = 6
					p.yd = 0
					if dx1 != 0:
						p.xd = dx1
						p.statecount = 0
						p.substate = 1
					else:
						p.xd = 0
						p.statecount = -2 if hard else 0
					g.snd("land", 2)
					if g.jump_buffer > 0:
						g.jump_buffer = 0
						_launch(g, p, dx1)
			else:
				var desty: int = (p.y - 1) & ~15
				if desty == p.y:
					p.yd = 0
				elif not g.trymovey(p, p.x + dx1 * 8, desty):
					p.yd = 0

## A jump from the floor. Adapted: the source waits two steps (substate 0 -> 3) before the
## first rise; starting at substate 2 rises on the next move, on the same arc.
static func _launch(g, p, dx1: int) -> void:
	p.state = D.ST_JUMPING
	p.yd = -(16 + 4 * g.invcount(D.INV_BOOTS))
	p.substate = 2
	p.xd = dx1
	g.jump_buffer = 0
	g.ledge_grace = 0
	g.snd("jump", 2)

static func _climb(g, p) -> void:
	var dx1: int = g.dx1
	var dy1: int = g.dy1
	if dx1 != 0:
		if p.substate != 6 and g.cando(p, p.x + dx1 * 8, p.y, T.PLAYERTHRU) != 0:
			p.counter = 0
			g.moveobj(p, p.x + dx1 * 8, p.y)
			p.state = D.ST_JUMPING
			p.substate = 2
			p.xd = dx1
			if g.fire2:
				g.fire2off = 1
				p.yd = -16
				g.snd("jump", 2)
			else:
				p.yd = -4
		return
	p.xd = 0
	if p.substate == 6:
		p.substate = 0
	if dy1 != 0:
		var desty: int = p.y - CLIMBY[p.substate] if dy1 < 0 else p.y + 4
		var ok := true
		if g.cando(p, p.x, desty, T.PLAYERTHRU) == 0:
			desty = ((p.y & ~15) + 16) if dy1 > 0 else ((p.y - 1) & ~15)
			ok = g.cando(p, p.x, desty, T.PLAYERTHRU) != 0
		if ok:
			if dy1 < 0:
				p.substate -= 1
				if p.substate >= 6:
					p.substate = 0
			else:
				p.substate = 2
			g.moveobj(p, p.x, desty)
			if g.cando(p, p.x, p.y, T.NOTVINE) != 0:
				p.state = D.ST_STAND
				p.xd = 0
	if p.substate < 0:
		p.substate = 5
	elif p.substate > 6:
		p.substate = 6

static func _fire(g, p) -> void:
	# fireball > stone > bolt, each capped by what is already on screen
	if p.xd == 0 and p.state == D.ST_STAND:
		p.substate = 0
		p.statecount = 3
	elif p.xd == 0 and p.state == D.ST_PLATFORM:
		p.xd = p.info1
	var right := 1 if p.info1 > 0 else 0
	if g.invcount(D.INV_EMBER):
		if count_on_screen(g, D.EMBER) < 1:
			g.takeinv(D.INV_EMBER)
			g.addobj(D.EMBER, p.x - 8 + right * 16, p.y + 8, p.info1 * 8, 0)
			g.snd("firebreath", 2)
		else:
			g.snd("error", 1)
	elif g.invcount(D.INV_STONES):
		if count_on_screen(g, D.STONE) < g.invcount(D.INV_STONES):
			g.addobj(D.STONE, p.x + 4, p.y + 8, p.info1 * 6, -8)
			g.snd("stonebounce", 2)
		else:
			g.snd("error", 1)
	else:
		if count_on_screen(g, D.BOLT) < g.invcount(D.INV_BOLT):
			g.addobj(D.BOLT, p.x + 4 + right * 4, p.y + 18 + (12 if p.yd == 3 else 0), p.info1 * 6, 0)
			g.snd("bolt", 2)
		else:
			g.snd("error", 1)

# ---------------------------------------------------------------- other forms
static func upd_tiny(g, p) -> void:
	# X_PLAYER.C msg_tiny: the overworld walker
	if g.dx1 != 0 or g.dy1 != 0:
		p.statecount = (p.statecount + 1) & 7
		p.xd = g.dx1
		p.yd = g.dy1
		if g.cando(p, p.x + g.dx1 * 4, p.y + g.dy1 * 4, T.PLAYERTHRU) != 0:
			p.x += g.dx1 * 4
			p.y += g.dy1 * 4
		elif g.dx1 != 0 and g.dy1 != 0:
			# a blocked diagonal walks along whichever side is open
			if g.cando(p, p.x + g.dx1 * 4, p.y, T.PLAYERTHRU) != 0:
				p.x += g.dx1 * 4
			elif g.cando(p, p.x, p.y + g.dy1 * 4, T.PLAYERTHRU) != 0:
				p.y += g.dy1 * 4
		else:
			_tiny_slide(g, p, g.dx1, g.dy1)
	g.calc_scroll(0)

## Adapted: walking straight into a bank, the walker slides up to 12 px sideways toward an
## opening. The gates stand in one-cell gaps through the river and the rocks, and the walker
## moves 4 px a step, so a player a few pixels off the path's row met an invisible barrier
## beside an open gate (the source's map had no such gaps).
static func _tiny_slide(g, p, dx: int, dy: int) -> void:
	for d in [4, -4, 8, -8, 12, -12]:
		var sx: int = d if dy != 0 else 0
		var sy: int = d if dx != 0 else 0
		if g.cando(p, p.x + sx + dx * 4, p.y + sy + dy * 4, T.PLAYERTHRU) == 0:
			continue
		var clear := true
		for k in range(1, absi(d) / 4 + 1):
			if g.cando(p, p.x + sgn(sx) * 4 * k, p.y + sgn(sy) * 4 * k, T.PLAYERTHRU) == 0:
				clear = false
				break
		if clear:
			p.x += sgn(sx) * 4
			p.y += sgn(sy) * 4
			return
	g.touchbkgnd(p)

static func upd_bell(g, p) -> void:
	# X_PLAYER.C msg_heroswim
	if p.state == D.ST_DIE:
		upd_player(g, p)
		return
	var onwater: bool = g.fishdo(p, p.x, p.y)
	p.xd = g.dx1 * 8
	if onwater:
		p.yd += g.dy1 * 3 + (1 if p.yd < 2 else 0)
		if g.rnd(15) == 0:
			g.addobj(D.BUBBLE, p.x + 8, p.y - 2, 0, 0)
		p.yd = clampi(p.yd, -8, 8)
	else:
		p.yd = clampi(p.yd + 4, -16, 16)
	if g.fire2 and onwater:
		g.fire2off = 1
		p.yd = -3
	if g.fire1:
		g.fire1off = 1
		if count_on_screen(g, D.TORPEDO) < 1:
			g.addobj(D.TORPEDO, p.x + 22, p.y + 25, 6, 0)
			g.addobj(D.TORPEDO, p.x - 3, p.y + 25, -6, 0)
			g.snd("torpedo", 2)
		else:
			g.snd("error", 1)
	p.yd = clampi(p.yd, -8, 8)
	var destx: int = p.x + p.xd
	var desty: int = p.y + p.yd
	if not g.justmove(p, p.x, desty):
		if p.yd != 0:
			var tempy: int = ((desty + 16) & ~15) if p.yd < 0 else ((desty & ~15) + 32 - p.yl)
			g.justmove(p, p.x, tempy)
		p.yd = 0
	g.fishdo(p, destx, p.y)
	if p.xd != 0:
		p.info1 = sgn(p.xd)
	g.calc_scroll(0)

static func upd_moth(g, p) -> void:
	# X_PLAYER.C msg_herobee
	if p.state == D.ST_DIE:
		upd_player(g, p)
		return
	p.counter = (p.counter + 1) & 3
	if p.xd != 0:
		p.substate = p.xd
	if p.x & 7 != 0 or p.xd == 0:
		p.xd = g.dx1 * 4
	else:
		p.xd = g.dx1 * 8
	if p.counter & 1:
		p.yd += 1
	if g.fire2:
		g.snd("toadland", 1)
		g.fire2off = 1
		p.yd = -6
	if g.fire1:
		g.fire1off = 1
		if count_on_screen(g, D.BOLT) < 1:
			if p.substate == 0:
				p.substate = 4
			p.xd = p.substate
			g.addobj(D.BOLT, p.x + sgn(p.substate) * 8, p.y + 14, sgn(p.substate) * 8, g.dy1 * 2)
			g.snd("bolt", 2)
	p.yd = clampi(p.yd, -8, 8)
	var destx: int = p.x + p.xd
	if not g.justmove(p, destx, p.y):
		destx = p.x
	if p.yd != 0:
		if not g.justmove(p, destx, p.y + p.yd):
			p.yd = 0
	if p.xd != 0:
		p.info1 = sgn(p.xd)
	g.calc_scroll(0)
	g.touchbkgnd(p)

# ================================================================ mechanisms
static func upd_door(g, o) -> void:
	# X_OBJ.C msg_door: slides open over 16 steps once unlocked
	if o.statecount == 0:
		return
	o.statecount += 1
	if o.statecount > 16:
		g.killobj(o)

static func trig_door(g, o, from) -> void:
	if o.statecount != 0:
		return
	var xc: int = o.x >> 4
	var yc: int = o.y >> 4
	if g.takeinv(D.INV_KEY0 + o.state):
		g.txt(g.tr_text("door_open_%d" % g.rnd(4)), 2)
		g.snd("door", 4)
		o.statecount = 1
		for c in [-1, 0, 1]:
			g.settile(xc, yc + c, g.tile(xc - 1, yc + c))
		if from != null and from.kind == D.PAD:
			g.killobj(from)
	else:
		g.txt(g.tr_text("door_locked_%d" % g.rnd(4)), 5)

static func trig_bridger(g, o, msg: int, from) -> void:
	# X_OBJ.C msg_bridger: lays or lifts a line of bridge (or beam) cells
	var xc: int = o.x >> 4
	var yc: int = o.y >> 4
	var dircell: int = T.BEAM if o.xd == 0 else T.BRIDGE
	var oldcell := 0
	var newcell := 0
	if msg == D.MSG_TRIGON:
		oldcell = g.tile(xc, yc)
		newcell = dircell
	elif msg == D.MSG_TRIGOFF:
		oldcell = dircell
		newcell = 0
	else:
		if g.tile(xc, yc) == dircell:
			oldcell = dircell
			newcell = 0
		else:
			oldcell = g.tile(xc, yc)
			newcell = dircell
		if from != null and from.kind == D.PAD:
			g.killobj(from)
	if o.state == 1:
		g.snd("switch_on" if newcell != 0 else "switch_off", 2)
	if newcell == 0:
		newcell = T.AIR
		for c in [-1, 1]:
			var d: int = g.tile(xc + c * o.yd, yc + c * o.xd)
			if T.FLAGS[d] & (T.PLAYERTHRU | T.NOTSTAIR) == (T.PLAYERTHRU | T.NOTSTAIR):
				newcell = d
	if oldcell == newcell:
		return
	var guard := 0
	while g.tile(xc, yc) == oldcell and guard < 128:
		g.settile(xc, yc, newcell)
		xc += o.xd
		yc += o.yd
		guard += 1

static func upd_addstep(g, o) -> void:
	if o.state == 0:
		return
	var xc: int = o.x >> 4
	var yc: int = o.y >> 4
	for s in o.p.get("stamp", []):
		g.settile(xc + int(s[0]), yc + int(s[1]), int(s[2]))
	g.killobj(o)

static func trig_addstep(g, o, from) -> void:
	o.state = 1
	g.snd("switch_on", 4)
	if from != null and from.kind == D.PAD:
		g.addobj(D.FLASH, from.x - 1, from.y - 3, 0, 0)
		g.killobj(from)

static func upd_pad(g, o) -> void:
	if o.xd == 0:
		return
	o.statecount = (o.statecount + 1) % 16

static func touch_pad(g, o, zp: bool) -> void:
	if not zp:
		return
	if o.zaphold == 0:
		var m: int = D.MSG_TRIGGER
		if o.state == -1:
			m = D.MSG_TRIGOFF
		elif o.state == 1:
			m = D.MSG_TRIGON
		g.sendtrig(o.counter, m, o)
	o.zaphold = 3

static func touch_spring(g, o, z) -> void:
	var p = g.player()
	if z != p or p.kind != D.PLAYER or o.zaphold != 0:
		return
	if p.yd > 0 and p.y + p.yl >= o.y + 6:
		p.state = D.ST_JUMPING
		p.y -= 6
		p.yd = -(16 + 4 * o.counter)
		if o.xd == 1:
			o.counter += 1
			if o.counter > 4:
				o.counter = 0
		p.xd = g.dx1
		p.substate = 2                 # adapted: no launch hang (see _launch)
		g.snd("spring", 1)
		o.zaphold = 5
		o.statecount = 10

static func upd_dart(g, o) -> void:
	# X_OBJ.C msg_arrow: speeds up and wobbles
	const WOB := [1, 0, -1, 0]
	if not g.onscreen(o):
		g.killobj(o)
		return
	o.counter = (o.counter + 1) & 7
	o.xd += 1 if o.xd > 0 else -1
	if not g.justmove(o, o.x + o.xd, o.y + WOB[o.counter / 2]):
		g.killobj(o)

static func upd_masher(g, o) -> void:
	# X_OBJ.C msg_masher: a 25-step cycle of 4, 12, 20 px long
	match o.state:
		1:
			o.counter = 0
			o.yl = 4
		20:
			o.counter = 1
			o.yl = 12
		22:
			o.counter = 2
			o.yl = 20
			g.snd("masher", 1)
		24:
			o.state = 0
			o.counter = 1
			o.yl = 12
	o.state += 1

static func upd_platform(g, o) -> void:
	# X_OBJ.C msg_platform
	var p = g.player()
	var FL: int = T.PLAYERTHRU | T.NOTSTAIR
	o.statecount = (o.statecount + 1) & 7
	if o.state != 1:
		if o.yd < 0 and o.substate == D.ST_PLATFORM:
			if g.cando(p, p.x, o.y - 42, FL) == FL:
				g.moveobj(o, o.x + o.xd, o.y + o.yd)
			else:
				o.xd = -o.xd
				o.yd = -o.yd
				if g.cando(p, p.x, o.y - 42, FL) == FL:
					g.moveobj(o, o.x + o.xd, o.y + o.yd)
		else:
			if g.cando(o, o.x + o.xd, o.y + o.yd, FL) == FL:
				g.moveobj(o, o.x + o.xd, o.y + o.yd)
			else:
				o.xd = -o.xd
				o.yd = -o.yd
				if g.cando(o, o.x + o.xd, o.y + o.yd, FL) == FL:
					g.moveobj(o, o.x + o.xd, o.y + o.yd)
	if o.substate == D.ST_PLATFORM:
		if p.state != D.ST_PLATFORM:
			o.substate = D.ST_STAND        # the rider died or changed form
			return
		if g.dy1 > 0 and g.fire2:
			g.fire2off = 1
			p.state = D.ST_JUMPING
			p.yd = 0
			p.substate = 2
			p.xl = 24
			o.substate = D.ST_STAND
			o.zaphold = 10
			return
		if g.fire2:
			g.fire2off = 1
			p.state = D.ST_JUMPING
			p.yd = -(16 + 4 * g.invcount(D.INV_BOOTS))
			p.substate = 2                 # adapted: no launch hang (see _launch)
			p.xd = g.dx1
			p.xl = 24
			g.snd("jump", 2)
			o.substate = D.ST_STAND
			o.zaphold = 5
			return
		if g.dx1 != 0:
			p.xd = g.dx1
			p.statecount = 0
		elif p.statecount > 20:
			p.xd = 0
			p.statecount = 0
		p.x = o.x
		p.y = o.y - p.yl
		p.yd = 0 if o.yd != 0 else g.dy1
		if o.yd < 0:
			p.substate = 0
		elif o.yd > 0:
			p.substate = 1
		g.moveobj(p, p.x, p.y)

static func touch_platform(g, o, z) -> void:
	var p = g.player()
	if z != p or p.kind != D.PLAYER or o.zaphold != 0 or o.substate == D.ST_PLATFORM or p.state == D.ST_PLATFORM:
		return
	if p.state == D.ST_DIE or p.state == D.ST_BEGIN:
		return
	if p.y + p.yl > o.y + o.yl + p.yd:
		return
	g.tip("tip_platform")
	o.substate = D.ST_PLATFORM
	p.state = D.ST_PLATFORM
	p.counter = 6
	p.xl = 27
	g.snd("land", 2)

static func upd_checkpt(g, o) -> void:
	var p = g.player()
	if p.x < o.x + o.xl and o.x < p.x + p.xl and p.y < o.y + o.yl and o.y < p.y + p.yl:
		o.xd = p.x
		o.yd = p.y

static func touch_checkpt(g, o) -> void:
	# X_OBJ.C msg_checkpt
	var p = g.player()
	if o.state == 2 and _gatekey_left(g):
		g.txt(g.tr_text("leave_need_gatekey"), 5)
		return
	if o.state == 3 and g.countobj(D.SIGIL, false) > 0:
		g.txt(g.tr_text("leave_need_sigil"), 5)
		return
	if o.state == 4:
		g.gameover = 2
		return
	if g.pl["level"] != o.counter:
		g.snd("level", 5)
		if o.counter != 0:
			g.pl["level"] = o.counter
		if p.kind == D.TINY:
			# the source's map boards stored a return spot in xd,yd; ours are recorded by
			# upd_checkpt, which has not run yet on the first contact, so stay put then
			if o.xd != 0 or o.yd != 0:
				g.moveobj(p, o.xd, o.yd)
		else:
			p.x = o.x
			p.y = o.y - 24
			p.state = D.ST_BEGIN
			p.statecount = 0
		if o.inside != "":
			g.newlevel = o.inside

static func _gatekey_left(g) -> bool:
	# a gate-key token still lying about, or a crate that holds one (drop 10)
	for o in g.objs:
		if o.kind == D.TOKEN and o.state == D.INV_GATEKEY:
			return true
		if o.kind == D.CRATE and o.state == 10:
			return true
	return false

static func upd_lift(g, o) -> void:
	# X_OBJ.C msg_elev: the lift is a column of LIFT tiles; this object rides its top
	var xc: int = o.x >> 4
	var yc: int = o.y >> 4
	if o.state > 0:
		o.state -= 1
	if o.state == 0 and g.tile(xc, yc + 1) == T.LIFT_L and o.counter != -1:
		g.settile(xc, yc + 1, g.tile(xc, yc))
		g.settile(xc + 1, yc + 1, g.tile(xc + 1, yc))
		g.moveobj(o, o.x, o.y + 16)
		return
	if o.info1 and g.tile(xc, yc + 1) == T.LIFT_L:
		g.settile(xc, yc + 1, g.tile(xc, yc))
		g.settile(xc + 1, yc + 1, g.tile(xc + 1, yc))
		g.moveobj(o, o.x, o.y + 16)
		var p = g.player()
		g.justmove(p, p.x, yc * 16 - 8)
		o.info1 = 0

static func touch_lift(g, o) -> void:
	var xc: int = o.x >> 4
	var yc: int = o.y >> 4
	var p = g.player()
	o.state = 6
	if not g.seen.has("tip_lift"):
		g.seen["tip_lift"] = true
		g.txt(g.tr_text("tip_lift"), 7)
	if g.dy1 < 0:
		if o.substate != g.dy1:
			g.snd("lift", 2)
		if g.justmove(p, p.x, (yc - 2) * 16 - 8):
			g.moveobj(o, o.x, o.y - 16)
			g.settile(xc, yc, T.LIFT_L)
			g.settile(xc + 1, yc, T.LIFT_R)
	elif g.dy1 > 0:
		if o.substate != g.dy1:
			g.snd("lift", 2)
		if g.tile(xc, yc + 1) == T.LIFT_L:
			o.info1 = 1
	o.substate = g.dy1

# ================================================================ pickups
static func touch_key(g, o) -> void:
	var item: int = D.INV_KEY0 + o.state
	if g.invcount(item):
		g.txt(g.tr_text("key_have"), 5)
		return
	g.addinv(item)
	g.addobj(D.FLASH, o.x - 3, o.y - 2, 0, 0)
	g.killobj(o)
	g.snd("key", 3)
	g.txt(g.tr_text("key_got_" + D.KEY_COLORS[o.state]), 3)

static func touch_heart(g, o) -> void:
	if g.pl["health"] < 5:
		if not g.invcount(D.INV_WARD):
			g.pl["ouched"] = -4
		g.pl["health"] += 1
	g.addobj(D.FLASH, o.x - 1, o.y - 3, 0, 0)
	g.playerkill(o)
	g.snd("heart", 3)
	if not g.seen.has("tip_heart"):
		g.seen["tip_heart"] = true
		g.txt(g.tr_text("tip_heart"), 7)

static func touch_shard(g, o) -> void:
	if g.pl["shards"] < 99:
		g.pl["shards"] += 1
	g.snd("shard", 3)
	g.addobj(D.FLASH, o.x + 1, o.y - 2, 0, 1)
	g.playerkill(o)
	g.tip("tip_shard")

static func touch_bonus(g, o) -> void:
	# X_OBJ.C msg_bonus; state picks what it is
	var sc := 25
	match o.state:
		1:
			while g.invcount(D.INV_BOLT) < 5:
				g.addinv(D.INV_BOLT)
			sc = 100
			g.txt(g.tr_text("rapid"), 3)
			g.snd("token", 3)
		2, 6, 8, 14:
			g.tip("tip_berry")
			if g.fruit < 16:
				g.fruit += 1
			g.fruit_icon = {2: 0, 6: 1, 8: 2, 14: 3}[o.state]
			sc = 100
			g.snd("berry", 3)
		3:
			sc = 120
			g.snd("bonus", 3)
		7:
			sc = 200
			g.snd("bonus2", 3)
		23:
			sc = 50
			g.snd("bonus2", 3)
		19:
			sc = 2000
			g.snd("key", 3)
		9, 10, 11, 12:
			# the four runes V-A-L-E, collected in order, give 4000
			var i: int = o.state - 9
			g.addobj(D.FLASH, o.x - 1, o.y - 3, 0, 0)
			sc = 100
			if i < 3:
				if g.invcount(D.INV_RUNE) == i:
					g.addinv(D.INV_RUNE)
				if i == 0:
					g.txt(g.tr_text("rune_hint"), 3)
				g.snd("heart", 3)
			elif g.invcount(D.INV_RUNE) == 3:
				sc = 4000
				g.txt(g.tr_text("rune_bonus"), 3)
				g.snd("key", 3)
			else:
				g.snd("heart", 3)
		13:
			g.textwin(o.inside)
			g.killobj(o)
			return
		28:
			for i in 5:
				if g.invcount(D.INV_EMBER) < 9:
					g.addinv(D.INV_EMBER)
			sc = 1000
			g.txt(g.tr_text("embers5"), 3)
			g.snd("token", 3)
		_:
			g.snd("bonus", 3)
	if o.state < 9 or o.state > 12:
		g.addobj(D.FLASH, o.x + 1, o.y, 0, 1)
	g.addscore(sc, o.x, o.y)
	g.killobj(o)

static func upd_token(g, o) -> void:
	# the diving bell waits bobbing in the water (X_OBJ.C msg_token, state 6)
	if o.state != D.INV_BELL:
		return
	const BOB := [1, 1, 0, 0, -1, -1, 0, 0]
	if o.info1 == 0:
		o.info1 = 1
		o.xl = 30
		o.yl = 30
	o.statecount = (o.statecount + 1) & 7
	g.justmove(o, o.x, o.y + BOB[o.statecount])

static func touch_token(g, o) -> void:
	if o.substate != 0:
		return
	if D.INV_XFM[o.state]:
		if g.player().kind == D.TINY:
			return
		o.substate = 1
		g.snd({D.INV_BELL: "splash", D.INV_MOTH: "sting"}.get(o.state, "crash"), 5)
		if g.playerxfm(o.state) and o.p.has("dock"):
			# adapted: leaving the bell sets Orrin on dry land (the bell cannot leave the water)
			var d: PackedStringArray = String(o.p["dock"]).split(",")
			var p = g.player()
			p.x = int(d[0]) * 16
			p.y = (int(d[1]) + 1) * 16 - p.yl
			p.state = D.ST_STAND
			g.events.append({"t": "cut"})
		return
	g.txt(g.tr_text("token_" + D.INV_NAMES[o.state]), 3)
	g.snd("token", 3)
	g.addobj(D.FLASH, o.x - 1, o.y - 3, 0, 0)
	if o.state == D.INV_BOLT:
		if g.invcount(D.INV_BOLT) < 5:
			g.addinv(D.INV_BOLT)
	else:
		g.addinv(o.state)
	g.killobj(o)

static func touch_sigil(g, o) -> void:
	# X_OBJ.C msg_icons
	g.textwin(["sigil_root", "sigil_tide", "sigil_ember"][o.state])
	g.addinv(D.INV_SIGIL1 + o.state)
	g.snd("sigil", 5)
	g.addobj(D.FLASH, o.x - 1, o.y - 1, 0, 1)
	g.playerkill(o)

static func upd_crate(g, o) -> void:
	# X_OBJ.C msg_box: hidden until triggered, then falls like a block
	var FL: int = T.PLAYERTHRU | T.NOTSTAIR
	if o.yd == -1:
		o.substate = 1
		o.yd = 0
		return
	if o.substate == 0:
		return
	if g.cando(o, o.x, o.y + 1, FL) == FL:
		o.yd = mini(o.yd + 1, 9)
		if g.trymove(o, o.x, o.y + o.yd) != 1:
			g.trymove(o, o.x, ((o.y + o.yd - 1) & ~15) + 16 - 16)
	else:
		if o.yd != 0:
			g.snd("rockland", 2)
		o.yd = 0

static func touch_crate(g, o, z, zp: bool) -> void:
	if zp and o.substate == 1:
		g.tip("tip_crate")
	if g.kflags(z) & D.F_WEAPON and o.substate == 1:
		match o.state:
			0: g.addobj(D.HEART, o.x, o.y, 0, 0)
			1, 2, 3, 4:
				var b = g.addobj(D.BONUS, o.x, o.y, 0, 0)
				b.state = [2, 6, 8, 14][o.state - 1]
			5:
				var b = g.addobj(D.BONUS, o.x, o.y, 0, 0)
				b.state = 3
			6, 7, 8, 9:
				var k = g.addobj(D.KEY, o.x, o.y, 0, 0)
				k.state = o.state - 6
			10:
				var t = g.addobj(D.TOKEN, o.x, o.y, 0, 0)
				t.state = D.INV_GATEKEY
			11: g.addobj(D.SHARD, o.x, o.y, 0, 0)
			12:
				g.snd("kill1", 4)
				for dx in [-32, -16, 0, 16, 32]:
					g.addobj(D.FIRE, o.x + dx, o.y - 16, 0, 0)
		g.snd("crash", 3)
		g.explode1(o.x, o.y, 4, false)
		if o.yd != 0:
			g.addscore(50, o.x, o.y)
		g.killobj(o)
		if z.kind != D.EMBER:
			g.killobj(z)

static func upd_score(g, o) -> void:
	o.counter -= 1
	if o.counter < 0 or not g.onscreen(o):
		g.killobj(o)
		return
	o.x += o.xd
	o.y += o.yd
	o.yd -= 1

static func touch_switch(g, o) -> void:
	# X_OBJ.C msg_switch: up turns it on, down turns it off
	if o.zaphold == 0:
		o.zaphold = 25
		g.txt(g.tr_text("tip_switch"), 7)
	if g.dy1 < 0 and o.state == 1:
		o.state = 0
		g.snd("switch_on", 2)
		g.sendtrig(o.counter, D.MSG_TRIGGER if o.xd == 1 else D.MSG_TRIGON, o)
	elif g.dy1 > 0 and o.state == 0:
		o.state = 1
		g.snd("switch_off", 2)
		g.sendtrig(o.counter, D.MSG_TRIGGER if o.xd == 1 else D.MSG_TRIGOFF, o)

static func touch_button(g, o) -> void:
	if o.zaphold == 0:
		o.state = 1 - o.state
		if o.state == 1:
			g.sendtrig(o.counter, D.MSG_TRIGOFF, o)
			g.snd("switch_off", 2)
		else:
			g.sendtrig(o.counter, D.MSG_TRIGON, o)
			g.snd("switch_on", 2)
	o.zaphold = 10

static func touch_poker(g, o) -> void:
	if o.state == 0:
		g.hitplayer(o, false)
	else:
		g.p_ouch(5, D.DIE_ASH)
	o.statecount = 15

static func touch_signpost(g, o) -> void:
	# X_OBJ.C msg_txtmsg (the remake draws a post, so players can see it)
	if o.state == 0 and o.zaphold == 0:
		g.txt(g.tr_text("tip_sign"), 7)
		o.zaphold = 30
	if g.dy1 < 0 or o.state == 1:
		g.textwin(o.inside)
		if o.state == 1:
			g.killobj(o)

static func touch_flag(g, o) -> void:
	# new: a mid-stage checkpoint (the source only has the stage start)
	if o.state == 0:
		o.state = 1
		g.respawn = [o.x, o.y + 16]
		g.snd("token", 3)
		g.txt(g.tr_text("flag"), 3)

static func touch_gate(g, o) -> void:
	# overworld gates: a gate key, or all three sigils for the Spire
	if o.zaphold != 0:
		return
	o.zaphold = 20
	var need_sigils: bool = o.state == 1
	var ok := false
	if need_sigils:
		ok = g.invcount(D.INV_SIGIL1) and g.invcount(D.INV_SIGIL2) and g.invcount(D.INV_SIGIL3)
	else:
		ok = g.takeinv(D.INV_GATEKEY)
	if ok:
		g.snd("gate", 3)
		g.txt(g.tr_text("gate_open"), 2)
		for c in o.p.get("cells", []):
			g.settile(int(c[0]), int(c[1]), T.PATH)
		g.killobj(o)
	else:
		g.txt(g.tr_text("gate_sigils" if need_sigils else "gate_need"), 5)

static func trig_transport(g, o) -> void:
	var p = g.player()
	g.moveobj(p, o.x, o.y - 24)
	p.px = p.x
	p.py = p.y
	g.setorigin()
	g.events.append({"t": "cut"})
	g.snd("warp", 3)
	if o.xd == 1:
		g.killobj(o)

static func touch_transpad(g, o) -> void:
	# X_OBJ.C msg_transpad: doors that move Orrin elsewhere (press up)
	var p = g.player()
	if p.kind != D.PLAYER or p.state == D.ST_TRANSPORT:
		return
	if o.counter == -1:
		if o.zaphold == 0:
			g.txt(g.tr_text("tip_oneway"), 7)
			o.zaphold = 25
		return
	if o.zaphold == 0:
		if g.dy1 != 0:
			p.yd = 0
		if o.xd == 0 and o.state == 0:
			g.txt(g.tr_text("tip_door_up"), 7)
		if g.dy1 < 0 or o.xd == 1:
			g.snd("switch_on", 2)
			if o.xd == 1:
				g.killobj(o)
				p.statecount = 16
			else:
				p.statecount = 0
				o.zaphold = 20
			p.state = D.ST_TRANSPORT
			p.x = o.x
			p.y = o.y - 8
			p.substate = o.counter
	o.state = 3

static func upd_owl(g, o) -> void:
	# X_OBJ.C msg_eagle: Sable appears on a trigger, talks when touched, then flies off
	o.statecount = (o.statecount + 1) & 15
	if o.info1 < 2:
		return
	if o.substate == 0:
		g.textwin(o.inside)
		o.substate = 1
		return
	if not g.justmove(o, o.x + o.xd, o.y - 1) or not g.onscreen(o):
		g.killobj(o)

static func trig_owl(g, o, from) -> void:
	if o.info1 != 0:
		return
	g.snd("sigil", 4)
	g.addobj(D.IMPACT, o.x + 5, o.y + 2, 0, 0)
	g.addobj(D.FLASH, o.x - 8, o.y - 4, 0, 0)
	g.addobj(D.FLASH, o.x, o.y + 12, 0, 0)
	g.addobj(D.FLASH, o.x + 12, o.y + 6, 0, 0)
	o.info1 = 1
	if from != null and from.kind == D.PAD:
		g.killobj(from)

# ================================================================ weapons
static func _kill_killable(g, weapon, z, pebbles_at_weapon: bool) -> void:
	# the shared kill for lasers, stones and embers against F_KILLABLE creatures
	match z.kind:
		D.DUSKWING, D.PIPTOAD, D.STINGMOTE:
			g.snd("toaddie", 4)
			g.explode1(weapon.x, weapon.y, 4, true)
		D.GLASSBOLT:
			g.snd("kill3", 4)
			g.explode1(z.x, z.y, 5, true)
		_:
			g.snd("kill1", 4)
			g.explode1(z.x, z.y, 5, false)
	g.playerkill(z)

static func upd_bolt(g, o) -> void:
	# X_OBJ.C msg_laser: accelerates, and up/down steer it in flight
	if not g.onscreen(o):
		g.killobj(o)
		return
	if not g.justmove(o, o.x + o.xd, o.y):
		g.addobj(D.SPARK, o.x + (12 if o.xd > 0 else -12), o.y - 5, 0, 0)
		g.snd("hitwall", 2)
		g.killobj(o)
		return
	o.xd += 1 if o.xd > 0 else -1
	g.trybreakwall(o, o.x + o.xd, o.y + o.yd)
	if o.kind != D.KILLME:
		g.justmove(o, o.x, o.y + g.dy1 * 2)

static func touch_bolt(g, o, z) -> void:
	if g.kflags(z) & D.F_KILLABLE:
		g.killobj(o)
		_kill_killable(g, o, z, true)

static func upd_torpedo(g, o) -> void:
	if not g.onscreen(o):
		g.killobj(o)
		return
	if not g.justmove(o, o.x + o.xd, o.y):
		g.addobj(D.SPARK, o.x + (8 if o.xd > 0 else -12), o.y - 4, 0, 0)
		g.snd("hitwall", 2)
		g.killobj(o)
		return
	o.xd += 1 if o.xd > 0 else -1
	g.justmove(o, o.x, o.y + g.dy1 * 2)

static func touch_torpedo(g, o, z) -> void:
	if g.kflags(z) & D.F_KILLABLE:
		g.killobj(o)
		g.addobj(D.FLASH, o.x + 2, o.y, 0, 1)
		g.addobj(D.FLASH, o.x + 8, o.y + 2, 0, 1)
		for i in 3:
			g.addobj(D.BUBBLE, o.x + i * 3, o.y + 1 + i, 0, 0)
		g.snd("fishdie", 4)
		g.playerkill(z)

static func upd_stone(g, o) -> void:
	# X_OBJ.C msg_rock: gravity 1, homes on the nearest killable within 96 px, bounces
	o.substate += 1
	if o.substate >= 64 or not g.onscreen(o):
		g.killobj(o)
		return
	var best = null
	var bd := 32767
	for c in g.scrn:
		if c != g.player() and c.kind != D.KILLME and g.kflags(c) & D.F_KILLABLE:
			var d: int = g.vectdist(o, c)
			if d < bd and d < 96:
				best = c
				bd = d
	var ax := 0
	if best != null:
		ax = g.pointvect(best, o, 3).x
	o.xd = clampi(o.xd + ax, -12, 12)
	o.yd = clampi(o.yd + 1, -12, 12)
	o.substate += g.trybreakwall(o, o.x + o.xd, o.y + o.yd) * 10
	if o.kind == D.KILLME:
		return
	if not g.justmove(o, o.x + o.xd, o.y):
		o.xd = -o.xd
	var c2: int = ((o.y + o.yd) & ~15) + 16 - 16
	if not g.justmove(o, o.x, o.y + o.yd):
		g.snd("stonebounce", 1)
		if c2 == o.y or not g.justmove(o, o.x, c2):
			o.yd = -o.yd
	if not g.justmove(o, o.x, o.y):
		g.killobj(o)

static func touch_stone(g, o, z, zp: bool) -> void:
	if zp and o.substate > 7:
		g.killobj(o)       # caught again
	elif not zp and g.kflags(z) & D.F_KILLABLE:
		g.killobj(o)
		_kill_killable(g, o, z, true)

static func upd_ember(g, o) -> void:
	# X_OBJ.C msg_fireball: flies through breakable walls, bursts on others
	if not g.onscreen(o):
		g.killobj(o)
		return
	o.counter = (o.counter + 1) & 3
	o.xd += 1 if o.xd > 0 else -1
	g.trybreakwall(o, o.x + o.xd, o.y + o.yd)
	if not g.justmove(o, o.x + o.xd, o.y + o.yd):
		g.addobj(D.BURST, o.x + (12 if o.xd > 0 else -20), o.y - 5, 0, 0)
		g.snd("hitwall", 2)
		g.killobj(o)

static func touch_ember(g, o, z) -> void:
	if g.kflags(z) & D.F_FIREBALL:
		g.explode2(z)
		g.playerkill(z)
		g.snd("kill1", 4)
	elif g.kflags(z) & D.F_KILLABLE:
		g.explode1(z.x, z.y, 5, false)
		_kill_killable(g, o, z, false)

static func upd_pellet(g, o) -> void:
	# X_OBJ.C msg_bullet
	if o.state == 1:
		o.state = 2
		o.xl = 6
		o.yl = 4
	o.counter = (o.counter + 1) & 7
	o.x += o.xd
	o.y += o.yd
	o.xd = clampi(o.xd, -12, 12)
	if not g.onscreen(o) or (o.xd == 0 and o.yd == 0):
		g.killobj(o)
		return
	if not g.justmove(o, o.x + o.xd, o.y + o.yd):
		g.killobj(o)

static func touch_pellet(g, o, z, zp: bool) -> void:
	if z.kind == D.BELL:
		g.p_ouch(1, D.DIE_BELL)
		g.addobj(D.IMPACT, z.x, z.y, 0, 0)
		g.killobj(o)
	elif zp:
		g.hitplayer(o, false)
		g.killobj(o)

# ================================================================ effects
static func upd_frag(g, o) -> void:
	if o.state == -1:
		o.state = -2
		o.yl = 4
	o.statecount += 1
	if o.statecount >= 40 or not g.onscreen(o):
		g.killobj(o)
	o.yd = mini(o.yd + 1, 12)
	g.moveobj(o, o.x + o.xd, o.y + o.yd)

static func upd_flash(g, o) -> void:
	if o.yd == 1 and o.info1 == 0:
		o.info1 = 1
		o.xl = 14
		o.yl = 15
	_age(g, o, 16)

static func upd_bubble(g, o) -> void:
	if g.rnd(15) == 0:
		o.counter += 1
	if o.counter > 2 or not g.onscreen(o):
		g.killobj(o)
	elif not g.fishdo(o, o.x + g.rnd(3) - 1, o.y - o.counter - 1):
		g.killobj(o)

static func upd_fire(g, o) -> void:
	o.counter += 1
	if o.counter >= 12 or o.counter < 0:
		g.killobj(o)

static func touch_fire(g, o, zp: bool) -> void:
	var p = g.player()
	if zp and o.state != 1 and not (D.STATEINFO[p.state] & D.STI_INVINCIBLE and p.kind == D.PLAYER):
		g.p_ouch(2, D.DIE_ASH)
		g.explode2(p)
		o.state = 1

# ================================================================ traps
static func upd_spear(g, o) -> void:
	# X_OBJ.C msg_spear: yd is the direction (1 up out of the floor, -1 down from a ceiling)
	match o.statecount:
		0:
			o.counter = 0
			o.yl = 4
			o.y += o.yd * 12
		20:
			o.counter = 1
			o.yl = 12
			o.y -= o.yd * 8
		22:
			o.counter = 2
			o.yl = 20
			o.y -= o.yd * 8
			g.snd("spikes", 1)
		24:
			o.statecount = 0
			o.counter = 0
			o.yl = 4
			o.y += o.yd * 16
	o.statecount += 1

static func upd_spikes(g, o) -> void:
	# X_OBJ.C msg_spikes: counter = delay before the first cycle
	const TAB := [1, 2, 3, 3, 3, 2, 1, 0]
	if o.info1 == 0:
		o.statecount += 1
		if o.statecount >= o.counter:
			o.info1 = 1
			o.statecount = 0
		else:
			return
	o.state = TAB[o.substate]
	if o.substate == 3:
		g.snd("spikes", 1)
	if o.state == 0:
		o.substate = 0
		o.info1 = 0
		return
	o.substate += 1

static func upd_stalactite(g, o) -> void:
	if o.yd != 0:
		if not g.trymovey(o, o.x, o.y + o.yd):
			g.snd("crash", 3)
			g.explode1(o.x, o.y + 10, 5, true)
			g.killobj(o)
			return
		o.yd = mini(o.yd + 2, 16)

static func touch_stalactite(g, o) -> void:
	var p = g.player()
	if p.yd < 0 and o.yd == 0:
		p.y = o.y + o.yl
		p.state = D.ST_JUMPING
		p.yd = 0
		p.substate = 2
	g.hitplayer(o, false)

static func trig_stalactite(g, o, from) -> void:
	o.xd -= 1
	if o.xd >= 0:
		return
	if o.yd == 0:
		o.yd = 2
		g.snd("stonebounce", 2)
		if from != null and from.kind == D.PAD:
			g.killobj(from)

static func upd_snapjaw(g, o) -> void:
	# X_OBJ.C msg_biter: a 37-step cycle; xd is the facing (1 right, -1 left)
	match o.state:
		0:
			o.counter = 0
			o.xl = 10
			o.x += o.xd * 6
		27:
			g.snd("snap", 1)
			o.counter = 1
			o.xl = 24
			o.x -= o.xd * 14
		34:
			o.counter = 2
		36:
			o.state = 0
			o.counter = 0
			o.xl = 10
			o.x += o.xd * 14
	o.state += 1

static func upd_timerpad(g, o) -> void:
	# X_OBJ.C msg_timerpad
	match o.yd:
		1:
			if g.rnd(70) == 0 and o.info1 == 0:
				o.statecount = 15
				o.info1 = 1
			if o.info1 == 0:
				return
			if o.statecount == 5:
				var f = g.addobj(D.FIRE, o.x + 7, o.y + 27, 0, 1)
				f.yd = 1
				g.snd("firebreath", 2)
			if o.statecount == 0:
				o.info1 = 0
			o.statecount -= 1
		2:
			if g.rnd(50) == 0:
				g.addobj(D.FIRE, o.x, o.y - 26, 0, 0)
				g.snd("firebreath", 2)
		3:
			if g.player().state != D.ST_STILL and g.rnd(maxi(1, o.counter)) == 0:
				g.addobj(D.FLASH, o.x - 1, o.y - 1, 0, 0)
				var d = g.addobj(D.DRONE, o.x, o.y, 0, 0)
				d.state = g.rnd(2)
				g.snd("dronefire", 3)
		4:
			if g.rnd(200) == 0:
				g.addobj(D.FLASH, o.x - 1, o.y - 3, 0, 0)
				var b = g.addobj(D.BONUS, o.x, o.y, 0, 0)
				b.state = o.state
				g.snd("bonus2", 3)
				g.killobj(o)
		5:
			if g.player().state != D.ST_STILL and g.rnd(maxi(1, o.counter)) == 0:
				g.addobj(D.FLASH, o.x + 6, o.y - 6, 0, 0)
				g.addobj(D.BURROWHOG, o.x, o.y - 15, -4, 0)
				g.snd("grunt", 3)
		_:
			o.substate += 1
			if o.substate > o.state:
				g.sendtrig(o.counter, D.MSG_TRIGGER, o)
				o.substate = 0

static func upd_turret(g, o) -> void:
	# X_OBJ.C msg_turret: glows at 32, fires at 36
	if o.state == 1:
		return
	o.xd = clampi(g.pointvect(g.player(), o, 3).x, -2, 2)
	if o.statecount == 36:
		o.statecount = 0
		var off: Array = [[1, 6], [5, 9], [8, 10], [11, 11], [15, 8]][o.xd + 2]
		g.snd("enemyfire", 2)
		var b = g.addobj(D.PELLET, o.x + off[0], o.y + off[1], o.xd, 2)
		b.state = 1
	o.statecount += 1

static func touch_turret(g, o, z, zp: bool) -> void:
	if g.kflags(z) & D.F_WEAPON:
		g.explode1(o.x + g.rnd(16), o.y + 8, 4, true)
		g.snd("hitwall", 2)
		if z.kind != D.EMBER:
			g.killobj(z)
		return
	if o.state == 1:
		return
	if zp:
		g.hitplayer(o, false)

# ================================================================ creatures
static func touch_tough(g, o, z, zp: bool, hp: int, hitsnd: String) -> void:
	# the grunt pattern: hurts on touch; each weapon hit counts; dies at hp (X_OBJ2.C msg_grunt)
	if o.state >= hp:
		return
	if zp:
		g.hitplayer(o, false)
	if g.kflags(z) & D.F_WEAPON:
		o.state += 1
		g.snd(hitsnd, 4)
		g.explode1(o.x + 4, o.y + 4, 3, false)
		g.explode1(o.x + 8, o.y + 6, 4, true)
		if z.kind != D.EMBER:
			g.killobj(z)

static func upd_burrowhog(g, o) -> void:
	# X_OBJ2.C msg_grunt
	if o.state >= 4:
		if o.statecount == 0:
			g.snd("kill3", 4)
			g.addscore(D.KINDS[D.BURROWHOG][5], o.x, o.y)
		o.statecount += 1
		if o.statecount >= 10:
			g.killobj(o)
		return
	o.counter = (o.counter + 1) % 10
	if o.counter & 1:
		return
	if g.rnd(20) == 0:
		o.xd = 0
		g.snd("grunt", 2)
	if g.rnd(15) == 0:
		o.xd = g.seekplayer(o).x * 4
	if not g.crawl(o, o.xd, 0):
		o.xd = -o.xd

static func upd_cairnbrute(g, o) -> void:
	# X_OBJ2.C msg_troll
	if o.state >= 4:
		g.snd("kill3", 4)
		g.addscore(D.KINDS[D.CAIRNBRUTE][5], o.x, o.y)
		g.addobj(D.IMPACT, o.x, o.y, 0, 0)
		g.killobj(o)
		return
	o.counter = (o.counter + 1) % 32
	if o.counter & 1:
		return
	if g.rnd(20) == 0:
		o.xd = g.seekplayer(o).x * 4
	if not g.crawl(o, o.xd, 0):
		o.xd = -o.xd
	if g.rnd(30) == 0 and o.xd != 0:
		g.addobj(D.PELLET, o.x + 6 + (20 if o.xd > 0 else 0), o.y + 10, sgn(o.xd) * 6, 0)
		g.snd("enemyfire", 2)

static func touch_brute(g, o, z, zp: bool) -> void:
	if zp:
		g.hitplayer(o, false)
	if g.kflags(z) & D.F_WEAPON:
		o.state += 1
		g.snd("hit4", 4)
		g.explode1(o.x, o.y, 3, false)
		g.explode1(o.x + 4, o.y + 10, 3, true)
		if z.kind != D.EMBER:
			g.killobj(z)

static func upd_sentry(g, o) -> void:
	# X_OBJ2.C msg_robot
	if o.state >= 3:
		g.snd("kill1", 4)
		g.addscore(D.KINDS[D.SENTRY][5], o.x, o.y)
		g.killobj(o)
		return
	o.counter = (o.counter + 1) % 16
	if o.counter & 1:
		return
	if g.rnd(40) == 0:
		o.xd = g.seekplayer(o).x * 4
	if not g.crawl(o, o.xd, 0):
		o.xd = -o.xd
	if g.rnd(50) == 0 and o.xd != 0:
		var b = g.addobj(D.PELLET, o.x - 3 + (28 if o.xd > 0 else 0), o.y + 12, sgn(o.xd) * 4, 0)
		b.state = 1
		g.snd("enemyfire", 2)

static func touch_sentry(g, o, z, zp: bool) -> void:
	if zp:
		g.hitplayer(o, false)
		return
	if g.kflags(z) & D.F_WEAPON:
		o.state += 1
		g.snd("hit4", 4)
		g.explode2(o)
		if z.kind != D.EMBER:
			g.killobj(z)

static func upd_newt(g, o) -> void:
	# X_OBJ2.C msg_lizard
	o.counter = (o.counter + 1) & 7
	if g.rnd(20) == 0:
		o.xd = g.seekplayer(o).x * 2
	if not g.crawl(o, o.xd, 0):
		o.xd = -o.xd
	if g.rnd(55) == 0 and o.xd != 0:
		g.addobj(D.PELLET, o.x - 4 + (16 if o.xd > 0 else 0), o.y + 4, o.xd * 4, 0)
		g.snd("enemyfire", 2)

static func upd_loomspider(g, o) -> void:
	# X_OBJ2.C msg_spider
	o.counter = (o.counter + 1) % 18
	if o.state >= 2:
		g.snd("kill2", 4)
		g.addscore(D.KINDS[D.LOOMSPIDER][5], o.x, o.y)
		g.killobj(o)
		return
	if g.rnd(40) == 0:
		g.snd("spider", 2)
		o.xd = g.seekplayer(o).x
	if not g.crawl(o, o.xd, 0):
		o.xd = -o.xd

static func touch_spider(g, o, z, zp: bool) -> void:
	if zp:
		g.hitplayer(o, false)
	if g.kflags(z) & D.F_WEAPON:
		o.state += 1
		g.snd("hit1", 4)
		g.explode1(o.x + 30, o.y + 4, 5, false)
		if z.kind != D.EMBER:
			g.killobj(z)

static func upd_segmenter(g, o) -> void:
	# X_OBJ2.C msg_centipede
	o.counter = (o.counter + 1) % 12
	if g.rnd(30) == 0:
		o.xd = g.seekplayer(o).x
	if not g.crawl(o, o.xd, 0):
		o.xd = -o.xd

static func touch_segmenter(g, o, z, zp: bool) -> void:
	if zp:
		g.hitplayer(o, false)
	if g.kflags(z) & D.F_WEAPON:
		o.xl -= 8
		if o.xd > 0:
			o.x += 0
		g.killobj(z)
		var bx: int = o.x + (o.xl - 24 if o.xd > 0 else 16)
		if o.xl < 37:
			for c in 7:
				g.addobj(D.SEGBIT, bx, o.y + 5, g.rnd(7) - 3, g.rnd(4) - 10)
			g.explode1(z.x, z.y, 4, false)
			g.playerkill(o)
			g.snd("kill3", 4)
		else:
			g.addobj(D.SEGBIT, bx, o.y + 5, g.rnd(7) - 3, g.rnd(4) - 10)
			g.snd("hit3", 4)

static func upd_segbit(g, o) -> void:
	# X_OBJ.C msg_centexpl: a loose crystal segment that bounces and can be collected
	o.statecount += 1
	if o.statecount >= 50 or not g.onscreen(o):
		g.killobj(o)
		return
	o.yd = mini(o.yd + 1, 12)
	o.state = g.rnd(6)
	if not g.trymovey(o, o.x + o.xd, o.y + o.yd):
		o.yd = -o.yd
		g.snd("toadland", 1)

static func upd_slick(g, o) -> void:
	# X_OBJ2.C msg_blob: slides, and sometimes stretches across a gap to flip over
	o.counter = (o.counter + 1) & 15
	match o.state:
		0:
			var lo := 0 if o.xd < 0 else 12
			var hi := 4 if o.xd < 0 else 16
			if o.counter >= lo and o.counter < hi:
				if not g.crawl(o, o.xd, 0) or g.rnd(40) == 0:
					o.xd = -o.xd
			if g.rnd(50) == 0:
				if o.xd < 0:
					if not g.standfloor(o, -78, 0):
						return
					o.state = 1
					o.x -= 23
				else:
					if not g.standfloor(o, 78, 0):
						return
					o.state = 2
					o.x += 2
				g.snd("slick", 2)
				o.xl = 52
				o.yl = 28
				o.y -= 15
				o.counter = 0
		1:
			if o.counter == 8:
				o.x -= 52
			if o.counter > 14:
				o.xl = 30
				o.yl = 13
				o.y += 15
				o.x -= 2
				o.counter = 0
				o.state = 0
		2:
			if o.counter == 8:
				o.x += 52
			if o.counter > 14:
				o.xl = 30
				o.yl = 13
				o.y += 15
				o.x += 23
				o.counter = 12
				o.state = 0

static func upd_duskwing(g, o) -> void:
	# X_OBJ2.C msg_bat
	const BOB := [1, 0, -1, 0]
	o.counter = (o.counter + 1) & 7
	o.statecount = (o.statecount + 1) & 3
	if not g.justmove(o, o.x + o.xd, o.y):
		o.xd = -o.xd
	g.justmove(o, o.x, o.y + BOB[o.statecount])

static func upd_piptoad(g, o) -> void:
	# X_OBJ2.C msg_hopper
	if o.state == 0:
		o.counter += 1
		if o.counter > 16:
			o.state = 1
			o.xd = g.seekplayer(o).x * 4
			o.yd = -12
	else:
		o.yd += 1
		if o.yd > 12:
			o.yd = 10
		var dx: int = o.x + o.xd
		var dy: int = o.y + o.yd
		if g.trymove(o, dx, dy) & 3 == 0:
			if o.yd < 0:
				o.yd = 0
			else:
				dy = (dy & ~15) + 16 - o.yl
				g.trymove(o, dx, dy)
				o.xd = g.seekplayer(o).x
				o.state = 0
				o.counter = 0
				g.snd("toadland", 1)

static func upd_stingmote(g, o) -> void:
	# X_OBJ2.C msg_bee
	const BOB := [1, 0, -1, 0]
	o.counter = (o.counter + 1) & 3
	o.statecount = (o.statecount + 1) & 3
	if o.xd != 0:
		o.substate = o.xd
	if g.rnd(20) == 0:
		o.xd = 0 if o.xd > 0 else o.substate
	if g.rnd(40) == 0:
		g.snd("sting", 1)
		var s = g.seekplayer(o)
		o.xd = s.x * 4
		o.yd = s.y * 2
	if not g.justmove(o, o.x + o.xd, o.y):
		o.xd = -o.xd
	g.justmove(o, o.x, o.y + BOB[o.statecount] + o.yd)

static func upd_creeper(g, o) -> void:
	# X_OBJ2.C msg_climber: runs up and down its vine
	if o.info1 == 0:
		o.info1 = 1
		o.x += 4
		if o.yd == 0:
			o.yd = 2
	o.counter = (o.counter + 1) & 15
	var ahead: int = o.y + o.yd + (29 if o.yd > 0 else -29)
	if g.objdo(o, o.x, ahead, T.NOTVINE) == 0:
		g.moveobj(o, o.x, o.y + o.yd)
	else:
		o.yd = -o.yd

static func touch_creeper(g, o) -> void:
	var p = g.player()
	if not (D.STATEINFO[p.state] & D.STI_INVINCIBLE):
		if not g.justmove(p, p.x - 16, p.y):
			g.justmove(p, p.x + 16, p.y)
		p.state = D.ST_STAND
		p.substate = 0
	g.hitplayer(o, false)

static func upd_drone(g, o) -> void:
	# X_OBJ2.C msg_xargbot; state 2 is the armoured kind
	const WOB := [-8, 8]
	if o.info1 == 1:
		o.counter = (o.counter + 1) & 1
		if o.counter == 0:
			var f = g.addobj(D.FIRE, o.x, o.y - 24, 0, 0)
			f.state = 1
		g.justmove(o, o.x + WOB[o.counter], o.y + o.yd)
		if not g.justmove(o, o.x, o.y + o.yd) or not g.onscreen(o):
			g.explode1(o.x + 4, o.y + 4, 5, false)
			g.killobj(o)
		return
	if g.rnd(15) == 0:
		var s = g.seekplayer(o)
		o.yd = s.y * 4
		o.xd = s.x * 2
	if not g.justmove(o, o.x + o.xd, o.y):
		o.xd = -o.xd
	if not g.justmove(o, o.x, o.y + o.yd) or not g.onscreen(o):
		o.yd = -o.yd
	if g.rnd(20) == 0:
		o.xd = 0
		o.substate = 1
		return
	if o.xd < 0:
		o.substate = 0
	elif o.xd > 0:
		o.substate = 2
	if g.rnd(40 if o.state == 2 else 50) == 0 and o.xd != 0:
		g.addobj(D.PELLET, o.x - 4 + (16 if o.xd > 0 else 0), o.y + 18, o.xd * 3, 0)
		g.snd("dronefire", 2)

static func touch_drone(g, o, z, zp: bool) -> void:
	if o.info1 == 1:
		return
	if zp:
		g.hitplayer(o, false)
	if g.kflags(z) & D.F_WEAPON:
		if o.state == 2 and o.statecount == 0:
			o.statecount = 1
			g.snd("hit4", 4)
			g.explode1(o.x, o.y, 5, true)
		else:
			o.info1 = 1
			o.yd = 2
			o.substate = 1
			g.addscore(130 if o.state == 2 else D.KINDS[D.DRONE][5], o.x, o.y)
			g.snd("kill1", 4)
		if z.kind != D.EMBER:
			g.killobj(z)

static func upd_shade(g, o) -> void:
	# X_OBJ2.C msg_ghoul: fades in as Orrin comes near, shoots when close
	if o.info1 >= 8:
		g.snd("kill1", 4)
		g.addscore(D.KINDS[D.SHADE][5], o.x, o.y)
		g.explode2(o)
		g.killobj(o)
		return
	if o.statecount > 0:
		o.statecount -= 1
	if not g.justmove(o, o.x, o.y + o.yd):
		o.yd = -o.yd
	if g.rnd(20) == 0:
		var s = g.seekplayer(o)
		o.xd = s.x * 2
		o.yd = s.y * 2
	if not g.justmove(o, o.x + o.xd, o.y):
		o.xd = -o.xd
	var dist: int = g.vectdist(o, g.player())
	o.state = 0
	for lim in [192, 160, 128]:
		if dist < lim:
			o.state += 1
	if dist < 96:
		o.state = 4
		if o.statecount == 0:
			o.statecount = 30
			g.addobj(D.PELLET, o.x - 4 + (30 if o.xd > 0 else 0), o.y + 4, o.xd * 3, 0)
	elif dist >= 224:
		o.state = 0

static func touch_shade(g, o, z, zp: bool) -> void:
	if zp:
		g.hitplayer(o, false)
	if g.kflags(z) & D.F_WEAPON:
		o.info1 += 1
		g.snd("hit4", 4)
		g.explode2(o)
		if z.kind != D.EMBER:
			g.killobj(z)

static func upd_geode(g, o) -> void:
	# X_OBJ.C msg_boulder: rolls toward Orrin; three weapon hits break it
	var FL: int = T.PLAYERTHRU | T.NOTSTAIR
	if o.state >= 3:
		g.snd("kill3", 4)
		g.explode1(o.x, o.y, 7, true)
		g.playerkill(o)
		return
	if g.cando(o, o.x, o.y + 1, FL) == FL:
		o.yd = mini(o.yd + 2, 12)
		if g.trymove(o, o.x + o.xd, o.y + o.yd) != 1:
			g.trymove(o, o.x, ((o.y + o.yd - 1) & ~15) + 16 - 16)
			o.xd = 0
	else:
		if o.yd != 0:
			g.snd("rockland", 2)
		o.yd = 0
		if o.xd == 0:
			o.xd = g.seekplayer(o).x * 4
		o.counter = (o.counter + (1 if o.xd > 0 else -1)) & 3
		if g.trymove(o, o.x + o.xd, o.y) != 1:
			o.xd = -o.xd

static func touch_geode(g, o, z, zp: bool) -> void:
	if zp:
		g.hitplayer(o, false)
	if g.kflags(z) & D.F_WEAPON:
		g.snd("hitwall", 2)
		g.explode1(o.x, o.y, 5, true)
		g.killobj(z)
		o.state += 1

# ---------------------------------------------------------------- water
static func upd_swimmer(g, o, cycle: int, bubbles: int) -> void:
	# X_OBJ2.C msg_eel / msg_redfish: wander at random inside water
	o.counter = (o.counter + 1) % cycle
	if g.rnd(20) == 0:
		o.xd = g.rnd(3) * 4 - 4
		o.yd = (g.rnd(2) * 4 - 2) if o.xd == 0 else (g.rnd(3) * 2 - 2)
	if not g.fishdo(o, o.x + o.xd, o.y):
		o.xd = -o.xd
	if not g.fishdo(o, o.x, o.y + o.yd):
		o.yd = -o.yd
	if g.rnd(bubbles) == 0:
		g.addobj(D.BUBBLE, o.x + 6, o.y - 2, 0, 0)

static func upd_gar(g, o) -> void:
	# X_OBJ2.C msg_badfish
	if o.state >= 2:
		if o.statecount == 0:
			g.snd("fishdie", 4)
			g.addscore(D.KINDS[D.GAR][5], o.x, o.y)
		g.fishdo(o, o.x, o.y + 2)
		o.statecount += 1
		if o.statecount >= 20:
			g.killobj(o)
		return
	upd_swimmer(g, o, 8, 10)

static func touch_gar(g, o, z, zp: bool) -> void:
	if o.state >= 2:
		return
	if zp:
		g.hitplayer(o, true)
	if g.kflags(z) & D.F_WEAPON:
		o.state += 1
		g.snd("hit3", 4)
		g.explode1(o.x, o.y, 4, true)
		g.killobj(z)

static func upd_urchin(g, o) -> void:
	# X_OBJ.C msg_mine: drifts, reverses every 8 steps vertically
	if o.counter == 8:
		o.counter = 0
		o.yd = -o.yd
	if not g.fishdo(o, o.x + o.xd, o.y):
		o.xd = -o.xd
	if not g.fishdo(o, o.x, o.y + o.yd):
		o.yd = -o.yd
	if g.rnd(16) == 0:
		g.addobj(D.BUBBLE, o.x + 6, o.y - 2, 0, 0)
	o.counter += 1

static func touch_urchin(g, o, z, zp: bool) -> void:
	if zp:
		g.p_ouch(2, D.DIE_BELL)
		g.snd("kill1", 4)
		g.explode2(o)
		g.killobj(o)
		return
	if g.kflags(z) & D.F_WEAPON:
		g.snd("kill1", 4)
		g.explode2(o)
		for s in [[-4, -2], [-4, 0], [-4, 2]]:
			g.addobj(D.PELLET, o.x - 4, o.y + 8, s[0], s[1])
			g.addobj(D.PELLET, o.x + 11, o.y + 8, -s[0], s[1])
		g.killobj(o)
		g.killobj(z)

# ================================================================ the Spire
static func upd_glassbolt(g, o) -> void:
	# X_OBJ2.C msg_skull: thrown left, speeding up to 10
	o.counter = (o.counter + 1) & 7
	if not g.onscreen(o):
		g.killobj(o)
		return
	if not g.justmove(o, o.x + o.xd, o.y):
		g.addobj(D.SPARK, o.x + (16 if o.xd > 0 else -12), o.y, 0, 0)
		g.snd("hitwall", 2)
		g.killobj(o)
		return
	o.xd = maxi(o.xd - 1, -10)

## Regent phases in o.yd: 2 waiting (faint, harmless), 1 the meeting, 0 the fight.
const REGENT_WAIT := 2
const REGENT_MEET := 1
const MEET_APPEAR := 14             # meeting step at which the Regent takes full form
const MEET_TALK := 24               # meeting step at which the dialog opens

static func upd_regent(g, o) -> void:
	# X_OBJ2.C msg_xargon: 50 hits; hovers and bobs; turns at 80 and 256 px
	const BOB := [1, 2, 1, 0, -1, -2, -1, 0]
	const DIEY := [4, -2, 6, -4, 8, -6, 8, -6]
	const DIEX := [4, -4, 4, -4, 4, -4, 4, -4]
	o.counter = (o.counter + 1) & 15
	if o.yd == REGENT_WAIT:
		_regent_wait(g, o)
		return
	if o.yd == REGENT_MEET:
		_regent_meet(g, o)
		return
	if o.state > 0:
		o.state -= 1
	if o.info1 > 0:
		o.info1 -= 1
	if o.substate >= 50:
		o.state = 3
		g.justmove(o, o.x + DIEX[o.counter / 2], o.y + DIEY[o.counter / 2])
		g.explode1(o.x + g.rnd(54), o.y + g.rnd(60), 1, true)
		g.explode1(o.x + g.rnd(54), o.y + g.rnd(60), 1, false)
		g.addobj(D.BURST, o.x + g.rnd(60) - 15, o.y + g.rnd(68) - 15, 0, 0)
		g.addobj(D.IMPACT, o.x + g.rnd(60) - 12, o.y + g.rnd(68) - 17, 0, 0)
		if o.statecount == 0:
			g.player().state = D.ST_STILL
			g.snd("kill1", 5)
			g.addscore(D.KINDS[D.REGENT][5], o.x, o.y)
			g.pl["health"] = 5
		if o.statecount == 58:
			g.snd("kill2", 4)
			g.txt(g.tr_text("regent_down"), 7)
		o.statecount += 1
		if o.statecount >= 60:
			var p = g.player()
			p.state = D.ST_STAND
			g.sendtrig(int(o.p.get("channel", 90)), D.MSG_TRIGGER, o)
			g.killobj(o)
		return
	if g.rnd(20) == 0:
		o.xd = g.seekplayer(o).x * 4
	var dist: int = g.vectdist(o, g.player())
	if dist < 80 and o.xd < 0:
		o.xd = -o.xd
	if dist > 256 and o.xd >= 0:
		o.xd = -o.xd
	if not g.justmove(o, o.x + o.xd, o.y):
		o.xd = -o.xd
	g.justmove(o, o.x, o.y + BOB[o.counter / 2])
	if g.rnd(20) == 0 and o.info1 == 0 and o.yd == 0:
		o.info1 = 15
		g.addobj(D.GLASSBOLT, o.x - 10, o.y + 50, -2, 0)
		o.state = 5
		g.snd("enemyfire", 2)

## Adapted (the source has no scene before its last boss): Orrin stops on the floor, the
## camera pans to the Regent, the Regent takes form, they speak, and the fight begins.
static func _regent_wait(g, o) -> void:
	var p = g.player()
	if p.kind != D.PLAYER or p.state != D.ST_STAND or absi(p.x - o.x) > int(o.p.get("wake", 176)):
		return
	o.yd = REGENT_MEET
	o.statecount = 0
	p.state = D.ST_STILL
	p.xd = 0
	p.info1 = sgn(o.x - p.x)
	g.focus_x = (p.x + p.xl / 2 + o.x + o.xl / 2) / 2    # frame them both
	g.events.append({"t": "music", "n": "-"})
	g.snd("warp", 4)

static func _regent_meet(g, o) -> void:
	o.statecount += 1
	var p = g.player()
	p.state = D.ST_STILL
	if o.statecount == MEET_APPEAR:
		g.snd("sigil", 5)
		g.addobj(D.FLASH, o.x + 4, o.y + 8, 0, 0)
		g.addobj(D.FLASH, o.x + 34, o.y + 20, 0, 0)
		g.addobj(D.FLASH, o.x + 14, o.y + 44, 0, 0)
		g.addobj(D.IMPACT, o.x + 20, o.y + 24, 0, 0)
	if o.statecount == MEET_TALK:
		g.textwin(o.inside)          # the step waits while the dialog is open
	if o.statecount > MEET_TALK:
		g.focus_x = -1               # the camera drifts back to Orrin
		p.state = D.ST_STAND
		p.statecount = 0
		o.yd = 0
		o.statecount = 0
		o.info1 = 15                 # a breath before the first glass bolt
		g.music_for_level()

static func touch_regent(g, o, z, zp: bool) -> void:
	if o.substate >= 50 or o.yd != 0:
		return
	if zp:
		g.hitplayer(o, false)
	if g.kflags(z) & D.F_WEAPON:
		o.substate += 1
		g.snd("hit4", 4)
		g.explode1(o.x + g.rnd(55), o.y + g.rnd(60), 2, true)
		g.explode1(o.x + g.rnd(55), o.y + g.rnd(60), 3, true)
		g.addobj(D.BURST, o.x + g.rnd(44), o.y + g.rnd(52), 0, 0)
		g.killobj(z)

static func upd_heartcrystal(g, o) -> void:
	# X_OBJ.C msg_front (the main reactor): 40 hits, then a 60-step blast ends the game
	if o.info1 >= 3 and o.info1 < 40 and g.rnd(absi(o.info1 - 42)) == 0:
		var f = g.addobj(D.FIRE, o.x + g.rnd(56), o.y + g.rnd(32), 0, 0)
		f.state = 1
	if o.info1 < 40:
		return
	g.explode1(o.x + g.rnd(56), o.y + g.rnd(56), 1, true)
	g.explode1(o.x + g.rnd(56), o.y + g.rnd(56), 1, false)
	g.addobj(D.BURST, o.x + g.rnd(64) - 15, o.y + g.rnd(64) - 15, 0, 0)
	if o.statecount == 0:
		g.player().state = D.ST_STILL
		g.snd("kill1", 5)
		g.addscore(D.KINDS[D.HEARTCRYSTAL][5], o.x, o.y)
		g.pl["health"] = 5
	if o.statecount == 58:
		g.snd("kill2", 4)
		g.txt(g.tr_text("crystal_down"), 7)
	o.statecount += 1
	if o.statecount >= 60:
		g.gameover = 2
		g.killobj(o)

static func touch_heartcrystal(g, o, z, zp: bool) -> void:
	if o.info1 >= 40:
		return
	if zp:
		g.hitplayer(o, false)
	if g.kflags(z) & D.F_WEAPON:
		o.info1 += 1
		g.snd("hit4", 4)
		g.explode1(o.x + g.rnd(56), o.y + g.rnd(56), 2, false)
		g.explode1(o.x + g.rnd(56), o.y + g.rnd(56), 3, true)
		g.addobj(D.BURST, o.x + g.rnd(48), o.y + g.rnd(48), 0, 0)
		g.killobj(z)
