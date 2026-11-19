# Tidebell: design

Tidebell is an original side-scrolling sword game. Its rules come from the source
analysed in `ANALYSIS.md`; its world, people, names, story, art, stages and music are
new. This file has four parts:

1. the game in brief;
2. the rules table: every mechanic and control in ANALYSIS, and whether it is kept,
   changed or dropped;
3. the content (heroes, stages, enemies, items, story);
4. the two builds and what each engine and tool does.

## 1. The game in brief

The Saltmarch is a chain of tidal islands. Six bronze bells hang around the Maw, a
whirlpool at its centre, and their ringing keeps the Grey Tide asleep. The Grey Tide is a
silt that turns whatever it touches to salt-stone. The raider captain Ossery Grane has
taken the bells down to sell, and the tide is rising.

Pell, an old hermit crab who keeps a lantern-house, sends a warden to bring the bells
back. The player picks one of three wardens before each stage. There are six stages, and
each one ends with a guardian who holds a bell. On Grane's flagship the captain binds
himself to the tide and becomes the Silt King. The six bells, rung together, drive the
tide back.

## 2. Rules: kept, changed, dropped

Numbers are per frame at 60 frames per second, as in the source. The core keeps
positions and speeds in 16.16 fixed point, as the cartridge does, so both builds compute
the same integers. The IDs in the first column are the ones the code comments use.

### Movement

| ID | source (ANALYSIS) | Tidebell | status |
|---|---|---|---|
| M1 | walk acceleration 0.5625, first frame 0.375 | the same | kept |
| M2 | top walk speed 2.75 | 2.75 for Kess; 3.0 for June; 2.5 for Brannoch (section 3) | changed: the heroes differ |
| M3 | stops on the frame after release; builds from 0 after a turn | the same | kept |
| M4 | jump launch −8.078125, gravity 0.421875, 81 px high | the same full-height arc | kept |
| M5 | the rise starts one frame after the press | the rise starts on the press frame | changed: the player takes one step from press to motion (the Vale of Shards "late jump" report) |
| M6 | fixed height; holding B changes nothing | releasing jump while rising cuts the upward speed to at most −3.0, so a quick tap gives a hop of 10 to 30 px (the check measures it) | changed: short hops over low enemies, and the jump feels less stiff |
| M7 | no jump buffer, no ledge grace | a press up to 6 frames before landing is kept; a jump is allowed up to 5 frames after walking off a ledge | added: the same report |
| M8 | no run | no run | kept |
| M9 | climb trunks and vines with up/down (seen) | climb at 1.5 px/frame; jump off with a sideways push of 2.0 | kept; the speed is Tidebell's own |
| M10 | crouch with Down | the same; crouching lowers the hurt box by 14 px | kept |
| M11 | (none found) | Down + jump on a thin ledge drops through it | added: thin ledges are common in Tidebell's stages |
| M12 | (not measured) | the top of a climbable column can be stood on like a thin ledge | added: climbing ends on the column's top |
| M13 | (not measured) | falling speed is capped at 8.0 px/frame | Tidebell's own |

### Attacks

| ID | source | Tidebell | status |
|---|---|---|---|
| A1 | attack starts on the press frame, 20 frames, rooted | the same (per hero: 20, 16 or 24 frames) | kept |
| A2 | next press accepted from frame 16, no buffer | accepted 4 frames before the end; a press in the last 6 frames is buffered | changed: a buffer, so a chain does not drop a press |
| A3 | three swing poses in turn | a 3-hit chain: cut, cut, spin; the spin deals double damage and knocks back | kept; damage is Tidebell's own |
| A4 | crouch attack, 21 frames | the same; it hits low | kept |
| A5 | jump attack, 13 frames, arc unchanged | the same | kept |
| A6 | special move needs 24 health; input not identified; cost not found | "Tide Cleave": a spin that hits both sides for 4 damage, on its own button; it needs 24 health and costs 12 | changed: a dedicated button replaces the unknown sequence; the cost is Tidebell's own |
| A7 | special allowed only with under 10 objects of two kinds | dropped | dropped: a hardware limit, not a rule |
| A8 | timed state 4 lifts the special's health rule | the Fury Salt item: 20 s of free Tide Cleaves | kept |

### Health, damage and lives

| ID | source | Tidebell | status |
|---|---|---|---|
| H1 | starting and maximum health 71, cap 127 | the same | kept |
| H2 | bar 1 px per point; frame drawn at the maximum | the same | kept |
| H3 | shown value moves 1 per frame toward the real one | the same | kept |
| H4 | a sword raider's hit costs 12 | enemy hits cost 12 on Normal, 8 on Easy, 16 on Hard | kept on Normal; the Easy and Hard values are Tidebell's own |
| H5 | hazard damage by difficulty 15/20/10 | spikes and silt cost 15 on Normal, 10 on Easy, 20 on Hard | kept |
| H6 | knockback ±4 and −4; 100 frames of safety | the same; the hero blinks while safe | kept |
| H7 | pit: 20 damage and back to the last firm ground | the same | kept |
| H8 | death: a life is lost; full health again; the bar refills from 0 | the same; the hero comes back at the last checkpoint post | kept; checkpoints are Tidebell's own (the source's sections do this job) |
| H9 | 3 lives; a pickup adds one; game over flag at 0 | the same; the gull-bone charm adds a life | kept |
| H10 | Continue or End Game after game over | 3 continues; a continue restarts the stage with 3 lives | kept; the count of 3 is Tidebell's own |

### Items

The item box holds the selected item and the item button uses it. Pause opens the item
window. Counts are capped at 9 (the source keeps BCD counts). The items with timers use
the source's four timed states.

| ID | source handler | Tidebell item | effect | status |
|---|---|---|---|---|
| I1 | `$894A` restore to maximum | Tonic | fills health; cannot be used at full health | kept |
| I2 | `$8984` maximum +24 up to 127 | Heartroot | maximum +24 (cap 127) and fills health | kept |
| I3 | `$89D4` thrown weapon | Throwing knives | throws a knife, 6 px/frame, 2 damage | kept |
| I4 | state 1, 900 frames | Gull Feather | 15 s of half gravity | kept (the timing); the effect is Tidebell's own |
| I5 | state 2, 480 frames plus an effect | Squall Charm | hits every enemy on screen for 6 at once, then 8 s of a spinning gust that hurts what it touches | kept (the timing); the effect is Tidebell's own |
| I6 | state 3, 1200 frames | Stoneskin | 20 s with no damage and no knockback | kept (the timing) |
| I7 | state 4, 1200 frames | Fury Salt | 20 s of free Tide Cleaves | kept |
| I8 | a key item | Abbey Key | walking into a locked gate with the key opens it (the key is used up) | changed: no need to select the key first |
| I9 | magic energy, second thrown weapon, special magic | dropped | dropped: fewer items to learn; knives cover throwing |
| I10 | gold coins in chests | chests hold coins (score) or an item | kept |

### Structure, screens and options

| ID | source | Tidebell | status |
|---|---|---|---|
| S1 | ~52 sections in 11 regions | 6 stages, each one long stage with checkpoints, ending in a guardian | changed: shorter, original stages |
| S2 | hub window between stages: advisor, map, hero, start | the Lantern-house: Talk to Pell, Map, Choose Warden, Set Out | kept |
| S3 | three heroes with profile pages | three wardens with profile pages; they differ in speed, reach and swing (section 3) | kept; the differences are Tidebell's own |
| S4 | walking into a friendly character opens a story page | the same, in the same kind of window; the page gives an item where the story says so | kept |
| S5 | bosses talk before the fight | every guardian speaks first; the view holds until the page is closed | kept |
| S6 | stage password between stages | an 8-letter tide-code; Title → Enter Code | kept |
| S7 | difficulty setting 0/1/2 | Easy, Normal, Hard in Options | kept |
| S8 | control choice | 3 button layouts in Options (section 4) | kept |
| S9 | debug level select | dropped | dropped |
| S10 | chests, pickups, pits, climbable trunks, ledges | all kept | kept |
| S11 | score shown in the hub | kept; the best score is saved | kept |
| S12 | closing sequence and staff credits | an ending (bells ring, 4 pages, a dawn scene), credits, then the title | kept |
| S13 | intro pages before the first stage | an opening of 4 pages over the title art | kept |
| S14 | map screen | the Saltmarch map with the six islands; done islands show their bell | kept; the stage order is fixed (the source's was not measured) |

### Controls (every source control)

| source | keyboard | pad | status |
|---|---|---|---|
| D-pad | arrows or WASD | D-pad or left stick | kept |
| A (attack) | X or J | X / Square (west) | kept |
| B (jump) | Z, K or Space | A / Cross (south) | kept |
| C (item) | C or L | B / Circle (east) | kept |
| (pause window: select an item) | Up + item | Up + B / Circle | added: switches to the next item carried without pausing |
| Start (pause, items) | Enter or Esc | Start | kept |
| special (sequence) | V or I | Y / Triangle (north) | replaced: its own button (A6) |
| control choice | Options → Buttons | the same | kept: layout 2 swaps attack and jump, layout 3 puts attack on the south button and jump on the east one |

In menus the jump button and Enter confirm; the item button and Esc go back. In the
Godot build, any key or pad button also works as the confirm on story pages.

Responsiveness (the repo rule: count the steps from a press to visible motion):

| press | first visible change | steps |
|---|---|---|
| walk | the hero moves 0.375 px on the press step, and the walk pose shows | 1 |
| jump | the hero rises on the press step | 1 |
| attack | the swing pose shows on the press step | 1 |
| item | used on the press step | 1 |

### Guards against the bugs players found in the other games

| rule (root CLAUDE.md) | Tidebell |
|---|---|
| buttons carry over | the button that closes a window is swallowed until it is released; story pages ignore buttons for 0.4 s after they open |
| a hold keeps gravity | every talk, guardian meeting and bell scene that starts in the air lets the hero land first |
| text fits with real data | a `fit` harness command checks every window, the hub, the code page and the credits with the longest data |
| play past the win | the last check goes from the Silt King through the ending and credits back to the title |
| tests keep out of the player's files | harness runs use `user://harness/` for options, the best score and the last code |
| narrow gaps from off-line | the route check starts each jump from every horizontal offset the walk can reach (steps of 0.375 px up to 2.75) |

## 3. Content

### Wardens

| warden | weapon | walk | swing | re-press from | reach | damage per cut | look |
|---|---|---|---|---|---|---|---|
| Kess Marrow | cutlass | 2.75 | 20 | 16 | 30 px | 2 | a harbour pilot in a blue coat and a red headscarf |
| June Rook | twin hook-knives | 3.0 | 16 | 12 | 24 px | 1, and each cut hits twice | a small, quick netmender with a green hood |
| Brannoch Tull | boarding anchor | 2.5 | 24 | 20 | 36 px | 3 | a tall bell-founder in a leather apron |

All three jump the same (M4 to M7).

### Stages

Each stage is 14 tiles high (16 px tiles, one screen) unless noted, with checkpoint posts
about every screen and a half.

| # | stage | ground | new thing | guardian |
|---|---|---|---|---|
| 1 | Mangrove Reach | roots and boardwalks over mud | trunks to climb; the first chest; the first captive | Vell the Netter: leaps and throws nets that slow the hero |
| 2 | Lantern Harbor | piers, crates, water gaps | throwers; crates to climb | the Hullbreaker: an armoured crab that charges and rests |
| 3 | Stilt Village | stilt houses and ropes | ropes to climb; high and low routes | the Tallyman: lobs coin bombs in arcs |
| 4 | Gullstone Cliffs | ledges, 2 screens high | climbing, wind gulls | Old Grey: a great gull that swoops |
| 5 | Drowned Abbey | flooded halls | the Abbey Key and a locked gate; wisps | the Bell Warden: vanishes and appears, sends wisps |
| 6 | The Brinecrow | the flagship's decks | all of the above | Captain Grane (duel), then the Silt King |

### Enemies

| enemy | hit points | behaviour | stages |
|---|---|---|---|
| Brinecrow raider | 6 | walks toward the hero on its ledge; cuts when within 28 px (a 12-point hit) | all |
| raider thrower | 4 | keeps 90 px away and lobs a bottle every 90 frames | 2, 3, 6 |
| mudskip | 2 | hops toward the hero | 1, 2 |
| marsh bat | 2 | hangs, then swoops at the hero and rises again | 1, 4 |
| silt crab | 8 | walks side to side; the front is armoured, so only hits from behind or above hurt | 2, 3, 5 |
| wind gull | 3 | flies across the screen in a wave | 4 |
| wisp | 3 | drifts toward the hero through walls | 5 |
| salt golem | 14 | slow; slams the floor, sending a shock along it | 5, 6 |

### Guardians

| guardian | hit points | pattern |
|---|---|---|
| Vell the Netter | 30 | walks, leaps at the hero; throws a net that halves the hero's speed for 2 s |
| the Hullbreaker | 40 | charges wall to wall; after hitting a wall it rests for 1.5 s with its soft belly open, and only then does damage get through |
| the Tallyman | 36 | jumps between three stalls and lobs 3 coin bombs in arcs |
| Old Grey | 40 | circles high and swoops in a dive toward the hero's place; drops feathers |
| the Bell Warden | 44 | disappears and appears at one of four places; fires 3 wisps |
| Captain Grane | 50 | duels: walks in, cuts twice, blocks one hit in three from the front, jumps back |
| the Silt King | 90 | large; slams (a shock along the floor), sends silt waves to jump over, calls 2 raiders at half health |

### Story (text lives in `content/data/text.json`)

| beat | where | check |
|---|---|---|
| opening | 4 pages over the title art before the first hub | `run_all.sh` pages through the opening with the pad and must reach the hub |
| Pell before each stage | the hub's Talk | the fit check draws all six |
| captives | one per stage, as story pages | the stage 1 replay touches the captive |
| guardian meetings | a page before each guardian; Grane's is two pages | the stage replays page through each |
| the Silt King | Grane's change is a scene of 3 pages | the final check |
| ending | the bells ring (a scene), 4 pages, a dawn picture | the final check |
| credits | a scrolling roll, then the title | the final check must reach the title |

## 4. Two builds, and what each tool does

| part | Godot 4.7 build | three.js build |
|---|---|---|
| rules | `godot/scripts/core/` (GDScript) | `web/src/core/` (JavaScript) |
| same rules? | both run the same inputs to the same state; `tests/parity` compares hashes every 30 steps over whole stages | |
| drawing | 2D nodes at 320×224, integer scale | into one 320×224 target: the far backdrop on a plane, the stage's Blender glTF scene as real 3D lit in 3 toon bands, then the 2D layer (tiles, sprites, HUD, windows, drawn on a canvas) on an orthographic quad; a palette pass (48 colours, 4×4 ordered dither), then a nearest upscale at an integer scale |
| input | Godot input map for keys and pads | keyboard events and the browser Gamepad API (standard mapping) |
| deliverable | a Windows exe in a 7z under 30 MiB | a static folder (`web/dist/`) that runs from any web server |

| tool | what it makes |
|---|---|
| Aseprite format | every sprite, tile set, portrait and the font are `.aseprite` files in `art/aseprite/`, written by `pipeline/aseprite/` (this machine has no Aseprite, so the scripts write the format directly); PNG sheets are exported from them |
| Blender (`bpy` 5.0) | the parallax backdrops for the six stages (rendered, then reduced to the palette), and the low-poly backdrop scenes as glTF for three.js; the same scripts run in Blender or through the Blender MCP |
| reality.js | the painted stills: the title art, the Saltmarch map and the dawn of the ending, path-traced from `.real` scenes, then reduced to the palette |
| three.js | the browser build |
| Godot | the desktop build and its checks |

### Palette

Genesis colour: 3 bits per channel (512 colours). Every image, including the reality.js
and Blender renders, is reduced to the game's 48-colour palette, which is made only of
those 512 colours. `tests/verify_art.py` checks that every exported pixel is in the
palette.
