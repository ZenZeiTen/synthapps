#!/usr/bin/env bash
# The browser build's checks: build web/dist, compare the two cores step for step, then play
# the built page in headless Chromium (WebGL through SwiftShader) from synthesized keyboard
# events and a virtual Gamepad API pad.
set -eo pipefail
cd "$(dirname "$0")/.."
if [ ! -d web/node_modules/three ] || [ ! -d web/node_modules/playwright ]; then
  (cd web && npm install --no-audit --no-fund)
fi
python3 pipeline/sync_content.py
(cd web && node tools/build.mjs)
bash tests/parity.sh
node web/tests/check.mjs build/web
