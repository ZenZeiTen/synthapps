## Stage files (content/levels/*.txt): a header of `key: value` lines, a `---` line, then
## rows of tiles, 16 px each. Markers become objects and leave an empty tile behind.
## web/src/core/level.js reads the same format; keep the two in step.
##
## Tiles:  # solid   X solid crate   = thin ledge (stand on it from above)   H climb
##         ^ spikes or silt (hurts)  L locked gate   ~ water (drawn only)   . empty
## Markers: S start  P checkpoint post  C chest  $ coin  * gem  N captive  A arena edge
##          G guardian  k key  T tonic  h heartroot  n knives  f feather  q squall
##          s stoneskin  y fury salt  1 extra life
##          r raider  t thrower  m mudskip  b bat  c crab  g gull  w wisp  o golem
extends RefCounted

const TILE_CHARS := "#X=H^L~."
const ENEMY_MARKERS := {"r": "raider", "t": "thrower", "m": "mudskip", "b": "bat", "c": "crab",
	"g": "gull", "w": "wisp", "o": "golem"}
const PICKUP_MARKERS := {"$": "coin", "*": "gem", "k": "key", "T": "tonic", "h": "heartroot", "n": "knives",
	"f": "feather", "q": "squall", "s": "stoneskin", "y": "fury", "1": "life"}


## Returns {"head": {...}, "w": int, "h": int, "rows": Array[PackedByteArray], "marks": [[char, tx, ty], ...]}
## Marks are listed row by row, left to right.
static func parse(text: String) -> Dictionary:
	var head := {}
	var rows: Array = []
	var in_rows := false
	for line in text.split("\n"):
		var l := line.strip_edges(false, true)
		if not in_rows:
			if l == "---":
				in_rows = true
			elif l != "" and not l.begins_with("#"):
				var i := l.find(":")
				if i > 0:
					head[l.substr(0, i).strip_edges()] = l.substr(i + 1).strip_edges()
			continue
		if l == "":
			continue
		rows.append(l)
	var w := 0
	for r in rows:
		w = maxi(w, r.length())
	var out_rows: Array = []
	var marks: Array = []
	for ty in rows.size():
		var src: String = rows[ty]
		var b := PackedByteArray()
		b.resize(w)
		for tx in w:
			var c := src[tx] if tx < src.length() else "."
			if TILE_CHARS.contains(c):
				b[tx] = c.unicode_at(0)
			else:
				b[tx] = 46  # "."
				marks.append([c, tx, ty])
		out_rows.append(b)
	return {"head": head, "w": w, "h": rows.size(), "rows": out_rows, "marks": marks}


static func list(head: Dictionary, key: String) -> Array:
	var out: Array = []
	if not head.has(key):
		return out
	for s in String(head[key]).split(","):
		var t := s.strip_edges()
		if t != "":
			out.append(t)
	return out
