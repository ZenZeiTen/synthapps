# ADR 0001: Data-driven combat

- Status: accepted
- Date: 2026-05-12
- Deciders: combat team, lead designer

## Context

The first combat prototype hard-coded every skill as a function. Designers had
to ask a programmer to change a damage value, and balancing a single boss took
several days of round trips.

## Decision

Combat is data driven:

- Skills, items and enemies are described by data tables (power, element,
  target, cost).
- The damage calculation in `src/combat/damage.ts` is a set of pure functions
  over those tables. It has no hidden state, so it can be tested exhaustively
  and replayed from a battle log.
- The battle system (`src/combat/battle_system.ts`) owns turn order, random
  rolls and status effects, and calls the damage functions with explicit
  inputs.
- Elemental affinities live in one table in `src/combat/elements.ts`.

## Consequences

- Designers can rebalance by editing tables; programmers review the diff.
- Damage formulas need unit tests for every branch (see `tests/damage.test.ts`).
- Replays become possible: a seed plus the input log reproduces a battle.
- The data format is now a public contract between design and code; changes to
  it need a new ADR.
