/**
 * Elemental affinities. One table, read by the damage calculation.
 * See docs/design/combat.md section 3.
 */

export type Element = "fire" | "ice" | "wind" | "earth" | "holy" | "none";

export type Affinity = "weak" | "normal" | "resist" | "absorb";

export const AFFINITY_MULTIPLIER: Record<Affinity, number> = {
  weak: 2,
  normal: 1,
  resist: 0.5,
  absorb: -1,
};

/** Affinity of a defender of element `target` when hit by element `attack`. */
const AFFINITY_TABLE: Record<Element, Partial<Record<Element, Affinity>>> = {
  fire: { fire: "resist", ice: "weak" },
  ice: { ice: "resist", fire: "weak" },
  wind: { wind: "resist", earth: "weak" },
  earth: { earth: "resist", wind: "weak" },
  holy: { holy: "absorb" },
  none: {},
};

export function affinityOf(attack: Element, target: Element): Affinity {
  if (attack === "none") return "normal";
  return AFFINITY_TABLE[attack][target] ?? "normal";
}

/** Multiplier applied to damage of element `attack` against a defender of element `target`. */
export function elementMultiplier(attack: Element, target: Element): number {
  return AFFINITY_MULTIPLIER[affinityOf(attack, target)];
}
