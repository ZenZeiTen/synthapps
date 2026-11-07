Retroglot plays games from the DOS era to the PlayStation, Nintendo DS and PSP era on Windows, and translates their on-screen text with Claude: press **F2** and the translation appears over the game's own dialogue window.

## Download

| File | Use it if |
|---|---|
| `Retroglot-Setup-<version>.exe` | You want it installed, with a Start menu entry and an uninstaller. |
| `Retroglot-<version>-portable.exe` | You want to run it without installing (for example from a USB stick). |

Both files contain the same app. Before publishing, the automated build started the app on a Windows machine, let it download the emulator and booted the demo game. The installer itself was built but not run by that test.

## First start

1. **Windows says "Windows protected your PC"**: the app is not code-signed. Click **More info**, then **Run anyway**.
2. On first start the app downloads the emulator (EmulatorJS and its cores, about 90 MB). This needs an internet connection once.
3. To translate, open **Settings** and paste a Claude API key from [console.anthropic.com](https://console.anthropic.com). Playing games does not need a key.
4. Click **Try the Japanese demo** on the home screen, start it, then press **F2**.

Retroglot ships no games and no BIOS files. Use games you own.

## New in 0.3.0

- **In-game saves now stay saved.** When a game saves to its own memory card or cartridge, Retroglot writes that save to disk within seconds, and again when you leave the game. Before, a save could be lost if you left soon after saving. Saves are kept in `.retroglot\saves` in your user folder, with the previous copy kept next to it.
- **Autosave:** Retroglot makes a save state when you leave a game and every 5 minutes of play. **Continue** in the library resumes from it. You can turn it off in Settings.
- **Import and download in-game saves** from the Saves tab (F1), for example to bring in a save from another emulator.
- **Screen shape (F8):** original, widescreen 16:9, or fill the whole window. The translation boxes follow the picture.
- **Nintendo DS screen layout:** stacked, side by side, one large screen, or top screen only (F1, Picture tab).

## New in 0.2.0

- **Nintendo DS** (melonDS): `.nds` games, both screens shown one above the other, touch screen with the mouse. No BIOS needed.
- **PlayStation Portable** (PPSSPP): `.iso`, `.cso` and `EBOOT.PBP`. An `EBOOT.PBP` that holds a PlayStation game is recognised and played by the PlayStation emulator.
- If you already use 0.1.0, the DS or PSP emulator downloads by itself the first time you open such a game.
- Nintendo 3DS is not supported: no 3DS emulator runs in a browser engine, which Retroglot needs for translation.

## Everything in this version

- **Library:** a console-style home screen with real box art, keyboard and controller navigation, favourites and play time.
- **Player:** full-window play with save states (with pictures) and quick save and load. Continue from your latest save straight from the library.
- **Translation:** boxes over the text, subtitles or a side panel, plus auto-translate. Each game keeps its own glossary, repeated screens are answered from memory (no charge), and you can export the script as TXT, CSV or TMX.
- **Systems:** DOS, NES, SNES, N64, Game Boy, GBA, Nintendo DS, Virtual Boy, Master System, Mega Drive, Game Gear, Sega CD, 32X, PC Engine, PlayStation, PSP, Atari 2600/7800/Lynx, Neo Geo Pocket, WonderSwan. Saturn, 3DO, Jaguar, arcade, Amiga and C64 emulators download the first time you open such a game (Saturn and 3DO also need their BIOS).
- **Picture (F1, Picture tab):**
  - Filters: CRT, sharp, smooth, xBR and ScaleFX.
  - Nintendo 64: rendering at up to 4×, edge smoothing, texture upscaling, widescreen, and HD texture packs (experimental).
  - PlayStation: an HD renderer with up to 8× resolution and wobble-free 3D. It needs the PlayStation BIOS for the game's region.

## Known limits

- These were never tested: a live Claude API call, a real HD texture pack in a real game, the PlayStation HD renderer with a real disc, and commercial DS and PSP games (only test programs).
- PSP emulation is demanding: expect full speed only on a fast computer.
- Games on systems other than DOS, NES and DS use the same emulator path, but each emulator has its own quirks.
- High resolutions (3× and above) need a fast graphics card.

## Licences

Retroglot's own code is MIT licensed. The emulator (EmulatorJS, GPL-3.0) and its cores are downloaded on first start, not bundled. Some cores do not allow commercial use. See `retroglot/README.md` for details.
