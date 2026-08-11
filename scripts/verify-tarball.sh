#!/usr/bin/env bash
# Asserts the @airshiplabs/cli tarball is actually shippable before it goes out.
#
# Why this exists: `files: ["dist"]` silently matches nothing when dist/ has not
# been built, so `pnpm publish` succeeds and ships a package.json and a LICENSE.
# npm reports that as a clean publish, the version number is burned forever, and
# the breakage only surfaces when a user runs `npx airship`. A --dry-run does not
# catch it — it packs the same empty tarball and exits 0.
#
# So: pack for real, look inside, and fail loudly on anything missing.
#
#   bash scripts/verify-tarball.sh
#
# Assumes the CLI is already built (`pnpm turbo run build --filter=@airshiplabs/cli`).
set -euo pipefail

PKG_DIR="apps/cli"
PKG_NAME="@airshiplabs/cli"

# Every path the published CLI resolves at runtime but no bundler can inline.
# dist/vendor/ is written by apps/cli/scripts/vendor-assets.mjs; without it the
# installed CLI 404s on its own overlay and renders unstyled.
#
# README.md is generated from the root one by scripts/sync-readme.mjs and is the
# only thing npmjs.com has to show for the package. Without it the page reads
# "This package does not have a README" — which is how 0.2.1 shipped — and the
# version number is spent, because npm never lets you republish one.
REQUIRED=(
  "package/package.json"
  "package/README.md"
  "package/dist/index.js"
  "package/dist/vendor/overlay.global.js"
  "package/dist/vendor/hook.global.js"
  "package/dist/vendor/fonts/inter-variable.woff2"
  "package/dist/vendor/fonts/jetbrains-mono-400.woff2"
  "package/dist/vendor/fonts/jetbrains-mono-700.woff2"
)

# A correctly built tarball is ~1MB. An empty one is ~1.5KB. This catches the
# shape of failure the per-file checks might miss if the layout ever changes.
MIN_BYTES=200000

cd "$(git rev-parse --show-toplevel)"
[ -d "$PKG_DIR" ] || { echo "verify-tarball: $PKG_DIR not found" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "» packing $PKG_NAME"
( cd "$PKG_DIR" && npm pack --pack-destination "$WORK" >/dev/null )

TARBALL="$(find "$WORK" -name '*.tgz' -maxdepth 1 | head -1)"
[ -n "$TARBALL" ] || { echo "verify-tarball: npm pack produced no tarball" >&2; exit 1; }

SIZE="$(wc -c < "$TARBALL" | tr -d ' ')"
LISTING="$WORK/listing.txt"
tar tzf "$TARBALL" > "$LISTING"

MISSING=0
for entry in "${REQUIRED[@]}"; do
  if grep -qxF "$entry" "$LISTING"; then
    echo "  ✓ ${entry#package/}"
  else
    echo "  ✖ ${entry#package/} — MISSING"
    MISSING=1
  fi
done

echo
echo "  $(wc -l < "$LISTING" | tr -d ' ') files, $SIZE bytes"

if [ "$MISSING" -ne 0 ]; then
  echo >&2
  echo "verify-tarball: the tarball is incomplete — refusing to publish." >&2
  echo "  Build it first: pnpm turbo run build --filter=$PKG_NAME" >&2
  exit 1
fi

if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo >&2
  echo "verify-tarball: tarball is $SIZE bytes, expected at least $MIN_BYTES." >&2
  echo "  Something is missing even though the required paths are present." >&2
  exit 1
fi

echo "✓ tarball is complete"
