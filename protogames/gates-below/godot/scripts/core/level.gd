## Compiles a level JSON (ASCII doubled grid + annotations) into the original's model:
## an array of squares, each owning four inward-facing wall faces (map_sides[sector*4+dir]).
## The result is static data; everything that changes during play lives in the level
## state that game.gd keeps (and saves).
extends RefCounted

const DIRS := ["N", "E", "S", "W"]
const DX: Array[int] = [0, 1, 0, -1]
const DY: Array[int] = [-1, 0, 1, 0]
const WALL_CHARS := "#|-+ "
const CELL_TYPES := {".": "floor", "~": "water", "^": "pit", "*": "teleport", "_": "plate", "<": "stairs", ">": "stairs"}

var id: String
var data: Dictionary
var w: int
var h: int
var cells: Array = []      # index y*w+x -> {} for void, else {x, y, type, floor, ceil, wall, anchor, def}
var faces: Array = []      # index cell*4+dir -> {kind, tex, decal, lock, niche, switch, fountain, on_touch, on_pass, on_niche}
var anchors: Dictionary = {}
var errors: Array = []


func _init(level_id: String, level_data: Dictionary) -> void:
	id = level_id
	data = level_data
	_compile()


func idx(x: int, y: int) -> int:
	return y * w + x


func valid(x: int, y: int) -> bool:
	return x >= 0 and y >= 0 and x < w and y < h and not cells[idx(x, y)].is_empty()


static func dir_of(s: String) -> int:
	return DIRS.find(s)


## "A" or "3,4" -> Vector2i (or (-1,-1) and an error).
func cell_ref(ref) -> Vector2i:
	if ref is Array:
		return Vector2i(int(ref[0]), int(ref[1]))
	var s = String(ref)
	if "," in s:
		var p = s.split(",")
		return Vector2i(int(p[0]), int(p[1]))
	if anchors.has(s):
		return anchors[s]
	errors.append("%s: unknown anchor '%s'" % [id, s])
	return Vector2i(-1, -1)


## "A.N" or "3,4.E" -> face index (cell*4+dir), or -1.
func face_ref(ref: String) -> int:
	var dot = ref.rfind(".")
	if dot < 0:
		errors.append("%s: bad face '%s'" % [id, ref])
		return -1
	var c = cell_ref(ref.substr(0, dot))
	var d = dir_of(ref.substr(dot + 1))
	if d < 0 or not valid(c.x, c.y):
		errors.append("%s: face '%s' is not on a square" % [id, ref])
		return -1
	return idx(c.x, c.y) * 4 + d


## The face on the other side of the same edge (or -1 at the map edge / void).
func opposite(face: int) -> int:
	var c = face >> 2
	var d = face & 3
	var x = c % w + DX[d]
	var y = c / w + DY[d]
	if not valid(x, y):
		return -1
	return idx(x, y) * 4 + ((d + 2) & 3)


func neighbour(cell: int, d: int) -> int:
	var x = cell % w + DX[d]
	var y = cell / w + DY[d]
	return idx(x, y) if valid(x, y) else -1


func _compile() -> void:
	var rows: Array = data["map"]
	h = (rows.size() - 1) / 2
	w = (String(rows[0]).length() - 1) / 2
	for r in rows:
		if String(r).length() != 2 * w + 1:
			errors.append("%s: map rows have different lengths" % id)
			return
	var tex: Dictionary = data.get("tex", {})
	cells.resize(w * h)
	for y in h:
		for x in w:
			var ch = String(rows[2 * y + 1])[2 * x + 1]
			if ch in WALL_CHARS:
				cells[idx(x, y)] = {}
				continue
			var c = {"x": x, "y": y, "type": CELL_TYPES.get(ch, "floor"), "glyph": ch,
				"floor": tex.get("floor", "floor_flag"), "ceil": tex.get("ceil", "ceiling_stone"), "wall": tex.get("wall", "wall_stone")}
			if not CELL_TYPES.has(ch):
				anchors[ch] = Vector2i(x, y)
				c["anchor"] = ch
			if ch == "<" or ch == ">":
				anchors[ch] = Vector2i(x, y)
				c["stairs"] = "up" if ch == "<" else "down"
			if ch == "^":
				anchors[ch] = Vector2i(x, y)
			cells[idx(x, y)] = c
	for reg in data.get("regions", []):
		var r: Array = reg["cells"]
		for y in range(int(r[1]), int(r[3]) + 1):
			for x in range(int(r[0]), int(r[2]) + 1):
				if valid(x, y):
					for k in ["floor", "ceil", "wall"]:
						if reg.has(k):
							cells[idx(x, y)][k] = reg[k]
	faces.resize(w * h * 4)
	for y in h:
		for x in w:
			for d in 4:
				var f = {}
				if valid(x, y):
					var ex = 2 * x + 1 + DX[d]
					var ey = 2 * y + 1 + DY[d]
					var ch = String(rows[ey])[ex]
					var kind = "wall"
					if valid(x + DX[d], y + DY[d]):
						match ch:
							".": kind = "open"
							"D": kind = "door"
							"G": kind = "gate"
							"S": kind = "secret"
					f = {"kind": kind, "tex": cells[idx(x, y)]["wall"]}
					if kind == "door":
						f["tex"] = "door_wood"
					elif kind == "gate":
						f["tex"] = "portcullis"
				faces[idx(x, y) * 4 + d] = f
	# Annotations. A lock on one face locks the whole edge (both faces).
	var fdefs: Dictionary = data.get("faces", {})
	for ref in fdefs:
		var fi = face_ref(ref)
		if fi < 0:
			continue
		var def: Dictionary = fdefs[ref]
		for k in def:
			faces[fi][k] = def[k]
		if def.has("lock"):
			var o = opposite(fi)
			if o >= 0:
				faces[o]["lock"] = def["lock"]
			if not faces[fi]["kind"] in ["door", "gate"]:
				errors.append("%s: lock on '%s', which is not a door" % [id, ref])
		if def.has("niche") or def.has("switch") or def.has("fountain") or def.has("decal"):
			if faces[fi]["kind"] != "wall":
				errors.append("%s: '%s' puts a wall fitting on an open face" % [id, ref])
	var cdefs: Dictionary = data.get("cells", {})
	for ref in cdefs:
		var c = cell_ref(ref)
		if not valid(c.x, c.y):
			errors.append("%s: cell '%s' is not a square" % [id, ref])
			continue
		cells[idx(c.x, c.y)]["def"] = cdefs[ref]
		if cdefs[ref].has("teleport"):
			cells[idx(c.x, c.y)]["type"] = "teleport"
		elif cdefs[ref].has("on_press") and cells[idx(c.x, c.y)]["type"] == "floor":
			cells[idx(c.x, c.y)]["type"] = "plate"


## Doors and portcullises are edges: both faces share one state, keyed by the lower index.
func edge_key(face: int) -> int:
	var o = opposite(face)
	return face if o < 0 else mini(face, o)
