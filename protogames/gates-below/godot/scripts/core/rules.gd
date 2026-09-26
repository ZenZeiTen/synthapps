## Formulas of the original game (see docs/ANALYSIS.md), kept as pure functions so the
## tests can check them against hand-computed values.
extends RefCounted

## The 24 stat slots of the original (VLS_*), same order.
const STATS := ["str", "mag", "mob", "dex", "hp_max", "st_max", "mp_max", "def_l", "def_h", "atk_l", "atk_h",
	"r_fire", "r_water", "r_earth", "r_air", "r_mind", "hp_reg", "mp_reg", "st_reg", "mag_l", "mag_h", "mag_el", "dmg", "fx"]
const ELEMENTS := ["fire", "water", "earth", "air", "mind"]
const RESIST := ["r_fire", "r_water", "r_earth", "r_air", "r_mind"]
## vls_min / vls_max clamps (INV.C:790-793).
const CLAMP_MAX := {"str": 200, "mag": 200, "mob": 200, "dex": 200, "atk_l": 190, "atk_h": 190, "def_l": 199, "def_h": 199,
	"r_fire": 99, "r_water": 99, "r_earth": 99, "r_air": 99, "r_mind": 99, "hp_reg": 90, "mp_reg": 90, "st_reg": 90}
## XP needed for levels 2..40 (level_map, SOUBOJE.C:59).
const LEVEL_XP := [400, 1000, 1800, 2800, 5000, 8400, 13000, 20000, 30000, 45000, 70000, 110000, 180000, 300000,
	500000, 800000, 1300000, 2000000, 3000000, 4500000, 6500000, 10000000, 11000000, 13000000, 16000000, 20000000,
	25000000, 32000000, 40000000, 50000000, 60000000, 70000000, 80000000, 90000000, 100000000, 110000000,
	120000000, 130000000, 140000000]
const MAX_LEVEL := 40
## Weapon-skill thresholds: 20, 40, 80, ... hits (SOUBOJE.C:104-117); level 9 is the cap.
const SKILL_MAX := 9
const HOUR := 360          # game ticks per hour (HODINA)
const MAX_SLEEP := 4320    # 12 h sleep budget (MAX_SLEEP)


static func blank_stats() -> Dictionary:
	var d := {}
	for s in STATS:
		d[s] = 0
	return d


## Action points: get_ap (GLOBALS.H:285). Mobility 1..14 still gives one action.
static func ap(mob: int) -> int:
	if mob > 0 and mob < 15:
		return 1
	return maxi(mob / 15, 0)


## Resistances combine with diminishing returns (INV.C:846).
static func stack_resist(a: int, b: int) -> int:
	return int(round(float(a + b) / (1.0 + float(a * b) / 8100.0)))


## Base stats of a freshly made character (generuj_postavu, CHARGEN.C:616-646), with the
## regeneration values this remake chooses (the original read them from data).
static func creation_stats(strv: int, magv: int, mobv: int, dexv: int) -> Dictionary:
	var s := blank_stats()
	s["str"] = strv
	s["mag"] = magv
	s["mob"] = mobv
	s["dex"] = dexv
	s["hp_max"] = (3 * strv + mobv) / 2
	s["mp_max"] = 2 * magv
	s["st_max"] = 2 * dexv
	s["atk_l"] = 1
	s["atk_h"] = 2
	s["def_l"] = 1
	s["def_h"] = 2
	s["hp_reg"] = strv / 4
	s["mp_reg"] = magv / 3 + 2
	s["st_reg"] = dexv / 3 + 2
	return s


## Current stats = base + every worn item's mods + timed spell changes (prepocitat_postavu).
static func derive(base: Dictionary, mod_list: Array) -> Dictionary:
	var s := base.duplicate()
	for mods in mod_list:
		for k in mods:
			if k == "fx":
				continue
			if k in RESIST:
				s[k] = stack_resist(int(s[k]), int(mods[k]))
			elif k == "mag_el":
				s[k] = int(mods[k])
			else:
				s[k] = int(s.get(k, 0)) + int(mods[k])
	for k in CLAMP_MAX:
		s[k] = clampi(int(s[k]), -100 if k in RESIST else 0, CLAMP_MAX[k])
	return s


## The hit formula, standard mode (vypocet_zasahu, SOUBOJE.C:375-405).
## a = attacker stats, d = defender stats. crowd = defenders standing on the target
## square (monsters 1-2; the party counts its living members). Returns a Dictionary with
## the rolls so a test can check every step.
static func hit(rng, a: Dictionary, d: Dictionary, crowd: int, skill: int, d_fx: Array, bonus: int = 0) -> Dictionary:
	var chaos := (crowd + 1) / 2
	if chaos < 1:
		chaos = 1
	var ospod: int = int(d["def_l"]) / chaos
	var x: int = rng.rnd(int(a["atk_h"]) - int(a["atk_l"]) + 1)
	var y: int = rng.rnd(int(d["def_h"]) - ospod + 1)
	var z: int = rng.rnd(int(a["mag_h"]) - int(a["mag_l"]) + 1)
	var attack: int = int(a["atk_l"]) + x + (int(a["str"]) * 15 + int(a["dex"]) * 10) / 150 + bonus
	var defence: int = ospod + y + int(d["dex"]) / 5 + (10 if "invisible" in d_fx else 0)
	var magic: int = int(a["mag_l"]) + z
	var resist: int = int(d[RESIST[clampi(int(a["mag_el"]), 0, 4)]])
	magic = magic * (100 - resist) / 100
	var phys := attack - defence
	if phys < 0:
		phys = 0
	if phys > 0:
		phys = maxi(phys + int(a["dmg"]), 1)
	var total := phys + magic
	if total > 0:
		total = maxi(total + skill, 1)
	if "sanctuary" in d_fx:
		total /= 2
	return {"attack": attack, "defence": defence, "phys": phys, "magic": magic, "total": total}


## Casting risk (cast, KOUZLA.C:1629-1727). Returns "safe", "impossible", "success",
## "fizzle" or "backfire", plus whether Magic rises permanently.
static func cast_outcome(rng, magic: int, need: int, has_backfire: bool) -> Dictionary:
	if magic >= need:
		return {"result": "safe", "learn": false}
	if magic < need / 2:
		return {"result": "impossible", "learn": false}
	var per1: int = (magic - need / 2) * 128 / maxi(need, 1)
	var per2: int = rng.rnd(64)
	if per1 / 2 + 32 < per2 and has_backfire:
		return {"result": "backfire", "learn": false}
	if per1 < per2:
		return {"result": "fizzle", "learn": false}
	var learn: bool = (64 - per1) / 2 > rng.rnd(64)
	return {"result": "success", "learn": learn}


## Monster flee test (akce_moba_zac, ENEMY.C:1888). taken = damage taken so far.
static func wants_to_flee(rng, flee: int, hp: int, hp_max: int, taken: int, on_square: int) -> bool:
	if flee <= 0:
		return false
	if flee >= 100:
		return true
	var dper: int = taken * 100 / maxi(hp + taken, 1) + rng.rnd(flee)
	var corlives: int = hp_max - flee * (hp_max - hp) / 100
	var perlives: int = (100 - flee) * corlives * on_square / maxi(hp_max, 1) + rng.rnd(flee)
	return dper > perlives


## Encumbrance penalty added to stamina costs (INV.C:2015-2039).
static func weight_defect(weight_tenths: int, strv: int) -> int:
	# weight_tenths: total weight x10 (pack items count 1.5x)
	return maxi(0, (weight_tenths / 10 - 20 * strv) / 200)


static func xp_for_next(level: int) -> int:
	if level >= MAX_LEVEL:
		return -1
	return LEVEL_XP[level - 1]


static func skill_threshold(skill_level: int) -> int:
	return 20 << skill_level


## Food and water capacity in game ticks (MAX_HLAD, MAX_ZIZEN; GLOBALS.H:278-279).
static func food_max(hp_max: int) -> int:
	return (hp_max / 2 + 48) * HOUR


static func water_max(hp_max: int) -> int:
	return (hp_max / 3 + 24) * HOUR


## Positional volume from Manhattan distance (SNDandMUS.C:172): 0..1.
static func sound_volume(d: int) -> float:
	return clampf((32000.0 - 64000.0 * d / (8.0 + d)) / 32000.0, 0.0, 1.0)
