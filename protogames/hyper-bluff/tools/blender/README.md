# Blender art pipeline

Every Blender-rendered image in the game is built from code. Nothing is imported:
no models, no textures, no fonts.

| File | What it does |
| --- | --- |
| `build_scenes.py` | Runs inside Blender. Builds the scenes, saves `art/blender/table.blend` (scenes `Floor1`..`Floor5`, `Title`) and `art/blender/props.blend` (scenes `ChipSpin`, `Chips`, `StarSpin`, `Trophy`, `CoinBurst`), and renders raw frames into `art/blender/render/`. |
| `pixelize.py` | Plain Python (PIL and numpy). Turns the raw frames into the PNGs in `godot/assets/art/` and writes `blender_sprites.json` (frame sizes of the sprite strips). |

## Outputs (`godot/assets/art/`)

| File | Size | Notes |
| --- | --- | --- |
| `bg_floor1.png` .. `bg_floor5.png` | 640x360 | One poker room per floor of the tower, own palette each |
| `bg_title.png` | 640x360 | Title backdrop; logo area x 120..520, y 30..170 kept calm |
| `chip_spin.png` | 8 x 24x24 | |
| `chips.png` | 5 x 20x20 | white, red, blue, green, black |
| `star_spin.png` | 8 x 24x24 | |
| `trophy.png` | 64x64 | |
| `coin_burst.png` | 6 x 32x32 | |

## The five rooms

All five share one camera and one table (the contract the UI relies on): felt from about
y=120 down, the rival's chair dark and calm in x 250..390, y 0..120, nothing on the table.
Each room is a function in `build_scenes.py` (`room1` .. `room5`); colours and light
energies are in `FLOORS`.

| Floor | Room | Felt | Background | Chair |
| --- | --- | --- | --- | --- |
| 1 | Lobby Pit | emerald | warm red wall, gold-framed windows on a sunset street close by, hanging lamps, rope barriers, potted palms, slot machines | dealer stool back on a post |
| 2 | Garage Deck | burgundy, rough rail | concrete pillars and deck slabs, parked motorcycle, oil drums and a cone, elevated highway with sodium lamps, blank neon signs | chrome sissy-bar seat |
| 3 | Snow Garden | royal blue | lattice (shoji-style) window grid, lit paper side panels, snowy hills, bare tree with snow, stone lantern, falling snow, pale moon, vase and paper floor lantern | low lacquer chair with up-turned top rail |
| 4 | Odds Laboratory | teal | metal wall, round porthole with stars and a ringed planet, rack of glowing tubes, six monitors with abstract graphs, copper pipes, tesla coil with arcs | lab chair with head-rest |
| 5 | Starlight Table | near-black crimson | pointed-arch windows, red banners, gold braziers with flames, storm clouds, red moon, three lightning bolts, city far below | spiked throne with gold studs |

## Regenerate

Blender 4.2 LTS (4.2.3 was used), Cycles on CPU. Run from `hyper-bluff/`:

```sh
BLENDER=/path/to/blender-4.2.3-linux-x64/blender
"$BLENDER" -b --python tools/blender/build_scenes.py        # everything, about 10 minutes on 4 cores
python3 tools/blender/pixelize.py --report
```

Options for `build_scenes.py` go after `--`:

- `--only floors,title,props` (the default) renders everything. A subset also works:
  `floor1` .. `floor5`, `title`, `props`, or one sprite (`chip_spin`, `chips`, `star_spin`,
  `trophy`, `coin_burst`). `table.blend` always holds all floors and the title.
- `--samples N` sets background samples (default 64, denoised with OpenImageDenoise).
- `--sprite-samples N` sets sprite samples (default 32, not denoised; the 8x downscale averages them).
- `--no-render` only saves the `.blend` files.

A quick preview: `-- --only floors --samples 10` (about 2 minutes).

`pixelize.py` skips a background whose raw render is missing, so it can run after a
partial render.

## How the look is made

- Backgrounds render at 1280x720 and are box-filtered to 640x360. Each one gets its own
  k-means palette (44 colours for floors 1 to 4 and the title, 40 for floor 5) and a subtle
  4x4 Bayer dither.
- Sprites render at 8x on a transparent film. They are box-filtered with premultiplied
  alpha, the alpha is snapped to fully on or off, colours go to a small palette with no
  dither, and a 1 px dark outline is added per frame.
- Skies, cities, signs, the garden, the moon, flames and arcs are self-lit (emission)
  surfaces, so they render flat and free of noise. The room, table and props are path-traced.
- `View` in `build_scenes.py` maps final-image pixels to world positions (`p`, `frame`)
  and back (`proj`), so screen-space pieces (moon, signs, garden, flames, arcs) are placed
  in pixel coordinates.
- The spin sprites cover half a turn in 8 frames, because both shapes look the same from behind.

## Readability check

`pixelize.py --report` prints the mean and standard deviation of luminance (0..255) for
the felt (x 60..580, y 150..350) and the rival portrait area (x 250..390, y 0..120) of
each floor, and for the logo area of the title. Targets: felt std under about 12,
top-centre mean under about 30.

| Floor | Felt mean | Felt std | Top-centre mean |
| --- | --- | --- | --- |
| 1 | 73.3 | 9.2 | 28.3 |
| 2 | 61.6 | 7.8 | 18.9 |
| 3 | 64.7 | 8.8 | 25.1 |
| 4 | 80.5 | 9.2 | 25.2 |
| 5 | 41.6 | 7.8 | 12.3 |

## Known traps

- In background mode Blender does not evaluate the animation of a scene that is not the
  active one, so `frame_set` left the spin sprites on one pose. The script keyframes the
  poses (they are in `props.blend`) and also sets each pose directly before it renders.
- A low ceiling slab in the garage first sat inside the camera view and blocked the
  sodium light, which left the felt nearly black (mean 20). Keep ceilings above z 3.6.
