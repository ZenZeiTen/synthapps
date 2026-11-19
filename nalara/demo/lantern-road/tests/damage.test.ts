// Demo content: tests for the sample game project, run with `npm test`
// (node --test) inside this folder. Nalara's own vitest suite does not run them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateDamage, calculatePhysicalDamage, clampDamage, MAX_DAMAGE, type CombatStats } from "../src/combat/damage.ts";
import { elementMultiplier } from "../src/combat/elements.ts";

const hero: CombatStats = { level: 10, attack: 40, defense: 20, magic: 30, spirit: 18, agility: 25 };
const slime: CombatStats = { level: 3, attack: 12, defense: 10, magic: 5, spirit: 8, agility: 6 };

test("physical damage subtracts half the defense", () => {
  assert.equal(calculatePhysicalDamage(hero, slime, 16), 35);
});

test("damage never goes negative", () => {
  assert.equal(calculatePhysicalDamage(slime, { ...hero, defense: 500 }, 16), 0);
});

test("weakness doubles damage and resistance halves it", () => {
  assert.equal(elementMultiplier("fire", "ice"), 2);
  assert.equal(elementMultiplier("fire", "fire"), 0.5);
});

test("critical hits and guarding modify the calculation", () => {
  const base = { attacker: hero, defender: slime, power: 16, kind: "physical" as const, element: "none" as const, defenderElement: "none" as const };
  assert.equal(calculateDamage({ ...base, critical: false, guarding: false }).amount, 35);
  assert.equal(calculateDamage({ ...base, critical: true, guarding: false }).amount, 52);
  assert.equal(calculateDamage({ ...base, critical: false, guarding: true }).amount, 17);
});

test("absorbed elements heal", () => {
  const result = calculateDamage({ attacker: hero, defender: slime, power: 16, kind: "magic", element: "holy", defenderElement: "holy", critical: false, guarding: false });
  assert.equal(result.heals, true);
});

test("damage is clamped to the cap", () => {
  assert.equal(clampDamage(123456), MAX_DAMAGE);
});
