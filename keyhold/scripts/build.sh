#!/usr/bin/env bash
# Builds Keyhold for Windows, Linux and macOS into dist/.
#   Keyhold.exe        Windows app (no console window): double-click to open your vault
#   keyhold-cli.exe    Windows command line: keyhold serve, keyhold version, ...
#                      (its own name: on Windows, Keyhold.exe and keyhold.exe would be one file)
#   keyhold-linux-*    Linux (desktop or server)
#   keyhold-macos-*    macOS
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${VERSION:-$(sed -n 's/^\tversion  = "\(.*\)"/\1/p' main.go)}"
OUT="${OUT:-dist}"
mkdir -p "$OUT"
LD="-s -w -X main.version=$VERSION"
export CGO_ENABLED=0
build() { echo "  $3"; GOOS=$1 GOARCH=$2 go build -trimpath -ldflags "$LD ${4:-}" -o "$OUT/$3" .; }
echo "Keyhold $VERSION"
build windows amd64 Keyhold.exe "-H windowsgui -X main.guiBuild=1"
build windows amd64 keyhold-cli.exe
build windows arm64 Keyhold-arm64.exe "-H windowsgui -X main.guiBuild=1"
build linux amd64 keyhold-linux-amd64
build linux arm64 keyhold-linux-arm64
build darwin arm64 keyhold-macos-arm64
build darwin amd64 keyhold-macos-amd64
# Every build must be its own file, also on file systems that ignore letter case.
if cmp -s "$OUT/Keyhold.exe" "$OUT/keyhold-cli.exe"; then
  echo "Keyhold.exe and keyhold-cli.exe are the same file" >&2
  exit 1
fi
(cd "$OUT" && sha256sum Keyhold.exe keyhold-cli.exe Keyhold-arm64.exe keyhold-linux-* keyhold-macos-* > SHA256SUMS.txt)
echo "Done: $OUT/"
