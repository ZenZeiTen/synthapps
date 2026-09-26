## The whole game state and its rules. Pure data and logic: no nodes, no drawing. It runs
## headless for the tests, and the view (scripts/view) draws it and feeds it input.
##
## Most functions are ports of the Xargon source. Each comment names the function it
## follows (for example "X_OBJMAN.C cando"). The step rate is 18.2 per second
## (docs/ANALYSIS.md §1).
extends RefCounted

const Tiles = preload("res://scripts/core/tiles.gd")
const D = preload("res://scripts/core/defs.gd")
const Obj = preload("res://scripts/core/obj.gd")
const Kinds = preload("res://scripts/core/kinds.gd")
const Level = preload("res://scripts/core/level.gd")

const STEP_HZ := 18.2
const VIEW_W := 320
const VIEW_H := 148
const SCRN_XS := 20            # cells across the view (normxs in XARGON.H is 21 incl. the partial cell)
const MAX_OBJS := 400

# ---------------------------------------------------------------- state
var w := 0
var h := 0
var board := PackedInt32Array()
var board_owned := true        # false after clone(): the board is shared until the first write
var objs: Array = []           # Obj; objs[0] is always the player (in whatever form)
var level: Dictionary = {}     # the loaded level's header (name, theme, music, intro, overworld ...)
var curlevel := ""

# player record (XARGON.H pltype)
var pl := {"level": 0, "health": 5, "shards": 0, "inv": [], "score": 0, "ouched": 0}
var fruit := 0                 # cnt_fruit
var fruit_icon := 0
var o_pl := {}                 # stats(1) snapshot
var old_fruit := 0
var done_stages: Array = []    # stage numbers finished (map entrances removed)
var seen: Dictionary = {}      # one-off tips already shown
var respawn := []              # [x, y] of the last mid-stage flag touched ([] = none)

var gamecount := 0
var rng_state := 12345
var dx1 := 0
var dy1 := 0
var fire1 := 0
var fire2 := 0
var fire1off := 0
var fire2off := 0
var blink_phase := 0
var levelcount := 0            # steps since the stage was loaded (drives the blinking blocks)

var vpox := 0
var vpoy := 0
var pvpox := 0                 # camera at the previous step, for interpolation
var pvpoy := 0
var scrollxd := 0
var scrollyd := 0

var scrn: Array = []           # objects updated this step (upd_objs)
var botmsg := ""
var bottime := 0
var events: Array = []         # sound / music / camera events for the view, drained each frame
var modal: Dictionary = {}     # text window, dialog, intro card, shop ... the step waits while set
var newlevel := ""
var gameover := 0              # 1 quit, 2 won
var map_snapshot: Dictionary = {}
var next_id := 1
var ward_count := 0
var ward_tick := 0
var fidget_line := -1
var text: Dictionary = {}      # content/data/text.json
var content_root := "res://content"
var god := false               # route checker / attract mode: creatures cannot hurt (hazard tiles still can)
var in_hazard := false

# ---------------------------------------------------------------- setup
func _init(root: String = "res://content") -> void:
	content_root = root
	if root == "":
		return            # clone(): the caller copies the text table
	var f := FileAccess.open(content_root + "/data/text.json", FileAccess.READ)
	if f:
		text = JSON.parse_string(f.get_as_text())

func rnd(n: int) -> int:
	# a 31-bit LCG; the source seeds with 12345 for replays (GAMECTRL.C stopmac)
	rng_state = (rng_state * 1103515245 + 12345) & 0x7fffffff
	if n <= 0:
		return 0
	return ((rng_state >> 16) & 0x7fff) * n / 32768

func new_game() -> void:
	pl = {"level": 127, "health": 5, "shards": 0, "inv": [], "score": 0, "ouched": 0}
	fruit = 0
	fruit_icon = 0
	done_stages = []
	seen = {}
	gameover = 0
	rng_state = 12345
	load_level("vale")
	init_inv()
	stats(1)
	p_reenter(false)

func init_inv() -> void:
	# X_OBJMAN.C init_inv
	pl["shards"] = 0
	pl["health"] = 5
	fruit = 0
	fruit_icon = 0
	addinv(D.INV_BOLT)

# ---------------------------------------------------------------- board
func tile(x: int, y: int) -> int:
	if x < 0 or y < 0 or x >= w or y >= h:
		return Tiles.SOLID
	return board[y * w + x]

func settile(x: int, y: int, t: int) -> void:
	if x >= 0 and y >= 0 and x < w and y < h:
		if not board_owned:
			board = board.duplicate()
			board_owned = true
		board[y * w + x] = t

func flags_at(x: int, y: int) -> int:
	var t := tile(x, y)
	var f: int = Tiles.FLAGS[t]
	if t == Tiles.BLINK and blink_phase >= 6 and blink_phase < 12:
		f |= Tiles.NOTSTAIR       # X_OBJ3.C msg_block: not standable in phases 6..11
	return f

# ---------------------------------------------------------------- objects
func addobj(kind: int, x: int, y: int, xd: int, yd: int) -> Obj:
	# X_OBJMAN.C addobj (the source overwrites the last slot when full; we just refuse)
	var o := Obj.new()
	o.kind = kind
	o.x = x
	o.y = y
	o.px = x
	o.py = y
	o.xd = xd
	o.yd = yd
	o.xl = D.KINDS[kind][2]
	o.yl = D.KINDS[kind][3]
	o.id = next_id
	next_id += 1
	if objs.size() < MAX_OBJS:
		objs.append(o)
	return o

func killobj(o: Obj) -> void:
	o.kind = D.KILLME

func kflags(o: Obj) -> int:
	return D.KINDS[o.kind][4]

func player() -> Obj:
	return objs[0]

func addinv(item: int) -> void:
	if pl["inv"].size() >= 29:
		return
	pl["inv"].append(item)

func takeinv(item: int) -> bool:
	var i: int = pl["inv"].find(item)
	if i < 0:
		return false
	pl["inv"].remove_at(i)
	return true

func invcount(item: int) -> int:
	return pl["inv"].count(item)

func countobj(kind: int, only_state1: bool) -> int:
	var n := 0
	for o in objs:
		if o.kind == kind and (not only_state1 or o.state == 1):
			n += 1
	return n

# ---------------------------------------------------------------- collision (X_OBJMAN.C)
func moveobj(o: Obj, nx: int, ny: int) -> void:
	if ny < 0:
		ny = 0
	elif ny > h * 16 - 16 - o.yl:
		ny = h * 16 - 16 - o.yl
	if nx < 0:
		nx = 0
	elif nx > w * 16 - 16 - o.xl:
		nx = w * 16 - 16 - o.xl
	o.x = nx
	o.y = ny

func cando(o: Obj, nx: int, ny: int, ourflags: int) -> int:
	# One-way ledges: rows above the object's current feet row (splity) never block
	var sx := nx >> 4
	var sy := ny >> 4
	var ex := (nx + o.xl + 15) >> 4
	var ey := (ny + o.yl + 15) >> 4
	var splity: int = (o.y + D.KINDS[o.kind][3] + 15) >> 4
	var flagor := Tiles.NOTSTAIR
	var result := 0xffff
	for y in range(sy, ey):
		if y >= splity:
			flagor = 0
		for x in range(sx, ex):
			result &= (flags_at(x, y) | flagor) & ourflags
	return result

func objdo(o: Obj, nx: int, ny: int, ourflags: int) -> int:
	var result := 0xffff
	for y in range(ny >> 4, (ny + o.yl + 15) >> 4):
		for x in range(nx >> 4, (nx + o.xl + 15) >> 4):
			result &= flags_at(x, y) & ourflags
	return result

func standfloor(o: Obj, dx: int, dy: int) -> bool:
	var nx := o.x + dx
	var ny := o.y + dy
	if ((ny + o.yl) & 15) != 0:
		return false
	var row := ((ny + o.yl - 1) >> 4) + 1
	for xc in range(nx >> 4, (nx + o.xl + 15) >> 4):
		if flags_at(xc, row) & (Tiles.PLAYERTHRU | Tiles.NOTSTAIR) == (Tiles.PLAYERTHRU | Tiles.NOTSTAIR):
			return false
	return true

func trymove(o: Obj, nx: int, ny: int) -> int:
	var f := Tiles.PLAYERTHRU
	if ny > o.y:
		f |= Tiles.NOTSTAIR
	if cando(o, nx, ny, f) == f:
		moveobj(o, nx, ny)
		return 1
	if cando(o, o.x, ny, f) == f:
		moveobj(o, o.x, ny)
		return 2
	if cando(o, nx, o.y, f) == f:
		moveobj(o, nx, o.y)
		return 4
	return 0

func justmove(o: Obj, nx: int, ny: int) -> bool:
	if cando(o, nx, ny, Tiles.PLAYERTHRU) != 0:
		moveobj(o, nx, ny)
		return true
	return false

func trymovey(o: Obj, nx: int, ny: int) -> bool:
	var f := Tiles.PLAYERTHRU | Tiles.NOTSTAIR
	if cando(o, nx, ny, f) == f:
		moveobj(o, nx, ny)
		return true
	if cando(o, o.x, ny, f) == f:
		moveobj(o, o.x, ny)
		return true
	o.xd = 0
	return false

func crawl(o: Obj, dx: int, dy: int) -> bool:
	if standfloor(o, dx, dy):
		if cando(o, o.x + dx, o.y + dy, Tiles.PLAYERTHRU) == Tiles.PLAYERTHRU:
			moveobj(o, o.x + dx, o.y + dy)
			return true
	return false

func fishdo(o: Obj, x: int, y: int) -> bool:
	# the whole box must be passable water (X_OBJMAN.C fishdo)
	var ok := objdo(o, x, y, Tiles.PLAYERTHRU) == Tiles.PLAYERTHRU
	if ok:
		for yy in range(y >> 4, (y + o.yl + 15) >> 4):
			for xx in range(x >> 4, (x + o.xl + 15) >> 4):
				if not Tiles.is_water(tile(xx, yy)):
					return false
		moveobj(o, x, y)
		return true
	return false

func onscreen(o: Obj) -> bool:
	return o.x + o.xl >= vpox and o.y + o.yl >= vpoy and o.x <= vpox + VIEW_W and o.y <= vpoy + VIEW_H

func seekplayer(o: Obj) -> Vector2i:
	var p := player()
	return Vector2i(sgn(p.x - o.x), sgn(p.y - o.y))

func pointvect(to: Obj, frm: Obj, length: int) -> Vector2i:
	var x := to.x - frm.x
	var y := to.y - frm.y
	if x == 0:
		if y != 0:
			y = length * sgn(y)
	elif y == 0:
		x = length * sgn(x)
	elif absi(x) > absi(y):
		y = (y * length) / absi(x)
		x = length * sgn(x)
	else:
		x = (x * length) / absi(y)
		y = length * sgn(y)
	return Vector2i(x, y)

func vectdist(a: Obj, b: Obj) -> int:
	return absi(a.x - b.x) + absi(a.y - b.y)

static func sgn(v: int) -> int:
	return (1 if v > 0 else 0) - (1 if v < 0 else 0)

# ---------------------------------------------------------------- feedback to the view
func snd(name: String, pri: int = 2) -> void:
	events.append({"t": "snd", "n": name, "p": pri})

func txt(msg: String, col: int = 7) -> void:
	# XARGON.C txt: the message line shows for 100 steps
	botmsg = msg
	bottime = 100
	events.append({"t": "msg", "col": col})

func tip(key: String) -> void:
	# first-time help windows (the source's first_* flags)
	if seen.has(key):
		return
	seen[key] = true
	textwin(key)

func textwin(key: String) -> void:
	var t = text.get(key)
	if t == null:
		push_warning("missing text " + key)
		return
	if t is Array:
		modal = {"type": "dialog", "pages": t, "page": 0}
	else:
		modal = {"type": "text", "title": t.get("title", ""), "lines": t.get("lines", []), "who": t.get("who", "")}
	snd("menu", 5)

func close_modal() -> void:
	if modal.get("type", "") == "dialog" and modal["page"] + 1 < modal["pages"].size():
		modal["page"] += 1
		return
	modal = {}

func addscore(sc: int, x: int, y: int) -> void:
	# X_OBJMAN.C addscore: a number that pops out and falls away
	var o := addobj(D.SCORE, x, y, 0, 0)
	o.state = sc
	o.counter = 30
	o.xd = rnd(4) * sgn(x - player().x)
	o.yd = rnd(4) + 4             # dips, then rises away (msg_score: y += yd; yd--)
	o.xl = (2 + str(sc).length()) * 8
	pl["score"] += sc

func playerkill(o: Obj) -> void:
	addscore(D.KINDS[o.kind][5], o.x, o.y)
	killobj(o)

func explode1(x: int, y: int, num: int, pebbles: bool) -> void:
	for c in num:
		var f := addobj(D.FRAG, x, y, rnd(7) - 3, rnd(11) - 8)
		f.state = -1 if pebbles else rnd(5)

func explode2(o: Obj) -> void:
	addobj(D.BURST, o.x + (o.xl - 32) / 2, o.y + o.yl - 32, 0, 0)

# ---------------------------------------------------------------- damage (X_OBJMAN.C)
func p_ouch(take: int, diemode: int) -> void:
	if god and not in_hazard:
		return
	var p := player()
	if p.kind == D.TINY:
		return
	if p.kind == D.PLAYER and D.STATEINFO[p.state] & D.STI_INVINCIBLE:
		return
	if p.kind == D.MOTH:
		diemode = D.DIE_MOTH
	take -= invcount(D.INV_WARD)
	if take <= 0:
		return
	pl["health"] -= take
	pl["ouched"] = 4
	if pl["health"] > 0:
		snd("ouch", 5)
	else:
		pl["health"] = 0
		p.kind = D.PLAYER
		p.statecount = 18 if p.state == D.ST_PLATFORM else 0
		p.state = D.ST_DIE
		p.substate = diemode
		if diemode != D.DIE_ASH:
			pl["ouched"] = 0
		if diemode == D.DIE_MOTH:
			p.yd = 2
		snd("die", 5)
		explode1(p.x, p.y, 10, false)

func hitplayer(o: Obj, wet: bool) -> void:
	var p := player()
	if o.zaphold == 0 and not (D.STATEINFO[p.state] & D.STI_INVINCIBLE and p.kind == D.PLAYER):
		p_ouch(1, D.DIE_BELL if wet else D.DIE_ASH)
		addobj(D.IMPACT, p.x, p.y, 0, 0)
	o.zaphold = 3

# ---------------------------------------------------------------- triggers
func sendtrig(channel: int, msg: int, from: Obj) -> void:
	# X_OBJMAN.C sendtrig: every listening object on the channel gets the message
	for o in objs.duplicate():
		if kflags(o) & D.F_TRIGGER and o.counter == channel:
			Kinds.trigger(self, o, msg, from)

# ---------------------------------------------------------------- checkpoints and levels
func findcheckpt(lvl: int) -> Obj:
	for o in objs:
		if o.kind == D.CHECKPT and o.counter == lvl:
			return o
	return null

func p_reenter(died: bool) -> void:
	# X_OBJMAN.C p_reenter
	var c := findcheckpt(pl["level"])
	var p := player()
	if died and c != null and c.state == 1:
		load_level(curlevel)
		stats(0)
		c = findcheckpt(pl["level"])
		p = player()
	var dx := p.x
	var dy := p.y
	if c != null:
		dx = c.x
		dy = c.y
	if not respawn.is_empty() and died:
		dx = respawn[0]
		dy = respawn[1]
	if p.kind != D.TINY:
		dy -= 24
	p.x = dx & ~7
	p.y = dy
	p.px = p.x
	p.py = p.y
	setorigin()
	if p.kind != D.TINY:
		p.state = D.ST_BEGIN
		p.statecount = 0
	pl["health"] = 5
	# adapted: form tokens re-arm, so a stage can always be finished after a death
	for o in objs:
		if o.kind == D.TOKEN and D.INV_XFM[o.state]:
			o.substate = 0
	events.append({"t": "cut"})
	music_for_level()

func music_for_level() -> void:
	events.append({"t": "music", "n": level.get("music", "")})

func stats(save: int) -> void:
	# XARGON.C stats: snapshot, or restore and strip the per-stage items
	if save:
		o_pl = pl.duplicate(true)
		old_fruit = fruit
	else:
		pl = o_pl.duplicate(true)
		fruit = old_fruit
		while takeinv(D.INV_RUNE):
			pass
		while invcount(D.INV_BOLT) > 1:
			takeinv(D.INV_BOLT)
		for it in [D.INV_STONES, D.INV_BOOTS, D.INV_WARD, D.INV_KEY0, D.INV_KEY0 + 1, D.INV_KEY0 + 2, D.INV_KEY0 + 3]:
			while takeinv(it):
				pass

func load_level(name: String) -> void:
	var data := Level.load_level(content_root, name)
	if data.is_empty():
		push_error("level not found: " + name)
		return
	curlevel = name
	level = data["header"]
	w = data["w"]
	h = data["h"]
	board = data["board"].duplicate()
	var keep := player() if not objs.is_empty() else null
	objs = []
	var p: Obj
	if keep != null:
		p = keep
	else:
		p = Obj.new()
		p.id = 0
	p.kind = D.TINY if level.get("overworld", false) else D.PLAYER
	p.xl = D.KINDS[p.kind][2]
	p.yl = D.KINDS[p.kind][3]
	p.state = D.ST_STAND
	p.substate = 0
	p.statecount = 0
	p.xd = 0
	p.yd = 0
	p.counter = 0
	p.info1 = 1
	objs.append(p)
	for spec in data["objects"]:
		Level.spawn(self, spec)
	respawn = []
	blink_phase = 0
	levelcount = 0

func enter_pending_level() -> void:
	# XARGON.C play(): the newlevel branch
	var nl := newlevel
	newlevel = ""
	if nl.begins_with("!"):
		# back to the overworld; the finished stage's entrance disappears
		stats(1)
		if map_snapshot.is_empty():
			load_level("vale")         # a stage started directly (tests, demos): a fresh map
		else:
			restore_snapshot(map_snapshot)
		stats(0)
		var c := findcheckpt(pl["level"])
		if not done_stages.has(pl["level"]):
			done_stages.append(pl["level"])
		p_reenter(false)
		if c != null:
			killobj(c)
		modal = {"type": "intro", "title": level.get("name", ""), "lines": [], "t": 0}
		events.append({"t": "autosave"})
	else:
		map_snapshot = snapshot_world()
		stats(1)
		load_level(nl)
		stats(0)
		p_reenter(false)
		modal = {"type": "intro", "title": level.get("name", ""), "lines": level.get("intro", []), "t": 0}
	snd("level", 5)

# ---------------------------------------------------------------- camera (X_PLAYER.C calc_scroll)
func vp_max_x() -> int:
	return maxi(16, w * 16 - VIEW_W - 16)

func vp_max_y() -> int:
	return maxi(0, h * 16 - VIEW_H - 16)

func calc_scroll(peeky: int) -> void:
	var p := player()
	var xs := 4 if p.xl == 10 else 8
	if p.x < vpox + 116 and vpox >= 24:
		scrollxd = -xs
	if p.x > vpox + VIEW_W - 140 and vpox < vp_max_x():
		scrollxd = xs
	var top := clampi(p.y - 80, 0, vp_max_y())
	var bot := clampi(p.y - 32, 0, vp_max_y())
	var peek := vpoy + peeky
	if peek >= top and peek <= bot:
		scrollyd = peeky
	elif vpoy > bot:
		scrollyd = bot - vpoy
	elif vpoy < top:
		scrollyd = top - vpoy

func setorigin() -> void:
	var p := player()
	vpox = clampi((p.x - SCRN_XS * 8) & ~7, 16, vp_max_x())
	vpoy = clampi(p.y + 16 - VIEW_H / 2, 0, vp_max_y())
	pvpox = vpox
	pvpoy = vpoy

# ---------------------------------------------------------------- the step (XARGON.C play)
func step(inp: Dictionary) -> void:
	if not modal.is_empty():
		return
	if newlevel != "":
		enter_pending_level()
		if not modal.is_empty():
			return
	gamecount += 1
	# GAMECTRL.C checkctrl: fire buttons are edge-triggered through the *off latches
	dx1 = int(inp.get("dx", 0))
	dy1 = int(inp.get("dy", 0))
	fire1 = 1 if inp.get("fire1", false) else 0
	fire2 = 1 if inp.get("fire2", false) else 0
	if fire1:
		fire1 ^= fire1off
	else:
		fire1off = 0
	if fire2:
		fire2 ^= fire2off
	else:
		fire2off = 0
	# adapted: the source runs the blink cycle off the global step count; the remake restarts it
	# with each stage, so a stage plays the same however long the map walk took
	levelcount += 1
	if levelcount & 7 == 2:
		blink_phase = (levelcount >> 3) & 15
	pvpox = vpox
	pvpoy = vpoy
	for o in objs:
		o.px = o.x
		o.py = o.y
	upd_bkgnd()
	upd_objs()
	if bottime > 0:
		bottime -= 1
	vpox = clampi(vpox + scrollxd, 0, maxi(0, w * 16 - VIEW_W))
	vpoy = clampi(vpoy + scrollyd, 0, maxi(0, h * 16 - VIEW_H))
	end_of_step()
	purgeobjs()

func end_of_step() -> void:
	# XARGON.C drawstats: 16 berries give a heart
	if fruit >= 16 and pl["health"] < 5:
		fruit = 0
		pl["health"] += 1
		snd("heart", 3)
		if not invcount(D.INV_WARD):
			pl["ouched"] = -4
	# X_OBJ.C msg_effects: the ward wears off after 31 ten-step blinks
	if invcount(D.INV_WARD):
		ward_tick += 1
		if ward_tick >= 10:
			ward_tick = 0
			ward_count += 1
			if ward_count >= 31:
				ward_count = 0
				takeinv(D.INV_WARD)
				pl["ouched"] = -1
				txt(tr_text("ward_gone"))
	else:
		ward_tick = 0
		ward_count = 0
	# XARGON.C refresh: hurt (red) and heal (blue) tints fade
	var ou: int = pl["ouched"]
	if ou >= 2:
		pl["ouched"] = ou - 1
	elif ou == 1 or ou == -1:
		pl["ouched"] = 0
	elif ou <= -2:
		pl["ouched"] = ou + 1

func tr_text(key: String) -> String:
	var t = text.get(key)
	if t is String:
		return t
	if t is Dictionary:
		return " ".join(t.get("lines", []))
	return key

func upd_bkgnd() -> void:
	# X_OBJMAN.C upd_bkgnd + X_OBJ3.C msg_block(update): dart traps fire only on screen
	var sx := vpox >> 4
	var sy := vpoy >> 4
	for x in range(sx, mini(sx + SCRN_XS + 1, w)):
		for y in range(sy, mini(sy + 11, h)):
			var t := tile(x, y)
			if t == Tiles.DART_R and rnd(100) == 0:
				addobj(D.DART, x * 16 + 12, y * 16 + 6, 4, 0)
				snd("enemyfire")
			elif t == Tiles.DART_L and rnd(90) == 0:
				var d := addobj(D.DART, x * 16 - 8, y * 16 + 6, -4, 0)
				d.yd = 1
				snd("enemyfire")

func upd_objs() -> void:
	# X_OBJMAN.C upd_objs: only objects near the view (or F_ALWAYS) move this step
	scrn = [objs[0]]
	var sx := vpox - 96
	var ex := vpox + VIEW_W + 96
	var sy := vpoy - 48
	var ey := vpoy + VIEW_H + 48
	for i in range(1, objs.size()):
		var o: Obj = objs[i]
		if (o.x + o.xl >= sx and o.x <= ex and o.y + o.yl >= sy and o.y <= ey) or kflags(o) & D.F_ALWAYS:
			scrn.append(o)
	scrollxd = 0
	scrollyd = 0
	for o in scrn:
		if o.kind == D.KILLME:
			continue
		if o.zaphold > 0:
			o.zaphold -= 1
		Kinds.update(self, o)
		if o.kind == D.KILLME or not (kflags(o) & D.F_MSGTOUCH):
			continue
		var p := player()
		var squat: bool = o == p and p.kind == D.PLAYER and p.state == D.ST_STAND and p.xd == 0 and p.yd == 3
		for o2 in scrn:
			if o2 == o or o2.kind == D.KILLME:
				continue
			if o.kind == D.KILLME:
				break
			var top: int = o.y + (18 if squat else 0)
			if o2.x < o.x + o.xl and o.x < o2.x + o2.xl and o2.y < o.y + o.yl and top < o2.y + o2.yl:
				Kinds.touch(self, o, o2)
				if o2.kind != D.KILLME:
					Kinds.touch(self, o2, o)

func purgeobjs() -> void:
	var keep: Array = []
	for o in objs:
		if o.kind != D.KILLME:
			keep.append(o)
	objs = keep

func touchbkgnd(o: Obj) -> void:
	# X_OBJMAN.C touchbkgnd: hazard tiles, and crumbling floors under the feet
	if D.STATEINFO[o.state] & D.STI_INVINCIBLE and o.kind == D.PLAYER:
		return
	for y in range(o.y >> 4, (o.y + o.yl + 15) >> 4):
		for x in range(o.x >> 4, (o.x + o.xl + 15) >> 4):
			var t := tile(x, y)
			if Tiles.FLAGS[t] & Tiles.MSGTOUCH:
				touch_block(x, y, t)
				if player().state == D.ST_DIE:
					return
			else:
				var below := tile(x, y + 1)
				if Tiles.is_crumble(below) and gamecount & 3 == 2:
					var f := addobj(D.FRAG, o.x + rnd(10), o.y + o.yl + 4, 0, 2)
					f.state = -1
					settile(x, y + 1, Tiles.AIR if below == Tiles.CRUMBLE_LAST else below + 1)

func touch_block(x: int, y: int, t: int) -> void:
	# X_OBJ3.C msg_block(touch)
	in_hazard = t != Tiles.THORNS
	_touch_block(x, y, t)
	in_hazard = false

func _touch_block(x: int, y: int, t: int) -> void:
	var p := player()
	if t == Tiles.LAVA or t == Tiles.LAVA_TOP:
		p_ouch(5, D.DIE_ASH)
		addobj(D.FIRE, p.x - 4, p.y + 4, 0, 0)
		addobj(D.FIRE, p.x, p.y - 4, 0, 0)
		addobj(D.FIRE, p.x + 12, p.y + 4, 0, 0)
		addobj(D.IMPACT, p.x, p.y, 0, 0)
	elif t == Tiles.THORNS:
		hitplayer(p, false)
	elif t == Tiles.WATER or t == Tiles.WATER_TOP:
		if p.kind != D.BELL:
			p_ouch(5, D.DIE_ASH)
			snd("splash", 3)
	elif t == Tiles.SPIKES:
		p_ouch(5, D.DIE_ASH)

func trybreakwall(o: Obj, x: int, y: int) -> int:
	# X_OBJMAN.C trybreakwall: breakable blocks and crystal nodes
	var f := 0
	for xc in range(x >> 4, ((x + o.xl) >> 4) + 1):
		for yc in range(y >> 4, ((y + o.yl) >> 4) + 1):
			var t := tile(xc, yc)
			if t == Tiles.BREAKABLE:
				settile(xc, yc, Tiles.AIR)
				pl["score"] += 10
				if o.kind == D.EMBER:
					addobj(D.BURST, xc * 16 - 16 + 8, yc * 16 - 16 + 8, 0, 0)
				else:
					killobj(o)
				if f == 0:
					explode1(xc * 16, yc * 16, 5, true)
					snd("crash", 3)
				f += 1
			elif t == Tiles.NODE:
				addobj(D.FLASH, xc * 16 - 1, yc * 16 - 4, 0, 0)
				settile(xc, yc, Tiles.NODE_BROKEN)
				addscore(100, xc * 16, yc * 16)
				killobj(o)
				snd("crash", 3)
	return f

# ---------------------------------------------------------------- transforms (X_PLAYER.C playerxfm)
func playerxfm(to: int) -> bool:
	var p := player()
	var newkind := D.PLAYER
	if to == D.INV_MOTH:
		newkind = D.MOTH
	elif to == D.INV_BELL:
		newkind = D.BELL
	if p.kind == newkind:
		return false
	var oldkind := p.kind
	var oldxl := p.xl
	var oldyl := p.yl
	p.kind = newkind
	p.xl = D.KINDS[newkind][2]
	p.yl = D.KINDS[newkind][3]
	var nx := p.x & ~7
	var ny := p.y + oldyl - p.yl
	var ok := cando(p, nx, ny, Tiles.PLAYERTHRU) != 0
	if not ok:
		ny = p.y
		ok = cando(p, nx, ny, Tiles.PLAYERTHRU) != 0
	if ok:
		for c in D.INV_COUNT:
			if D.INV_XFM[c]:
				while takeinv(c):
					pass
		if to != D.INV_LAMP:
			addinv(to)
		p.y = ny
		p.x = nx
		p.state = 0
		p.substate = 0
		p.counter = 0
		p.xd = 0
		p.yd = 0
		explode1(p.x, p.y, 10, false)
		txt(tr_text("xfm_" + D.INV_NAMES[to]), 7)
		return true
	p.kind = oldkind
	p.xl = oldxl
	p.yl = oldyl
	return false

# ---------------------------------------------------------------- shop (XARGON.C buymenu)
const SHOP := [
	["health", 15], ["bolt", 10], ["rapid", 25], ["ember1", 5], ["ember5", 20], ["ward", 30]]

func can_shop() -> bool:
	return not level.get("overworld", false)

func buy(item: String) -> String:
	# returns "" on success, else the reason; costs as in the source
	var human := player().kind == D.PLAYER
	var cost := 0
	for e in SHOP:
		if e[0] == item:
			cost = e[1]
	if pl["shards"] < cost:
		return "poor"
	match item:
		"health":
			if pl["health"] >= 5:
				return "full"
			if not invcount(D.INV_WARD):
				pl["ouched"] = -4
			pl["health"] += 1
		"bolt":
			if not human:
				return "form"
			if invcount(D.INV_BOLT) >= 5:
				return "full"
			addinv(D.INV_BOLT)
		"rapid":
			if not human:
				return "form"
			if invcount(D.INV_BOLT) >= 5:
				return "full"
			while invcount(D.INV_BOLT) < 5:
				addinv(D.INV_BOLT)
		"ember1":
			if not human:
				return "form"
			if invcount(D.INV_EMBER) >= 9:
				return "full"
			addinv(D.INV_EMBER)
		"ember5":
			if not human:
				return "form"
			if invcount(D.INV_EMBER) >= 5:
				return "full"
			for i in 5:
				addinv(D.INV_EMBER)
		"ward":
			if invcount(D.INV_WARD):
				return "full"
			addinv(D.INV_WARD)
	pl["shards"] -= cost
	snd("token", 3)
	return ""

# ---------------------------------------------------------------- fast copy (route checker)
func clone():
	var c = get_script().new("")
	c.content_root = content_root
	c.text = text
	for f in ["w", "h", "curlevel", "fruit", "fruit_icon", "old_fruit", "gamecount", "rng_state", "dx1", "dy1",
			"fire1", "fire2", "fire1off", "fire2off", "blink_phase", "vpox", "vpoy", "pvpox", "pvpoy", "botmsg",
			"bottime", "newlevel", "gameover", "next_id", "ward_count", "ward_tick", "god", "levelcount"]:
		c.set(f, get(f))
	c.level = level
	c.board = board
	c.board_owned = false
	board_owned = false
	c.objs = []
	for o in objs:
		c.objs.append(o.copy())
	c.pl = pl.duplicate(true)
	c.o_pl = o_pl
	c.done_stages = done_stages.duplicate()
	c.seen = seen.duplicate()
	c.respawn = respawn.duplicate()
	c.map_snapshot = map_snapshot
	return c

# ---------------------------------------------------------------- save / load
func snapshot_world() -> Dictionary:
	var ol: Array = []
	for o in objs:
		ol.append(o.to_dict())
	return {"curlevel": curlevel, "w": w, "h": h, "board": board.duplicate(), "objs": ol,
		"respawn": respawn.duplicate(), "vpox": vpox, "vpoy": vpoy}

func restore_snapshot(s: Dictionary) -> void:
	curlevel = s["curlevel"]
	var data := Level.load_level(content_root, curlevel)
	level = data["header"]
	w = s["w"]
	h = s["h"]
	board = s["board"].duplicate()
	objs = []
	for d in s["objs"]:
		var o := Obj.new()
		o.from_dict(d)
		objs.append(o)
		next_id = maxi(next_id, o.id + 1)
	respawn = s["respawn"].duplicate()
	vpox = s["vpox"]
	vpoy = s["vpoy"]

func save_state() -> Dictionary:
	return {"version": 1, "world": snapshot_world(), "pl": pl.duplicate(true), "o_pl": o_pl.duplicate(true),
		"fruit": fruit, "fruit_icon": fruit_icon, "old_fruit": old_fruit, "done": done_stages.duplicate(),
		"seen": seen.duplicate(), "map": map_snapshot.duplicate(true), "rng": rng_state, "gamecount": gamecount,
		"blink": blink_phase, "levelcount": levelcount, "ward": [ward_count, ward_tick], "next_id": next_id}

func load_state(s: Dictionary) -> void:
	restore_snapshot(s["world"])
	pl = s["pl"].duplicate(true)
	o_pl = s["o_pl"].duplicate(true)
	fruit = s["fruit"]
	fruit_icon = s["fruit_icon"]
	old_fruit = s["old_fruit"]
	done_stages = s["done"].duplicate()
	seen = s["seen"].duplicate()
	map_snapshot = s["map"].duplicate(true)
	rng_state = s["rng"]
	gamecount = s["gamecount"]
	blink_phase = s["blink"]
	levelcount = s.get("levelcount", 0)
	ward_count = s["ward"][0]
	ward_tick = s["ward"][1]
	next_id = maxi(next_id, s["next_id"])
	modal = {}
	newlevel = ""
	gameover = 0
	pvpox = vpox
	pvpoy = vpoy
	music_for_level()
	events.append({"t": "cut"})
