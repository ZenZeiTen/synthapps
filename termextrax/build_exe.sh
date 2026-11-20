#!/usr/bin/env bash
# Build the TermExtrax single-file executable (Linux/macOS equivalent of
# build_exe.bat). Result: backend/dist/TermExtrax
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1/4 Building frontend ==="
(cd frontend && npm install && npm run build)

echo "=== 2/4 Installing backend dependencies ==="
pip install -r backend/requirements.txt pyinstaller

echo "=== 3/4 Bundling frontend into backend/static ==="
rm -rf backend/static
cp -r frontend/dist backend/static

echo "=== 4/4 Building executable ==="
(cd backend && pyinstaller --noconfirm TermExtrax.spec)

echo
echo "Done: backend/dist/TermExtrax"
