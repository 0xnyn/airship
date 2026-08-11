#!/usr/bin/env bash
# Asserts the version just published actually has a README on npmjs.com.
#
# Why this exists: npmjs.com does not read the README out of the tarball. It
# renders the `readme` field of the version manifest, which the CLIENT attaches
# at publish time — and `pnpm publish` does not attach it. v0.2.2 shipped a
# tarball with a perfectly good README.md inside and a package page that still
# read "This package does not have a README". verify-tarball.sh could not catch
# it: the tarball was correct. Only the registry can tell you.
#
#   bash scripts/verify-published-readme.sh [version]
#
# Version defaults to whatever apps/cli/package.json holds. Runs after publish,
# so it cannot prevent a bad release — it makes one loud instead of silent, and
# the fix is always the next patch (npm never lets you republish a version).
set -euo pipefail

PKG_NAME="@airshiplabs/cli"
PKG_URL="https://registry.npmjs.org/@airshiplabs%2Fcli"
ATTEMPTS=6
DELAY=5

cd "$(git rev-parse --show-toplevel)"

VERSION="${1:-$(node -p "require('./apps/cli/package.json').version")}"

echo "» checking the readme field on $PKG_NAME@$VERSION"

len=0
for attempt in $(seq 1 "$ATTEMPTS"); do
  # The registry keeps one README per package, at the top level of the
  # packument, taken from the manifest of the version that became `latest`.
  # Per-version `readme` fields are stripped, so there is nothing else to read.
  len="$(
    curl -sf "$PKG_URL" |
      VERSION="$VERSION" node -e "
        let s = '';
        process.stdin.on('data', (d) => { s += d; });
        process.stdin.on('end', () => {
          const doc = JSON.parse(s);
          const isLatest = doc['dist-tags']?.latest === process.env.VERSION;
          process.stdout.write(isLatest ? String((doc.readme ?? '').length) : '0');
        });
      "
  )" || len=0

  if [ "${len:-0}" -gt 0 ]; then
    break
  fi
  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    echo "  not visible yet (attempt $attempt/$ATTEMPTS) — retrying in ${DELAY}s"
    sleep "$DELAY"
  fi
done

if [ "${len:-0}" -eq 0 ]; then
  echo >&2
  echo "::error::$PKG_NAME@$VERSION has no README on npmjs.com — the package page will be blank." >&2
  echo "  Either it is not the 'latest' tag yet, or the readme field was never sent." >&2
  echo "  The tarball can still be perfect; this field is attached by the publishing client." >&2
  echo "  Publish with 'npm publish <tarball>', not 'pnpm publish' — see scripts/verify-tarball.sh." >&2
  exit 1
fi

echo "✓ readme field is $len bytes"
