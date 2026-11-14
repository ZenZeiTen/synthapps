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
| Opening (5 pages: the Crown legend, the Baron, the wardens) | after choosing a player | title to first hand |
| Episode card, rival lore and intro | before each of the five floors ("EPISODE n: ROOM") | title to first hand |
| Interlude: mini-boss lore and intro | between floors ("INTERLUDE: PLACE") | mini-boss between floors |
| Rival's last word | after each match | winning a floor |
| Scene before the boss (4 pages: the Baron's past) | before floor 5 | boss floor gets its own scene |
| Ending (5 pages: the cracked mask, the Crown) | after the boss | beating the boss |

The ladder is nine matches: five floors, each followed by a mini-boss ("warden") except
the last. Wardens (Tetsu, Suzu, Kagero, Q-7) are lesser rivals: 500-chip stacks instead
of 800, one power, simpler play, and they share the room of the floor before them. Their
match end reads "WARDEN DOWN!!". The score table shows "STAGE n OF 9".

Text boxes: story pages are 80 characters by 5 lines; a longer page is split into more
pages, never cut off. The match-end panel grows with the rival's last word; the hand result
panel sits on the right, over the meter and powers, so the hole cards, the player's portrait
and the bet buttons stay visible. Any paragraph that runs past its box is reported to the
`fit` harness check.
| Credits, score table, title | after the ending | beating the boss; credits end by themselves |

## Pace and motion

Changed after the first player report ("moves too quickly, animations feel clunky").
Guidance used: interface motion reads best at about 100 to 400 ms with an ease-out curve,
and 500 ms or more starts to drag (Nielsen Norman Group, "Executing UX Animations";
Microsoft "Timing and easing"; Febucci, "Easing functions"). So every move is short and
eased, and the slowness the player asked for comes from the pauses between moves.

| Thing | Motion (60 ticks = 1 s) | Pause after it at RELAXED / NORMAL / FAST |
|---|---|---|
| Card dealt | 18-tick eased slide from the deck with a small arc, then a 14-tick flip | cards 12 to 16 ticks apart |
| Chips | 20-tick eased arc from seat to bet spot, bet spot to pot, pot to winner | |
| Rival's turn | thinking dots beside the portrait | 105 / 70 / 42 ticks |
| After your action | | 60 / 40 / 24 |
| New street | board cards slide and flip one by one | 90 / 60 / 36 plus the deal |
| Showdown | rival cards flip one after the other | 120 / 80 / 48, then 75 / 50 / 30 |
| Result panel | 16-tick slide in from the left | waits for a press |
| Cut-in | band opens, eyes slide in, band closes: 100 ticks | game holds meanwhile |
| Pot and chip counts | count towards the new value | |
| Story text | 1 character a tick (was 2) | |

PACE is in the options menu and defaults to RELAXED. A confirm press during a pause
shortens it to 12 ticks, so nobody has to wait if they do not want to.

## Rooms and colour

Each floor has its own Blender-built room and felt, and the table panels take an accent
colour that matches it. Felt colours follow the traditional poker set (green, burgundy,
blue, teal, black), kept mid-dark and low-contrast so cards stay the brightest thing on
screen; warm accents (gold, orange, crimson) mark what needs a decision.

| Floor | Rival | Room | Felt | Accent |
|---|---|---|---|---|
| 1 | Pochi | Lobby Pit, dusk | emerald | gold |
| 2 | Goro | Garage Deck, sodium lights | burgundy (reads rust) | orange |
| 3 | Yuki | Snow Garden, moonlit | royal blue | ice |
| 4 | Zeno | Odds Laboratory | teal | lime |
| 5 | Onyx | Starlight Table, storm | dark crimson | crimson |

## Known limits

- Portraits are painted by script, not by hand; see `tools/art/README_portraits.md`.
- Nobody has listened to the music; it is checked by numbers only (length, level, loop seam).
- Summer Engine has no Linux build, so the project was run in Godot 4.7.2 and 4.4.1 only.
