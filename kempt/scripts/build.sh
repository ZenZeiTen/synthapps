#!/usr/bin/env bash
# Builds Kempt into dist/.
#   Kempt.exe         Windows app (no console window): double-click to open
#   kempt-cli.exe     Windows command line: kempt scan, kempt clean --yes, ...
#                     (its own name: on Windows, Kempt.exe and kempt.exe would be one file)
#   Kempt-arm64.exe   Windows on ARM
#   kempt-linux-*     Linux (cleaning, large files, duplicates, autostart, health)
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${VERSION:-$(sed -n 's/^\tversion  = "\(.*\)"/\1/p' main.go)}"
OUT="${OUT:-dist}"
mkdir -p "$OUT"
LD="-s -w -X main.version=$VERSION"
export CGO_ENABLED=0
build() { echo "  $3"; GOOS=$1 GOARCH=$2 go build -trimpath -ldflags "$LD ${4:-}" -o "$OUT/$3" .; }
echo "Kempt $VERSION"
build windows amd64 Kempt.exe "-H windowsgui -X main.guiBuild=1"
build windows amd64 kempt-cli.exe
build windows arm64 Kempt-arm64.exe "-H windowsgui -X main.guiBuild=1"
build linux amd64 kempt-linux-amd64
build linux arm64 kempt-linux-arm64
if cmp -s "$OUT/Kempt.exe" "$OUT/kempt-cli.exe"; then
  echo "Kempt.exe and kempt-cli.exe are the same file" >&2
  exit 1
fi
(cd "$OUT" && sha256sum Kempt.exe kempt-cli.exe Kempt-arm64.exe kempt-linux-* > SHA256SUMS.txt)
echo "Done: $OUT/"
