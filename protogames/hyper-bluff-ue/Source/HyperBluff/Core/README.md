# Hyper Bluff!! rules core (C++)

The rules of the Godot game (`hyper-bluff/godot/scripts/core/`) ported to standard C++17 for
the Unreal Engine 5 project. No Unreal headers, no exceptions, no RTTI, no global mutable
state (the only statics are `const` tables built on first use). Everything is in `namespace hb`.

## Files

| C++ | Godot | What |
| --- | --- | --- |
| `HBCards.h/.cpp` (`hb::cards`) | `cards.gd` | card ints, `Roll` (the LCG), `Eval`, `NameOf`, `EquityBatch` / `Equity` |
| `HBGame.h/.cpp` (`hb::game`, `hb::State`) | `game.gd` | hold'em, blinds, powers, missions, stars, fever, scoring, run flow, saves |
| `HBAi.h/.cpp` (`hb::ai`) | `ai.gd` | `Think`, `Play`, `DefaultProfile` (= `Ai.DEFAULT`) |
| `HBData.h/.cpp` (`hb::data`) | `data.gd` | cast, profiles, powers, missions, story, credits (text copied verbatim) |

Function names map one to one: `start_hand` is `game::StartHand`, `use_power` is
`game::UsePower`, `Cards.equity` is `cards::Equity`, and so on. The state is one plain struct,
`hb::State`, with the same fields as the Godot dictionary `s` (phase, street, button, to_act,
stack, bet, total, hole, board, runout, deck, stars, star_pot, fever, mission, powers, fx,
result, events, score, match, rival, avatar, continues, blind, last_raise, acted, folded,
allin_seen, hand_no, rng_deck / rng_ai / rng_bonus, `bot`).

Small enums are used internally (`Phase`, `Action`, `Shown`, `Power`, `MissionId`,
`EventType`); `PhaseName`, `PowerName`, `ShownName`, `MissionName`, `EventTypeName` (and the
`...FromName` helpers) give the exact strings the Godot UI and saves use ("hand_over",
"glare", "allin", ...). Differences in shape, not in rules:

- `rival` is the ladder index (0..8) into `data::kRivals`, not the name. The ladder is five
  floors with a warden (`CastEntry::mini`, own `stack`) between each; `room`, `episode`,
  `lore` and `data::EpisodeLabel` mirror data.gd's fields and `episode_label`.
- `stars` is a vector of (index, value) pairs in insertion order (a Godot dictionary keeps
  insertion order; nothing reads it out of order).
- An empty Godot `mission` / `result` dictionary is `MissionId::None` / `Result::set == false`.
  A "no power" string (`""`) is `Power::None`.
- `s["bot"]` is `has_bot` + `bot`.
- `game::Serialize` / `Deserialize` are a compact text save of the whole state (not Godot's
  `var_to_str` format). The tests use them where the Godot tests use `var_to_str`.

## Determinism (bit-exact with Godot)

The parity check (below) plays the same seeds in Godot and in C++ and compares the RNG state
after every step, so these details matter:

- **64-bit wrap-around.** GDScript ints are signed 64-bit and wrap. `Roll` does
  `x = box * 6364136223846793005 + 1442695040888963407` in `uint64_t` and converts back with
  `WrapI64`, which avoids the implementation-defined `uint64 -> int64` cast. The seeds
  (`seed * 2654435761 + 1`, `* 40503 + 7`, `* 69069 + 3`) use `WrapMulAdd`.
- **The shift.** GDScript's `>>` is arithmetic, but `& 0x7FFFFFFF` keeps only bits 33..63, so
  the logical shift of the unsigned value gives the same result.
- **Division and modulo.** GDScript `/` truncates toward zero and `%` takes the sign of the
  dividend, like C++. Every `/` and `%` in the rules has non-negative operands (pot halves,
  `score / 2`, raise sizes `x - x % 5`, blind level, guard refunds), so there is no sign case.
- **Short-circuit.** `fever = hand_no > 1 and roll(...) < 12` does not roll on a match's first
  hand; the C++ `&&` keeps that.
- **RNG order.** Every roll happens in the GDScript order: deck shuffle, fever, mission (and
  its suit), blinds; per board card a star roll then its value roll, a 777 then a power grant;
  the AI's equity samples before its decision roll; Hawk's coin. Loops over powers, missions
  and stars keep the Godot iteration order.
- **Floating point.** The AI's thresholds are double expressions in the same operand order.
  Do not let the compiler fuse multiply-adds: build with `-ffp-contract=off` (GCC/Clang) and
  keep MSVC on `/fp:precise` without `/fp:contract` or `/fp:fast`. `int(x)` is a truncating
  `static_cast<int>`.
- **No platform `long`.** Fixed-width `int64_t` / `uint64_t` / `int` only; no VLAs, no
  `__int128`, no GNU extensions.

## Checks

```bash
bash hyper-bluff-ue/tests/run_core_tests.sh
# [g] CORE TESTS 49/49 passed
# [clang] CORE TESTS 49/49 passed
# PARITY ok: 200 seeds, <steps> steps (...)
```

- `tests/core/test_core.cpp`: the Godot rules tests (`godot/tests/run_tests.gd`; `t_story_pages_fit` is in `tests/app`) with the
  same names and assertions, plus 8 `t_dc_*` tests for Director's Cut. `ONLY=name` filters.
- `tests/parity/dump.gd` + `tests/parity/parity_dump.cpp`: twin dumpers. For 200 seeds x
  9 starting matches (the whole ladder) they play bot runs (seat 0 on `Ai.DEFAULT`; a capped run stops at its third
  match end so lost matches are continued; seeds divisible by 25 also play a whole run to
  `run_won`) and write one line per step: phase, street, to_act, stacks, bets, totals, board,
  stars, star pot, fever, mission, score, powers, fx, the three RNG states and the step's events;
  at each deal the cards and two `EquityBatch` estimates with fixed boxes; at each settle the
  whole result. Then 2,000,000 random 5-7 card `Eval`s (hashed, with `NameOf` samples), 60,000
  2-4 card sets, and every data string and constant. The script builds the dumper with g++ and
  clang++ and `cmp`s each against Godot. The Godot side takes about 3 minutes on 4 cores and is
  cached in `tests/build/parity/<hash of the .gd files and parameters>`.

## Director's Cut: "CUT! RETAKE" (C++ only)

A new power for the "Director's Cut" jam theme. The Godot game is unchanged, and so is the C++
game unless `State::director_cut` is true (`game::NewRun(seed, avatar, true)`); the parity runs
leave it false.

- id `retake`, name `CUT! RETAKE`, desc `Reshoot the newest table card(s).`
- **When:** by the seat to act, in `bet`, on street 1-3, only before anyone has bet or checked on
  this street (`bet == [0, 0]` and neither seat has acted), once per seat per hand
  (`fx.retake`), and only if the deck still holds enough cards.
- **What:** the cards this street dealt (3 on the flop, 1 on turn or river) are replaced by cards
  popped from the end of `deck`, in board order. The old cards are discarded (not returned to
  the deck). `runout[i]` is set to the new `board[i]`, so `runout` stays the board plus the
  undealt cards and Future Sight still shows the real next card. Stars on the replaced indexes
  leave `stars` and `star_pot`; each new card rolls for a star with the usual rules (fever
  chance, weights, 777 grants a power), emitting `star` events before the `power` event.
- **Pool:** with `director_cut` on, `retake` is the seventh entry of `data::PowerIds(true)`, so
  grants can give it, and Baron Onyx starts with `swap, glare, guard, hawk, retake`.
- **AI:** uses it on the flop or turn when its equity on the board it knows is below 0.35.
- A retake counts as a used power (`fx.used`, so it spoils "WIN WITHOUT USING A POWER").

Rule choices made where the brief was open:

- "Board dealt this street" is checked as `board.size() == street + 2`.
- The river is allowed for players; the AI only reshoots flop and turn.
- A power granted by a 777 on a replaced card is kept; a re-rolled 777 can grant another.
- Onyx's start of five powers is above `MAX_POWERS` (3); as in Godot (where he already has
  four), the cap only limits grants.
