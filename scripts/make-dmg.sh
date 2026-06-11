#!/usr/bin/env bash
# Build a universal (Intel + Apple Silicon) Strata.app and wrap it in a
# distributable .dmg. We package the disk image with macOS's own hdiutil
# rather than Tauri's bundler, because the latter needs the `create-dmg`
# Homebrew tool plus Finder automation that isn't available headless.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(sed -nE 's/.*"version": "([^"]+)".*/\1/p' src-tauri/tauri.conf.json | head -1)"
APP="src-tauri/target/universal-apple-darwin/release/bundle/macos/Strata.app"
OUT="$ROOT/dist-dmg"
DMG="$OUT/Strata_${VERSION}_universal.dmg"

echo "▸ Building universal Strata.app (compiles both arches — a few minutes)…"
bun run tauri build --target universal-apple-darwin --bundles app

echo "▸ Packaging $DMG"
mkdir -p "$OUT"
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"   # drag-to-install target
rm -f "$DMG"
hdiutil create -volname "Strata" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo "✓ $DMG"
