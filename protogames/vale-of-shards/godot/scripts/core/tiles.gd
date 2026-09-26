## Tile kinds and their flags. Pure data, no nodes.
##
## Flags follow the source (INCLUDE/XARGON.H, SOURCE/X_INFO.C init_info): a tile is solid
## unless PLAYERTHRU is set; NOTSTAIR missing on a passable tile makes a one-way ledge;
## NOTVINE missing makes a vine; NOTWATER missing makes water. The view picks the art from
## ART (a slot name in pipeline/manifest.py SIDE_LAYOUT / MAP_LAYOUT).
extends RefCounted

const PLAYERTHRU := 1
const NOTSTAIR := 2
const NOTVINE := 4
const MSGTOUCH := 8
const WATER_BIT := 16    # the source's f_notwater; here: set = NOT water (same sense)
const DEFAULT := NOTSTAIR | NOTVINE | WATER_BIT
const OPEN := PLAYERTHRU | NOTSTAIR | NOTVINE | WATER_BIT

# ids
const AIR := 0
const SOLID := 1
const BACKWALL := 2
const LEDGE := 3
const VINE := 4
const VINE_TOP := 5
const CRUMBLE := 6          # 6..17: 12 stages (X_OBJMAN.C touchbkgnd: crum1..crum_last)
const CRUMBLE_LAST := 17
const BREAKABLE := 18
const BLINK := 19
const BRIDGE := 20
const BEAM := 21
const WATER_TOP := 22
const WATER := 23
const LAVA_TOP := 24
const LAVA := 25
const SPIKES := 26
const THORNS := 27
const NODE := 28
const NODE_BROKEN := 29
const LIFT_L := 30
const LIFT_R := 31
const DART_R := 32
const DART_L := 33
const DECO_A := 40          # 40..49 passable decorations
const DECO_B := 50          # 50..57 passable decorations
const SOLID_DECO := 58      # a solid tile drawn with a decorative variant
const DOORWAY := 59         # solid cells behind a door object (the door draws itself)
# overworld
const GRASS := 64
const FLOWERS := 65
const SAND := 66
const REEDS := 67
const PATH := 68
const MWATER := 69
const FOREST := 70
const ROCK := 71
const GATE := 72
const BRIDGE_H := 73
const BRIDGE_V := 74
const HOUSE := 75
const TOWER := 76
const WELL := 77
const STUMP := 78
const MDECO := 79
const COUNT := 80

static var FLAGS := PackedInt32Array()
static var ART: Array = []

static func _static_init() -> void:
	FLAGS.resize(COUNT)
	ART.resize(COUNT)
	for i in COUNT:
		FLAGS[i] = DEFAULT        # solid by default, as in the source
		ART[i] = ""
	_def(AIR, OPEN, "")
	_def(SOLID, DEFAULT, "solid")
	_def(SOLID_DECO, DEFAULT, "solid")
	_def(DOORWAY, DEFAULT, "")
	_def(BACKWALL, OPEN, "backwall")
	_def(LEDGE, PLAYERTHRU | NOTVINE | WATER_BIT, "ledge")
	_def(BRIDGE, PLAYERTHRU | NOTVINE | WATER_BIT, "bridge")
	_def(VINE, PLAYERTHRU | NOTSTAIR | WATER_BIT, "vine")
	_def(VINE_TOP, PLAYERTHRU | WATER_BIT, "vine_top")        # a vine you can also stand on
	for i in range(CRUMBLE, CRUMBLE_LAST + 1):
		_def(i, DEFAULT, "crumble")
	_def(BREAKABLE, DEFAULT, "breakable")
	# a ledge that is only standable in phases 6..11 of its cycle (X_OBJ3.C msg_block);
	# the game adds NOTSTAIR in the other phases (game.gd flags_at)
	_def(BLINK, PLAYERTHRU | NOTVINE | WATER_BIT, "blink")
	_def(BEAM, DEFAULT, "beam")
	_def(WATER_TOP, PLAYERTHRU | NOTSTAIR | NOTVINE | MSGTOUCH, "water_top")
	_def(WATER, PLAYERTHRU | NOTSTAIR | NOTVINE | MSGTOUCH, "water")
	_def(LAVA_TOP, OPEN | MSGTOUCH, "lava_top")
	_def(LAVA, OPEN | MSGTOUCH, "lava")
	_def(SPIKES, OPEN | MSGTOUCH, "spikes")
	_def(THORNS, OPEN | MSGTOUCH, "thorns")
	_def(NODE, DEFAULT, "node")
	_def(NODE_BROKEN, DEFAULT, "node_broken")
	_def(LIFT_L, PLAYERTHRU | NOTVINE | WATER_BIT, "shaft_l")
	_def(LIFT_R, PLAYERTHRU | NOTVINE | WATER_BIT, "shaft_r")
	_def(DART_R, DEFAULT, "dart_r")
	_def(DART_L, DEFAULT, "dart_l")
	for i in 10:
		_def(DECO_A + i, OPEN, "deco_a")
	for i in 8:
		_def(DECO_B + i, OPEN, "deco_b")
	for t in [GRASS, FLOWERS, SAND, REEDS, PATH, BRIDGE_H, BRIDGE_V, MDECO]:
		_def(t, OPEN, "")
	for t in [MWATER, FOREST, ROCK, GATE, HOUSE, TOWER, WELL, STUMP]:
		_def(t, DEFAULT, "")

static func _def(id: int, flags: int, art: String) -> void:
	FLAGS[id] = flags
	ART[id] = art

static func is_solid(id: int) -> bool:
	return FLAGS[id] & PLAYERTHRU == 0

static func is_water(id: int) -> bool:
	return FLAGS[id] & PLAYERTHRU != 0 and FLAGS[id] & WATER_BIT == 0

static func is_crumble(id: int) -> bool:
	return id >= CRUMBLE and id <= CRUMBLE_LAST
