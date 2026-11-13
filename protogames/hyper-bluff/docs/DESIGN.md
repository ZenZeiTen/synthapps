# Design

Everything here is original: names, faces, text, tunes, table art.

## Rules

Heads-up no-limit Texas hold'em, 800 chips each, blinds 10/20 rising every 3 hands
(`Game.BLINDS`). The button posts the small blind and acts first before the flop, last
after it. A raise must be at least the last raise; bets are capped at what the other
seat can call. A match ends when one stack is empty.

Score (player only, on a won hand): chips won + hand bonus at showdown (pair 100 up to
royal flush 25000) + bonus mission + star pot, times 2 with Overdrive, times 3 in a fever
hand. Clearing floor n adds 2000 x n. Continuing after a lost floor halves the score.

| Random bonus | Chance | Effect |
|---|---|---|
| Bonus mission | every hand, 8 kinds, weighted | 150 to 1500 points if met on a win |
| Star card | 15% per table card (40% in fever) | 100/200/300/500/777/1000 into the star pot; 777 also grants a power |
| Fever hand | 12% from hand 2 on | points x3, a free power, fever music |

| Power | Effect |
|---|---|
| Hawk Eye | reveal one rival hole card (the meter then uses it) |
| Wild Swap | replace your lower hole card from the deck |
| Iron Guard | lose a showdown, get half your bet back |
| Overdrive | this hand's points x2 |
| Future Sight | see the next table card early |
| Demon Glare | the other seat cannot raise this betting round (a rival also folds unless strong) |

Aura Meter: Monte Carlo win chance against one unknown hand, 60 samples a step up to
480, from the cards the player may know. It never touches the game's own random numbers.

Rivals: Pochi (calls too much), Goro (raises and bluffs), Yuki (tight), Zeno (balanced,
three powers), Onyx (aggressive, four powers). They decide from the same win-chance
estimate plus pot odds; see `core/ai.gd`.

## Input map

| Action | Keys | Pad | Mouse | Check |
|---|---|---|---|---|
| up/down/left/right | arrows, WASD | D-pad | hover | cursor answers on the same step |
| ok | Z, Enter, Space | A | click | title to first hand (keys / mouse) |
| cancel | X, Backspace | B | | options from the pause menu |
| pause | Esc, P | Start | MENU | pause opens over the table |
| fold / call / raise | F / C / R | LB folds | buttons | fold key; raise sizes |
| raise size | up / down | D-pad | wheel, - + | raise sizes |
| power1..3 | 1 2 3 | X, Y, RB | icons | power keys and pad button |

Press to visible motion: one step for every control (cursor and button highlight change
on the tick of the press). Screen changes ignore presses for 12 ticks and story pages for
15, so a held or repeated confirm cannot act on the next screen.

## Story beats

| Beat | Where | Check |
|---|---|---|
| Opening (3 pages) | after choosing a player | title to first hand |
| Rival intro, last word | before and after each floor | winning a floor |
| Scene before the boss (3 pages) | before floor 5 | boss floor gets its own scene |
| Ending (3 pages) | after the boss | beating the boss |
| Credits, score table, title | after the ending | beating the boss; credits end by themselves |

## Known limits

- Portraits are front-view busts painted by script; the review notes call the art
  serviceable, with Jiro's hair and the boss mask the weakest shapes.
- Nobody has listened to the music; it is checked by numbers only (length, level, loop seam).
- Summer Engine has no Linux build, so the project was run in Godot 4.7.2 and 4.4.1 only.
