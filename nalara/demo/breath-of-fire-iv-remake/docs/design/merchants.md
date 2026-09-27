# Merchants and shops

Owner: economy design. Related code: `src/merchants/shop.ts`,
`src/inventory/inventory.ts`, `src/inventory/items.ts`.

## Goals

Merchants give the player a reason to explore towns and a sink for gold. Each
town has at least one merchant; some merchants travel between towns on a
schedule.

## Shop types

| Shop | Sells | Notes |
|---|---|---|
| Item shop | Herbs, tonics, Dragon Tears | Every town |
| Weapon smith | Weapons | Stock improves with story progress |
| Armorer | Armor, shields | Stock improves with story progress |
| Travelling merchant | Rare items | Appears on market days only |

## Buying and selling

- The buy price comes from the item catalog (`items.ts`).
- Merchants buy items back at half the catalog price.
- A purchase fails when the party lacks gold or the inventory stack is full
  (99 per item). The shop must never take gold without delivering the item.
- Key items cannot be sold.

## Merchant stock

Each merchant has a stock list. Limited stock (for example, one Dragon Tear per
visit) is restocked when the player rests at an inn.

## Haggling (planned)

Merchants in the port town accept haggling: a successful dialogue check lowers
prices by up to 10 percent. The shop code has a TODO for this.

## Localization notes

Merchant greetings and shop menus are player-facing strings and must go through
the string table. See the [glossary](../glossary.md) for the Indonesian terms
("pedagang" for merchant, "toko" for shop).
