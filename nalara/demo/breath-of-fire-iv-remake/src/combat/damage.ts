/**
 * Damage calculation for the combat system.
 *
 * Every function here is pure (CODING_STANDARDS.md rule 2): the battle system
 * rolls critical hits and passes the result in. Formulas are documented in
 * docs/design/combat.md section 2.
 */
import { elementMultiplier, type Element } from "./elements.ts";

export const MAX_DAMAGE = 9999;
export const GUARD_MULTIPLIER = 0.5;

export interface CombatStats {
  level: number;
  attack: number;
  defense: number;
  magic: number;
  spirit: number;
  agility: number;
}

export interface DamageInput {
  attacker: CombatStats;
  defender: CombatStats;
  /** Skill power from the skill table; a basic attack is 16. */
  power: number;
  kind: "physical" | "magic";
  element: Element;
  defenderElement: Element;
  critical: boolean;
  guarding: boolean;
}

export interface DamageResult {
  amount: number;
  /** True when an absorbed element turns the hit into healing. */
  heals: boolean;
  critical: boolean;
}

/** Physical base damage: attack scaled by skill power, minus half the defense. */
export function calculatePhysicalDamage(attacker: CombatStats, defender: CombatStats, power: number): number {
  return Math.max(0, (attacker.attack * power) / 16 - defender.defense / 2);
}

/** Magic base damage: same shape as physical, using magic against spirit. */
export function calculateMagicDamage(attacker: CombatStats, defender: CombatStats, power: number): number {
  return Math.max(0, (attacker.magic * power) / 16 - defender.spirit / 2);
}

export function applyCritical(damage: number, critical: boolean): number {
  return critical ? damage * 1.5 : damage;
}

export function clampDamage(value: number): number {
  return Math.max(0, Math.min(MAX_DAMAGE, Math.floor(value)));
}

/** Full damage calculation for one hit, including element, critical and guard modifiers. */
export function calculateDamage(input: DamageInput): DamageResult {
  const base =
    input.kind === "physical"
      ? calculatePhysicalDamage(input.attacker, input.defender, input.power)
      : calculateMagicDamage(input.attacker, input.defender, input.power);
  const multiplier = elementMultiplier(input.element, input.defenderElement);
  let damage = applyCritical(base * Math.abs(multiplier), input.critical);
  if (input.guarding) damage *= GUARD_MULTIPLIER;
  return { amount: clampDamage(damage), heals: multiplier < 0, critical: input.critical };
}
