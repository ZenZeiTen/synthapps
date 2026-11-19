// Demo content: tests for the sample game project, run with `npm test`
// (node --test) inside this folder. Nalara's own vitest suite does not run them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Inventory, MAX_STACK } from "../src/inventory/inventory.ts";
import { Shop } from "../src/merchants/shop.ts";

test("adds and removes item stacks", () => {
  const inv = new Inventory();
  assert.equal(inv.add("healing-herb", 3), true);
  assert.equal(inv.remove("healing-herb", 2), true);
  assert.equal(inv.count("healing-herb"), 1);
});

test("rejects unknown items and overflowing stacks", () => {
  const inv = new Inventory();
  assert.equal(inv.add("no-such-item"), false);
  assert.equal(inv.add("antidote", MAX_STACK + 1), false);
});

test("buying takes gold only when the item is delivered", () => {
  const inv = new Inventory();
  inv.add("antidote", MAX_STACK);
  const shop = new Shop("Harbor Merchant", { antidote: 5 });
  const purse = { gold: 100 };
  const result = shop.buy("antidote", 1, inv, purse);
  assert.deepEqual(result, { ok: false, reason: "inventory-full" });
  assert.equal(purse.gold, 100);
});

test("merchants buy back at half price", () => {
  const inv = new Inventory();
  inv.add("bronze-sword");
  const shop = new Shop("Smith", {});
  const purse = { gold: 0 };
  shop.sell("bronze-sword", 1, inv, purse);
  assert.equal(purse.gold, 60);
});
