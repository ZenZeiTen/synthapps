# Hyper Bluff!! Starlight Showdown: Director's Cut (Unreal Engine 5.8)

An original 90s-anime heads-up poker game, ported from the Godot game in `../hyper-bluff/`
to Unreal Engine 5.8 for the **2026 Epic AI MegaJam** (theme: *DIRECTOR'S CUT*). C++ only:
no Blueprints, no `.uasset`/`.umap`; the art and sound are read at run time from
`Content/Raw/` as plain PNG and WAV files.

## Open, compile, run (Windows, UE 5.8, Visual Studio 2022)

1. Install UE 5.8 from the Epic launcher and Visual Studio 2022 with "Game development with
   C++" (MSVC v143, a Windows 10/11 SDK).
2. Compile without opening the editor (default engine path `C:\Program Files\Epic Games\UE_5.8`;
   set `UE_ROOT` if yours differs):
   ```bat
   hyper-bluff-ue\tools\build_editor.bat
   ```
   It ends with `BUILD OK`. Or right-click `HyperBluff.uproject` > *Generate Visual Studio
   project files*, open `HyperBluff.sln`, pick `Development Editor | Win64`, build.
3. Run: double-click `HyperBluff.uproject` and press *Play* (use **P** for the pause menu in
   the editor, because Esc ends Play-in-Editor), or run the game directly:
   ```bat
   "%UE_ROOT%\Engine\Binaries\Win64\UnrealEditor.exe" "%CD%\hyper-bluff-ue\HyperBluff.uproject" -game -windowed -ResX=1280 -ResY=720
   ```
4. Package (cook, stage, pak, archive to `dist\`, then `dist\TeamName_HyperBluff.zip`;
   rename `TeamName` in the script to your team name):
   ```bat
   hyper-bluff-ue\tools\package_win64.bat
   ```
5. Run the end-to-end checks against the build (see *Harness*):
   ```powershell
   powershell -ExecutionPolicy Bypass -File hyper-bluff-ue\tools\harness.ps1
   powershell -ExecutionPolicy Bypass -File hyper-bluff-ue\tools\harness.ps1 -Exe "hyper-bluff-ue\dist\Windows\HyperBluff.exe"
   ```
   Both must end with `HARNESS 0 failure(s)` before the zip is sent.

## Controls

| Action | Keyboard | Pad | Mouse |
|---|---|---|---|
| Move cursor / raise size | Arrows, WASD (held arrows repeat after 0.4 s) | D-pad | hover; wheel and `-` `+` for the raise size |
| OK / confirm | Z, Enter, Space | A (bottom) | click |
| Cancel | X, Backspace | B (right) | |
| Pause menu | Esc, P | Start | MENU button |
| Fold / call / raise | F / C / R | LB folds | buttons |
| Powers 1 2 3 | 1 2 3 | X (left), Y (top), RB | power icons |

Same map as the Godot game (`main.gd` ACTIONS/PADS). A key held through a screen change
does nothing on the next screen; new screens ignore presses for 12 ticks and story pages
for 15.

## Director's Cut (the jam additions)

- **Title**: the HYPER BLUFF!! logo with a red *DIRECTOR'S CUT* stamp that thumps down.
- **Episodes**: every match of the ladder (five floors, four wardens between them) opens
  with its episode card from the rules data, e.g. `EPISODE 2: THE GARAGE DECK` or
  `INTERLUDE: THE STAIRWELL`; the floor-clear screen shows a *TO BE CONTINUED...* panel with
  `COMING UP: <next episode>`.
- **CUT! RETAKE** (new power, rules in `Source/HyperBluff/Core/README.md`): right after a
  street is dealt, reshoot it. A clapperboard cut-in snaps shut (the cut-in sound), the old
  cards fly off the table and the new ones deal in from the deck. Icon: a clapperboard in
  `icons.png` (drawn by `hyper-bluff/tools/art/sheets.py`, checked by Aseprite). Baron Onyx
  starts with it, and 777 star cards can grant it.

## Layout

| Path | What |
|---|---|
| `Source/HyperBluff/Core/` | poker rules, plain C++17, parity-tested bit-exact against the Godot rules |
| `Source/HyperBluff/App/` | the port of `main.gd` + `render.gd`: screens, menus, input, pacing, animation, saves, harness, draw list, PNG/WAV decoders. Plain C++20, tested on Linux |
| `Source/HyperBluff/Game/` | thin Unreal classes: `AHBGameMode` (owns the app, 60 Hz tick, textures, sound), `AHBHUD` (draws the list), `AHBPlayerController` (input) |
| `Content/Raw/` | PNG art and 16-bit PCM WAV audio, staged as loose files (`tools/stage_assets.sh`) |
| `tests/` | `run_all.sh` (everything checkable on Linux), core tests, parity, app tests, lint, `harness_checks.tsv` |
| `tools/` | `build_editor.bat`, `package_win64.bat`, `harness.ps1`, `stage_assets.sh` |

Rendering: a 640x360 virtual screen scaled by the largest whole number that fits the window,
centred, letterboxed in near-black; the mouse is mapped back into 640x360. Textures use
nearest filtering. Saves, options and scores are text files in `Saved/HyperBluff/`; harness
runs use `Saved/HyperBluff/harness/`, emptied at the start of each run.

## Harness

`-HBScript="cmd,cmd,..."` runs a script through the same entry points as real input (keys
go through the same key-to-action table, clicks through the same hit regions):
`wait:n`, `tap:<action>`, `key:<Key>` (Unreal key names, plus `1`, `Space`, `Esc`),
`pad:<n|name>` (Godot JoyButton index or Unreal pad key name), `click:<region>`,
`wheel:up|down`, `until:mine|over|<screen>:<ticks>`, `dump`, `fit`, and the set-up shortcuts
`seed:n`, `rig:win|lose`, `floor:n`, `give:a+b`, `score:n`, `fever`, `quit`. It prints
`DUMP ...` lines to stdout and to the log (`LogHB`), and quits when the script ends.

```bat
"%UE_ROOT%\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "%CD%\hyper-bluff-ue\HyperBluff.uproject" -game -nullrhi -nosound -unattended -stdout "-HBScript=until:title:60,dump,tap:ok,until:avatar:60,dump"
```

`tools/harness.ps1` runs every check in `tests/harness_checks.tsv` (the 25 checks of
`hyper-bluff/godot/tests/harness.sh`, adapted to the nine-match ladder, plus mini-boss,
retake and episode-title checks). The same file is generated and passed by the Linux app
tests, so a check that fails on Windows but not on Linux points at the Unreal wrappers.

## Checks run on Linux (no Unreal here)

```bash
bash hyper-bluff-ue/tests/run_all.sh     # ends with ALL OK
```

1. `tests/run_core_tests.sh`: the rules tests (`CORE TESTS 49/49 passed`, g++ and clang++)
   and parity with the Godot rules over 200 seeds x 9 starting matches (`PARITY ok`).
2. Every `App/` file builds with g++ and clang++ under `-std=c++20 -Wall -Wextra -Wpedantic
   -Wshadow -Wconversion -Werror`.
3. `tests/app/test_app.cpp` (`APP TESTS n/n passed`, both compilers): all harness checks
   through the app's real entry points; CUT! RETAKE (cut-in, snap sound timing, fly-off and
   re-deal); episode titles; held arrows repeat after 24 ticks every 5; a held confirm or
   arrow does nothing on the next screen; every Unreal key name maps to its action; the
   letterbox maths and mouse mapping; same ticks at 30 and 144 fps; harness saves never touch
   the player's files; text fit with the longest real strings (story pages split to 5 lines
   of 80, speech bubbles, missions, power tooltips, the fullest result panel, every avatar
   and every rival's versus and floor-clear screen); the PNG decoder against Python/PIL
   pixel for pixel; the WAV decoder on every sound.
4. `tests/lint_game.sh`: the Unreal files include the headers of the engine types they use,
   UCLASS headers end with their `.generated.h`, and the plain C++ has no identifier that a
   Windows or Unreal macro would rewrite (`check`, `TEXT`, `PI`, `DrawText`, `min(`...).

## Unreal APIs the wrappers rely on (not compiled here)

| File | API | Confidence |
|---|---|---|
| HyperBluff.cpp | `IMPLEMENT_PRIMARY_GAME_MODULE`, `DECLARE/DEFINE_LOG_CATEGORY`, `UE_LOG` | high |
| HBGameMode | `AGameModeBase` (`HUDClass`, `PlayerControllerClass`, `DefaultPawnClass`, `PrimaryActorTick`), `BeginPlay/EndPlay/BeginDestroy/Tick` | high |
| HBGameMode | `FParse::Value(FCommandLine::Get(), TEXT("HBScript="), Str, false)` | high |
| HBGameMode | `FFileHelper::LoadFileToArray/LoadFileToString/SaveStringToFile`, `IFileManager::Get().MakeDirectory/Delete`, `FPaths::ProjectContentDir/ProjectSavedDir/Combine/FileExists/GetPath` | high |
| HBGameMode | `UTexture2D::CreateTransient(W, H, PF_B8G8R8A8)`, `GetPlatformData()->Mips[0].BulkData.Lock(LOCK_READ_WRITE)/Unlock()`, `UpdateResource()`, `Filter=TF_Nearest`, `SRGB`, `LODGroup=TEXTUREGROUP_Pixels2D`, `NeverStream` | medium-high (`GetPlatformData` is the UE5 accessor; `TextureResource.h` included for `FTexture2DMipMap`) |
| HBGameMode | `NewObject<UAudioComponent>` + `RegisterComponent()`, `bAutoActivate`, `bAllowSpatialization`, `bIsUISound`, `SetSound`, `Play`, `Stop`, `SetVolumeMultiplier` | high |
| HBGameMode | `NewObject<USoundWaveProcedural>`, `SetSampleRate`, `NumChannels`, `Duration`, `SoundGroup`, `bLooping`, `QueueAudio(const uint8*, int32)`, `GetAvailableAudioByteCount()` | medium (`SetSampleRate` and `GetAvailableAudioByteCount` from memory of UE5 headers and public plugin code; not checked against 5.8 headers) |
| HBGameMode | `GEngine->GetGameUserSettings()->SetFullscreenMode/ApplyResolutionSettings`, `UKismetSystemLibrary::QuitGame`, `FPlatformMisc::RequestExit(false)` | high |
| HBHUD | `AHUD::DrawHUD`, `Canvas->ClipX/ClipY`, `AHUD::DrawRect(FLinearColor, x, y, w, h)`, `AHUD::DrawTexture(Tex, x, y, w, h, u, v, uw, vh, Tint, BLEND_Translucent)`, `FLinearColor(FColor)` (sRGB to linear) | high |
| HBPlayerController | `bShowMouseCursor`, `FInputModeGameAndUI` + `SetInputMode`, `WasInputKeyJustPressed/Released(FKey)`, `FKey(FName)`, `GetMousePosition`, `EKeys::LeftMouseButton/MouseScrollUp/MouseScrollDown` | high (wheel via `WasInputKeyJustPressed` is medium) |
| Build.cs | `CppStandard = Cpp20`, `bUseUnity = false`, `bEnableExceptions = false`, include paths | high |

The dev.epicgames.com API pages render in the browser only, so they could not be read from
this sandbox; nothing in the table was checked against the 5.8 headers.

## Not verified here

- **Nothing Unreal-side was compiled or run**: Unreal cannot be installed in this Linux
  sandbox. The first compile, the editor run, packaging and `harness.ps1` happen on Windows.
- Whether `-nullrhi` runs still tick the game mode and spawn the controller exactly as
  expected (the harness only needs the game mode's tick; drawing is not needed for `fit`,
  which the app computes itself).
- Colour: the app's sRGB colours are converted with `FLinearColor(FColor)` for the canvas;
  if the HUD looks too dark or washed out, change `ToLinear` in `Game/HBHUD.cpp`.
- Audio: procedural waves with whole-track queuing and re-queuing for loops; mixing levels
  and the loop seam were not heard. If `SetSampleRate` or `GetAvailableAudioByteCount` do
  not compile in 5.8, see `CLAUDE.md` for the fallbacks.
- `tools/harness.ps1` and the `.bat` files were not run (no PowerShell or cmd here).
- Fullscreen toggle, gamepad on real hardware, DPI scaling of the mouse.
