# Gates Below: design

*Gates Below* is an original dungeon crawler built on the **mechanics** of *Gates of Skeldal*, as reverse-engineered in [ANALYSIS.md](ANALYSIS.md). Its world, story, characters, text, maps, art, sound and music are all new. Nothing is taken from the original game's data.

**Spoiler warning:** the last section lists every puzzle solution.

## Premise

The hill town of Harrowmoot stands on the Underkeep, three levels of old vaults. At the bottom is the **Nether Gate**, a stone door that keeps the cold of the Hollow out of the world.

Grave robbers took the **Sealstone** from the Gate's lock and carried it down with them. Now frost creeps up the cellar stairs at night.

Four townsfolk go down to bring the Sealstone back and set it in the Gate:

| name | role | build |
|---|---|---|
| Brann | smith turned watchman | strong, slow with magic |
| Ilsa | the scribe's apprentice | a gifted, fragile caster |
| Odo | old lamp-priest | healer, steady |
| Tobin | poacher | quick; bow and knives |

Maren, a thief left behind by the robbers, can join as a fifth.

## What is kept, adapted and dropped

| original mechanic | in *Gates Below* |
|---|---|
| squares linked as a graph, 4 inward faces per square | **kept.** Levels are drawn as ASCII on a doubled grid and compiled into the same square/face model. Every face has its own flags, so one-sided walls and levers work as in the original |
| face flags: impassable to players / monsters / items, see-through, secret, door animation | **kept**: walls, wooden doors (open by touch), portcullises (see-through, script-driven), secret walls (walk-through illusions that stay hidden on the map until crossed) |
| square types: stairs, pit, teleport, water, pressure plate | **kept.** Pits drop the party to the level below with the original fall damage, split across the party. Water costs stamina per step, then HP (softened from instant drowning). Teleports can be switched on and off. Plates are pressed by the party, a monster **or any item** |
| wall actions and ~40-opcode macros | **kept as a small script language**: open, close and toggle doors; show and hide decals; messages; items; flags; conditions; teleport; level change; damage; XP; book pages; spawn; delayed actions; end game. Triggers: touch, walk through, enter, press, release, level start, niche change |
| real-time world, 10 s regeneration tick, 1 tick = 10 game seconds | **kept.** The core steps the world in 100 ms ticks. Monsters walk between squares in real time, and regeneration runs every 100 ticks |
| round-based battle: plan actions, shuffled initiative | **kept.** Each living character plans an action and repeats it once per action point (`AP = max(1, MOB/15)`). Tokens are shuffled uniformly. **Adapted:** the party moves as one group; a move or flee takes the whole party's round, since party splitting is dropped |
| hit formula, stamina costs, surprise, monsters hit a random character | **kept exactly** (`vypocet_zasahu`). A party that isn't facing the monster that engages loses round 1 |
| 24-slot stat block for characters and monsters | **kept**: the same slots (STR, MAG, MOB, DEX, max HP/stamina/mana, attack and defence ranges, 5 resistances, 3 regenerations, magic damage, damage bonus, effect flags) |
| derived stats, resistance stacking `(a+b)/(1+ab/8100)`, item requirements, encumbrance | **kept** |
| XP table, +5 points per level, hidden level gains, XP from damage share + kill bonus + mana cast | **kept** (table to level 40) |
| weapon skills in 7 families | **kept** (20, 40, 80… hits per level, +1 damage per level) |
| rune magic, 5 elements, 3 power levels, casting risk with fizzle and backfire | **kept**. There are 6 runes × 3 powers = 18 spells, as data in a small op-list language modelled on the original bytecode |
| monster flags (walks, attacks, hears, big, guard, shoots, casts) and battle AI order | **kept**: flee check, strike in front, turn to an adjacent character, shoot/cast along a line, path toward the party by breadth-first search, give up |
| cursor-held items, four floor piles per square, throwing | **kept**. Throwing is a battle action that uses the held item |
| paper-doll slots and backpack | **adapted:** head, neck, body, legs, feet, two hands, two rings, a quiver and 12 backpack slots. Bags and robes are dropped |
| wall niches that fire events | **kept**. The final puzzle uses one |
| food and water, sleeping with a 12 h budget, no HP regeneration awake | **kept**. Fountains refill water |
| automap: visited squares, wall kinds, symbols | **kept**, as a full-screen map plus a mini-map. Map notes are dropped |
| book / journal | **kept**: scrolls and events add pages |
| dialogues with choices, conditions, items, runes, joining, shops | **kept** as JSON dialogue graphs |
| shops with price factor | **kept**. Haggling is dropped |
| 10 save slots + autosave | **kept** (JSON saves; autosave on every level entry) |
| positional sound `32000 − 64000·d/(8+d)` | **kept** as a volume curve on Manhattan distance |
| step zoom and turn slide | **modernised**: the camera glides between squares and turns smoothly in real 3D |
| world map, flute puzzles, boats, lava, party splitting, demon form, haggling | **dropped** for scope |

## Presentation

- **Resolution.** The base resolution is 640×360, scaled by an integer factor to the window (1280×720 by default).
- **3D view.**
  - The view is 448×272 at the top left, rendered in real 3D by Godot with pixel textures. Filtering is nearest and there are no mipmaps.
  - Light comes from a torch carried by the party. Fog fades toward each level's fog colour, as the original did with its five fog palettes.
  - Monsters are billboard sprites that move between squares in real time. A square holds up to two monsters, or one big one.
  - Floor items stand in the four corners of each square.
- **Right panel** (192×272): a compass, the mini-map and the message log.
- **Bottom strip** (640×88): up to six character cards, each with a portrait and HP, stamina and mana bars.
  - A dead character shows a grey portrait.
  - In battle, the card shows the planned action.
- **Overlays** in the 3D view area: inventory, character sheet, book, full automap, dialogue, shop and rune picker.

## Controls

| key | action |
|---|---|
| W / ↑, S / ↓ | step forward / back |
| A, D | strafe left / right |
| Q / ←, E / → | turn left / right |
| Space | use the wall ahead (lever, button, door, keyhole, fountain, niche) |
| mouse in the view | click walls to use them, click floor items to pick them up, click with an item held to drop it (or throw it in battle), click NPCs to talk |
| I / 1-6 | inventory of the selected or numbered character |
| C | cast (rune picker) |
| M / Tab | automap |
| B | book |
| R | rest |
| F5 / F9 | quick save / quick load; Esc opens the menu, which has all 10 slots |
| in battle | 1-6 select a character; A attack, C cast, T throw held item, G guard (stand), F flee (whole party); Enter confirms; a movement key moves the whole party |

## Rules at a glance

These are the original formulas, applied as-is:
```
AP        = max(1, MOB/15)
MaxHP     = (3*STR + MOB)/2,  MaxMana = 2*MAG,  MaxStamina = 2*DEX     (at creation)
attack    = rnd(ATK_L..ATK_H) + (STR*15 + DEX*10)/150
defence   = rnd(DEF_L/crowd .. DEF_H) + DEX/5 (+10 if invisible), crowd = (defenders+1)/2
phys      = attack - defence; if > 0 then max(1, phys + DAMAGE)
magic     = rnd(MAG_L..MAG_H) * (100 - resist)/100
total     = phys + magic; if > 0 then max(1, total + weapon skill)
cast risk : MAG >= need: safe; MAG < need/2: impossible; else per1=(MAG-need/2)*128/need,
            per2=rnd(64): backfire if per1/2+32 < per2, fizzle if per1 < per2, else success
flee      : dper = taken*100/(hp+taken) + rnd(flee); perlives = (100-flee)*corlives*n/maxhp + rnd(flee)
```

Tuned numbers, which the original kept in data files that aren't in the source release:
- Regeneration stats are set at creation as HP regen `STR/4`, mana regen `MAG/3 + 2` and stamina regen `DEX/3 + 2`.
- Awake, every 10 s, stamina and mana gain `ceil(regen/10)`.
- Asleep, every game hour, each gains its full regen value.

## Content

**Levels:** each is a JSON file in `godot/content/levels/`.
1. **The Cellar Vaults.** Doors, a lever, a locked door, a hidden cache, the peddler Tamsin, and a portcullis held open by a pressure plate.
2. **The Cistern.** Water channels, a teleport loop that a lever switches off, a pit, and Maren in a cell.
3. **The Gate Hall.** A four-lever code lock, the Warden, and the Nether Gate's niche.

**Runes:**

| rune | element | I | II | III |
|---|---|---|---|---|
| Ember | fire | Ember Dart | Flame Bolt | Pyre (the whole square in front) |
| Rime | water | Chill | Ice Lance | Frost Ward (party fire resistance) |
| Spark | air | Spark | Arc | Stormcall (the whole square in front) |
| Mend | earth | Mend | Greater Mend | Circle of Mending (whole party) |
| Return | earth | Vigor (stamina) | Sanctuary (damage halved) | Return (raise the dead) |
| Sight | mind | Far Sight (map r4) | True Sight (map r8, reveal illusions) | Omen (map r15) |

**Monsters**, all rendered in Blender and cleaned up in the Aseprite step:
- cellar rat
- ooze
- bone guard
- grave wisp (caster)
- ghoul (drains HP)
- **the Warden** (big, casts, drops the Sealstone)

**NPCs:** Tamsin the peddler (shop) and Maren (joins the party).

## Walkthrough (spoilers)

**Level 1, the Cellar Vaults**
1. Read the note in the start room.
2. Pull the lever on the west wall to raise the south portcullis.
3. The storeroom east of the start holds bread, a dagger and leather armour, and two rats.
4. In the south corridor, the third stone of the north wall is a secret wall. The cache behind it holds the **Ember** rune and coins.
5. Tamsin the peddler sells potions and arrows.
6. The iron key lies in the storeroom niche. It opens the locked door to the plate crypt.
7. The portcullis to the stairs stays up only while the plate is pressed. Leave any item on the plate, walk through, and take the stairs down.

**Level 2, the Cistern**
1. Wading costs stamina.
2. Three teleports loop the party back to the landing until the lever in the flooded chapel switches the loop off.
3. The chapel gives the **Rime** rune. The shrine gives **Sight**.
4. A lever in the guard room raises Maren's cell. Talk to her to let her join.
5. The gold key is in the wisp's alcove. It opens the stair door down.
6. The pit in the drain room is a shortcut down to level 3, with fall damage.

**Level 3, the Gate Hall**
1. The **Spark** rune sits in the ossuary, and **Return** in the chapel of lamps.
2. Four levers, one on each wall of the Lever Room, must all be pulled down to open the hall. The book page "The Four Hands" hints at this.
3. Kill the Warden and take the **Sealstone**.
4. Place the Sealstone in the niche of the Nether Gate. The Gate seals, and the game ends.
