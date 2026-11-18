## One game object: the source's objtype (INCLUDE/XARGON.H) plus a few fields the remake
## needs (a stable id and the previous position for drawing between steps).
extends RefCounted

var id := 0
var kind := 0
var x := 0
var y := 0
var xd := 0
var yd := 0
var xl := 0
var yl := 0
var state := 0
var substate := 0
var statecount := 0
var counter := 0
var info1 := 0
var zaphold := 0
var inside := ""          # a text key or the next board's name
var p: Dictionary = {}    # extra parameters from the level file (colour, dialog key ...)
var px := 0               # position at the previous step
var py := 0

const FIELDS := ["id", "kind", "x", "y", "xd", "yd", "xl", "yl", "state", "substate", "statecount",
	"counter", "info1", "zaphold", "inside"]

func to_dict() -> Dictionary:
	var d := {}
	for f in FIELDS:
		d[f] = get(f)
	d["p"] = p.duplicate(true)
	return d

func from_dict(d: Dictionary) -> void:
	for f in FIELDS:
		set(f, d[f])
	p = d["p"].duplicate(true)
	px = x
	py = y

func copy():
	var o = get_script().new()
	o.id = id
	o.kind = kind
	o.x = x
	o.y = y
	o.xd = xd
	o.yd = yd
	o.xl = xl
	o.yl = yl
	o.state = state
	o.substate = substate
	o.statecount = statecount
	o.counter = counter
	o.info1 = info1
	o.zaphold = zaphold
	o.inside = inside
	o.p = p
	o.px = px
	o.py = py
	return o
