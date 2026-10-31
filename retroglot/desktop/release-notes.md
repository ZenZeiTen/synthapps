Retroglot plays games from the DOS era to the PlayStation era on Windows, and translates their on-screen text with Claude: press **F2** and the translation appears over the game's own dialogue window.

## Download

| File | Use it if |
|---|---|
| `Retroglot-Setup-<version>.exe` | You want it installed, with a Start menu entry and an uninstaller. |
| `Retroglot-<version>-portable.exe` | You want to run it without installing (for example from a USB stick). |

Both files contain the same app. Before publishing, the automated build started the app on a Windows machine, let it download the emulator and booted the demo game. The installer itself was built but not run by that test.

## First start

1. **Windows says "Windows protected your PC"**: the app is not code-signed. Click **More info**, then **Run anyway**.
2. On first start the app downloads the emulator (EmulatorJS and its cores, about 70 MB). This needs an internet connection once.
3. To translate, open **Settings** and paste a Claude API key from [console.anthropic.com](https://console.anthropic.com). Playing games does not need a key.
4. Click **Try the Japanese demo** on the home screen, start it, then press **F2**.

Retroglot ships no games and no BIOS files. Use games you own.

## What's in this version

- **Library:** a console-style home screen with real box art, keyboard and controller navigation, favourites and play time.
- **Player:** full-window play with save states (with pictures) and quick save and load. Continue from your latest save straight from the library.
- **Translation:** boxes over the text, subtitles or a side panel, plus auto-translate. Each game keeps its own glossary, repeated screens are answered from memory (no charge), and you can export the script as TXT, CSV or TMX.
- **Picture (F1, Picture tab):**
  - Filters: CRT, sharp, smooth, xBR and ScaleFX.
  - Nintendo 64: rendering at up to 4×, edge smoothing, texture upscaling, widescreen, and HD texture packs (experimental).
  - PlayStation: an HD renderer with up to 8× resolution and wobble-free 3D. It needs the PlayStation BIOS for the game's region.

## Known limits

- These were never tested: a live Claude API call, a real HD texture pack in a real game, and the PlayStation HD renderer with a real disc.
- Games run on systems other than DOS and NES use the same emulator path, but each emulator has its own quirks.
- High resolutions (3× and above) need a fast graphics card.

## Licences

Retroglot's own code is MIT licensed. The emulator (EmulatorJS, GPL-3.0) and its cores are downloaded on first start, not bundled. Some cores do not allow commercial use. See `retroglot/README.md` for details.
