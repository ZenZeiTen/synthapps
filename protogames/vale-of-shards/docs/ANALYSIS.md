# Source analysis

This file describes how the 1993–95 Xargon C source (Allen W. Pilgrim, Epic MegaGames)
works. The remake follows these rules. Every number here was read from the code, and each
section names the file and function it comes from. The upload holds source and object
files only. It has no graphics, maps, sound banks or text banks, so nothing here describes
the original's content beyond what the code itself says.

Paths are relative to the archive: `SOURCE/`, `INCLUDE/`.

## 1. Frame loop and timing

`XARGON.C play()` runs one game step per loop:

1. load a pending level (`newlevel`);
2. read input (`GAMECTRL.C checkctrl`);
3. handle command keys;
4. `upd_bkgnd` (animated tiles), `upd_objs(1)` (update and touch), message timer;
5. `refresh` (draw), `purgeobjs` (remove killed objects);
6. busy-wait until the BIOS tick counter has advanced `granny+1` ticks.

`myclock` points at the BIOS tick word at `0040:006C` (`MUSIC.C`). That word advances at
18.2 Hz unless something reprograms the timer. The PC-speaker path divides the PIT by
`clockrate=64`, and the music library installs its own `int 8` handler (`worxint8`). Its
source is not in the archive (only `TCWORXL.LIB`).

**Inference:** one step per BIOS tick, so about 18.2 steps per second. "Granny mode" (the
`G` key) halves the speed, to one step per two ticks. The remake keeps every per-step
number and runs the logic at a fixed 18.2 Hz. Drawing is interpolated between steps.

## 2. Board and tile flags

- The board is 128 × 64 cells of 16 × 16 px (`XARGON.H boardxs/boardys`). The low 14 bits
  of a cell are a tile number (0–899); the top bits are redraw flags.
- The view is 320 × 158 px (`XARGON.C init_win`), about 20 × 10 cells, with a 320 × 28
  status bar and a one-line message strip below it.
- Every tile starts as `f_notvine | f_notstair | f_notwater` (`X_INFO.C init_info`). A
  per-tile mask from the tile file is then XORed in. So:
  - **solid** is the default: `f_playerthru` is not set;
  - **passable** tiles have `f_playerthru`;
  - **one-way ledges ("stairs")** are passable *and* lack `f_notstair`: you can stand on
    them and jump up through them;
  - **vines** lack `f_notvine`;
  - **water** lacks `f_notwater` (bit value 16384; the same bit means `f_weapon` for objects).
- Flags for special behaviour: `f_msgtouch` (a touch handler), `f_msgdraw` (custom draw),
  `f_msgupdate` (animates every step).

### Collision: `X_OBJMAN.C cando`

`cando(n, x, y, flags)` ANDs the flags of every cell that the box `(x, y, xl, yl)` covers
and returns the result. Callers ask for `f_playerthru` (can the object be there) and, when
moving down, also `f_notstair`. The one-way rule is in `splity`, the first row at or below
the object's current feet: `(y + kind_height + 15) / 16`.

- Rows above `splity` get `f_notstair` ORed in, so a ledge the object already overlaps
  never blocks it.
- Rows at or below `splity` keep their real flag, so a ledge blocks only downward entry
  from above.

| helper | what it does |
|---|---|
| `trymove` | moves diagonally, else Y only, else X only (returns 1, 2, 4 or 0). Moving down includes `f_notstair` |
| `trymovey` | moves diagonally, else Y only. Always includes `f_notstair`. Zeroes `xd` on failure |
| `justmove` | plain `f_playerthru` test (fliers, projectiles) |
| `crawl` | walkers: moves only if the new spot is standing on something (`standfloor`: feet exactly on a cell edge and no cell below is fully open) |
| `fishdo` | the target must be both passable and water (`objdo`, with no stair handling) |
| `moveobj` | clamps to the board with a one-cell margin on the right and bottom |

## 3. The player (`X_PLAYER.C msg_player`)

The hitbox is 24 × 40 px (`X_OBJ.DEF`). The object record holds `x, y, xd, yd`, `state`,
`substate`, `statecount`, `counter` (landing dust), and `info1` (last facing, ±1).

| state | invincible | can fire | notes |
|---|---|---|---|
| `st_stand` | no | yes | standing and running |
| `st_still` | yes | no | frozen during boss death |
| `st_jumping` | no | yes | jumping or falling |
| `st_climbing` | no | no | on a vine |
| `st_begin` | yes | no | entering a level, 40 steps |
| `st_die` | yes | no | 19 steps, then respawn |
| `st_transport` | yes | no | using a door, 15 steps |
| `st_platform` | no | yes | riding a platform |

(Invincibility and firing flags: `X_INFO.C`.)

### Running

- **First press** from rest: the step only turns the player (`substate=7`, `xd=dx`). It
  does not move.
- **While held:** each step moves 8 px if `cando` allows. The run cycle
  `substate=(substate+1)&7` advances even against a wall.
- **Reversing direction** stops for 4 steps first (`xd=0`, `statecount=4`).
- **Releasing** stops after 2 steps.

So a full-speed run is 8 px per step: about 146 px/s, or 9 cells a second.

### Falling off an edge

When the cell below the feet is open and not a ledge, the state becomes `st_jumping` with
`yd=0`. The duplicated test at the end of the stand case leaves `substate=0`.

### Jumping (`st_jumping`)

- Fire2 (Alt/Ctrl, or joystick button 2) jumps: `yd = -(16 + 4 × boots)`, `substate=0`,
  and the sideways direction is kept from the stick.
- The jump state increments `substate` each step. **Movement happens only once
  `substate > 2`.** A jump from the ground therefore hangs 2 steps before rising. After
  that, each step:
  - `yd += 2`, capped at 16;
  - if the stick is sideways, `xd = dx` and `substate` resets to 2, which keeps air
    control alive;
  - once `substate > 8`, `xd = 0`;
  - `trymovey(x + dx*8, y + yd)`. Sideways speed in the air is also 8 px from the
    *current* stick.
- **Rise:** 14+12+10+8+6+4+2 = **56 px** (3.5 cells) without boots. Boots add 4 to the
  launch speed per pair: **90 px** with one pair (18+16+…+2).
- **Landing:** when the downward move fails, the player snaps to the cell edge if the
  feet are not already on one. The state becomes `st_stand` and `statecount` is set to
  -4, or -7 after a full-speed fall. Holding a direction adds 1. `counter=6` shows dust.
- **Head bump:** moving up fails, the player snaps up to the cell edge, then `yd=0`.
- **Vine grab:** in the air, with `x % 16 == 0` and a vine at both `x` and `x-8`, the
  state becomes `st_climbing`.

### Climbing (`st_climbing`)

- **Up:** moves by `climby[substate]` = 4,0,0,6,4,4,… px per step, so the climb has a
  rhythm. **Down:** 4 px per step.
- Off the vine the player is standing again.
- **Sideways** leaves the vine with an 8 px hop: `yd=-4`, or `yd=-16` if Fire2 is held.
- **Grabbing from the ground:** pressing up or down at `x % 16 == 0`, with a vine
  4 px in that direction, starts climbing.

### Looking up and down

- Standing still with up or down held moves `yd` toward ±3 by 2 per step. The camera peeks
  2 px per step.
- `yd==3` draws a squat. In the touch pass, a squatting player only counts as touching
  things below its top 18 px (`upd_objs`).

### Firing (Fire1: Shift, joystick button 1, or Space)

- The weapon priority is fireball, then rock, then laser (the bolt).
- **Lasers:** the number of bolts on screen is capped by the number of laser upgrades held
  (1 at the start, 5 at most). A bolt:
  - spawns at `(x+4 or x+8, y+18)` with `xd = ±6`;
  - speeds up by 1 px every step;
  - is steered 2 px per step by up and down while it flies;
  - dies on any wall, leaving a spark.
- **Rocks:** only as many on screen as rocks held (rocks are not used up). Each rock:
  - is thrown at `xd = ±6`, `yd = -8`, with gravity 1;
  - homes on the nearest killable enemy within 96 px (steer 3);
  - bounces and lasts 64 steps;
  - adds 10 steps of age per breakable wall it smashes.
- **Fireballs:** one on screen at a time, and each one uses up a charge. A fireball:
  - kills "fireball-killable" enemies outright;
  - smashes breakable walls and flies on through them.
- If the cap is reached, firing plays an error blip.

### Damage (`X_OBJMAN.C p_ouch`, `hitplayer`)

- Health is 5 pips.
- `hitplayer` deals 1 damage, then gives that attacker a 3-step `zaphold`. The attacker
  cannot hurt again during it, so there is no global invincibility window.
- The invincibility shield subtracts 1 from all damage, so normal hits do nothing while it
  lasts. `msg_effects` counts it down: its phase flips every 5 steps and the shield counter
  rises once per two flips, so it wears off after 31 × 10 = 310 steps (about 17 s).
- Lava, acid, spikes tiles and deep water without the diving craft deal 5 damage:
  instant death.
- On death:
  - an ash, bee-fall or fish-float animation plays for 19 steps;
  - `p_reenter` puts the player back at the current checkpoint with 5 health;
  - the level reloads when that checkpoint is flagged "restart on death";
  - `stats(0)` restores the inventory saved at the level's start and strips the per-level
    items: extra lasers beyond 1, rocks, boots, shield, coloured keys and pool-ball
    progress.

## 4. Other player forms

| form | where | size | movement | fire |
|---|---|---|---|---|
| **Tiny hero** (`msg_tiny`) | the overworld map | 10 × 16 | 4 px per step in four directions; the camera scrolls 4 px per step | — |
| **Diving craft** (`msg_heroswim`) | water only (`fishdo`) | 30 × 30 | x = 8 px × stick. Up/down adds 3 to `yd` per step, with a slight sink, clamped to ±8 | twin torpedoes, one pair on screen |

Diving craft details:

- Fire2 kicks it up (`yd=-3`).
- Out of water it falls with gravity 4.

**Bee form** (`msg_herobee`, 24 × 24): the player flies.

- Sideways: 4 px on odd pixel columns, 8 px once aligned.
- Gravity is +1 every other step; Fire2 flaps (`yd=-6`).
- Fires single lasers that can be aimed up or down.

**Switching forms:** `playerxfm` swaps the object kind, keeps the feet line, snaps x to
8 px, and removes any other transform token. A "return to human" token also exists.

## 5. Items and inventory (`XARGON.H`, `X_OBJ.C`)

The inventory is a list of up to 29 item ids, so counts come from counting entries.

| item | effect |
|---|---|
| map key | opens a gate tile on the overworld |
| laser upgrade | raises the on-screen bolt cap (max 5); five = rapid fire |
| fireball | one charge each, max 9 |
| rock | throwable, not used up |
| jump boots | +4 launch speed each |
| shield | as above |
| coloured keys 0–3 | open the matching door |
| three power objects | the collectibles of an episode |
| bonus letters | four balls picked up in order (1, 2, 3, 4) give a 4000-point bonus |

Pickups:

| pickup | effect |
|---|---|
| hearts | +1 health up to 5 |
| emeralds | +1, max 99: the shop currency |
| fruit (4 kinds) | a counter to 16; **16 fruit = +1 health** (`drawstats`) |
| score gems | points only |
| tokens | give an item or a transform |
| journal notes | open a text window |

Boxes (`msg_box`):

- A box is invisible until triggered (`yd=-1` makes it start visible).
- Once visible it falls.
- A weapon hit breaks it and releases a set drop: a heart, fruit, a key of a colour, a map
  key, an emerald or a burst of fire.

## 6. Shop (`XARGON.C buymenu`)

The shop can be opened anywhere except on the overworld map.

| entry | cost | limit |
|---|---|---|
| health +1 | 15 | health below 5 |
| extra laser | 10 | 5 lasers held |
| rapid fire (5 lasers) | 25 | — |
| 1 fireball | 5 | 9 held |
| 5 fireballs | 20 | only when fewer than 5 are held |
| shield | 30 | when not held |

Lasers and fireballs can only be bought in human form. If the player can't afford an
entry, a text window says so.

## 7. Triggers (`X_OBJMAN.C sendtrig`)

Every object has a channel number (`counter`). Objects with `f_trigger` listen on their
channel. Senders call `sendtrig(channel, message, sender)` with one of three messages:
`trigger` (toggle), `trigon`, or `trigoff`.

**Senders:**

- **Pads** (invisible or visible):
  - touched by the player;
  - `state` -1, 0 or 1 selects `trigoff`, `trigger` or `trigon`;
  - 3-step `zaphold`.
- **Wall switches:**
  - up turns them on, down turns them off;
  - toggle or on/off mode.
- **Floor buttons:** each touch flips them, with a 10-step `zaphold`.
- **Timer pads** (`msg_timerpad`), by `yd`:
  - fire a trigger every N steps;
  - drip fire;
  - spawn enemies at random;
  - drop a bonus once.
- **Level exits** that finish a stage.

**Receivers:**

| receiver | effect |
|---|---|
| bridger | fills a row or column of cells with bridge or beam tiles, or clears them (restoring the neighbour tile) |
| door | a coloured door: needs the matching key and opens over 16 steps. On the overworld, a gate tile needs a map key |
| add-step | writes a fixed tile pattern (steps, ledges, platforms) |
| platform | toggles moving/stopped |
| elevator | — |
| box | appears |
| token | appears |
| poker | spike stab |
| stalactite | falls after N triggers |
| turret | on/off |
| eagle | an NPC that flies in and talks |
| transport | teleports the player: the door system (`msg_transpad`) sends its channel. The player presses up at a door (`xd=0`), or it fires on touch (`xd=1`) |

Pads that trigger an effect are usually removed by it (`killobj(z)` when the sender is a pad).

## 8. Moving parts

- **Platform** (28 × 4):
  - moves `xd, yd` per step and reverses on blocking cells (it checks head room when the
    player rides it upward);
  - the player lands on it from above and rides it as `st_platform`;
  - Fire2 jumps off; down+Fire2 drops through;
  - up and down only look.
- **Elevator** (32 × 16):
  - rides a column of `elevl/elevr` shaft tiles;
  - hold up to rise one cell per step while there is room; press down to sink back one
    cell;
  - with no input it drifts down after 6 steps.
- **Spring:** landing on it while falling launches the player with `yd = -(16 + 4 × power)`.
  Power 0–4 can cycle up by one each bounce (`xd=1`).
- **Crumbling floor:**
  - `touchbkgnd` advances a crumble tile under the player's feet every 4th step (12
    stages), then it vanishes;
  - it throws out pebbles.
- **Blinking block:** solid in phases 6–11 of a 16-phase, 128-step cycle (`X_OBJ3.C`).
- **Breakable wall:** lasers, rocks and fireballs clear it (+10 points).
- **Eye tiles:** 100 points when shot out.
- **Arrow traps:** a 1-in-100 chance per step to shoot an arrow that accelerates and wobbles.

## 9. Enemies (`X_OBJ.C`, `X_OBJ2.C`)

Terms:

- **"crawl"**: a walker that turns at ledges and walls.
- **"seek"**: turns to face the player.
- **"hp N"**: dies on the Nth weapon hit.
- **fb** (`f_fireball`): a fireball kills the enemy outright.
- **killable** (`f_killable`): lasers and rocks kill it in one hit.

| kind | size | behaviour | hp | points |
|---|---|---|---|---|
| grunt | 38×25 | crawl 4 px on even steps, pause 1/20, seek 1/15 | 4, fb | 400 |
| biter | 10–24 | wall trap: snaps out 14 px at step 27 of a 36-step cycle | — | — |
| centipede | 76×22 | crawl 1 px, seek 1/30; each hit shortens it 8 px and throws a gem; dies below 37 px | ~5 | 500 |
| alien | 40×24 | crawl 4 px, idles, seek 1/15 | 3, fb | 250 |
| leech | 44×23 | crawl 4, pauses, seek 1/40 | 4, fb | 300 |
| troll | 32×48 | crawl 4, seek 1/20, shoots a 6 px bullet 1/30 | 4, fb | 400 |
| blob | 30×13 | slides, sometimes stretches 52 px to leap-flip | — | — |
| lizard | 16×16 | crawl 2, seek 1/20, spits 1/55 | killable | 114 |
| bat | 16×13 | flies 2 px, bobs, bounces off walls | killable | 140 |
| hopper | 16×14 | waits 16 steps, hops `yd=-12` toward the player | killable | 145 |
| bee | 24×24 | flies 4 px, seeks 1/40 | killable | 125 |
| spider | 40×24 | crawl, seek 1/40 | 2, fb | 150 |
| creeper | 30×14 | crawl, rises into a 20×36 pillar as it dies | 3, fb | 500 |
| robot | 28×28 | crawl 4, fires 1/50 | 3, fb | 600 |
| drone | 16×20 | free flier; seeks 1/15 at `(2x, 4y)`; fires 1/50; falls burning when shot | 1 (armoured: 2) | 65 |
| ghoul | 30×30 | ghost flier; fades in over 5 stages as the player comes within 224 px, shoots within 96 | 8 | 2000 |
| boulder | 16×16 | rolls 4 px toward the player; 3 hits | fb | 200 |
| climber | 16×29 | runs up and down a vine; knocks the player 16 px aside | — | — |
| mine / eel / badfish / redfish / krusty / seamonster | water | swim at random 4 px; bubbles; fish die in 2 hits, mines burst into six bullets | — | — |
| turret | 22×15 | aims one of 5 directions, fires every 36 steps, glows before it shoots; trigger toggles it | only fireballs damage | — |
| masher / spear / spikes / poker | traps | on fixed cycles | — | — |
| final boss | 60×68 | hovers, turns at 80 px and 256 px range, drops 16 px bobbing, shoots accelerating skulls | 50 | 30000 |

The reactor "front" objects of a volume finale take 40 hits. They then play a 60-step
blast and end the volume.

## 10. Checkpoints, levels and the overworld

- Checkpoints (`msg_checkpt`) carry a level number and an optional next board name. The
  name's first character decides what it does:
  - `*` sets the song;
  - `#` sets the song only if none is playing;
  - `&` plays a demo;
  - `!` returns to the map.
- **Touching a checkpoint whose level differs from the current one:**
  1. `pl.level` is set;
  2. the player re-enters in `st_begin` (rising out of the floor for 40 steps);
  3. if it names a board, that board loads.
- **Checkpoint states:**
  - 2: blocks leaving while a map key token remains;
  - 3: blocks leaving without the power object;
  - 4: ends the game;
  - 5: marks the map board, the only place saving is allowed.
- **The overworld** is the map board: the tiny hero walks between level entrances.
  Entering a level:
  1. saves the map to a temp board;
  2. snapshots the stats;
  3. loads the level.

  Leaving through a `!` checkpoint restores the map and removes the checkpoint just
  finished, so a level is played once. Map gates need map keys found inside levels.
- **Level intro card:** a text card shows for 2–4 s (`donelevelmsg`).
- **Save and load:** seven named slots, saved only on the map. The high-score table has 10
  names.
- **Demo:** a macro format records input changes with step deltas; `srand(12345)` makes
  replays deterministic. The main menu plays the demo after about 22 s idle.

## 11. Camera (`X_PLAYER.C calc_scroll`)

- **Horizontal:** 8 px per step, triggered when the player is within 116 px of the left
  edge or 140 px of the right edge (4 px per step in tiny form).
- **Vertical:** keeps the player between `y-32` and `y-16*rows+96`, snapping to the band.
  Peeking scrolls 2 px per step inside the band.

## 12. Presentation that the code fixes

- **Status bar:** score (up to 7 digits), 5 health pips, 4 key slots, fruit icon and count,
  emerald count. The message line shows transient text for 100 steps, then the volume
  title.
- **Palette cycling:** lava, waterfalls, acid and machinery (`upd_colors`).
- **Hero tint:**
  - red for 4 steps after a hit;
  - blue while shielded or after healing;
  - red flashing at 1 health;
  - boots flash while held.
- **Skies:** per-level presets set by an effects object: black, lightning, dark blue, light
  blue, yellow, emerald, olive, violet, grey or royal blue.
- **Idle fidget:** after about 300 idle steps the hero says a one-liner.
- **First-time tips:** the first platform, box, heart, emerald and fruit each show a one-off
  help text.

## 13. Input (`GAMECTRL.C`)

| input | keyboard | joystick |
|---|---|---|
| move | arrows or keypad 8/4/6/2, polled as held keys | calibrated from center and corners |
| Fire1 | Shift or Space | button 1 |
| Fire2 (jump) | Alt or Ctrl | button 2 |

- Both fire buttons are edge-triggered: `fireNoff` latches until the button is released.
- **Commands:**

  | key | action |
  |---|---|
  | F1 | help |
  | S | save |
  | L | load |
  | P | pause |
  | B | shop |
  | Enter | inventory |
  | G | granny mode |
  | N | sound |
  | Esc or Q | game menu |

- **Cheat:** F7 three times gives full health, all keys and the shield.
- **Menus:** moved with the stick or arrows; Enter, Space or Fire1 selects; Esc goes back.
  Letter keys select directly.

The original has no gamepad API; "joystick" means the analog game port with two buttons.
