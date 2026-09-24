# Design notes: The House on Crowmere Hill

> **Spoilers.** This file contains every puzzle, every death and the full walkthrough.

## The pitch

It's a dark and stormy night (it usually is). Gus Pickett is a paperboy, twelve and
three-quarters, with one newspaper left to deliver. His dog Crumpet has just chased a
crow through the gate of the old Crowmere house. Gus goes in after him. The front door
slams behind him, so the only way out is through.

The goal is small and warm: **find your dog and get out**. The house isn't evil, just
very old, very dark, and full of things you shouldn't touch.

## What the homage keeps, and what it doesn't

The game is written in the idiom of the 1990 EGA parser adventures:

- 16 colours at 320x200
- arrow-key walking plus a typed parser
- a score counter
- sudden, comic deaths that punish curiosity

Everything else is original to this project: the characters, the house, the puzzles,
the text, the art and the sound. No other game's assets, names or writing are used.

A few modern kindnesses soften the period rough edges without changing the feel:

- **"go to &lt;thing&gt;"** walks Gus there. Most commands need him within reach
  (an ellipse 36x18 px around the thing), and the game says "You're not close enough"
  rather than failing silently.
- **Typed exits** ("west", "go upstairs") walk Gus to the doorway, so nobody has to
  pixel-hunt for an exit.
- **`hint`** gives the next step for the current situation (20 context hints).
- **Undo after death** is an open question left to the owner. See
  `web/src/death.js`.

## Map

```
                    [bedroom]
                        | up / down (stairs)
[library] -- west -- [hall] -- east -- [kitchen]
                        |                  | trapdoor (needs light)
               front door (slams)       [cellar] -- coal chute --> out (win)
                        |
                     [gate]
```

## The puzzle chain

Each step unlocks the next, and every item has exactly one job.

1. **Gate.** The doormat says GO AWAY and has a lump under it. Looking under it
   finds the **brass key**, which unlocks the front door.
2. **Hall.** The door slams behind you. The grandfather clock's case hides a box of
   **matches**.
3. **Library.** The writing desk's drawer holds a **silver whistle**. The skeleton's
   book (*Birds of Crowmere Hill*) explains the crow puzzle: the crow hoards shiny
   things and can't abide a shrill whistle. Giving the skeleton your newspaper scores
   nothing and completes the delivery.
4. **Kitchen.** The chopping table has a **candle**, and the matches light it. The
   pantry holds **Crunchy Bones** dog biscuits.
5. **Bedroom.** Crumpet's **collar** lies on the floor, gritty with coal soot. That's
   the clue that he's gone down to wherever the coal is. Outside the window, the crow
   guards its nest, and the **iron key** glints in it. Blow the whistle to scare the
   crow away, open the window, and take the key.
6. **Kitchen, again.** Open the trapdoor and go down. Going down *without* a lit
   candle is a death.
7. **Cellar.** Crumpet is hiding behind the crates. Shake the biscuits to bring him
   out, and buckle his collar back on. The iron key opens the padlock on the coal
   chute. Go out: Crumpet follows, you're free, and somewhere inside a skeleton is
   reading tomorrow's paper.

## Score: 80 points

| points | for |
|---:|---|
| 5 | taking the brass key |
| 5 | unlocking the front door |
| 5 | taking the matches |
| 5 | taking the whistle |
| 5 | taking the candle |
| 5 | lighting the candle |
| 5 | taking the biscuits |
| 5 | taking the collar |
| 5 | scaring off the crow |
| 5 | taking the iron key |
| 5 | reaching the cellar |
| 10 | rescuing Crumpet |
| 5 | opening the coal chute |
| 10 | escaping |

## Eight ways to die

Each death punishes a reasonable curiosity with a joke, never a gotcha.

| where | what kills you |
|---|---|
| gate | disturbing the gravestones (dig, search, move, look under…): a bony hand |
| hall | touching the axe or the suit of armour, which objects strongly |
| library | climbing the bookshelf for a better look |
| kitchen | tasting what bubbles in the cauldron |
| kitchen | going down the trapdoor in the dark |
| bedroom | looking under the bed: two yellow eyes |
| bedroom | climbing out onto the window ledge |
| cellar | drinking from the bottle labelled NOT WINE |

## Walkthrough

This is the winning route that `tests/transcripts/walkthrough.txt` replays in both
engines, scoring 80 of 80. The golden file adds a few checks along the way, listed
after the route.

```
go to doormat
look under doormat
take key
go to door
unlock door
open door
go north
go to clock
open clock
take matches
west
go to desk
open drawer
take whistle
go to skeleton
read book
give newspaper to skeleton
east
east
go to table
take candle
light candle
go to pantry
open pantry
take biscuits
west
up
go to collar
take collar
go to window
blow whistle
open window
take key
down
east
go to trapdoor
open trapdoor
down
give biscuits to crumpet
put collar on crumpet
go to chute
unlock chute
go out
```

The golden file also checks these points along the route:

- `look under doormat` from the gate path must answer "You're not close enough".
- `take key` at the window must be refused twice: first by the crow, then (after
  the whistle) by the closed window.
- `inventory` and `score` must show the running state.
