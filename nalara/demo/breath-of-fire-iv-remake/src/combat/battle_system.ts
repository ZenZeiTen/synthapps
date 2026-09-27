/**
 * Turn-based battle loop: turn order, random rolls and applying damage.
 * Damage math lives in damage.ts; this file owns everything stateful.
 */
import { calculateDamage, type CombatStats } from "./damage.ts";
import type { Element } from "./elements.ts";

export interface Combatant {
  id: string;
  name: string;
  side: "party" | "enemy";
  stats: CombatStats;
  element: Element;
  hp: number;
  maxHp: number;
  guarding: boolean;
}

export interface BattleAction {
  actorId: string;
  targetId: string;
  kind: "attack" | "skill" | "guard";
  power?: number;
  element?: Element;
}

export interface BattleLogEntry {
  round: number;
  actorId: string;
  targetId: string;
  amount: number;
  heals: boolean;
  critical: boolean;
}

export type Rng = () => number;

export class BattleSystem {
  readonly combatants: Combatant[];
  readonly log: BattleLogEntry[] = [];
  round = 1;
  private readonly rng: Rng;

  constructor(combatants: Combatant[], rng: Rng = Math.random) {
    this.combatants = combatants;
    this.rng = rng;
  }

  /** Acting order for the current round: agility, highest first. */
  turnOrder(): Combatant[] {
    return this.combatants
      .filter((c) => c.hp > 0)
      .sort((a, b) => b.stats.agility - a.stats.agility);
  }

  perform(action: BattleAction): BattleLogEntry | undefined {
    const actor = this.find(action.actorId);
    const target = this.find(action.targetId);
    if (!actor || !target || actor.hp <= 0) return undefined;
    if (action.kind === "guard") {
      actor.guarding = true;
      return undefined;
    }
    // Critical hit chance: 1 in 16.
    const critical = this.rng() < 0.0625;
    const result = calculateDamage({
      attacker: actor.stats,
      defender: target.stats,
      power: action.power ?? 16,
      kind: action.kind === "skill" ? "magic" : "physical",
      element: action.element ?? "none",
      defenderElement: target.element,
      critical,
      guarding: target.guarding,
    });
    target.hp = result.heals
      ? Math.min(target.maxHp, target.hp + result.amount)
      : Math.max(0, target.hp - result.amount);
    const entry = { round: this.round, actorId: actor.id, targetId: target.id, ...result };
    this.log.push(entry);
    return entry;
  }

  endRound(): void {
    for (const c of this.combatants) c.guarding = false;
    this.round++;
    // TODO: resolve combos here once the combo rules in docs/design/combat.md section 4 are final.
  }

  isOver(): boolean {
    const alive = (side: Combatant["side"]) => this.combatants.some((c) => c.side === side && c.hp > 0);
    return !alive("party") || !alive("enemy");
  }

  handleEvent(event: any): void {
    if (event.type === "flee") this.round = Number.MAX_SAFE_INTEGER;
  }

  private find(id: string): Combatant | undefined {
    return this.combatants.find((c) => c.id === id);
  }
}
