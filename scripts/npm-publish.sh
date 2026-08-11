#!/usr/bin/env bash
# Publishes a packed tarball to npm with provenance, retrying the Sigstore flake.
#
# Why this exists: `--provenance` makes npm POST a signed provenance bundle to
# Sigstore's Rekor transparency log before the package goes out. When that POST
# hangs, npm's own HTTP layer retries the IDENTICAL payload and Rekor answers
#
#   npm error code TLOG_CREATE_ENTRY_ERROR
#   npm error error creating tlog entry - (409) an equivalent entry already
#   exists in the transparency log
#
# — a duplicate rejection, not a real failure. That is how v0.2.4 died: git got
# the release commit and the tag, npm never got the package, and the run turned
# red 42 seconds into a publish that had nothing wrong with it.
#
# Retrying HERE works where npm's internal retry cannot. npm's retry replays the
# same bytes and the same signature, so Rekor keeps seeing a duplicate; a fresh
# `npm publish` process mints a new ephemeral signing key, which produces a
# different log entry that Rekor accepts.
#
#   bash scripts/npm-publish.sh <tarball>
#
# Only transient codes are retried — an expired token fails on the first attempt
# rather than burning a minute proving it three times.
#
# Env knobs:
#   ATTEMPTS=n   how many publishes to try (default 3)
#   DELAY=n      seconds before the second attempt, doubled for the third
#                (default 15) — set to 0 to exercise the retry paths in a test
set -euo pipefail

PKG_NAME="@airshiplabs/cli"
ATTEMPTS="${ATTEMPTS:-3}"
DELAY="${DELAY:-15}"

TGZ="${1:-}"
if [ -z "$TGZ" ]; then
  echo "npm-publish: usage: npm-publish.sh <tarball>" >&2
  exit 1
fi

# Resolve the argument before cd'ing, so a relative path still works.
TGZ="$(cd "$(dirname "$TGZ")" && pwd)/$(basename "$TGZ")"
[ -f "$TGZ" ] || { echo "npm-publish: $TGZ not found" >&2; exit 1; }

# Publish from the repo root, which is where both workflows used to run this
# inline. Auth comes from NPM_CONFIG_USERCONFIG, not from cwd, but the repo
# .npmrc is read from here and this keeps the two identical.
cd "$(git rev-parse --show-toplevel)"

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

for attempt in $(seq 1 "$ATTEMPTS"); do
  echo "» publishing $(basename "$TGZ") (attempt $attempt/$ATTEMPTS)"

  # PIPESTATUS, not the pipeline's status: `tee` succeeds even when npm does
  # not, and streaming the output is what makes a failed publish readable in
  # the Actions log.
  set +e
  npm publish "$TGZ" --access public --provenance 2>&1 | tee "$LOG"
  status="${PIPESTATUS[0]}"
  set -e

  if [ "$status" -eq 0 ]; then
    echo "✓ published $PKG_NAME"
    exit 0
  fi

  code="$(sed -n 's/^npm error code \(.*\)$/\1/p' "$LOG" | head -1)"

  # A conflict on a LATER attempt means an earlier attempt this run actually
  # reached the registry and only its response was lost — the publish landed,
  # so this run succeeded. On the first attempt it means the version was
  # already on npm before we started, which is a real error: we were asked to
  # publish and published nothing.
  if [ "$code" = "EPUBLISHCONFLICT" ]; then
    if [ "$attempt" -gt 1 ]; then
      echo
      echo "✓ attempt $((attempt - 1)) landed after all — the registry already has this version"
      exit 0
    fi
    echo >&2
    echo "::error::npm already has this version of $PKG_NAME — nothing was published." >&2
    echo "  A version is spent the moment it goes out; npm never lets you replace one." >&2
    echo "  Release the next version instead." >&2
    exit "$status"
  fi

  case "$code" in
    TLOG_CREATE_ENTRY_ERROR | ETIMEDOUT | ECONNRESET | EAI_AGAIN | ERR_SOCKET_TIMEOUT | E5[0-9][0-9]) ;;
    *)
      echo >&2
      echo "::error::$PKG_NAME publish failed with ${code:-no error code} — not retrying." >&2
      echo "  Only transient codes are retried; this one needs a fix, not another attempt." >&2
      exit "$status"
      ;;
  esac

  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    wait_for=$((DELAY * attempt))
    echo
    echo "  $code is transient — retrying in ${wait_for}s with a fresh signing key"
    sleep "$wait_for"
  fi
done

echo >&2
echo "::error::$PKG_NAME publish failed $ATTEMPTS times — last code was ${code:-unknown}." >&2
echo "  Nothing was pushed to git, so re-running this workflow is safe." >&2
exit 1
