# Breath of Fire IV Remake

A small, fan-made turn-based RPG prototype. It is the sample project that
NeuralOS demos against: code, design documents, tests, a marketing website and
a services contract, all in one place.

> This is original demo content. It is not affiliated with, endorsed by, or
> derived from any commercial game or publisher.

## Layout

| Folder | What lives there |
|---|---|
| `src/combat/` | Battle loop, damage calculation, elemental affinities |
| `src/inventory/` | Item catalog and the party inventory |
| `src/merchants/` | Shops and merchant pricing (uses the inventory) |
| `src/party/` | Party roster and formation |
| `tests/` | Unit tests (`node --test`) |
| `docs/` | Design docs, architecture decisions, glossary |
| `website/` | English marketing pages |
| `contracts/` | Agreements with outside studios |

## Running the tests

```sh
npm test
```

Node 22.18 or newer runs the TypeScript sources directly (type stripping), so
there is no build step.

## Key documents

- [Coding standards](CODING_STANDARDS.md)
- [ADR 0001: data-driven combat](docs/adr/0001-data-driven-combat.md)
- [Combat design](docs/design/combat.md)
- [Merchants and shops](docs/design/merchants.md)
- [Glossary (English / Indonesian)](docs/glossary.md)
