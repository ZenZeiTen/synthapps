#!/usr/bin/env bash
# Cheap static checks for the files Linux cannot compile (Unreal is not installed here):
#  - Game/*.cpp include the header of every engine type they use (a table of the ones used);
#  - every UCLASS header includes its .generated.h as the last include;
#  - App/ and Core/ use no engine headers and no identifier that a Windows or Unreal macro
#    would rewrite (check, verify, TEXT, PI, DrawText, ERROR, small, interface, min(, ...).
# Prints "LINT ok" or the problems and exits non-zero.
set -euo pipefail
S="$(cd "$(dirname "$0")/../Source/HyperBluff" && pwd)"
fail=0
need() {  # need <file> <regex for use> <header>
  if grep -Eq "$2" "$1" && ! grep -q "#include \"$3\"" "$1"; then
    echo "LINT $1: uses $2 but does not include $3"; fail=1
  fi
}
for f in "$S"/Game/*.cpp; do
  need "$f" 'UAudioComponent' 'Components/AudioComponent.h'
  need "$f" 'USoundWaveProcedural' 'Sound/SoundWaveProcedural.h'
  need "$f" 'UTexture2D' 'Engine/Texture2D.h'
  need "$f" 'FTexture2DMipMap|FTexturePlatformData' 'TextureResource.h'
  need "$f" 'FFileHelper' 'Misc/FileHelper.h'
  need "$f" 'FPaths' 'Misc/Paths.h'
  need "$f" 'IFileManager' 'HAL/FileManager.h'
  need "$f" 'FParse::' 'Misc/Parse.h'
  need "$f" 'FCommandLine' 'Misc/CommandLine.h'
  need "$f" 'UKismetSystemLibrary' 'Kismet/KismetSystemLibrary.h'
  need "$f" 'UGameUserSettings' 'GameFramework/GameUserSettings.h'
  need "$f" 'Canvas->' 'Engine/Canvas.h'
  need "$f" 'GetWorld\(\)->|World->' 'Engine/World.h'
  need "$f" 'FDateTime' 'Misc/DateTime.h'
  need "$f" 'FPlatformTime' 'HAL/PlatformTime.h'
  need "$f" 'FPlatformMisc' 'HAL/PlatformMisc.h'
  need "$f" 'GEngine' 'Engine/Engine.h'
  need "$f" 'APlayerController' 'GameFramework/PlayerController.h'
  need "$f" 'EKeys::' 'InputCoreTypes.h'
done
for h in "$S"/Game/*.h; do
  if grep -q 'UCLASS(' "$h"; then
    last="$(grep '#include' "$h" | tail -1)"
    base="$(basename "$h" .h)"
    [ "$last" = "#include \"$base.generated.h\"" ] || { echo "LINT $h: last include must be $base.generated.h"; fail=1; }
  fi
done
for f in "$S"/App/* "$S"/Core/*.h "$S"/Core/*.cpp; do
  if grep -En '#include "(CoreMinimal|Engine/|GameFramework/|Misc/|HAL/)' "$f"; then echo "LINT $f: engine header in plain C++"; fail=1; fi
  # strip comments and string literals before looking for macro names
  body="$(sed -e 's://.*$::' -e 's/"\([^"\\]\|\\.\)*"/""/g' "$f")"
  if printf '%s\n' "$body" | grep -nwE 'check|verify|ensure|TEXT|PI|DrawText|PlaySound|LoadImage|ERROR|small|near|far|interface|IN|OUT|TRUE|FALSE|CreateWindow|GetObject|DeleteFile|CopyFile|MoveFile|GetMessage|SendMessage|PostMessage|Yield|CreateFont|Rectangle|Polygon|Ellipse|hyper|boolean|OPTIONAL|CALLBACK|INFINITE|TRANSPARENT|OPAQUE|IGNORE|DELETE'; then
    echo "LINT $f: identifier that a Windows/Unreal macro rewrites"; fail=1
  fi
  if printf '%s\n' "$body" | grep -nE '(^|[^:A-Za-z0-9_.>])(min|max)\('; then
    echo "LINT $f: unqualified min( / max( (Windows macros)"; fail=1
  fi
done
[ $fail -eq 0 ] && echo "LINT ok"
exit $fail
