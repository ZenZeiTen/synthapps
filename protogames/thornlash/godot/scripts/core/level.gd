class_name Level
extends RefCounted
## One block of a stage, parsed from an ASCII grid. Static data only: everything that
## changes during play (broken walls, live enemies) lives in the Game state dictionary.

const T := 16

# Grid characters that are terrain. Everything else in the grid is an entity marker and is
# replaced by '.' after parsing.
const SOLID := "#%=X"
const ENTITY_CHARS := "@iIjBGMFKSWRHNOPQUVYZET12345"

var id: String = ""
var meta: Dictionary = {}
var w: int = 0
var h: int = 0
var rows: Array[String] = []
var stairs: Array = []      # [{x0,y0,x1,y1,dir,len}] feet points: (x0,y0) bottom, (x1,y1) top
var marks: Array = []       # [{c, cx, cy, x, y, n}] entity markers, reading order
var errors: Array[String] = []


static func parse_file(text: String) -> Dictionary:
	## Returns {block_id: Level}. Format: "@block <id>" header, key=value lines, "---",
	## then grid rows until the next "@block" or end of file.
	var out: Dictionary = {}
	var cur: Level = null
	var in_grid := false
	for raw in text.split("\n"):
		var line: String = raw.rstrip("\r")
		if line.begins_with("@block"):
			if cur != null:
				cur._finish()
				out[cur.id] = cur
			cur = Level.new()
			cur.id = line.substr(6).strip_edges()
			in_grid = false
			continue
		if cur == null:
			continue
		if not in_grid:
			if line.strip_edges() == "---":
				in_grid = true
			elif line.strip_edges() != "" and not line.begins_with(";"):
				var eq := line.find("=")
				if eq > 0:
					cur.meta[line.substr(0, eq).strip_edges()] = line.substr(eq + 1).strip_edges()
		else:
			if line.begins_with(";"):
				continue
			cur.rows.append(line)
	if cur != null:
		cur._finish()
		out[cur.id] = cur
	return out


func _finish() -> void:
	while not rows.is_empty() and rows[rows.size() - 1].strip_edges() == "":
		rows.pop_back()
	h = rows.size()
	w = 0
	for r in rows:
		w = maxi(w, r.length())
	for i in rows.size():
		rows[i] = rows[i].rpad(w, ".").replace(" ", ".")
	# entity markers
	var n_by_char: Dictionary = {}
	for cy in h:
		var row: String = rows[cy]
		for cx in w:
			var c := row[cx]
			if ENTITY_CHARS.contains(c):
				var n: int = n_by_char.get(c, 0)
				n_by_char[c] = n + 1
				marks.append({"c": c, "cx": cx, "cy": cy, "x": cx * T + T / 2, "y": (cy + 1) * T, "n": n})
				row[cx] = "."
		rows[cy] = row
	_find_stairs()
	if w == 0 or h == 0:
		errors.append("%s: empty grid" % id)


func ch(cx: int, cy: int) -> String:
	if cy < 0 or cy >= h or cx < 0 or cx >= w:
		return "."
	return rows[cy][cx]


func solid(cx: int, cy: int, broken: Dictionary) -> bool:
	if cx < 0 or cx >= w:
		return cy >= 0   # side walls; open sky above the grid
	if cy < 0 or cy >= h:
		return false
	var c := rows[cy][cx]
	if c == "X":
		return not broken.has(Vector2i(cx, cy))
	return SOLID.contains(c)


func hazard(cx: int, cy: int) -> String:
	## "~" water (deadly), "^" spikes, or "".
	var c := ch(cx, cy)
	if c == "~" or c == "^":
		return c
	return ""


func _find_stairs() -> void:
	for cy in h:
		for cx in w:
			var c := ch(cx, cy)
			if c == "/" and ch(cx - 1, cy + 1) != "/":
				var ex := cx
				var ey := cy
				while ch(ex + 1, ey - 1) == "/":
					ex += 1
					ey -= 1
				var x0 := cx * T
				var y0 := (cy + 1) * T
				var x1 := (ex + 1) * T
				var y1 := ey * T
				stairs.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "dir": 1, "len": x1 - x0})
			elif c == "\\" and ch(cx + 1, cy + 1) != "\\":
				var ex2 := cx
				var ey2 := cy
				while ch(ex2 - 1, ey2 - 1) == "\\":
					ex2 -= 1
					ey2 -= 1
				var bx0 := (cx + 1) * T
				var by0 := (cy + 1) * T
				var bx1 := ex2 * T
				var by1 := ey2 * T
				stairs.append({"x0": bx0, "y0": by0, "x1": bx1, "y1": by1, "dir": -1, "len": bx0 - bx1})


func meta_list(key: String) -> PackedStringArray:
	var v: String = meta.get(key, "")
	if v == "":
		return PackedStringArray()
	var parts := v.split(",")
	for i in parts.size():
		parts[i] = parts[i].strip_edges()
	return parts


func meta_int(key: String, def: int) -> int:
	return int(meta.get(key, str(def)))


func px_w() -> int:
	return w * T


func px_h() -> int:
	return h * T
