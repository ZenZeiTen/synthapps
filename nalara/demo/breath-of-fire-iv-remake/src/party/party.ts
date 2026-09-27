/**
 * Party roster: up to four active heroes plus a reserve.
 * The battle system reads the active members; the menu swaps them.
 */

export const MAX_ACTIVE_MEMBERS = 4;

export interface Hero {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
}

export class Party {
  private active: Hero[] = [];
  private reserve: Hero[] = [];

  members(): readonly Hero[] {
    return this.active;
  }

  reserves(): readonly Hero[] {
    return this.reserve;
  }

  recruit(hero: Hero): void {
    if (this.active.length < MAX_ACTIVE_MEMBERS) this.active.push(hero);
    else this.reserve.push(hero);
  }

  /** Swaps an active member with a reserve member. Returns false if either is missing. */
  swap(activeId: string, reserveId: string): boolean {
    const a = this.active.findIndex((h) => h.id === activeId);
    const r = this.reserve.findIndex((h) => h.id === reserveId);
    if (a < 0 || r < 0) return false;
    [this.active[a], this.reserve[r]] = [this.reserve[r], this.active[a]];
    return true;
  }

  isWiped(): boolean {
    return this.active.every((h) => h.hp <= 0);
  }

  averageLevel(): number {
    if (this.active.length === 0) return 0;
    return Math.round(this.active.reduce((sum, h) => sum + h.level, 0) / this.active.length);
  }
}
