## Object kinds, flags, player states and inventory ids. Pure data.
##
## Sizes, flags and scores follow INCLUDE/X_OBJ.DEF; each kind names the source object whose
## behaviour it ports. Kinds marked "new" have no source counterpart.
extends RefCounted

# object flags (INCLUDE/XARGON.H)
const F_MSGTOUCH := 8
const F_INSIDE := 64
const F_FRONT := 128
const F_TRIGGER := 256
const F_BACK := 512
const F_ALWAYS := 1024
const F_KILLABLE := 2048
const F_FIREBALL := 4096
const F_WEAPON := 16384

# kinds
enum {
	PLAYER, KILLME, BELL, MOTH, URCHIN, TINY, BRIDGER, DOOR, ADDSTEP, PAD,
	SPRING, DART, MASHER, PLATFORM, CHECKPT, LIFT, KEY, HEART, SHARD, OWL,
	BURROWHOG, CRATE, SCORE, TOKEN, SWITCH, BUTTON, POKER, PELLET, BONUS, STONE,
	EMBER, BOLT, TORPEDO, FRAG, BURST, FLASH, SPARK, SPEAR, STALACTITE, GEODE,
	FIRE, TORCH, SNAPJAW, SEGMENTER, SEGBIT, CAIRNBRUTE, SLICK, IMPACT, NEWT, SPIKES,
	DRONE, TRANSPORT, TRANSPAD, EFFECTS, SHADE, BUBBLE, EEL, GAR, DUSKWING, PIPTOAD,
	SIGNPOST, HEARTCRYSTAL, TIMERPAD, TURRET, STINGMOTE, CREEPER, LOOMSPIDER, GLASSBOLT, MINNOW, SIGIL,
	REGENT, SENTRY, FLAG, GATE, KIND_COUNT
}

# name, source object, xl, yl, flags, score
const KINDS := [
	["player", "player", 24, 40, F_MSGTOUCH, 0],
	["killme", "killme", 0, 0, 0, 0],
	["bell", "heroswim", 30, 30, F_MSGTOUCH, 0],
	["moth", "herobee", 24, 24, F_MSGTOUCH, 0],
	["urchin", "mine", 20, 15, 0, 0],
	["tiny", "tiny", 10, 16, F_MSGTOUCH, 0],
	["bridger", "bridger", 0, 0, F_TRIGGER, 0],
	["door", "door", 6, 8, F_TRIGGER, 0],
	["addstep", "addstep", 16, 16, F_TRIGGER, 0],
	["pad", "pad", 16, 16, 0, 0],
	["spring", "spring", 32, 16, 0, 0],
	["dart", "arrow", 12, 3, 0, 0],
	["masher", "masher", 24, 4, 0, 0],
	["platform", "platform", 28, 4, F_TRIGGER | F_ALWAYS, 0],
	["checkpt", "checkpt", 16, 16, F_INSIDE, 0],
	["lift", "elev", 32, 16, F_TRIGGER | F_FRONT, 0],
	["key", "key", 12, 20, 0, 0],
	["heart", "heart", 16, 16, 0, 100],
	["shard", "emerald", 16, 12, 0, 100],
	["owl", "eagle", 34, 44, F_TRIGGER, 0],
	["burrowhog", "grunt", 38, 25, F_FIREBALL, 400],
	["crate", "box", 16, 16, F_TRIGGER, 0],
	["score", "score", 8, 8, F_FRONT, 0],
	["token", "token", 16, 16, F_TRIGGER, 0],
	["switch", "switch", 16, 16, F_BACK, 0],
	["button", "button", 16, 8, 0, 0],
	["poker", "poker", 10, 16, F_TRIGGER, 0],
	["pellet", "bullet", 8, 3, 0, 0],
	["bonus", "bonus", 16, 16, 0, 0],
	["stone", "rock", 16, 16, F_WEAPON | F_MSGTOUCH, 0],
	["ember", "fireball", 24, 22, F_WEAPON | F_MSGTOUCH, 0],
	["bolt", "laser", 14, 4, F_WEAPON | F_MSGTOUCH, 0],
	["torpedo", "torpedo", 10, 5, F_WEAPON | F_MSGTOUCH, 0],
	["frag", "fragexpl", 6, 6, F_FRONT, 0],
	["burst", "fireexpl", 32, 32, F_FRONT, 0],
	["flash", "flash", 18, 23, F_FRONT, 0],
	["spark", "hitwall", 14, 14, F_FRONT, 0],
	["spear", "spear", 6, 4, 0, 0],
	["stalactite", "stalag", 16, 16, F_BACK | F_TRIGGER, 0],
	["geode", "boulder", 16, 16, F_FIREBALL, 200],
	["fire", "fire", 16, 32, F_FRONT, 0],
	["torch", "torch", 10, 24, F_BACK, 0],
	["snapjaw", "biter", 10, 16, 0, 0],
	["segmenter", "centipede", 76, 22, F_FIREBALL, 500],
	["segbit", "centexpl", 8, 17, 0, 20],
	["cairnbrute", "troll", 32, 48, F_FIREBALL, 400],
	["slick", "blob", 30, 13, 0, 0],
	["impact", "hithero", 24, 35, F_FRONT, 0],
	["newt", "lizard", 16, 16, F_KILLABLE, 114],
	["spikes", "spikes", 24, 16, 0, 0],
	["drone", "xargbot", 16, 20, 0, 65],
	["transport", "transport", 16, 16, F_TRIGGER, 0],
	["transpad", "transpad", 16, 16, 0, 0],
	["effects", "effects", 0, 0, F_ALWAYS, 0],
	["shade", "ghoul", 30, 30, 0, 2000],
	["bubble", "bubble", 8, 8, 0, 0],
	["eel", "eel", 34, 21, F_KILLABLE, 60],
	["gar", "badfish", 24, 16, 0, 140],
	["duskwing", "bat", 16, 13, F_KILLABLE, 140],
	["piptoad", "hopper", 16, 14, F_KILLABLE, 145],
	["signpost", "txtmsg", 16, 16, 0, 0],
	["heartcrystal", "front (reactor)", 64, 64, 0, 20000],
	["timerpad", "timerpad", 24, 10, 0, 0],
	["turret", "turret", 22, 15, F_TRIGGER, 0],
	["stingmote", "bee", 24, 24, F_KILLABLE, 125],
	["creeper", "climber", 16, 29, 0, 0],
	["loomspider", "spider", 40, 24, F_FIREBALL, 150],
	["glassbolt", "skull", 18, 13, F_KILLABLE, 10],
	["minnow", "redfish", 16, 8, F_KILLABLE, 110],
	["sigil", "icons", 18, 18, 0, 500],
	["regent", "xargon", 60, 68, 0, 30000],
	["sentry", "robot", 28, 28, F_FIREBALL, 600],
	["flag", "new: mid-stage checkpoint", 16, 40, 0, 0],
	["gate", "new: overworld gate (the source uses pad + door)", 16, 16, 0, 0],
]

# player states (INCLUDE/XARGON.H)
const ST_STAND := 0
const ST_STILL := 1
const ST_JUMPING := 2
const ST_CLIMBING := 3
const ST_BEGIN := 4
const ST_DIE := 5
const ST_TRANSPORT := 6
const ST_PLATFORM := 7
const STI_CANFIRE := 1
const STI_INVINCIBLE := 2
# X_INFO.C init_info
const STATEINFO := [STI_CANFIRE, STI_INVINCIBLE, STI_CANFIRE, 0, STI_INVINCIBLE, STI_INVINCIBLE, STI_INVINCIBLE, STI_CANFIRE]

const DIE_ASH := 0
const DIE_MOTH := 1
const DIE_BELL := 2

# messages
const MSG_TRIGGER := 3
const MSG_TRIGOFF := 4
const MSG_TRIGON := 5

# inventory (INCLUDE/XARGON.H inv_*)
const INV_LAMP := 0       # return to human form
const INV_GATEKEY := 1
const INV_RUNE := 2       # V-A-L-E progress
const INV_EMBER := 3
const INV_BOLT := 4
const INV_MOTH := 5
const INV_BELL := 6
const INV_STONES := 7
const INV_BOOTS := 8
const INV_WARD := 9
const INV_SIGIL1 := 10
const INV_SIGIL2 := 11
const INV_SIGIL3 := 12
const INV_KEY0 := 13
const INV_COUNT := 17
const INV_XFM := [1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
const INV_NAMES := ["lamp", "gatekey", "rune", "embers", "bolt", "moth", "bell", "stones", "boots", "ward",
	"sigil_root", "sigil_tide", "sigil_ember", "key_amber", "key_moss", "key_rose", "key_sky"]
const KEY_COLORS := ["amber", "moss", "rose", "sky"]

static func kind_id(name: String) -> int:
	for i in KINDS.size():
		if KINDS[i][0] == name:
			return i
	return -1
