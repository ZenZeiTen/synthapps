/**
 * The party inventory: item stacks keyed by item id.
 * Shops and battle item usage both go through this class.
 */
import { getItem, type ItemDefinition } from "./items.ts";

export const MAX_STACK = 99;

export interface InventoryEntry {
  item: ItemDefinition;
  quantity: number;
}

export class Inventory {
  private readonly stacks = new Map<string, number>();

  count(itemId: string): number {
    return this.stacks.get(itemId) ?? 0;
  }

  has(itemId: string, quantity = 1): boolean {
    return this.count(itemId) >= quantity;
  }

  /** How many more of this item fit in its stack. */
  room(itemId: string): number {
    return MAX_STACK - this.count(itemId);
  }

  /** Adds items; returns false (and changes nothing) if the item is unknown or the stack would overflow. */
  add(itemId: string, quantity = 1): boolean {
    if (!getItem(itemId) || quantity <= 0 || quantity > this.room(itemId)) return false;
    this.stacks.set(itemId, this.count(itemId) + quantity);
    return true;
  }

  /** Removes items; returns false (and changes nothing) if there are not enough. */
  remove(itemId: string, quantity = 1): boolean {
    if (quantity <= 0 || !this.has(itemId, quantity)) return false;
    const left = this.count(itemId) - quantity;
    if (left === 0) this.stacks.delete(itemId);
    else this.stacks.set(itemId, left);
    return true;
  }

  list(): InventoryEntry[] {
    const entries: InventoryEntry[] = [];
    for (const [id, quantity] of this.stacks) {
      const item = getItem(id);
      if (item) entries.push({ item, quantity });
    }
    return entries.sort((a, b) => a.item.name.localeCompare(b.item.name));
  }
}
