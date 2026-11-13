# Portraits

Nine original characters, 96x96 close-up busts, five expressions each
(neutral, happy, shock, defeat, fierce). Each character has its own painter in
`portraits.py` (own head shape, eyes, pose and per-expression changes); the head and
hair fill the cell and may run off its top and sides. Rin and Yuki are painted facing
left and mirrored at the end, so their coordinates in the code are flipped.

| file | role |
|---|---|
| `tools/art/portraits.py` | paints every character procedurally and writes `art/portraits/<id>.aseprite` |
| `tools/art/paintkit.py` | mask / layer helpers used by the painter (hard edges only, no anti-aliasing) |
| `tools/art/asefile.py` | reads and writes real `.aseprite` files (Aseprite itself is not needed) |
| `tools/art/export_portraits.py` | flattens the `.aseprite` files into `godot/assets/art/portraits.png` + `portraits.json` |

## Regenerate everything from code

    python3 tools/art/portraits.py          # all nine sources (or: portraits.py rin mako)
    python3 tools/art/export_portraits.py   # sheet + json

`portraits.py` is deterministic: the same code gives byte-identical files.
**It overwrites the `.aseprite` files, so it throws away hand edits.** Run it only
when you want the procedural version back.

## Hand-edit, then re-export

1. Open `art/portraits/<id>.aseprite` in Aseprite. Each file has
   - frames 0..4 tagged `neutral`, `happy`, `shock`, `defeat`, `fierce` (200 ms each);
   - layers, bottom to top: `hair_back`, `body`, `face`, `hair`, `fx`
     (`hair` also holds hats, hoods, visors and ornaments; `fx` holds eyebrows, goggles,
     Yuki's fan, Mako's gum, sweat drops and shock marks);
   - a hidden guide layer `eyeband`: a 96x24 magenta box over the eyes;
   - the character's palette (18-24 colours). Stay inside it and keep edges hard:
     no soft brushes, no partial alpha. The exporter refuses semi-transparent pixels.
2. Save (keep RGB colour mode, keep the five tags).
3. Run `python3 tools/art/export_portraits.py` only. Do not run `portraits.py`.

The exporter reads the files with `asefile.Sprite.load()` and `flatten()`, so what
you see in Aseprite (visible layers, layer and cel opacity) is what ships.

## Sheet layout

`portraits.png` is 480x864: 5 columns x 9 rows of 96x96 cells.
Rows: rin, mako, jiro, aya, pochi, goro, yuki, zeno, onyx.
Columns: neutral, happy, shock, defeat, fierce.

`portraits.json`: `cell`, `order`, `expr`, `names`, `eye_y`.

`eye_y[id]` is the top row of the 96x24 strip used for cut-in close-ups. It is the
y position of the `eyeband` guide in the `fierce` frame. If you move a character's
eyes by hand, move the guide box in that frame too (it stays hidden and is never
exported). Order and display names come from `CAST` in `portraits.py`.
