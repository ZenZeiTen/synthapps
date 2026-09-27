#!/usr/bin/env bash
# Draws every sprite and tile set (.aseprite sources), then exports them for both builds.
set -eo pipefail
cd "$(dirname "$0")/aseprite"
python3 art_people.py > /dev/null
python3 art_creatures.py > /dev/null
python3 art_tiles.py > /dev/null
python3 art_ui.py > /dev/null
python3 export_art.py
