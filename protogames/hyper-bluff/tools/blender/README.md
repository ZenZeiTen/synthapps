# Blender art pipeline

Every Blender-rendered image in the game is built from code. Nothing is imported:
no models, no textures, no fonts.

| File | What it does |
| --- | --- |
| `build_scenes.py` | Runs inside Blender. Builds the scenes, saves `art/blender/table.blend` (scenes `Table`, `Boss`, `Title`) and `art/blender/props.blend` (scenes `ChipSpin`, `Chips`, `StarSpin`, `Trophy`, `CoinBurst`), and renders raw frames into `art/blender/render/`. |
| `pixelize.py` | Plain Python (PIL and numpy). Turns the raw frames into the PNGs in `godot/assets/art/` and writes `blender_sprites.json`. |

## Regenerate

Blender 4.2 LTS (4.2.3 was used), Cycles on CPU. Run from `hyper-bluff/`:

```sh
BLENDER=/path/to/blender-4.2.3-linux-x64/blender
"$BLENDER" -b --python tools/blender/build_scenes.py        # about 4 minutes on 4 cores
python3 tools/blender/pixelize.py --report
```

Options for `build_scenes.py` go after `--`:

- `--only table,boss,title,props` renders a subset. A single sprite also works:
  `chip_spin`, `chips`, `star_spin`, `trophy`, `coin_burst`.
- `--samples N` sets background samples (default 64, denoised with OpenImageDenoise).
- `--sprite-samples N` sets sprite samples (default 32, not denoised; the 8x downscale averages them).
- `--no-render` only saves the `.blend` files.

A quick preview: `-- --samples 12 --sprite-samples 8` (about 90 seconds).

## How the look is made

- Backgrounds render at 1280x720 and are box-filtered to 640x360, then mapped to a k-means
  palette (40, 36 and 44 colours) with a subtle 4x4 Bayer dither.
- Sprites render at 8x on a transparent film. They are box-filtered with premultiplied
  alpha, the alpha is snapped to fully on or off, colours go to a small palette with no
  dither, and a 1 px dark outline is added per frame.
- The city, sky, moon, beams and streaks are self-lit (emission) surfaces, so they render
  flat and free of noise. Only the room and the tumbling props are path-traced.
- `View` in `build_scenes.py` maps final-image pixels to world positions, so the moon,
  stars, streaks and the title props are placed in screen coordinates. Change those
  numbers to move things.
- Table and boss share one builder; `THEMES` holds the colours and light energies.
- The spin sprites cover half a turn in 8 frames, because both shapes look the same from behind.

## Readability check

`pixelize.py --report` prints the mean and standard deviation of luminance (0..255) for
the felt area (x 60..580, y 150..350), the rival portrait area (x 250..390, y 0..120)
and the title logo area (x 120..520, y 30..170).

## Known trap

In background mode Blender does not evaluate the animation of a scene that is not the
active one, so `frame_set` left the spin sprites on one pose. The script keyframes the
poses (they are in `props.blend`) and also sets each pose directly before it renders.
