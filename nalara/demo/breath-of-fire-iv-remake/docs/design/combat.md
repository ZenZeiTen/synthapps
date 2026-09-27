# Combat design

Owner: combat team. Related decision: [ADR 0001](../adr/0001-data-driven-combat.md).

## 1. Battle flow

Battles are turn based. Each round, every combatant acts once in order of
agility (highest first, ties broken by party order). The battle ends when one
side has no conscious members.

## 2. Damage calculation

Physical damage:

```
base = attack * power / 16 - defense / 2
damage = base * elementMultiplier * (critical ? 1.5 : 1) * (guarding ? 0.5 : 1)
```

Magic damage uses `magic` against `spirit` with the same shape. Damage is
clamped to the range 0..9999. The implementation is `calculateDamage` in
`damage.ts`.

## 3. Elements

Five elements: fire, ice, wind, earth and holy. A weakness doubles damage, a
resistance halves it, and an absorb turns the damage into healing. The table is
in `elements.ts`.

| Attack \ Target | Fire | Ice | Wind | Earth |
|---|---|---|---|---|
| Fire | 0.5 | 2.0 | 1.0 | 1.0 |
| Ice | 2.0 | 0.5 | 1.0 | 1.0 |
| Wind | 1.0 | 1.0 | 0.5 | 2.0 |
| Earth | 1.0 | 1.0 | 2.0 | 0.5 |

## 4. Combos (planned)

Consecutive attacks of related elements in the same round chain into a combo
with a bonus multiplier. Not implemented yet.

## 5. Open questions

- Should guarding also reduce magic damage?
- Do critical hits ignore resistances?
