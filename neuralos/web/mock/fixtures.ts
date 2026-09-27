/** Canned project files for the mock kernel: the "Breath of Fire IV Remake" demo project. */
export const PROJECT_NAME = "Breath of Fire IV Remake";

export const FILES: Record<string, string> = {
  "README.md": `# Breath of Fire IV Remake

A fan remake of the 2000 JRPG in TypeScript. Turn-based combat with combos,
a dragon transformation system, a field map with merchants and an inventory
shared across the party.

- \`src/combat\`: battle loop, damage formulas, status effects
- \`src/inventory\`: items, party inventory, merchant shops
- \`src/world\`: field map and NPC dialogue
- \`docs/design\`: design notes
`,
  "package.json": `{
  "name": "bof4-remake",
  "version": "0.4.0",
  "type": "module",
  "scripts": { "test": "vitest run", "build": "tsc -p ." }
}
`,
  "src/combat/battle_system.ts": `import { calculateDamage, type Attack } from "./damage_calc";
import { applyStatus, tickStatuses } from "./status_effects";
import type { Combatant } from "../world/field_map";

export interface BattleState {
  turn: number;
  party: Combatant[];
  enemies: Combatant[];
  comboChain: string[];
}

/** One full round: every combatant acts in speed order, then statuses tick. */
export function runRound(state: BattleState, orders: Map<string, Attack>): BattleState {
  const actors = [...state.party, ...state.enemies].sort((a, b) => b.speed - a.speed);
  for (const actor of actors) {
    if (actor.hp <= 0) continue;
    const attack = orders.get(actor.id);
    if (!attack) continue;
    const target = pickTarget(state, actor, attack);
    const dmg = calculateDamage(actor, target, attack, state.comboChain);
    target.hp = Math.max(0, target.hp - dmg);
    if (attack.status) applyStatus(target, attack.status);
    state.comboChain.push(attack.element);
  }
  tickStatuses([...state.party, ...state.enemies]);
  return { ...state, turn: state.turn + 1, comboChain: state.comboChain.slice(-4) };
}

function pickTarget(state: BattleState, actor: Combatant, attack: Attack): Combatant {
  const side = state.party.includes(actor) ? state.enemies : state.party;
  const alive = side.filter((c) => c.hp > 0);
  return attack.targetLowest ? alive.sort((a, b) => a.hp - b.hp)[0] : alive[0];
}
`,
  "src/combat/damage_calc.ts": `import type { Combatant } from "../world/field_map";

export type Element = "fire" | "ice" | "wind" | "earth" | "holy" | "none";

export interface Attack {
  power: number;
  element: Element;
  status?: string;
  targetLowest?: boolean;
}

/** Combo bonus: each element in the chain that differs from the last adds 10%, capped at 50%. */
export function comboMultiplier(chain: string[]): number {
  let bonus = 0;
  for (let i = 1; i < chain.length; i++) if (chain[i] !== chain[i - 1]) bonus += 0.1;
  return 1 + Math.min(bonus, 0.5);
}

/** Latest damage formula (v0.4): defence scales with level, criticals ignore half the defence. */
export function calculateDamage(attacker: Combatant, defender: Combatant, attack: Attack, chain: string[]): number {
  const crit = Math.random() < attacker.luck / 256;
  const defence = crit ? defender.defence / 2 : defender.defence;
  const base = attack.power * (attacker.attack / Math.max(1, defence)) * (1 + attacker.level / 50);
  const weakness = defender.weakTo === attack.element ? 1.5 : 1;
  return Math.round(base * weakness * comboMultiplier(chain) * (crit ? 1.5 : 1));
}
`,
  "src/combat/status_effects.ts": `import type { Combatant } from "../world/field_map";

export interface StatusEffect {
  id: string;
  turns: number;
}

export function applyStatus(target: Combatant, id: string): void {
  target.statuses = target.statuses.filter((s) => s.id !== id);
  target.statuses.push({ id, turns: 3 });
}

export function tickStatuses(all: Combatant[]): void {
  for (const c of all) {
    for (const s of c.statuses) {
      if (s.id === "poison") c.hp = Math.max(0, c.hp - Math.ceil(c.maxHp / 16));
      s.turns -= 1;
    }
    c.statuses = c.statuses.filter((s) => s.turns > 0);
  }
}
`,
  "src/inventory/inventory.ts": `import { ITEMS, type ItemId } from "./items";

export const MAX_STACK = 99;

export class Inventory {
  private slots = new Map<ItemId, number>();

  add(id: ItemId, qty = 1): number {
    const have = this.slots.get(id) ?? 0;
    const next = have + qty;
    // TODO: overflow is silently dropped; the design doc says overflow goes to storage.
    this.slots.set(id, Math.min(next, MAX_STACK));
    return Math.max(0, next - MAX_STACK);
  }

  remove(id: ItemId, qty = 1): boolean {
    const have = this.slots.get(id) ?? 0;
    if (have < qty) return false;
    this.slots.set(id, have - qty);
    return true;
  }

  value(): number {
    let total = 0;
    for (const [id, qty] of this.slots) total += ITEMS[id].price * qty;
    return total;
  }

  list(): { id: ItemId; qty: number }[] {
    return [...this.slots].map(([id, qty]) => ({ id, qty }));
  }
}
`,
  "src/inventory/items.ts": `export type ItemId = "herb" | "healing_herb" | "ammonia" | "wisdom_seed" | "dragon_tear";

export interface Item {
  name: string;
  price: number;
  battleUse: boolean;
}

export const ITEMS: Record<ItemId, Item> = {
  herb: { name: "Herb", price: 12, battleUse: true },
  healing_herb: { name: "Healing Herb", price: 60, battleUse: true },
  ammonia: { name: "Ammonia", price: 40, battleUse: true },
  wisdom_seed: { name: "Wisdom Seed", price: 800, battleUse: false },
  dragon_tear: { name: "Dragon Tear", price: 0, battleUse: false },
};
`,
  "src/inventory/merchant_shop.ts": `import { Inventory } from "./inventory";
import { ITEMS, type ItemId } from "./items";

export interface Merchant {
  id: string;
  name: string;
  stock: ItemId[];
  markup: number;
}

/** Buying charges price * markup; selling pays half the base price. */
export function buy(inv: Inventory, zenny: number, merchant: Merchant, id: ItemId, qty: number): number {
  const cost = Math.round(ITEMS[id].price * merchant.markup) * qty;
  if (cost > zenny) throw new Error("Not enough zenny");
  inv.add(id, qty);
  return zenny - cost;
}

export function sell(inv: Inventory, zenny: number, id: ItemId, qty: number): number {
  if (!inv.remove(id, qty)) return zenny;
  return zenny + Math.floor(ITEMS[id].price / 2) * qty;
}
`,
  "src/world/field_map.ts": `import { dialogueFor } from "./npc_dialogue";

export interface Combatant {
  id: string;
  hp: number;
  maxHp: number;
  attack: number;
  defence: number;
  speed: number;
  luck: number;
  level: number;
  weakTo?: string;
  statuses: { id: string; turns: number }[];
}

export interface FieldMap {
  id: string;
  name: string;
  npcs: string[];
}

export function enter(map: FieldMap): string[] {
  return map.npcs.map((npc) => dialogueFor(npc, map.id));
}
`,
  "src/world/npc_dialogue.ts": `const LINES: Record<string, string> = {
  "merchant:wyndia": "Welcome, traveller. Herbs are fresh today.",
  "guard:wyndia": "The princess has been missing for days.",
};

export function dialogueFor(npc: string, mapId: string): string {
  return LINES[\`\${npc}:\${mapId}\`] ?? "...";
}
`,
  "tests/inventory.test.ts": `import { describe, expect, it } from "vitest";
import { Inventory, MAX_STACK } from "../src/inventory/inventory";

describe("Inventory", () => {
  it("caps stacks at MAX_STACK", () => {
    const inv = new Inventory();
    expect(inv.add("herb", 120)).toBe(120 - MAX_STACK);
  });
  it("refuses to remove more than it has", () => {
    const inv = new Inventory();
    inv.add("herb", 2);
    expect(inv.remove("herb", 3)).toBe(false);
  });
});
`,
  "tests/damage_calc.test.ts": `import { describe, expect, it } from "vitest";
import { comboMultiplier } from "../src/combat/damage_calc";

describe("comboMultiplier", () => {
  it("caps the combo bonus at 50%", () => {
    expect(comboMultiplier(["fire", "ice", "fire", "ice", "fire", "ice", "fire"])).toBe(1.5);
  });
});
`,
  "docs/design/combat.md": `# Combat design

Battles are turn based. Speed decides order. Combos: consecutive spells of
different elements build a chain; see \`src/combat/battle_system.ts\`.

Damage calculations live in \`src/combat/damage_calc.ts\` (formula v0.4).
`,
  "docs/design/merchants.md": `# Merchants

Every town has at least one merchant. Merchants sell at a markup and buy back
at half price (\`src/inventory/merchant_shop.ts\`). The Wyndia merchant stocks
herbs and ammonia; the Fou-lu route merchants stock wisdom seeds.

Open question: should merchant markup scale with the party's reputation?
`,
  "docs/design/inventory.md": `# Inventory

One shared party inventory, 99 per stack. Overflow goes to the storage chest
in camp (not implemented yet: see the TODO in \`src/inventory/inventory.ts\`).
`,
  "docs/legal/distribution_agreement.md": `# Distribution Agreement

1. Definitions. "Licensed Territory" means the Republic of Indonesia.
2. Grant. The Licensor grants the Distributor a non-exclusive licence to
   distribute the Game in the Licensed Territory.
3. Term. This Agreement runs for twenty-four (24) months from the Effective Date.
`,
  "docs/legal/glossary.csv": `term,indonesian,note
Licensed Territory,Wilayah Berlisensi,defined term
Distributor,Distributor,keep
Effective Date,Tanggal Efektif,defined term
`,
  "site/index.html": `<!doctype html>
<html lang="en"><head><title>Breath of Fire IV Remake</title></head>
<body><h1>Become the dragon.</h1><p>A remake of the classic JRPG. Coming 2027.</p></body></html>
`,
  ".neuralos/outputs/ws_review/report.md": `# Engineering review: inventory module

Commander merged 3 agent outputs.

## Findings (ranked)

1. **high** Inventory overflow is silently dropped (src/inventory/inventory.ts:12)
2. **medium** Merchant buy() adds items before checking the stack cap (src/inventory/merchant_shop.ts:15)
3. **low** Inventory.value() ignores merchant markup
4. **info** No test covers sell()

## Conflicts

- Stack overflow: Code Reviewer wants an error, Systems Architect wants storage. Resolved: route overflow to storage (design doc).
`,
};

export function kindOf(path: string): "code" | "doc" | "test" | "config" | "data" | "other" {
  if (path.startsWith("tests/") || /\.test\.ts$/.test(path)) return "test";
  if (/\.(ts|tsx|js|html)$/.test(path)) return "code";
  if (/\.md$/.test(path)) return "doc";
  if (/\.json$/.test(path)) return "config";
  if (/\.csv$/.test(path)) return "data";
  return "other";
}
