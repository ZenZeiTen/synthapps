# Thornlash design notes

The source request is in `docs/source-plan.docx`: a 16-bit remake of *Castlevania* (NES,
1986). That game and its hero belong to Konami, so Thornlash is an **original homage**. The
genre's mechanics and structure are kept; every name, map, sprite and note is new. The table
below answers the plan item by item.

## Plan items: adopted, adapted, declined

| Plan item | Status | What Thornlash does |
|---|---|---|
| Simon Belmont, from the reference image | **Declined** (Konami IP) | An original hero, Corvin Ashdown, is a heroic whip-hunter in the same spirit. His costume is his own: a green hooded mantle, an oxblood jerkin, and iron bracers and pauldron. |
| Original maps, enemy placement, item locations | **Declined** (Konami's content) | Eighteen original blocks. They keep the pacing: an easy first stage, rising enemy density, a boss at every stage end. |
| Original soundtrack, arranged | **Declined** | Twelve original compositions. The plan's "NES or 16-bit soundtrack" option becomes an 8-bit and a 16-bit arrangement of the same tunes. |
| "Official Konami remake" feel | Adapted | An era-authentic presentation, with no claim of affiliation. |
| Godot 4, Aseprite, Blender, Git | Adopted | Godot 4.7.2. Every sprite has an `.aseprite` source. Blender was used for the castle blockout. Git repository. |
| Windows target, controller-first | Adopted | One-file Windows exe. SDL gamepad support (Xbox, PlayStation, Switch Pro, Steam Deck as XInput), plus the keyboard. |
| SNES-quality sprites, rich palettes, strong silhouettes | Adopted, within limits | The resolution is 320×224, the Genesis H40 mode. Each sheet uses a 15-colour palette plus transparency (4bpp), hue-shifted ramps, a light from the upper left and plum outlines. The pixels are painted by script, not by a human artist (see "Honest limits"). |
| Hero animation set, 6–12 frames per action | Adopted, mostly | Idle 6, walk 8, whip 6 (standing, crouching, air, stairs up, stairs down), throw 6, crouching throw 6, stairs 4 each way, die 8, jump 3, fall 2, crouch 2, hurt 2. The last four are short poses by design, following the platformer feel rule of one pose per phase. |
| Stages: entrance, courtyards, catacombs, towers, dungeons, clock tower, throne room | Adopted | Gatehouse (courtyard, hall, belfry), Catacombs, Ramparts and Tower Climb, Dungeons, Clockwork Spire, Throne of Ash. |
| Multi-layer parallax, torches, fog, rain, lightning, windows, background creatures | Adopted | Two to four parallax layers per area, animated braziers and lamps, fog bands, rain, lightning flashes (also seen through windows), bats crossing the far sky, and turning gears. |
| Preserve progression, boss order, stage structure, difficulty, resources | Adopted in kind | Linear stages of three blocks. Hearts are sub-weapon ammunition. Timer, lives and score, with an extra life every 20,000. Classic knockback. |
| Not a Metroidvania, open world, roguelike, soulslike, procedural | Adopted | Linear and hand-designed; stages 2–6 are generated from fixed builder calls. |
| Save anywhere, quick save, auto-save, several slots | Adopted | Three slots plus quick plus auto. Auto-save runs at each block. |
| Rewind: instant, configurable, frame history, toggle | Adopted | Off, 5, 10, 20 or 30 s. Every frame is snapshotted. It speeds up after 0.75 s, and it can undo a death. |
| Difficulty, infinite lives, practice, remapping, game speed | Adopted | Easy, normal, hard. Infinite lives. Practice starts any stage with full whip and 30 hearts. Keyboard and pad rebinding. Game speed 50–100%. |
| Controller rebinding, custom layouts, vibration, dynamic prompts | Adopted | Per-action rebinding saved to `input.cfg`. Rumble on hurt, boss hits and boss deaths. Prompts use Xbox, PlayStation or Nintendo names. |
| Steam Input / Steam Deck | Partly | These arrive as SDL/XInput devices and work as Xbox pads. There is no Steamworks integration. |
| Larger bosses with clear telegraphs | Adopted | Examples: the Nightwing's perch before each swoop, the Warden's 30-frame overhead swing before a slam, and the Chainmaster crouching to leap before a shockwave. |

## Mechanics: kept, adapted, added

| Mechanic | | Why |
|---|---|---|
| Whip: 7-frame wind-up, 8 active, 7 recovery; three levels | Kept (genre) | The heart of the genre: commitment and range. |
| Classic jump: fixed arc, no air control, straight drop off ledges | Kept | Available as the *Classic* control feel. |
| Rise on the press frame | Adapted | A modern player reads any delay as input lag. |
| Knockback on hit, invulnerability afterwards | Kept | *Modern* reduces it and returns control after 14 frames. |
| Stairs mounted by holding Up or Down near an end, with auto-walk to the step | Kept | |
| Up + Whip throws the sub-weapon | Kept | A dedicated sub-weapon button is added as well. |
| Enemies respawn from their spawn points when scrolled back into view | Kept | |
| Hitboxes sized to the 16-bit art: hero 40 px tall, lash at hand height | Adapted | NES proportions (28 px) did not match 46 px sprites. |
| Boss intro line, two-phase final boss, ending pages and credits | Added | The story beats players expect. Each is checked by the harness. |

## Honest limits

- **The art is scripted, not hand-drawn by a human artist.** Characters are painted from 2D
  rigs with pseudo-normal shading, and icons are authored as character grids. It reads as
  clean 16-bit sprite art. It is not at the level of a professional pixel artist's Super
  Castlevania IV work, so expect to want touch-ups. The `.aseprite` sources are there for
  that, and the export reads them back.
- **The music and sound were measured, never heard.** Checks cover length against the score,
  clipping, loop seams and every name having a file. Judge the mix and melodies yourself.
- **No live gamepad hardware was tested.** The rebinding and prompt code paths run in the
  harness through synthesised events.
- **Balance was tuned against a simple bot,** which proves every boss can be beaten and can
  hurt the hero. Human difficulty feel still needs play.
