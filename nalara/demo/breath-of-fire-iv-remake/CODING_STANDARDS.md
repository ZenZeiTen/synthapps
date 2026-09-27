# Coding standards

These rules apply to everything under `src/`. Reviewers should block a change
that breaks one of them unless the pull request explains why.

1. **No `any`.** Use `unknown` and narrow it, or write the type. Event payloads
   get a discriminated union, not `any`.
2. **Damage formulas are pure.** Functions in `src/combat/damage.ts` take all
   inputs as arguments and never read global state, random numbers or the
   clock. Randomness (critical hits, misses) is rolled by the battle system and
   passed in.
3. **Every module has tests.** Each file in `src/` has a matching test in
   `tests/`. A new module without tests is not ready to merge.
4. **No magic numbers.** Tuning values (multipliers, caps, prices) are named
   constants or live in data tables, so designers can find and change them.
5. **Explicit `.ts` import extensions.** Node runs the sources directly, so
   relative imports spell out the extension: `import { x } from "./items.ts"`.
6. **No enums or constructor parameter properties.** Both need a compiler;
   type stripping does not support them. Use string unions and plain fields.
7. **Player-facing text is never hard-coded in logic.** Messages go through a
   string table so the Indonesian localization can replace them.
