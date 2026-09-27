/**
 * Merchant shops: buying and selling against the party inventory and purse.
 * Design: docs/design/merchants.md.
 */
import { Inventory } from "../inventory/inventory.ts";
import { getItem, isSellable } from "../inventory/items.ts";

/** Merchants buy items back at this fraction of the catalog price. */
export const SELL_BACK_RATIO = 0.5;

export interface Purse {
  gold: number;
}

export type TradeResult =
  | { ok: true; gold: number }
  | { ok: false; reason: "unknown-item" | "not-in-stock" | "not-enough-gold" | "inventory-full" | "not-sellable" | "not-owned" };

export class Shop {
  readonly merchantName: string;
  private readonly stock: Map<string, number>;

  /** `stock` maps item id to quantity; Infinity means unlimited. */
  constructor(merchantName: string, stock: Record<string, number>) {
    this.merchantName = merchantName;
    this.stock = new Map(Object.entries(stock));
  }

  priceOf(itemId: string): number | undefined {
    // TODO: apply haggling discounts for port-town merchants (docs/design/merchants.md).
    return getItem(itemId)?.price;
  }

  buy(itemId: string, quantity: number, inventory: Inventory, purse: Purse): TradeResult {
    const item = getItem(itemId);
    if (!item) return { ok: false, reason: "unknown-item" };
    const inStock = this.stock.get(itemId) ?? 0;
    if (inStock < quantity) return { ok: false, reason: "not-in-stock" };
    const cost = item.price * quantity;
    if (purse.gold < cost) return { ok: false, reason: "not-enough-gold" };
    if (!inventory.add(itemId, quantity)) return { ok: false, reason: "inventory-full" };
    purse.gold -= cost;
    this.stock.set(itemId, inStock - quantity);
    return { ok: true, gold: purse.gold };
  }

  sell(itemId: string, quantity: number, inventory: Inventory, purse: Purse): TradeResult {
    const item = getItem(itemId);
    if (!item) return { ok: false, reason: "unknown-item" };
    if (!isSellable(item)) return { ok: false, reason: "not-sellable" };
    if (!inventory.remove(itemId, quantity)) return { ok: false, reason: "not-owned" };
    purse.gold += Math.floor(item.price * SELL_BACK_RATIO) * quantity;
    return { ok: true, gold: purse.gold };
  }

  /** Called when the party rests at an inn. */
  restock(itemId: string, quantity: number): void {
    this.stock.set(itemId, (this.stock.get(itemId) ?? 0) + quantity);
  }
}
