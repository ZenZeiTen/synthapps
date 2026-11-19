# Gates of Skeldal: how the original works

This is a reverse-engineering report on the source of *Brány Skeldalu* (Gates of Skeldal, Napoleon Games, 1998). It covers revision r188 of the "trunk" code drop in `skeldal-code-r188-trunk.zip`.

It records how the original game works, so that the remake in this folder can reproduce the **mechanics**. The remake reuses no graphics, text, maps, music or names from the original. The source zip contains no game data anyway, only code and tools.

Paths are relative to the zip root:
- `GAME/` holds the game itself.
- `LIBS/` holds the engine libraries.
- `MAPS/` and `mapedit/` hold the editors.
- `AdvMan/` holds the adventure manager.

**How claims are sourced.** Unless marked *[inferred]*, every claim was read from the code. The core formulas were re-checked by hand against the source:
- the hit formula in `SOUBOJE.C:375-405`;
- `get_ap` in `GLOBALS.H:285`;
- the XP table in `SOUBOJE.C:59`;
- the sector type numbers in `GLOBALS.H:299-316`.

**Encoding.** Comments are Czech, in CP1250 or Kamenický. Read them with `iconv -c -f cp1250`.

## At a glance

| aspect | the original |
|---|---|
| genre | first-person, step-by-step party dungeon crawler (the lineage of *Dungeon Master* and *Eye of the Beholder*) |
| screen | 640×480, 16-bit colour; 3D view 640×360; 6 portraits along the bottom |
| world | squares ("sectors") linked as a graph, each with four inward-facing wall faces; multi-layer levels |
| time | real-time exploration at 50 Hz; world updates every ~120 ms; clock and regeneration every 10 s |
| combat | switches to **rounds** on contact: plan one action per action point, then shuffled initiative |
| party | up to 6; no classes; stats chosen on a disc between archetypes; 5 points per level |
| magic | runes, not a spell book: 5 elements × 7 runes × 3 power levels; casting can fizzle or backfire |
| items | cursor-held items; four floor piles per square; paper-doll with 9 slots + 4 rings; weight costs stamina |
| scripting | wall actions (open, close, toggle…) plus ~40-opcode macros on walls; compiled dialogues (~80 opcodes) |
| extras | automap with notes, book/journal, shops with haggling, world map, flute puzzles, 10 save slots |

## 1. The world model

**A level is a graph of squares ("sectors"), not a 2D array** (`GAME/GLOBALS.H:474-537`).
- Each sector stores its neighbours in `step_next[4]` (N, E, S, W, clockwise); 0 means "no neighbour". Sector 0 is the void, and teleporting there kills.
- Grid coordinates (x, y, layer) live in a separate table and are used only for the automap, sound and distances.
- Every sector owns **four inward-facing wall faces** (`map_sides[sector*4 + dir]`). A wall between two squares is therefore two independent faces, one seen from each side.

**A square** (`TSECTOR`, 16 bytes) holds:
- floor and ceiling texture ids (no ceiling means open sky);
- animation modes;
- a **type**;
- an action code with its target square and direction;
- the four neighbours.

| type | behaviour (code in `REALGAME.C`) |
|---|---|
| normal | plain floor |
| stairs | on entry, jump to the target square and rotate the facing (1636-1649) |
| boat | the boat carries you over water; no strafing |
| lava | death unless levitating |
| direction N/E/S/W | forces monsters to walk that way |
| water | drains stamina, then drowns (1093-1103) |
| pillar | drawn as a free-standing column |
| pit | fall to the target square for rnd(maxHP/2)+maxHP/3 damage; items fall too (2006-2024) |
| teleport | move to the target square and facing |
| pressure plate | pressed by a player, monster or item; fires the square's action (522-551) |
| flute puzzle | a melody played here is checked |
| exit | leave point for world-map travel |
| whirlpool | spins you through random quarter turns |
| acid | -3 HP per update |

**A wall face** (`TSTENA`, 16 bytes) holds:
- a primary texture (the wall or door);
- a secondary overlay (lever, button, decoration);
- an arch, and a niche flag;
- an action code with its target;
- 32 flag bits (`GLOBALS.H:59-85`).

The flag bits fall into these groups:
- **Passability:** separate "impassable" bits for players, monsters, thrown items and sound; a see-through bit.
- **Animation:** animate the primary or secondary texture, forward or ping-pong.
- **Triggers:** fire on walk-through instead of on touch; touching toggles (a lever); forward incoming actions to another wall.
- **Change mask:** the bits a sent action XORs into the target's passability. This is how a door becomes walkable.
- **Hidden things:** secret (cleared when you pass), illusion (revealed by True Seeing), hidden on the automap.

**Doors** are animated wall faces. An open order sets the animation direction. The face's passability flips when the last frame is reached (`REALGAME.C:730-786`).

**Actions** (`do_action`, `REALGAME.C:831-1001`):
- open, close or toggle a door;
- run, show, hide or toggle the primary or secondary texture;
- show a level text;
- open or close a teleport;
- a code lock that fires once all four walls of a square are switched.

Actions can be delayed by a number of ticks, and can forward to another wall.

**Macros** ("multi-actions", `MACROS.C:680-783`) are scripts attached to wall faces. They run on triggers:
- pass or fail to pass;
- touch;
- a door opens or closes;
- an action arrives;
- the level starts;
- a niche changes.

There are about 40 opcodes. They include:
- sound, text and story log;
- send an action, fire a projectile from the wall, load another level;
- start a dialogue, open a shop;
- a key check or lockpick roll;
- swap two squares, hurt the party;
- conditional jumps on flags, items or chance;
- give XP, teleport the party, add a book page;
- change music, end the game;
- register global hooks (on step, on turn, timers).

A record can be one-shot or can cancel the rest of the script.

**Level file** (`REALGAME.C:231-409`): tagged blocks for:
- global info (start square, fog colour, map name, underwater or town flag);
- sides, sectors and grid coordinates;
- texture name lists per wall orientation;
- macros, floor items, monsters, niches and a password.

Leaving a level saves only a diff of what changed (`GAMESAVE.C:380-461`).

**Levels connect** through stairs, holes and teleports inside a level, a "load level" macro between levels, and a scripted world map.

## 2. Movement

- The party (up to 6) moves one square at a time. It can split into groups, and each group has its own square and facing.
- **Stepping** (`REALGAME.C:1605-1770`):
  1. The target face's "impassable to players" bit decides whether the step succeeds. Pass and fail macros fire either way.
  2. A monster on the target square starts its dialogue or a fight.
  3. On success: pass-actions fire and weight costs stamina.
  4. After the move: pits, teleports, pressure plates and hazards are checked.
  5. A blocked step plays a short "bump".
- **Turning** changes the facing by a quarter turn.
- **Space or a click** on the front wall "touches" it. If the wall has an overlay (lever, button), the click must land on that overlay.
- **Transitions** (`BGraph2Dx.cpp:533-705`): a step zooms the old frame toward the centre over about 200 ms, and a turn slides the frames sideways over about 100 ms.

## 3. The 3D view

- **Screen and view.** The screen is 640×480. The 3D view is 640×360 with the vanishing point at (320, 112).
- **Visible area.** Each step deeper scales the view by 0.7 around that point (`ENGINE1.C:249-269`). The renderer draws **5 squares deep and 7 wide**, back to front (painter's algorithm), in this order:
  1. floor and ceiling;
  2. walls (arch, primary, overlay);
  3. floor items;
  4. monsters, other party members and projectiles.
- **Line of sight.** A flood fill from the party's square decides what is visible. It crosses only see-through walls, inside a view cone (`BUILDER.C:667-722`).
- **Textures.** Front walls are 500×320 images scaled per depth. Side walls are pre-drawn in perspective. Floor and ceiling are pre-rendered perspective bitmaps copied cell by cell.
- **Distance fog.** Each texture carries 5 fog palettes and 5 darkness palettes, one per depth row. Colours lerp toward the level's fog colour by 1, 11/14, 8/14, 5/14 and 2/14 (`pcx.c:77-111`).
- **Floor items** stand in the 4 corners of a square. **Monsters** use a sub-square position (0-255), which lets them be seen walking between squares. At most 2 monsters share a square.

## 4. Automap and timing

- **Automap** (`AUTOMAP.C`): squares seen in the centre column ±1 are marked as visited.
  - Walls are drawn by type: solid, see-through, or hidden.
  - Fills show water and lava, with symbols for stairs, teleports, pits and forced directions.
  - Levels (layers) are paged with PgUp/PgDn, and the player can add text notes.
  - A small rotating mini-map appears during battle.
- **Timing.** The base timer is 50 Hz.
  - The world updates every 6 ticks (~120 ms): door animation, delayed actions, monster movement, hazards and the battle check.
  - Regeneration and the game clock advance every 10 s (`SKELDAL.C:1127-1132`).
  - Combat advances the clock one tick per round.
## 5. Characters

**Party.** Up to 6 characters (`POCET_POSTAV`, `GAME/GLOBALS.H:26`). There are no races or classes. At creation you choose only a portrait (8: 4 male, 4 female), sex and name. The party can split into groups that stand on different squares.

**Stats.** Every character and every monster uses the same 24-slot stat array (`VLS_*`, `GLOBALS.H:401-425`):

| slots | meaning |
|---|---|
| 0-3 | Strength, Magic skill, Mobility, Dexterity |
| 4-6 | Max HP, Max stamina ("kondice"), Max mana |
| 7-8 / 9-10 | Defence range low-high / Attack range low-high |
| 11-15 | Resistance % to Fire, Water, Earth, Air, Mind |
| 16-18 | HP, mana and stamina regeneration |
| 19-21 | Magic damage range added to attacks, and its element |
| 22 | Flat damage bonus |
| 23 | Bit set of active effects (invisible, drain, mana shield, sanctuary, regen, fear, stoned, levitate…) |

- Current stats are recomputed from the base stats plus every worn item (`prepocitat_postavu`, `INV.C:825-872`).
- Resistances stack with diminishing returns: `r = (a+b)/(1+a*b/8100)`.
- Each item has minimum Strength, Magic, Mobility and Dexterity requirements (`INV.C:1440`).
- **Action points:** `Mobility/15`, and at least 1 (`get_ap`, `GLOBALS.H:285`).
- **Encumbrance** (`INV.C:2015-2039`): `max(0, (weight - 20*STR)/200)` is added to the stamina cost of every step and blow.

**Character creation** (`CHARGEN.C`).
- The player drags a pearl on a disc. The angle blends between 8 archetype profiles (fighter-like, mage-like and others). The radius blends from the balanced centre (12-17 in everything) to the rim profile.
- Stats are then rolled inside the resulting ranges:
  - `MaxHP = (3*STR + MOB)/2`
  - `MaxMana = 2*MAG`
  - `MaxStamina = 2*DEX`
- Every character starts with 5 bonus points to spend.

**Levels** (`SOUBOJE.C:59-100`, `2276-2312`).
- The XP table starts 400, 1000, 1800, 2800, 5000… and caps at level 40.
- Each level gives:
  - 5 attribute points;
  - hidden gains: the highest of STR/MAG/DEX gets 1-5, the second gets 1-3, the third gets 1.
- Raising a stat also raises the stats it drives (`advance_vls`, `INV.C:1582-1622`). For example, Strength raises Max HP by 1.5 per point.
- XP comes from three sources:
  - damage dealt, as a share of the monster's XP pool;
  - a flat kill bonus paid to every living member;
  - the mana spent on each spell cast.

**Weapon skill.** There are seven weapon families: sword, axe, hammer, staff, dagger, missile and other. Hits raise a family's skill (thresholds 20, 40, 80…), and the skill level is added to damage (`SOUBOJE.C:104-117`).

## 6. Combat

It is a **hybrid**. Exploration runs in real time: monsters walk, and a regeneration tick fires about every 10 s. When any monster engages, the game switches to **rounds** (`SOUBOJE.C`).

**Engagement.**
- An aggressive monster engages when it sees the party within its sight range, in the half-plane it faces, with a clear line of sight (`ENEMY.C:545`).
- If no party member faces the monster, the party is **surprised** and loses round 1 (`SOUBOJE.C:307`).

**The round.**
1. **Planning.** Each character queues one action per action point: attack, move, cast (rune picker), re-equip, stand, flee or throw.
2. **Initiative.** One token goes in per monster action point and per queued player action. The tokens are **shuffled uniformly**, so stats play no part in initiative (`SOUBOJE.C:410-438`).
3. **Execution.** Tokens resolve in shuffled order.
4. **End of round.** Regeneration effects apply, deaths are made final, and time advances one tick.

**Stamina.**
- Every attack costs stamina, and so does every step taken in battle, at a rising cost.
- A character with 0 stamina can only stand.
- Low stamina strips away the minimum defence (`SOUBOJE.C:2431`).

**Hit and damage** (`vypocet_zasahu`, `SOUBOJE.C:347-408`). There is no separate to-hit roll and no criticals.

```
attack  = rnd(ATK_L..ATK_H) + (STR*15 + DEX*10)/150
defence = rnd(DEF_L/crowd .. DEF_H) + DEX/5            (+10 if the defender is invisible)
phys    = attack - defence; if > 0: max(1, phys + DAMAGE)
magic   = rnd(MAG_L..MAG_H) * (100 - resist[element]) / 100      -- lands even on a miss
total   = phys + magic; if > 0: max(1, total + weapon_skill)
```

Sanctuary halves the damage and high sanctuary quarters it.

**Reach and targets.**
- **Melee** reaches only the square in front.
- **Missiles** (thrown weapons, bows, scrolls) fly up to 5 squares.
- A square holds 2 monsters, or 1 big one.
- A monster's blow hits one random living character on the target square.

**Death is final at the end of the round**, and there is no unconscious state.
- The dead character's XP is reset to the start of their level, and the body stays on the square.
- A spell can raise the dead.
- The game ends when everyone is dead (`SOUBOJE.C:2335`).

## 7. Monsters (`TMOB`, `GLOBALS.H:1449-1488`; editor `MAPS/MOB_EDIT.C`)

- Monsters share the 24-slot stat array. On top of it they have:
  - movement speed, sight range and engagement range;
  - an XP pool, a flat kill bonus, money, and up to 16 carried items that drop on death;
  - flee tendency, an optional spell, an optional dialogue and a home square.
- **Behaviour flags:**

  | flag | behaviour |
  |---|---|
  | walks | patrols |
  | attacks | hunts on sight |
  | hears | turns toward noise; sound spreads by breadth-first search through walls that let it pass (`ENEMY.C:1756`) |
  | big | takes a whole square |
  | guard | returns home |
  | picks up | loots items and corpses |
  | shoots | ranged attacker |
  | respawns | returns to its home square |
  | sees invisible | ignores invisibility |
  | casts | spellcaster |

- **Battle AI per action** (`ENEMY.C:1888-1993`), checked in this order:
  1. Flee if its damage share outweighs its courage.
  2. Hit or cast at a character in front.
  3. Turn toward an adjacent character.
  4. Shoot or cast along a clear line.
  5. Path toward the party by breadth-first search.
  6. Otherwise wander off and leave combat.
- **Special procedures** (`SPECPROC.C:661-673`) add scripted behaviours: circle-walker, random-spell wizard, kiting archer, door opener, shouter, a tactician that picks the weakest defender, and a stationary type.

## 8. Magic (`KOUZLA.C`, compiler `LIBS/CSPELLS.C`)

- **Runes, not a spell book.**
  - There are 5 elements: Fire, Water, Earth, Air, Mind.
  - Each element has 7 runes, and each rune has 3 power levels, for 105 spells.
  - Spell number = `(element*7 + rune)*3 + power` (`SOUBOJE.C:1524`).
  - Runes are known by the whole party. They are learned from rune items and dialogues.
- **Each spell carries:**
  - a required Magic skill and a mana cost;
  - an element and a resistible flag;
  - a stacking group, a backfire spell and a target type.
- **Casting risk** (`KOUZLA.C:1629-1727`):
  - Magic ≥ requirement: the cast is safe.
  - Magic below half the requirement: the spell cannot be cast.
  - Between the two: a roll decides. The outcome is success (with a small chance of a permanent +1 Magic), a fizzle (half the mana is lost), or a backfire (a different, harmful spell).
- **Spell scripts** are bytecode interpreted by `call_spell` (`KOUZLA.C:1399-1487`). The opcodes cover:
  - plain damage and elemental damage, where a negative value heals;
  - timed stat changes;
  - duration waits;
  - launching projectile items;
  - creating items, weapons and summons;
  - setting and clearing effect flags;
  - drain, mana and stamina changes;
  - teleports.
- A family of special codes covers the effects that are not stat changes: reveal map radius, summon party, true seeing, haste, demon form, fire waves, phase door and portals.
- The actual spell list lives in a data file (`KOUZLA.DAT`) that is not in this repository.

## 9. Time, rest, food

- One game hour is 360 ticks (`GLOBALS.H:27`). One tick is about 10 s of real time, so game time runs at roughly real-time speed.
- **Awake, per tick:** stamina and mana regenerate by a tenth of their regen stat. **HP does not regenerate while awake** (`INV.C:1111`).
- **Asleep, per game hour:** the full HP, stamina and mana regeneration applies. A sleep budget caps a rest at 12 h. Battle, hunger, thirst or a keypress interrupts it (`REALGAME.C:1856`).
- **Food and water** count down every tick:
  - out of food: no regeneration;
  - out of water: 1 damage per tick.
- Deep water drains stamina and then drowns. Volcanic and ice maps hurt characters who lack the matching resistance.
## 10. Items and inventory

**Item record** (`TITEM`, `GLOBALS.H:884-909`). Each item holds:
- a name and a description;
- 24 stat modifiers, applied while the item is worn (same layout as the character stats);
- minimum Strength, Magic, Mobility and Dexterity to use it;
- weight, and carrying capacity (for bags);
- type, body placement and flags (breaks on impact; cursed, destroyed when removed);
- an optional spell and its power, and a key id;
- weapon class and price;
- icon and floor/body pictures, plus 4×4 in-flight frames.

**Types** (`GLOBALS.H:847-862`): melee weapon, thrown weapon, ranged weapon, armour, scroll or wand, potion, water, food, special (water-breathing, flute), rune, money, text scroll (adds a book page), dust, other.

**Body slots** (`GLOBALS.H:388-396`):
- bag, upper body, lower body, head, feet, robe, neck, left hand and right hand;
- 4 ring slots and a quiver of up to 99 arrows;
- a backpack of 6 slots, plus the worn bag's capacity, up to 30.

**Equip rules** (`INV.C:2079-2177`):
- A two-handed item clears the other hand.
- A robe replaces head and body items.
- Items whose requirements are no longer met drop off automatically.
- "Wearing" an item that has no placement uses it: a potion casts its spell, and food or water restores hours.

**Weight** (`INV.C:2015-2039`): pack items count ×1.5. Load beyond 20×Strength costs extra stamina on every step and blow.

**Floor items sit in the 4 corners of a square** (`INV.C:400-428`), as one pile per corner in absolute directions.
- Clicking the near-left or near-right part of the view acts on your own square.
- Clicking the far-left or far-right part acts on the square ahead (`CLK_MAP.C:473-476`).
- Items dropped into a pit fall to the level below as projectiles.
- Walls can have **niches** that hold up to 8 items and can fire an event (`CLK_MAP.C:57-113`).

**The cursor holds items.**
- Picking something up puts it on the mouse cursor (`INV.C:75`, `554`). Clicking places it: on a portrait to store it, into the view to throw it.
- Picking up a rune teaches the party that rune. Money is banked, and a text scroll is added to the book (`INV.C:566-620`).
- **Throwing** (`INV.C:2327`): flight speed depends on weight, and the item's height and side offset follow the click position.
- **Keys:**
  - A lock's key id must match the item's key id.
  - A lockpick tests the party's best Dexterity against the lock level and can break (`MACROS.C:223-279`).
- **Combining:** items combine through a recipe list (`COMBITEM.DAT`, `INV.C:1779`).

## 11. Screen and controls

**Screen size:** 640×480, 16-bit colour (`ENGINE1.H:29-43`).

**Top bar** (y 0-16, `CLK_MAP.C:486-496`):
- buttons: quit, setup, save, load, sleep, book, cast, automap;
- the money counter;
- an animated compass.

**3D view:** y 17-376.

**Bottom panel:** y 378-479.
- Six portraits, each with HP, stamina and mana bars.
- Status icons show hunger, thirst, bonus points and active spells.
- In battle, each portrait also shows action points and facing.
- A 6-arrow movement pad sits on the right (`BUILDER.C:333-427`, `CLK_MAP.C:466-471`).

**Keys** (`REALGAME.C:1925-1987`):

| key | action |
|---|---|
| arrows | step and turn (Ctrl + arrow strafes) |
| End / PgDn | strafe |
| Space | use the wall ahead |
| Tab / M | automap |
| I | inventory |
| F2 / F3 / F4 | save / load / setup |
| 1-6 | select a character |
| Insert | regroup the party |
| Enter | start a battle |

**Mouse:**
- Right-click in the view moves by 3×2 zones: turn left, forward and turn right on top; strafe left, back and strafe right below (`CLK_MAP.C:155`).
- Left-click touches walls, talks to NPCs, and picks up or throws items.

**Inventory screen** (`INV.C:90-112`): a paper-doll, a 6-column backpack grid, ring slots, a stats page with + buttons for bonus points, and tooltips that show unmet requirements in red.

## 12. Dialogue, shops, book, world map

**Dialogues** are compiled scripts.
- Source: `.dlg` files with `DIALOG(n)`, `SENTENCE(n, mode)` and `IF`/`ELSE` blocks. `CDIALOGY` compiles them to `DIALOGY.DAT` (`MAPS/CDIALOGY.C`).
- Each dialogue has up to 128 paragraphs. A paragraph remembers whether it was visited, and can redirect to an alternative paragraph once visited.
- The interpreter (`DIALOGY.C:1210-1316`) has about 80 opcodes:
  - speech and description text;
  - choices, conditional choices and choices shown only if not yet visited;
  - goto, and branching on flags and variables;
  - picking a party member at random or by stat;
  - checking, giving or taking items and money;
  - training a stat or weapon skill for a fee;
  - granting runes;
  - starting a fight, firing a map action or teleporting;
  - adding a book section;
  - opening a shop on exit.
- Each NPC has 16 private flags (`DIALOGY.C:889-897`).
- Text markup: `%n` inserts the chosen character's name, and `[male,female]` picks a form by sex.

**Shops** (`INV.C:2364-3033`):
- A shop has a price factor: buy = price×(1+k%), sell = price×(1−k%).
- Stock can restock or roll special items on each level change.
- You can haggle by typing an offer, which is accepted by chance (`INTERFAC.C:1464-1569`).

**The book** (`KNIHA.C`) is a journal of HTML-like sections (`<P>`, `<IMG>`, `<CENTER>`). Sections are added by text scrolls, dialogue opcode 149 and a map macro. The pages turn two at a time.

**The world map** (`GLOBMAP.C`):
- It is a scripted overlay. Each location has conditions (flags, maps visited) and a pixel mask of clickable regions.
- Travel requires every living character to be able to reach an "exit map" square.
- The party arrives at the remembered exit square of the target map.

## 13. Saves, sound, packaging

**Saves** (`GAMESAVE.C`):
- There are 10 slots, and slot 9 is the autosave.
- A save is an archive of temp files, each with a CRC:
  - **Global state:** position, money, flags, runes, time, the raw party records, and dialogue visited bits.
  - **Per visited map:** automap bits, only the walls and squares that changed, live monsters, floor items, niches, flying items and delayed actions.
  - **Also saved:** shops, the book, the story log and the global event hooks.

**Sound** (`SNDandMUS.C`):
- WAV samples on 20 channels.
- Positional volume is `32000 − 64000·d/(8+d)` for Manhattan distance d. Pan follows the party's facing.
- Looping map sounds are re-panned on every step.
- A 12-note **flute** repitches one sample. Tune puzzles match note strings.
- **Music:**
  - Each level has a playlist (RANDOM/FORWARD).
  - The music format is a DPCM `.MUS` (`LIBS/zvuk_dx.cpp:522-640`).
  - Map macros can switch the playlist.

**Adventure packaging** (`AdvMan/`):
- An adventure is an `.adv` INI file that points at folders: maps, graphics, dialogues, enemies, items, sounds and saves. It also sets the start map and the party size limits.
- It ships compiled data files (`ITEMS.DAT`, `ENEMY.DAT`, `KOUZLA.DAT`, `DIALOGY.DAT`, `SHOPS.DAT`, `POSTAVY.DAT`).
- AdvMan launches the map editor, the spell and dialogue compilers and the icon builder.
