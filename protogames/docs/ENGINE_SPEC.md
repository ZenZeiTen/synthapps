# Engine specification

The game logic exists twice: `web/src/core.js` for the browser and
`godot/scripts/core.gd` for Godot. It is written line-for-line in the same plain style,
so a change to one ports mechanically to the other. This document is the contract
between them.

The proof that they agree is `tests/transcripts/*.txt`. Both engines replay the same
golden files and must regenerate them byte for byte.

The core is **pure**: no DOM, no clock, no randomness. Given a state and a typed line it
returns a list of events. Everything that moves, draws or makes noise is the
presentation layer's job (`web/src/main.js` + `world.js`, `godot/scripts/main.gd`).

## The content package

```
content/
  game.json                 all rules and text (below)
  rooms/<room>/room.json    walk mask, points, zones, markers, overlays, depth range,
                            optional probes (walkability assertions, tests only)
  rooms/<room>/bg.png       320x168 EGA background
  rooms/<room>/depth.png    R scene depth (1..254 near->far, sky = 255), G floor depth
                            under walkable pixels, B walk mask (255 = walkable)
  rooms/<room>/ov_*.png     state overlays: pixels that change when a state is on
  sprites/*.png + *.json    sheets and Aseprite sidecars; anims.json holds anchors and cycles
  font/font.png + font.json 5x9 glyphs in 6x10 cells
  sfx/*.wav + sfx.json      sound effects
```

`game.json` top level: `meta`, `start`, `reach`, `intro`, `text`, `vocab`, `objects`,
`scenery`, `rooms`, `rules`, `hints`.

## State

```js
{ room, pos: {x, y}, face, flags: {}, loc: {}, score, awarded: {}, turns,
  dead, won, visited: {}, lastNoun }
```

- `loc[objectId]` is `'inv'`, a room id, or `null` (not in the world yet).
- `snapshot()`/`restore()` are plain JSON. Save games, and the death screen's history,
  store only this.

## Parser

1. **Normalise.** Lowercase the line, turn every non-alphanumeric character into a
   space, split, and drop filler words (`vocab.fillers`). "Pick up the key!" and
   "pick up key" become the same tokens.
2. **Unknown words fail fast.** A token that no verb, noun, direction, preposition,
   pronoun or filler uses produces `unknown_word`, naming the word.
3. **Verb.** Take the longest known verb phrase at the start ("look under" beats
   "look"). If none matches and the first token is a direction, the verb is `go` and
   that word is the direction. A movement verb (`go climb enter exit jump`) followed
   by a direction takes the direction too.
4. **Nouns.** Split the rest at the first preposition. Each side is scanned for the
   longest noun phrase from the entities' `words`. A pronoun (`it`, `them`…)
   resolves to `lastNoun`. With nothing before the preposition, the first noun after
   it becomes noun 1.
5. **Resolve** each noun phrase to an entity id:
   - Among entities present in the room, a single match wins.
   - If there are several: `take` prefers one lying in the room, and every other verb
     prefers one being carried.
   - If none is present, the id is still resolved but marked **absent**.
6. `look <noun>` becomes `examine`. A verb whose `noun` is `required` asks "What do
   you want to …?" when no noun or direction was given. `turns` and `lastNoun` update
   only for commands that get this far.

## Rules

`rules` is an ordered list. The **first** rule that matches wins. Fields:

| field | meaning |
|---|---|
| `verb` | a verb id or a list of them. Special verbs: `@enter` and `_exit` (below) |
| `noun` | an entity id, a list of ids, or `"*"` (any noun). If absent, the rule only matches a command that has **no** noun |
| `noun2` | the same for the second noun |
| `pair` | `[a, b]`: matches the two nouns in either order ("use key on door" = "use door with key") |
| `room` | a room id or list of them. Omitted means anywhere |
| `if` | conditions (below). All must hold |
| `near` | an entity id. If the rule matches but Gus isn't within reach of it, the answer is "You're not close enough" and no effects run |
| `absentOK` | allow the rule to match nouns that aren't in the room (such as "call Crumpet" from another room) |
| `do` | effects, in order |

If no rule matches: an absent noun gets "You don't see that here". Next, the noun's
own canned text for that verb (`verbs: { smell: "…" }` on the entity) is used. Last,
the built-in defaults apply: `look`, `examine`, `inventory`, `score`, `help`, `wait`,
`hint`, `take`, `drop`, movement, the meta commands, and then the verb's own
`default` text.

**Reach** is an ellipse, `rx 36, ry 18` pixels (`game.json` → `reach`), around the
entity's `at` point. It is twice as wide as it is deep, because the picture is
foreshortened.

### Conditions

`{flag: f}`, `{not: f}`, `{has: obj}`, `{hasnt: obj}`, `{at: [obj, place]}`,
`{notat: [obj, place]}`, `{room: r | [..]}`, `{notroom: r | [..]}`, `{near: entity}`.
A list means AND. There is no OR; write two rules.

### Effects

Each effect may carry its own `if`, and is skipped when that fails.

| effect | does |
|---|---|
| `{say: text}` | print text, with `{score}` and `{max}` filled in |
| `{set: flag}` / `{clear: flag}` | flags are simply present or absent |
| `{move: [obj, place]}` | `'inv'`, a room id, or `null` to remove from the world |
| `{score: [points, id]}` | awarded once per id, ever. Replays of the action score nothing |
| `{sound: name}` | a named effect from `sfx.json` |
| `{die: text}` | sets `dead` and **stops** |
| `{win: text}` | sets `won` and **stops** |
| `{goto: [room, point, face]}` | changes room and **stops** |
| `{stop: true}` | stops. In an `_exit` hook it vetoes the transition |
| `{redirect: [verb, n1, n2]}` | runs the command as if typed ("light match" → "light candle"). It stops if the redirected command did. Redirects nest up to 5 deep |

### Entering rooms and using exits

- **`@enter` rules** run on every room change, for the new room. *All* matching rules
  run, in order, before the first-visit description. The front door slams shut this
  way.
- **Exits** live in `rooms.<id>.exits`, with these fields:
  - `dir` (words such as `north` or `up`) and `nouns` (entities that mean this exit,
    such as `stairs`)
  - `zone`, the polygon in `room.json`
  - `to`, `at` and `face` for the arrival
  - `when`, the conditions under which it opens, and `blocked`, the text shown when
    it doesn't
  - `silent`: when `when` fails, Gus just walks over it (the kitchen trapdoor while
    it's shut)
- An **`_exit` rule** for an exit is a hook. It runs when Gus steps into the zone, and
  can add effects, score, kill (a dark cellar), or `stop` to veto. If it doesn't stop,
  the default transition happens.

Typed movement doesn't teleport. The core emits `walkto {exit}` and the presentation
walks Gus into the zone, which then calls `enterZone`. "go to door" when the door is
shut emits `walkto {point}` instead: Gus walks up to it rather than bumping into it.

## Events

The core returns `{t: ...}` objects. Each engine renders them. The transcript harness
renders them as text:

| event | transcript line |
|---|---|
| `say` | the text |
| `score` | `[score +5 = 15]` |
| `room` | `[room hall]` |
| `sound` | `[sound creak]` |
| `die` | `[died] …` |
| `win` | `[won] …` |
| `meta` (save/restore/restart/quit) | `[meta save]` |
| `walkto` | `[walk to clock]` / `[walk x_hall_west]` |

## Golden transcripts

`tests/transcripts/*.txt` interleave input and expected output. Only input lines are
read; everything else is regenerated and compared.

| line | meaning |
|---|---|
| `@start` | new game, prints the opening room |
| `> text` | a typed command |
| `@near <entity>` | teleport Gus to that entity's point |
| `@at x y` | teleport Gus to a pixel |
| `@walkin <exitId>` | walk into the exit's zone on foot, as the arrow keys would. Prints `[blocked]` if refused |
| `# …` | comment |

Rules for keeping them honest:

- Geometry-dependent steps use explicit `go to` commands or `@at`, never
  luck.
- After changing content or engine behaviour, re-record with
  `node tools/record.mjs <file>` and read the diff. Recording blesses whatever the
  engine does now.
- `tests/mutation.mjs` (JS) and `tests/mutation_godot.py` (GDScript) plant faults in
  the cores and require the transcripts to catch every one.

## Presentation contracts

These live outside the core but both engines must honour them for the game to
feel the same.

- **Screen.**
  - 320x200: a 10 px status line, the 168 px picture, then the input line.
  - Tick every 40 ms. Gus walks 2 px across or 1 px up and down per tick.
  - The display is 4:3, or 8:5 with square pixels (F4 in the web build).
- **Walking.**
  - The walk mask is RLE rows in `room.json`. Arrow keys move Gus, sliding along a
    blocked axis.
  - The mask is the room's floor plan seen through the camera: walkable surfaces minus
    every object's footprint. Floor behind freestanding furniture is walkable, and the
    depth test hides Gus there. Only walls hide the floor behind them.
  - `room.json` may carry `probes` (spots declared walkable or blocked). The runtime
    ignores them; `tests/lint.test.mjs` checks them. It also checks that every point
    is reachable on foot, and every exit zone can be walked into, from where Gus
    enters. An exit zone must overlap the picture: walking off the bottom of the gate
    is how a player tries to go home.
  - Click-to-walk and `walkto` use A* over the mask. A route must **avoid every exit
    zone except the one it was sent to**, or a path across the foot of the stairs
    goes upstairs.
  - A walk that jams still delivers its arrival, so a typed exit is never stranded.
- **Depth.** A sprite pixel is hidden where the scene is more than 2 depth steps
  nearer than the sprite's feet, which is how Gus passes behind the armour and the
  bed.
- **Overlays.**
  - `rooms.<id>.overlays` in `game.json` maps each overlay to conditions. The core's
    `overlays(state)` lists the ones that hold.
  - `room.json` says whether each overlay is an image (`ov_<state>.png`) or an item
    sprite frame at its marker.
- **Effects.**
  - The cellar (`dark: true`) is black outside a dithered circle around Gus while the
    candle burns.
  - Lightning flashes only sky pixels (scene depth 255), so the house stays a
    silhouette.
- **Death** opens a dialog with these options:
  - **U**: undo the fatal step. `deathOptions()` in `web/src/death.js` picks the
    newest snapshot that isn't itself dead. That's the moment before the fatal
    command, or the last room change if Gus walked into trouble. Using it drops that
    snapshot from the history, so the next death undoes the step before.
  - **R**: restore the save. Offered only when an F5 save exists.
  - **S**: start over.
  - Godot's twin of the policy is `death_options` in `main.gd`.
    `tests/death.test.mjs` and `godot/tests/death_policy.gd` check both engines
    against the same cases.
