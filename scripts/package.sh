#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-$(node -p "require('./extension/manifest.json').version")}"
MANIFEST_VERSION="$(node -p "require('./extension/manifest.json').version")"

if [[ "$VERSION" != "$MANIFEST_VERSION" ]]; then
  printf 'Requested version %s does not match manifest version %s\n' "$VERSION" "$MANIFEST_VERSION" >&2
  exit 1
fi

rm -rf dist
mkdir -p dist

STAGE_DIR="dist/proxyhop-chrome-$VERSION"
mkdir -p "$STAGE_DIR"
cp -R extension/. "$STAGE_DIR"/

ARCHIVE_PATH="dist/proxyhop-chrome-$VERSION.zip"
ARCHIVE_BASENAME="$(basename "$ARCHIVE_PATH")"
rm -f "$ARCHIVE_PATH"

DIST_DIR="$ROOT_DIR/dist"
STAGE_BASENAME="$(basename "$STAGE_DIR")"
(cd "$DIST_DIR" && npx --no-install bestzip "$ARCHIVE_BASENAME" "$STAGE_BASENAME")

printf 'Created %s\n' "$ARCHIVE_PATH"
