# Analysis of the source game

Tidebell follows the rules of *The Pirates of Dark Water* for the Sega Genesis (Sunsoft,
developed by Iguana Entertainment, 1994). Only its mechanics are used. Its characters,
names, story, text, art, maps and music belong to their owners and appear nowhere in
this project. This file records what the cartridge does, how that was found, and how
sure each finding is.

## Source and method

| item | value |
|---|---|
| cartridge | USA release, product code `GM T-15086 -00`, header dated 1994.JAN |
| size | 2 MiB, header checksum `$E5E3` (verified against the ROM data) |
| CPU entry | reset vector `$000200`; vertical blank handler `$0042E4`; horizontal `$004302` |
| screen | 320×224 (H40, NTSC), 60 frames per second |
| pad | 3-button (A, B, C, Start) |

Two methods were used, and each finding below says which one it came from:

- **Measured (M).** The ROM ran in Genesis Plus GX (through `stable-retro`). A script
  pressed the real pad buttons and read the 68000's RAM every frame.
  `tools/rom/probe.py` repeats every measurement. Genesis Plus GX stores RAM as
  byte-swapped 16-bit words, and the probe reads it the way the CPU does.
- **Code (C).** A linear disassembly of the first 512 KiB (capstone, 68000 mode). A
  code finding cites the address of the instruction.
- **Seen (S).** Seen on screen, with no number found behind it. Treat these as weaker.
- **Inferred (I).** Deduced from code whose purpose is not fully known.

The ROM is not in this repository, and neither are its text, graphics or sound.

## Memory map (M, C)

Addresses are the 68000's. Positions and speeds are 16.16 fixed point: a whole pixel in the
high word and the fraction in the low word, as the knockback code writes them
(`move.l #$fffc0000, $ff2180` is −4.0 px per frame, at `$CE5A`).

| address | size | meaning |
|---|---|---|
| `$FF2142` | long | player X (16.16) |
| `$FF2146` | long | player X on the previous frame (restored when a pit is survived, `$D9BA`) |
| `$FF214A` | long | player X speed (16.16) |
| `$FF2156` | long | player Y (16.16), grows downward |
| `$FF215E` | long | player Y speed (16.16) |
| `$FF2180`, `$FF2184` | long | knockback X and Y speed |
| `$FF213C` | word | player action; values below |
| `$FF2194` | word | invulnerability timer after a knockback hit |
| `$FF2120`, `$FF2122` | word | timed item state (1 to 4) and its countdown in frames |
| `$FF0F66` | word | health |
| `$FF0F68` | word | health shown by the bar; it moves 1 per frame toward `$FF0F66` |
| `$FF0F6A` | word | maximum health |
| `$FF0EF6` | byte | lives (starts at 3: `move.w #$3ff, $ff0ef6` at `$0F70`) |
| `$FF0EB0` | word | difficulty: 0, 1 or 2 |
| `$FF0CD0`…`$FF0CE6` | word each | item counts, in BCD (the code uses `abcd`/`sbcd`) |

Action values seen in `$FF213C` (M): `$00` stand, `$04` walk, `$34` jump rise, `$38`
jump fall, `$1C` landing, `$3C`/`$44` crouch, `$48` crouch attack, `$54` attack, `$58`
jump attack. Values written by the code (C): `$78` hurt, `$6C` dead, `$C8` special move,
`$A4`/`$A8`/`$AC` item throws and uses.

## Controls (M)

| input | action |
|---|---|
| D-pad left/right | walk |
| D-pad down | crouch (attack from a crouch with A) |
| D-pad up/down | climb trunks and vines (S) |
| A | attack |
| B | jump |
| C | use the item in the box (nothing happens with an empty box) |
| Start | pause; the pause window selects an item and can call the advisor (strings) |
| A + B together | a jump: the jump wins, so this is not the special move |
| special move | read from a button-history bitfield (`$FFCC2C` tested against `$FFCC32`, at `$8630`); the exact sequence was not identified (I) |

The options include a "control choice" (a string), which suggests the buttons can be
reassigned. Its layouts were not examined.

## Movement (M)

All numbers are per frame at 60 frames per second.

| quantity | value | 16.16 |
|---|---|---|
| walk acceleration | 0.5625 px/frame² (first frame 0.375) | `$9000` |
| top walk speed | 2.75 px/frame (165 px/s) | `$2C000` |
| stopping | speed is 0 on the frame after the pad is released | — |
| turning | the speed builds again from 0 in the new direction | — |
| run | none: a double tap walks as usual | — |
| jump launch speed | −8.078125 px/frame | `$FFF7EC00` |
| gravity | 0.421875 px/frame² | `$6C00` |
| jump height | 81.4 px | — |
| time in the air | 38 frames on flat ground | — |
| jump start | the rise begins one frame after the press (the first frame reads speed 0) | — |
| variable jump | none: tapping B and holding it for 40 frames give the same arc | — |

The fixed jump and the one-frame delay are what the Vale of Shards players called "late
and stiff". DESIGN.md says what Tidebell changes (rows M4 to M6).

## Attacks (M, C)

| move | length | notes |
|---|---|---|
| standing attack (A) | 20 frames | Starts on the press frame. The player cannot walk during it. A new press is accepted from frame 16; earlier presses are dropped, since there is no input buffer. |
| attack chain | 3 swing poses in turn (S) | Pressing A again after a swing plays the next pose: an overhead cut, a forward cut and a spin. Whether they deal different damage was not found. |
| crouch attack (Down+A) | 21 frames | Then the player stays crouched while Down is held. |
| jump attack (A in the air) | 13 frames | The arc carries on unchanged. |
| special move | action `$C8` | Needs at least 24 health (`cmpi.w #$18, $ff0f66` at `$860C`), unless timed state 4 is running. Fewer than 10 of two kinds of object must be on screen (`$8618`, `$8624`). Whether it costs health was not found (I). |

The damage the sword deals and the enemies' hit points were not found. Tidebell's values
for those are its own.

## Health and damage (M, C)

| rule | value | where |
|---|---|---|
| starting health and maximum | 71 | M, `$FF0F6A` |
| maximum can grow to | 127 (`$7F`) | C `$898E` |
| health bar | 1 pixel per point; its frame is as long as the maximum | M |
| bar animation | the shown value moves 1 point per frame toward the real one | M, `$FF0F68` |
| a sword raider's hit | 12 | M (`subi.w #$c` at `$9060`) |
| hazard hit by difficulty | 15 on setting 0, 20 on setting 1, 10 on setting 2 | C `$CE90` |
| knockback | ±4 px/frame away from the hit, −4 px/frame upward | C `$CE5A` |
| invulnerability after a knockback hit | 100 frames | C `$CE88` (`$64` into `$FF2194`) |
| another hit path's recovery | 120 frames | C `$8FFA` (`$78` into `$FF2132`) |
| falling into a pit | 20 damage; the player goes back to the last position on firm ground | C `$D9BA`–`$D9EC` |
| death | the health bar empties; a life is lost; the player comes back with full health and the bar refills from 0 | M |
| lives | 3 at the start; one is added by a pickup (`addq.b #1` at `$F6CE`); at 0 a game-over flag is set (`$90D4`) | C |
| after game over | "Continue" or "End Game" (strings); a stage password is shown between stages | strings |

## Items (C, strings)

The item box holds one selected item; C uses it; the pause window changes it. The game
has ten item kinds: two thrown weapons (one with a count cap in a table at `$FA0A`), a key,
food, a maximum-health raise, three potions or spells with a time limit, magic energy
and a special magic. What the code shows:

| handler | effect |
|---|---|
| `$894A` | restores health to the maximum (not used when health is already full) |
| `$8984` | raises the maximum by 24, up to 127, and fills health |
| `$89D4` | a thrown weapon (action `$A4`), counted down by 1 |
| `$8878` | timed state 2 for 480 frames (8 s), and calls an effect at `$5CFF4` |
| `$88C2` | timed state 3 for 1200 frames (20 s) |
| `$8906` | timed state 4 for 1200 frames (20 s); the special move needs no health while it runs |
| `$8842` | timed state 1 for 900 frames (15 s); sets two values at `$FF2214`/`$FF2218` to 15.0 |

Which named item each timed state belongs to was not found; DESIGN.md assigns Tidebell's
own items to these timings.

## Structure (strings, S)

- **Stages.** The debug level list names about 52 sections in 11 regions: jungle, port,
  village, mountain, a haunted citadel (12 sections), an island town, caves, a temple,
  a bridge, and a ship's lower and upper decks. Four sections are named after bosses.
- **Between stages** a framed hub window offers: talk to the advisor, the map screen,
  choose a hero, and start the stage. The score is shown at the top.
- **Heroes.** Three heroes can be chosen before each stage, each with a profile page.
  Whether they play differently was not measured.
- **People.** Walking into a friendly character opens a story page in the hub window,
  with a "return to game" button (M: the first stage does this after about 400 px).
  Several bosses talk before the fight.
- **Treasure.** Chests hold gold coins. One character asks to be paid in gold.
- **Goal.** Collect six treasures, then use them against the final enemy. A closing
  sequence and staff credits follow.
- **Stage hazards** (S): pits, climbable tree trunks and vines, platforms at several
  heights, breakable chests, pickups.
- **Enemies** (S): sword raiders that stand on ledges and cut when the player is near;
  thrown projectiles; flying creatures.

## HUD (S)

- Top left: the hero's head and the number of lives.
- Top right: the item box.
- Bottom: the health bar, with its frame drawn at the maximum length.

## Not found

These were looked for and not found. Tidebell's values for them are its own:

- the sword's damage and the enemies' hit points;
- the special move's input and cost;
- the climbing speed;
- whether the three heroes differ in play;
- whether the stage order can be chosen on the map.
