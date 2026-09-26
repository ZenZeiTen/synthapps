# Design: Vale of Shards

Vale of Shards is an original side-scrolling platformer. Its rules come from the Xargon
source (see `ANALYSIS.md`). Its art, names, text, maps and music are new.

## Premise

The Vale is a green valley seeded with living crystal. Orrin is a lamplighter. He wakes to
find that the Glass Regent has drawn the valley's three **sigils** into a spire of glass.
The Regent is a sorcerer who wants to turn every living thing into still, perfect crystal.
Orrin has to:

1. cross the Vale on its overworld path;
2. recover the Sigil of Root, the Sigil of Tide and the Sigil of Ember;
3. climb the Spire and break the Regent.

His guide is **Sable**, an old owl who appears in a few places to talk (the dialog role of
the original's eagle). Shards are the valley's currency, and Tolly, a pedlar, trades for
them in a shop menu.

## One episode

| # | stage | theme | teaches | holds |
|---|---|---|---|---|
| 0 | The Vale (overworld) | map | walking between gates, map keys | — |
| 1 | Mossgate Hollow | moss | run, jump, ledges, vines, boxes, keys and doors, springs | map key |
| 2 | Lantern Mines | mine | crumbling floors, elevators, switches and bridges, breakable walls, rocks, turrets, arrow traps | Sigil of Root, map key |
| 3 | Sunken Aqueduct | water | the diving bell, swimming, torpedoes, fish, urchin mines | Sigil of Tide |
| 4 | Thornwood Canopy | wood | moth form, blinking blocks, climbers, platforms | map key |
| 5 | Ember Foundry | ember | lava, fire drips, mashers, spears, sentries, fireballs | Sigil of Ember |
| 6 | The Glass Spire | spire | the Regent (boss) | the ending |

The Spire gate on the map opens only with all three sigils. This is the original's
"can't leave without the power object" checkpoint rule, moved to the map gate.

## Mechanics: kept, adapted, dropped

Every mechanic and control in `ANALYSIS.md` has a row here.

| # | source mechanic | decision | how the remake does it |
|---|---|---|---|
| 1 | 18.2 steps/s logic, every per-step number | kept | fixed 18.2 Hz step (`core/tick.gd` `STEP_HZ`); drawing is interpolated at the display rate, so motion is smooth but the rules are unchanged |
| 2 | granny mode (half speed) | adapted | "Relaxed speed" option: 9.1 steps/s |
| 3 | 128×64 board, 16 px cells | kept | levels up to 128×64 |
| 4 | tile flags: solid default, passable, one-way ledge, vine, water, touch/update handlers | kept | `core/tiles.gd` |
| 5 | `cando` / `splity` one-way rule | kept | `core/world.gd` `cando` |
| 6 | `trymove`, `trymovey`, `justmove`, `crawl`, `standfloor`, `fishdo`, `moveobj` clamps | kept | same names |
| 7 | run: turn step, 8 px/step, 4-step reverse, 2-step stop | kept | `core/player.gd` |
| 8 | fall off edge (0-step hang from the dupe code) | kept | |
| 9 | jump `-(16+4·boots)`, 2-step launch hang, gravity 2 to 16, air control 8 px from the current stick, snap landing, head bump | kept | rise 56 px, 90 px with boots |
| 10 | landing recovery (-4 / -7) and dust | kept | |
| 11 | vine grab in air and from ground; climb rhythm 4,0,0,6,4,4; hop off (`yd -4` / `-16`) | kept | |
| 12 | look up / down, squat, camera peek | kept | |
| 13 | squatting shrinks the touch box by 18 px | kept | |
| 14 | fire priority fireball > rock > bolt; on-screen caps; error blip | kept | |
| 15 | bolt: accelerates, steered by up/down, spark on walls | kept | |
| 16 | rock: gravity, homing within 96 px, bounce, 64-step life, wall smash | kept | |
| 17 | fireball: consumed; kills `fb` enemies; flies through breakable walls | kept | |
| 18 | health 5; `hitplayer` 1 damage + per-attacker 3-step hold | kept | |
| 19 | shield −1 damage for 310 steps | kept | |
| 20 | instant death from lava, acid, spike floors, deep water without the bell | kept | the remake has lava and spike floors (no acid) |
| 21 | death: 19-step animation, checkpoint respawn, inventory rollback | kept + one addition | lantern posts (new) mark a mid-stage respawn point; the world is not rolled back (as for checkpoints without the restart flag) |
| 22 | tiny overworld hero, 4 px steps | kept | |
| 23 | diving craft (torpedo pair, water-only movement) | kept | the **Bell**, a brass diving bell. The bell cannot leave the water, so the lamp token that ends the form carries a "dock" cell where Orrin is set on dry land (adapted). Form tokens re-arm when Orrin respawns, so a death never strands him |
| 24 | bee form | kept | the **Moth** |
| 25 | return-to-human token | kept | the **Lamp** token |
| 26 | inventory as a list, 29 max | kept | |
| 27 | map keys, coloured keys (4), lasers, fireballs, rocks, boots, shield | kept | renamed: gate key, amber/moss/rose/sky keys, lamp bolts, ember charges, stones, spring boots, ward |
| 28 | hearts, emeralds (99), 4 fruits with 16 fruit = +1 health, score gems | kept | hearts, shards, four berries, gems |
| 29 | bonus balls in order for 4000 | kept | four rune stones, V-A-L-E in order |
| 30 | journal notes | kept | Orrin's notes and Sable's letters, all original text |
| 31 | hidden boxes, falling boxes, drop table | kept | crates |
| 32 | shop items and prices; human-form limit; not on the map | kept | Tolly's pack, same prices |
| 33 | trigger channels, trigger / on / off, pad states and zaphold | kept | `core/triggers` in `game.gd` |
| 34 | bridger, door (keyed and map gate), add-step, platform toggle, box, token, poker, stalactite, turret, NPC, transport | kept | the owl NPC is Sable |
| 35 | timer pads: periodic trigger, fire drip, spawner, delayed bonus | kept | |
| 36 | platform ride, jump-off, drop-through, head-room check | kept | |
| 37 | elevator on a shaft | kept | lift cage |
| 38 | spring with cycling power | kept | |
| 39 | crumbling floor (12 stages, every 4th step) | kept | |
| 40 | blinking block cycle | adapted | same 16-phase, 128-step cycle and standable phases; it restarts with each stage (the source ran it off the global step count), so a stage plays the same however long the map walk took |
| 41 | breakable walls (+10), shootable eyes (+100) | kept | eyes become crystal nodes |
| 42 | arrow traps | kept | dart traps |
| 43 | enemy behaviours | kept for the kinds listed below | new looks and names; the numbers are from the source |
| 44 | reactor finale (40 hits) | adapted | the Spire's heart crystal, destroyed after the Regent falls, ends the game |
| 45 | final boss: hover, range turning, skulls, 50 hits | kept | the Glass Regent throws glass shards |
| 46 | checkpoints: level number, next board, song, restart-on-death, map-key and power-object guards, end of game | kept | |
| 47 | overworld: stage played once, map snapshot, gates need keys | kept | |
| 48 | level intro card 2–4 s | kept | |
| 49 | save only on the map, 7 named slots | adapted | 7 slots, saved from the map. The map also autosaves a "continue" slot each time Orrin returns, because modern players expect that |
| 50 | high scores (10) | kept | |
| 51 | demo playback from macros, attract mode after idle | kept | macros made by the route checker (`tests/route.gd`) play in attract mode. The same macros are the proof that every stage can be finished |
| 52 | camera window (116 / 140 px, 8 px/step) and vertical band | kept | |
| 53 | status bar | adapted | a 320×32 bar holding the same fields |
| 54 | message line (100 steps, then the title) | kept | |
| 55 | palette cycling (lava, water, machines) | adapted | animated tiles |
| 56 | hero tints (hurt red, healed or shielded blue, 1-health flash, boots) | kept | shader-free: sprite modulate |
| 57 | per-level skies and lightning | adapted | Blender-rendered parallax backdrops per theme; lightning is kept for the Spire |
| 58 | idle fidget line | kept | original lines |
| 59 | first-time tips | kept | original text |
| 60 | keyboard: arrows, keypad, Shift/Space fire, Alt/Ctrl jump | kept | also Z/X, J/K, and WASD |
| 61 | joystick with two buttons | adapted | **full gamepad support** through Godot's joypad API (SDL mappings): D-pad and left stick move; A/Cross jumps; X/Square and B/Circle fire; Y/Triangle opens the inventory; Start opens the game menu; Back/Select opens the shop. Every menu works with the pad, and hot-plugging is handled. On-screen button prompts switch between keyboard and pad glyphs |
| 62 | command keys F1, S, L, P, B, Enter, G, N, Esc/Q | adapted | the same functions from the game menu and the pad; keys F1, P, B, I (inventory), Esc |
| 63 | F7 cheat | dropped | not part of play |
| 64 | edge-triggered fire buttons | kept | |
| 65 | level editor (design mode), memory checks, sound card set-up, joystick calibration, ordering info, Epic-specific fidget lines | dropped | none of these apply to a modern build. Calibration is replaced by a stick dead zone |

### Enemy cast

Behaviour numbers come from the source function named in brackets.

| remake | behaviour | stages |
|---|---|---|
| Burrowhog | grunt | 1, 2 |
| Pip-toad | hopper | 1, 4 |
| Duskwing | bat | 1, 2 |
| Spitter newt | lizard | 2, 4 |
| Stingmote | bee | 4 |
| Loom spider | spider | 4 |
| Cairn brute | troll | 2, 5 |
| Clockwork sentry | robot | 5 |
| Glass drone | xargbot | 5, 6 |
| Prism turret | turret | 2, 5, 6 |
| Hollow shade | ghoul | 6 |
| Rolling geode | boulder | 2 |
| Segmenter | centipede | 4 |
| Mire slick | blob | 3 |
| Vine creeper | climber | 4 |
| Snapjaw | biter | 2, 5 |
| Gar | badfish | 3 |
| Ember minnow | redfish | 3 |
| Ribbon eel | eel | 3 |
| Urchin mine | mine | 3 |
| traps: masher, spear, floor spikes, poker, dart trap, fire drip, stalactite | traps | 2–6 |
| the Glass Regent | xargon | 6 |

## Screen and controls

- **Screen:** a 320×180 internal canvas, scaled by whole numbers (×4 at 1280×720, ×6 at
  1080p). The play view is 320×148, about 20 × 9 cells. The status bar is 32 px.
- **Controls:**

  | action | keyboard | gamepad |
  |---|---|---|
  | move / climb / look | arrows, WASD | D-pad, left stick |
  | jump (Fire2) | Alt, Ctrl, Z, K | A (south) |
  | fire (Fire1) | Shift, Space, X, J | X (west) or B (east) |
  | inventory | I, Enter | Y (north) |
  | shop | B | Back / Select |
  | pause / menu | Esc, P | Start |

  Menus take arrows or D-pad or stick, confirm with Enter, Space, Z or A, and go back with
  Esc, X or B.
