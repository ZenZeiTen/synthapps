#!/usr/bin/env bash
# Copy the Hyper Bluff art and audio into Content/Raw/, which the game reads at run time
# as plain files (no editor import). Music ships as OGG in the Godot build; the game's WAV
# reader needs PCM, so music is converted to 16-bit 22050 Hz stereo WAV here.
# Usage: bash hyper-bluff-ue/tools/stage_assets.sh   (needs ffmpeg)
set -eo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/../hyper-bluff/godot/assets"
OUT="$HERE/Content/Raw"
rm -rf "$OUT"
mkdir -p "$OUT/Art" "$OUT/Audio"
cp "$SRC"/art/*.png "$SRC"/art/*.json "$OUT/Art/"
cp "$SRC"/audio/*.wav "$OUT/Audio/"
for f in "$SRC"/audio/*.ogg; do
  n="$(basename "$f" .ogg)"
  ffmpeg -loglevel error -y -i "$f" -ar 22050 -ac 2 -sample_fmt s16 "$OUT/Audio/$n.wav"
done
echo "STAGED $(ls "$OUT/Art" | wc -l) art files, $(ls "$OUT/Audio" | wc -l) audio files in $OUT"
