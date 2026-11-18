# Hyper Bluff!! Director's Cut (Unreal 5.8): notes for Claude

Read `README.md` first. The Godot game in `../hyper-bluff/` is the reference; this is a port.

## Commands

```bash
bash hyper-bluff-ue/tests/run_all.sh          # everything checkable on Linux; ends with ALL OK
bash hyper-bluff-ue/tests/run_core_tests.sh   # rules + parity (Godot side cached in tests/build/parity)
ONLY='retake' hyper-bluff-ue/tests/build/test_app_g hyper-bluff-ue   # one app check after run_all built it
bash hyper-bluff-ue/tools/stage_assets.sh     # copy art/audio from the Godot project (needs ffmpeg)
bash hyper-bluff-ue/tests/lint_game.sh        # static checks of the Unreal-only files
```

Windows only: `tools\build_editor.bat`, `tools\package_win64.bat`, `tools\harness.ps1`.

## Architecture

- `Core/` rules (plain C++17, `namespace hb`), bit-exact with `godot/scripts/core/` (parity).
  Data (cast, ladder, wardens, rooms, episodes, lore, story) is generated text: when
  `data.gd` changes, mirror it in `HBData.cpp` and run the parity check.
- `App/` is `main.gd` + `render.gd` in plain C++20 (`namespace hb::app`): one `App` object,
  driven by `KeyDown/KeyUp/MouseClick/MouseWheel/Press` and `Frame(dt)`, producing a draw
  list (`Render()`) and asking its `Host` for files and sounds. All ladder knowledge goes
  through `App/HBJam.cpp`. Everything here is tested on Linux by `tests/app/test_app.cpp`.
- `Game/` is the only Unreal code and stays thin. Keep logic out of it.
- `tests/harness_checks.tsv` is written by the app tests and read by `tools/harness.ps1`:
  add a harness check in `test_app.cpp` with `Run(...)` and Windows gets it too.

## Traps

- **Unity builds and macros.** `bUseUnity = false` in Build.cs, and file-local helpers carry
  a prefix anyway. Unreal force-includes its PCH into the plain C++ files: never name
  anything `check`, `verify`, `TEXT`, `PI`, `DrawText`, `ERROR`, `small`, `interface`, or
  call unqualified `min(`/`max(`. `tests/lint_game.sh` greps for these.
- **UHT headers.** Keep `std::` types and the `hb` namespace out of UCLASS headers; the
  game mode holds an opaque `FHBRuntime*` (`Game/HBRuntime.h`, not a UHT header). Do not
  put a `TUniquePtr` of an incomplete type in a UCLASS (generated code defines the
  destructor).
- **Harness output.** `DUMP` lines go to stdout with `printf` and to the log; with
  `-stdout` the log copies are prefixed (`LogHB: Display:`), so the harness takes lines that
  start with `DUMP ` and falls back to the log file for packaged builds.
- **`fit` without drawing.** The app renders its own draw list for `fit` and `dump`, so the
  harness works under `-nullrhi`.
- **Fallbacks if 5.8 rejects an audio call:** `SetSampleRate` missing -> set the protected
  rate through a small `USoundWaveProcedural` subclass, or `SampleRate = ...` if public;
  `GetAvailableAudioByteCount` missing -> bind `OnSoundWaveProceduralUnderflow` and queue
  the track again there. Texture: if `GetPlatformData()` changed, `UTexture2D::CreateTransient`
  plus `FImageUtils::CreateTexture2D` are the alternatives.
- Text fit: every boxed text goes through `Txt` (width) or `TxtFit`/`WrapBox` (squeeze or
  page) and the `fit` list also catches text off the screen; story pages are split to
  5 lines of 80 (`PaginateStory`), like `main.gd split_pages`.

## Not yet verified on Windows (update when it is)

The first compile, play-in-editor, `-nullrhi` harness, packaging, audio and colours. See
README "Not verified here".
