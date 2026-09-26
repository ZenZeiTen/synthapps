## Level files: content/levels/<name>.txt. A small text format so stages can be drawn as
## ASCII maps and still carry objects with parameters.
##
##   name: Mossgate Hollow          header lines (key: value) until "map:"
##   theme: moss
##   music: hollow
##   stage: 1
##   intro: first line | second line
##   map:
##   ##########                     one character per 16x16 cell (TILE_CHARS, or a marker)
##   end
##   legend:
##   K key color=amber              a marker character, the kind, then key=value parameters
##
## A marker's cell takes its tile from the nearest passable neighbour (left, then right),
## else air; "on=<char>" names the tile instead. Objects are placed at the cell's left edge and sit on its floor (their bottom
## is the cell's bottom), unless the parameter "align=top" (top of the cell) or dx=/dy= says otherwise.
extends RefCounted

const T = preload("res://scripts/core/tiles.gd")
const D = preload("res://scripts/core/defs.gd")

const TILE_CHARS := {
	" ": T.AIR, ".": T.BACKWALL, "#": T.SOLID, "%": T.SOLID_DECO, "=": T.LEDGE, "-": T.BRIDGE,
	"|": T.VINE, "!": T.VINE_TOP, "~": T.WATER_TOP, "w": T.WATER, "&": T.LAVA_TOP, "l": T.LAVA,
	"^": T.SPIKES, "x": T.THORNS, "c": T.CRUMBLE, "b": T.BREAKABLE, "k": T.BLINK, "I": T.BEAM,
	"n": T.NODE, ">": T.DART_R, "<": T.DART_L, "[": T.LIFT_L, "]": T.LIFT_R,
	"0": T.DECO_A, "1": T.DECO_A + 1, "2": T.DECO_A + 2, "3": T.DECO_A + 3, "4": T.DECO_A + 4,
	"5": T.DECO_A + 5, "6": T.DECO_A + 6, "7": T.DECO_A + 7, "8": T.DECO_A + 8, "9": T.DECO_A + 9,
	"a": T.DECO_B, "d": T.DECO_B + 1, "e": T.DECO_B + 2, "i": T.DECO_B + 3, "j": T.DECO_B + 4,
	"m": T.DECO_B + 5, "o": T.DECO_B + 6, "q": T.DECO_B + 7,
	# overworld
	",": T.GRASS, ";": T.FLOWERS, ":": T.SAND, "\"": T.REEDS, "p": T.PATH, "W": T.MWATER,
	"T": T.FOREST, "R": T.ROCK, "Z": T.BRIDGE_H, "z": T.BRIDGE_V, "U": T.HOUSE, "Y": T.TOWER,
	"O": T.WELL, "Q": T.STUMP, "'": T.MDECO,
}

# markers every level may use without declaring them
const DEFAULT_LEGEND := {
	"@": "start", "E": "exit", "F": "flag", "S": "shard", "H": "heart", "y": "bonus berry=sunberry", "u": "bonus berry=plum",
	"f": "bonus berry=fig", "r": "bonus berry=starfruit", "g": "bonus gem=0",
}

const BERRY_STATE := {"sunberry": 2, "plum": 6, "fig": 8, "starfruit": 14}
const GEM_STATE := [23, 3, 7, 19]           # 50, 120, 200, 2000 points
const CRATE_DROPS := ["heart", "sunberry", "plum", "fig", "starfruit", "gem", "key_amber", "key_moss",
	"key_rose", "key_sky", "gatekey", "shard", "fire", "nothing"]
const TOKEN_ITEMS := {"lamp": D.INV_LAMP, "gatekey": D.INV_GATEKEY, "bolt": D.INV_BOLT, "moth": D.INV_MOTH,
	"bell": D.INV_BELL, "stones": D.INV_STONES, "boots": D.INV_BOOTS, "ward": D.INV_WARD}

static var _cache: Dictionary = {}

static func load_level(root: String, name: String) -> Dictionary:
	var key := root + "/" + name
	if _cache.has(key):
		return _cache[key]
	var f := FileAccess.open(root + "/levels/" + name + ".txt", FileAccess.READ)
	if f == null:
		return {}
	var data := parse(f.get_as_text(), name)
	_cache[key] = data
	return data

static func parse(src: String, name: String) -> Dictionary:
	var header := {"name": name, "theme": "moss", "music": "", "intro": [], "stage": 0}
	var rows: Array = []
	var legend := DEFAULT_LEGEND.duplicate()
	var mode := "head"
	for raw in src.split("\n"):
		var line: String = raw.trim_suffix("\r")
		if mode == "map":
			if line == "end":
				mode = "tail"
			else:
				rows.append(line)
			continue
		if line.strip_edges() == "" or line.begins_with("//"):
			continue
		if line == "map:":
			mode = "map"
		elif line == "legend:":
			mode = "legend"
		elif mode == "legend":
			legend[line.substr(0, 1)] = line.substr(1).strip_edges()
		else:
			var i := line.find(":")
			var k := line.substr(0, i).strip_edges()
			var v := line.substr(i + 1).strip_edges()
			if k == "intro":
				header["intro"] = Array(v.split("|")).map(func(s): return s.strip_edges())
			elif k in ["stage"]:
				header[k] = int(v)
			elif k == "overworld":
				header[k] = v == "yes"
			else:
				header[k] = v
	var h := rows.size()
	var w := 0
	for r in rows:
		w = maxi(w, r.length())
	var board := PackedInt32Array()
	board.resize(w * h)
	var markers: Array = []
	for y in h:
		var r: String = rows[y]
		for x in w:
			var ch := r.substr(x, 1) if x < r.length() else " "
			if TILE_CHARS.has(ch) and not legend.has(ch):
				board[y * w + x] = TILE_CHARS[ch]
			elif legend.has(ch):
				board[y * w + x] = -1
				markers.append([x, y, ch])
			else:
				push_error("%s: unknown map character '%s' at %d,%d" % [name, ch, x, y])
				board[y * w + x] = T.SOLID
	# marker cells borrow the tile of a passable neighbour, unless the legend says "on=<char>"
	for m in markers:
		var x: int = m[0]
		var y: int = m[1]
		var on: String = parse_spec(legend[m[2]]).get("on", "")
		if on != "":
			board[y * w + x] = TILE_CHARS[on]
			continue
		var t := T.AIR
		for dx in [-1, 1, -2, 2]:
			if x + dx >= 0 and x + dx < w:
				var n := board[y * w + x + dx]
				if n >= 0 and not T.is_solid(n) and n != T.LIFT_L and n != T.LIFT_R:
					t = n
					break
		board[y * w + x] = t
	var objects: Array = []
	for m in markers:
		var spec := parse_spec(legend[m[2]])
		spec["cx"] = m[0]
		spec["cy"] = m[1]
		objects.append(spec)
	return {"header": header, "w": w, "h": h, "board": board, "objects": objects}

static func parse_spec(s: String) -> Dictionary:
	var parts := s.split(" ", false)
	var spec := {"kind": parts[0]}
	for i in range(1, parts.size()):
		var kv: PackedStringArray = parts[i].split("=", true, 1)
		spec[kv[0]] = kv[1] if kv.size() > 1 else "1"
	return spec

static func _i(spec: Dictionary, k: String, dflt: int) -> int:
	return int(spec[k]) if spec.has(k) else dflt

static func spawn(g, spec: Dictionary) -> void:
	var kname: String = spec["kind"]
	var cx: int = spec["cx"]
	var cy: int = spec["cy"]
	if kname == "start":
		kname = "checkpt"
	var kid: int
	match kname:
		"exit":
			kid = D.CHECKPT
		_:
			kid = D.kind_id(kname)
	if kid < 0:
		push_error("unknown object kind " + kname)
		return
	var xl: int = D.KINDS[kid][2]
	var yl: int = D.KINDS[kid][3]
	var x := cx * 16 + _i(spec, "dx", 0)
	var y := (cy * 16 if spec.get("align", "") == "top" else (cy + 1) * 16 - yl) + _i(spec, "dy", 0)
	if kid in [D.CHECKPT, D.PAD, D.BRIDGER, D.ADDSTEP, D.TRANSPORT, D.TRANSPAD, D.DOOR, D.TIMERPAD, D.GATE, D.STALACTITE, D.LIFT]:
		y = cy * 16 + _i(spec, "dy", 0)          # these work on their own cell
	var o = g.addobj(kid, x, y, _i(spec, "xd", 0), _i(spec, "yd", 0))
	for k in ["state", "substate", "statecount", "counter", "info1"]:
		if spec.has(k):
			o.set(k, int(spec[k]))
	if spec.has("text"):
		o.inside = spec["text"]
	if spec.has("channel"):
		o.counter = int(spec["channel"])
	match kname:
		"checkpt", "start":
			o.counter = _i(spec, "level", g.level.get("stage", 0))
			if spec.has("to"):
				o.inside = spec["to"]
		"exit":
			o.counter = 0
			o.inside = "!"
			o.state = _i(spec, "state", 0)
			o.p["exit"] = true
		"door":
			o.state = D.KEY_COLORS.find(spec.get("color", "amber"))
			for c in [-1, 0, 1]:
				g.settile(cx, cy + c, T.DOORWAY)
			# pads on both sides let Orrin unlock it by walking up to it
			for side in [-1, 1]:
				var pad = g.addobj(D.PAD, (cx + side) * 16, cy * 16, 0, 0)
				pad.counter = o.counter
		"key":
			o.state = D.KEY_COLORS.find(spec.get("color", "amber"))
		"bonus":
			if spec.has("berry"):
				o.state = BERRY_STATE[spec["berry"]]
			elif spec.has("gem"):
				o.state = GEM_STATE[int(spec["gem"])]
			elif spec.has("rune"):
				o.state = 9 + "vale".find(spec["rune"])
			elif spec.has("note"):
				o.state = 13
				o.inside = spec["note"]
			elif spec.has("embers"):
				o.state = 28
			elif spec.has("rapid"):
				o.state = 1
		"token":
			o.state = TOKEN_ITEMS[spec.get("item", "bolt")]
		"crate":
			o.state = CRATE_DROPS.find(spec.get("drop", "nothing"))
			if spec.get("hidden", "no") != "yes":
				o.yd = -1
		"sigil":
			o.state = ["root", "tide", "ember"].find(spec.get("which", "root"))
		"owl":
			o.inside = spec.get("text", "")
			o.xd = _i(spec, "xd", 4)
		"spikes":
			o.yd = 1 if spec.get("dir", "up") == "down" else 0
		"spear":
			o.yd = -1 if spec.get("dir", "up") == "down" else 1
		"snapjaw":
			o.xd = 1 if spec.get("dir", "right") == "right" else -1
			o.state = 1
		"gate":
			o.state = 1 if spec.get("need", "") == "sigils" else 0
			var cells: Array = [[cx, cy]]
			o.p["cells"] = cells
			o.x -= 4
			o.y -= 4
			o.xl = 24
			o.yl = 24
			g.settile(cx, cy, T.GATE)
		"regent":
			o.p["channel"] = _i(spec, "opens", 90)
		"urchin":
			if not spec.has("yd"):
				o.yd = 1
		"duskwing":
			if not spec.has("xd"):
				o.xd = 2
		"lift":
			if spec.has("free"):
				o.counter = 0
			else:
				o.counter = _i(spec, "counter", 0)
	if spec.has("stamp"):
		# addstep: "stamp=dx,dy,char;dx,dy,char" (a tile character from TILE_CHARS)
		var st: Array = []
		for part in String(spec["stamp"]).split(";"):
			var a: PackedStringArray = part.split(",")
			st.append([int(a[0]), int(a[1]), TILE_CHARS[a[2]]])
		o.p["stamp"] = st
	for k in spec:
		if not k in ["kind", "cx", "cy", "dx", "dy", "align", "on"]:
			o.p[k] = spec[k]
