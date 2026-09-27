/**
 * Item catalog: every item the player can hold, with its shop price.
 * Prices are in gold. Designers edit this table directly.
 */

export type ItemCategory = "consumable" | "weapon" | "armor" | "key";

export interface ItemDefinition {
  id: string;
  name: string;
  category: ItemCategory;
  /** Buy price at a merchant, in gold. 0 means it cannot be bought. */
  price: number;
  description: string;
}

export const ITEM_CATALOG: readonly ItemDefinition[] = [
  { id: "healing-herb", name: "Healing Herb", category: "consumable", price: 20, description: "Restores 50 HP to one ally." },
  { id: "antidote", name: "Antidote", category: "consumable", price: 15, description: "Cures poison." },
  { id: "dragon-tear", name: "Dragon Tear", category: "consumable", price: 800, description: "Revives a fallen ally with full HP." },
  { id: "bronze-sword", name: "Bronze Sword", category: "weapon", price: 120, description: "A plain, sturdy blade." },
  { id: "leather-vest", name: "Leather Vest", category: "armor", price: 90, description: "Light armor for travellers." },
  { id: "harbor-pass", name: "Harbor Pass", category: "key", price: 0, description: "Lets the party board ships." },
];

export function getItem(id: string): ItemDefinition | undefined {
  return ITEM_CATALOG.find((item) => item.id === id);
}

export function isSellable(item: ItemDefinition): boolean {
  return item.category !== "key";
}
