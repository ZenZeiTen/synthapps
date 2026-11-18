"""The art contract between the pipeline and the game.

Every sprite the game draws is listed here: frame size, origin, source, and its tags in
frame order. The game loads godot/content/sprites/<name>.png (a horizontal strip of
frames) and <name>.json ({"w", "h", "frames", "origin": [ox, oy], "tags": {tag: [from, to]}}).

origin: the offset from an object's hitbox top-left to the frame's top-left. The game draws
a frame at (x - ox, y - oy). For objects without a hitbox (UI, effects) it is (0, 0).

source: "code" = drawn by pipeline/aseprite/art_*.py; "blender" = rendered by
pipeline/blender/*.py, then palette-locked by pipeline/aseprite/import_renders.py.
Both write art/aseprite/<name>.aseprite, and pipeline/aseprite/export_art.py exports every
file listed here. tests/verify_art.py checks sizes, frame counts, tags and the palette.

    python3 pipeline/manifest.py     # also writes pipeline/manifest.json and godot/content/data/manifest.json
"""
from __future__ import annotations

import json
import os

# name: (frame_w, frame_h, (ox, oy), source, [(tag, frame_count), ...])
SPRITES: dict[str, tuple] = {
    # ---- player forms -------------------------------------------------------------
    # hero hitbox 24x40; the sprite is 32x48 with the feet on the bottom row
    "hero": (32, 48, (4, 8), "code", [
        ("stand_r", 1), ("stand_l", 1), ("front", 2), ("look_up", 1), ("squat", 1), ("land", 1),
        ("run_r", 4), ("run_l", 4),
        ("jump_r", 1), ("fall_r", 1), ("jump_l", 1), ("fall_l", 1), ("jump_up", 1), ("fall_down", 1),
        ("climb", 3), ("hurt_r", 1), ("hurt_l", 1), ("ash", 5), ("warp", 4),
        ("takeoff_r", 1), ("takeoff_l", 1), ("apex_r", 1), ("apex_l", 1), ("land_r", 1), ("land_l", 1)]),
    "tiny": (16, 16, (3, 0), "code", [("down", 2), ("up", 2), ("left", 2), ("right", 2)]),   # overworld, hitbox 10x16
    "moth": (32, 32, (4, 4), "code", [("fly_r", 2), ("fly_l", 2), ("hover", 2), ("fall", 1)]),  # hitbox 24x24
    "bell": (32, 32, (1, 1), "blender", [("down", 1), ("up", 1), ("left", 1), ("right", 1), ("still", 1), ("sink", 1)]),  # hitbox 30x30
    # ---- NPC ----------------------------------------------------------------------
    "owl": (40, 48, (3, 2), "code", [("fly", 4), ("perch", 2)]),                     # Sable, hitbox 34x44
    # ---- enemies (hitbox in the comment) -----------------------------------------------
    "burrowhog": (48, 32, (5, 7), "code", [("walk_r", 4), ("walk_l", 4), ("idle_r", 2), ("idle_l", 2), ("hit", 2)]),  # 38x25
    "piptoad": (24, 24, (4, 10), "code", [("sit_r", 1), ("up_r", 1), ("down_r", 1), ("sit_l", 1), ("up_l", 1), ("down_l", 1)]),  # 16x14
    "duskwing": (24, 16, (4, 2), "code", [("fly", 4)]),                              # 16x13
    "newt": (24, 16, (4, 0), "code", [("walk_r", 4), ("walk_l", 4)]),                # 16x16
    "stingmote": (32, 32, (4, 4), "code", [("fly_l", 2), ("fly_r", 2), ("hover", 2)]),  # 24x24
    "loomspider": (48, 32, (4, 8), "code", [("walk_r", 4), ("walk_l", 4)]),          # 40x24
    "cairnbrute": (40, 56, (4, 8), "code", [("walk_r", 4), ("walk_l", 4)]),          # 32x48
    "sentry": (32, 32, (2, 4), "blender", [("walk_r", 4), ("walk_l", 4)]),           # 28x28
    "drone": (24, 24, (4, 2), "blender", [("left", 1), ("hover", 1), ("right", 1),
                                           ("armored_left", 1), ("armored_hover", 1), ("armored_right", 1), ("fall", 1)]),  # 16x20
    "turret": (24, 16, (1, 1), "blender", [("aim", 5), ("glow", 5)]),                # 22x15; aim frame = direction -2..2
    "shade": (32, 32, (1, 1), "code", [("fade_r", 5), ("fade_l", 5)]),               # 30x30; frame = visibility stage 0..4
    "geode": (16, 16, (0, 0), "blender", [("roll", 4)]),                             # 16x16
    "segmenter": (16, 16, (0, 0), "code", [("head_l", 2), ("head_r", 2), ("body", 6), ("tail_l", 1), ("tail_r", 1)]),  # parts
    "slick": (32, 16, (1, 3), "code", [("crawl", 4)]),                               # 30x13
    "slick_leap": (56, 32, (2, 4), "code", [("leap", 4)]),                           # 52x28 while leaping
    "creeper": (24, 32, (4, 3), "code", [("climb", 8)]),                             # 16x29
    "snapjaw": (24, 16, (0, 0), "code", [("rest_r", 1), ("open_r", 1), ("snap_r", 1), ("rest_l", 1), ("open_l", 1), ("snap_l", 1)]),
    "gar": (32, 16, (4, 0), "code", [("swim_l", 4), ("swim_r", 4), ("dead_l", 1), ("dead_r", 1)]),  # 24x16
    "minnow": (16, 8, (0, 0), "code", [("swim_l", 4), ("swim_r", 4)]),              # 16x8
    "eel": (40, 24, (3, 2), "code", [("swim_l", 5), ("swim_r", 5)]),                 # 34x21
    "urchin": (24, 16, (2, 1), "code", [("float", 2)]),                              # 20x15
    "regent": (64, 72, (2, 2), "blender", [("idle", 2), ("cast", 1), ("hurt", 1)]),  # 60x68
    "heartcrystal": (64, 64, (0, 0), "blender", [("whole", 1), ("cracked", 1)]),     # 64x64
    # ---- traps and props ---------------------------------------------------------------
    "masher": (24, 20, (0, 0), "code", [("stage", 3)]),         # drawn from the top; stage 0/1/2 = 4/12/20 px long
    "spear": (8, 20, (1, 0), "code", [("up", 3), ("down", 3)]),
    "spikes": (24, 16, (0, 0), "code", [("up", 4), ("down", 4)]),   # frame = extension 0..3
    "poker": (16, 16, (3, 0), "code", [("rest", 1), ("stab", 1)]),
    "dart": (12, 4, (0, 0), "code", [("left", 1), ("right", 1)]),
    "fire": (16, 32, (0, 0), "code", [("burn", 6), ("drip", 6)]),
    "stalactite": (16, 16, (0, 0), "code", [("hang", 1)]),
    "spring": (32, 16, (0, 0), "code", [("rest", 1), ("mid", 1), ("pressed", 1)]),
    "platform": (32, 8, (2, 0), "code", [("glint", 4)]),        # hitbox 28x4
    "lift": (32, 16, (0, 0), "code", [("car", 1)]),
    "door": (16, 48, (0, 0), "code", [("amber", 1), ("moss", 1), ("rose", 1), ("sky", 1)]),
    "switch": (16, 16, (0, 0), "code", [("up", 1), ("down", 1)]),
    "button": (16, 8, (0, 0), "code", [("up", 1), ("down", 1)]),
    "pad": (16, 16, (0, 0), "code", [("glow", 4)]),
    "crate": (16, 16, (0, 0), "code", [("kind", 4)]),
    "torch": (16, 24, (3, 0), "code", [("burn", 4)]),
    "portal": (32, 48, (8, 8), "code", [("swirl", 4)]),         # stage exit arch, trigger box 16x40
    "signpost": (16, 16, (0, 0), "code", [("post", 1)]),
    # ---- pickups -----------------------------------------------------------------------
    "shard": (16, 12, (0, 0), "code", [("sparkle", 3)]),
    "heart": (16, 16, (0, 0), "code", [("beat", 3)]),
    "berry": (16, 16, (0, 0), "code", [("sunberry", 1), ("plum", 1), ("fig", 1), ("starfruit", 1)]),
    "gem": (16, 16, (2, 1), "code", [("kind", 4)]),              # hitbox 12x14
    "key": (16, 20, (2, 0), "code", [("amber", 4), ("moss", 4), ("rose", 4), ("sky", 4)]),  # hitbox 12x20, 4-frame spin each
    "token": (16, 16, (0, 0), "code", [("gatekey", 1), ("bolt", 1), ("stones", 1), ("boots", 1), ("ward", 1),
                                       ("embers", 1), ("lamp", 1), ("moth", 1)]),
    "sigil": (24, 24, (3, 3), "code", [("root", 1), ("tide", 1), ("ember", 1)]),   # hitbox 18x18
    "rune": (16, 16, (0, 0), "code", [("v", 1), ("a", 1), ("l", 1), ("e", 1)]),
    "note": (16, 16, (0, 0), "code", [("scroll", 1)]),
    # ---- projectiles and effects -------------------------------------------------------
    "bolt": (16, 4, (1, 0), "code", [("normal", 1), ("rapid", 1)]),               # 14x4
    "stone": (16, 16, (0, 0), "code", [("spin", 4)]),
    "ember": (24, 24, (0, 1), "code", [("left", 2), ("right", 2)]),               # 24x22
    "torpedo": (12, 8, (1, 1), "code", [("left", 1), ("right", 1)]),               # 10x5
    "pellet": (8, 4, (0, 0), "code", [("slug", 1), ("orb", 2)]),
    "glassbolt": (24, 16, (3, 1), "code", [("spin", 2)]),                          # boss shot 18x13
    "spark": (16, 16, (1, 1), "code", [("pop", 4)]),
    "flash": (16, 16, (1, 1), "code", [("star", 4), ("ring", 4)]),
    "burst": (32, 32, (0, 0), "code", [("boom", 5)]),
    "frag": (8, 8, (1, 1), "code", [("bits", 5), ("pebble", 1)]),
    "impact": (24, 40, (0, 0), "code", [("hit", 5)]),
    "bubble": (8, 8, (0, 0), "code", [("size", 3)]),
    "dust": (16, 8, (0, 0), "code", [("puff", 3)]),
    "digits": (4, 6, (0, 0), "code", [("n", 10)]),
    # ---- interface -----------------------------------------------------------------
    "hud": (320, 32, (0, 0), "code", [("bar", 1)]),
    "pip": (8, 8, (0, 0), "code", [("full", 1), ("empty", 1)]),
    "keyslot": (10, 12, (0, 0), "code", [("empty", 1), ("amber", 1), ("moss", 1), ("rose", 1), ("sky", 1)]),
    "icon": (12, 12, (0, 0), "code", [("shard", 1), ("sunberry", 1), ("plum", 1), ("fig", 1), ("starfruit", 1),
                                      ("bolt", 1), ("embers", 1), ("stones", 1), ("gatekey", 1), ("boots", 1), ("ward", 1)]),
    "font": (6, 8, (0, 0), "code", [("ascii", 96)]),              # glyphs for chars 32..127, 5x7 in a 6x8 cell
    "panel": (24, 24, (0, 0), "code", [("nine", 1)]),             # 9-slice with 8 px corners
    "cursor": (8, 8, (0, 0), "code", [("blink", 2)]),
    "portrait": (32, 32, (0, 0), "code", [("orrin", 1), ("sable", 1), ("tolly", 1), ("regent", 1)]),
    "glyph": (12, 12, (0, 0), "code", [("a", 1), ("b", 1), ("x", 1), ("y", 1), ("start", 1), ("back", 1),
                                       ("dpad", 1), ("key", 1)]),
    "marker": (16, 16, (0, 0), "code", [("open", 2), ("done", 1), ("locked", 1)]),
    "logo": (256, 64, (0, 0), "code", [("title", 1)]),
    # ---- backdrops (Blender scenes, palette-locked with ordered dither) --------------------
    "bg_moss": (480, 148, (0, 0), "blender", [("far", 1)]),
    "bg_mine": (480, 148, (0, 0), "blender", [("far", 1)]),
    "bg_water": (480, 148, (0, 0), "blender", [("far", 1)]),
    "bg_wood": (480, 148, (0, 0), "blender", [("far", 1)]),
    "bg_ember": (480, 148, (0, 0), "blender", [("far", 1)]),
    "bg_spire": (480, 148, (0, 0), "blender", [("far", 1)]),
    "title": (320, 180, (0, 0), "blender", [("scene", 1)]),
    "dawn": (320, 180, (0, 0), "blender", [("scene", 1)]),      # the ending: the Vale at dawn, the spire gone
}

# Tile sheets: godot/content/tiles/<theme>.png, 256x96 = 16 columns x 6 rows of 16x16.
SIDE_THEMES = ["moss", "mine", "water", "wood", "ember", "spire"]
MAP_THEME = "map"
TILE_COLS, TILE_ROWS = 16, 6

# Slot layout for the side-view themes. Autotile masks: bit 1 = neighbour above is the
# same family, 2 = right, 4 = below, 8 = left. "Same family" for solid means solid;
# for backwall it means backwall or solid.
SIDE_LAYOUT = {
    "solid": (0, 0),          # row 0, columns 0..15 by mask
    "backwall": (1, 0),       # row 1, columns 0..15 by mask
    "ledge_l": (2, 0), "ledge_m": (2, 1), "ledge_r": (2, 2), "ledge_one": (2, 3),
    "vine": (2, 4), "vine_top": (2, 5),
    "crumble": (2, 6),        # 4 stages: columns 6..9 (stage 0 intact .. 3 almost gone)
    "breakable": (2, 10),
    "blink": (2, 11),         # 4 phases: columns 11..14 (0 solid .. 3 faint ghost)
    "bridge": (2, 15),
    "water_top": (3, 0),      # 4 frames: 0..3
    "water": (3, 4),          # 2 frames: 4..5
    "lava_top": (3, 6),       # 4 frames: 6..9
    "lava": (3, 10),          # 2 frames: 10..11
    "spikes": (3, 12), "thorns": (3, 13), "beam": (3, 14), "node": (3, 15),
    "shaft_l": (4, 0), "shaft_r": (4, 1), "dart_r": (4, 2), "dart_l": (4, 3), "node_broken": (4, 4),
    "deco_a": (4, 6),         # 10 passable decorations: columns 6..15
    "solid_var": (5, 0),      # 8 interior variants for fully surrounded solid (mask 15): columns 0..7
    "deco_b": (5, 8),         # 8 more passable decorations: columns 8..15
}

# Overworld (top-down) sheet.
MAP_LAYOUT = {
    "grass": (0, 0),          # 4 variants: 0..3
    "flowers": (0, 4),        # 4 passable decorations: 4..7
    "sand": (0, 8),           # 4 variants: 8..11
    "reeds": (0, 12),         # 4 passable decorations: 12..15
    "path": (1, 0),           # autotile by mask (same family = path, bridge, gate, marker)
    "water": (2, 0),          # autotile (solid), same family = water or bridge
    "forest": (3, 0),         # autotile (solid)
    "rock": (4, 0),           # autotile (solid)
    "gate": (5, 0),           # 4 animation frames: 0..3 (closed gate)
    "bridge_h": (5, 4), "bridge_v": (5, 5),
    "house": (5, 8), "tower": (5, 9), "well": (5, 10), "stump": (5, 11),   # solid decorations
    "deco": (5, 12),          # 4 passable decorations: 12..15
}


def as_json() -> dict:
    out = {"sprites": {}, "side_themes": SIDE_THEMES, "map_theme": MAP_THEME,
           "side_layout": SIDE_LAYOUT, "map_layout": MAP_LAYOUT}
    for name, (w, h, org, src, tags) in SPRITES.items():
        t, i = {}, 0
        for tag, n in tags:
            t[tag] = [i, i + n - 1]
            i += n
        out["sprites"][name] = {"w": w, "h": h, "frames": i, "origin": list(org), "source": src, "tags": t}
    return out


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    # one copy for the pipeline tools, one the game reads (tile layouts, sprite origins)
    for path in (os.path.join(here, "manifest.json"),
                 os.path.join(here, "..", "godot", "content", "data", "manifest.json")):
        with open(path, "w") as f:
            json.dump(as_json(), f, indent=1, sort_keys=True)
    print(f"{len(SPRITES)} sprites")
