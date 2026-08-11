#!/usr/bin/env bash
# Guided release cutter for @airshiplabs/cli.
#
# Bumps apps/cli/package.json, refreshes the lockfile, validates the build and
# the npm packaging (dry-run), then creates the release commit and the
# cli-vX.Y.Z tag — and STOPS. Pushing the tag is deliberately left to you,
# because that push is what triggers .github/workflows/release.yml and
# publishes to npm:
#
#   make release                 # interactive: pick patch / minor / major
#   make release BUMP=minor      # non-interactive bump
#   make release VERSION=1.4.0   # set an explicit version
#   make release DRY=1           # validate everything, commit and tag nothing
#
# Env knobs:
#   YES=1         skip the final confirmation prompt
#   NO_VERIFY=1   skip the build + publish dry-run (faster, less safe)
#   ALLOW_DIRTY=1 escape hatch — proceed on a dirty tree (discouraged)
set -euo pipefail

PKG_DIR="apps/cli"
PKG_JSON="$PKG_DIR/package.json"
PKG_NAME="@airshiplabs/cli"
TAG_PREFIX="cli-v"

# Colors only when stdout is a terminal, so piping this into a log stays clean.
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[0;31m'
  GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; CYAN=''; RESET=''
fi

info() { printf "%s»%s %s\n" "$CYAN" "$RESET" "$1"; }
ok()   { printf "%s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
warn() { printf "%s!%s %s\n" "$YELLOW" "$RESET" "$1"; }
die()  { printf "%s✖%s %s\n" "$RED" "$RESET" "$1" >&2; exit 1; }

# Read from the terminal explicitly, so prompts still work when stdout is piped.
ask() {
  local prompt="$1" reply
  exec 3</dev/tty || die "no terminal to prompt on — pass BUMP= or VERSION=, or YES=1"
  printf "%s" "$prompt" > /dev/tty
  read -r reply <&3
  exec 3<&-
  printf "%s" "$reply"
}

# ---------------------------------------------------------------- preflight

for tool in git node pnpm; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not on PATH"
done

cd "$(git rev-parse --show-toplevel)" || die "not inside a git repository"
[ -f "$PKG_JSON" ] || die "$PKG_JSON not found"

# Releases go out from main, because what ships to npm should be what was
# reviewed and merged. Cutting from a branch publishes the branch: v0.2.2 and
# v0.2.3 both reached users from release/cli-readme before that branch had a
# pull request, a Checks run, or a single reviewer.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  warn "you are on '$BRANCH' — releases go out from main, so this would ship unmerged code"
fi

if [ -z "${ALLOW_DIRTY:-}" ] && [ -n "$(git status --porcelain)" ]; then
  git status --short
  die "working tree is dirty — commit or stash first (ALLOW_DIRTY=1 overrides)"
fi

info "fetching tags"
git fetch --tags --quiet 2>/dev/null || warn "could not fetch tags (no remote yet?)"

CURRENT="$(node -p "require('./$PKG_JSON').version")"

# ---------------------------------------------------------------- version

if [ -n "${VERSION:-}" ]; then
  NEXT="$(node scripts/next-version.mjs --version "$VERSION")"
elif [ -n "${BUMP:-}" ]; then
  NEXT="$(node scripts/next-version.mjs --bump "$BUMP")"
else
  printf "\n  current %s%s%s\n\n" "$BOLD" "$CURRENT" "$RESET"
  printf "    1) patch  ->  %s\n" "$(node scripts/next-version.mjs --bump patch)"
  printf "    2) minor  ->  %s\n" "$(node scripts/next-version.mjs --bump minor)"
  printf "    3) major  ->  %s\n\n" "$(node scripts/next-version.mjs --bump major)"
  case "$(ask "  Which? [1/2/3] ")" in
    1) NEXT="$(node scripts/next-version.mjs --bump patch)" ;;
    2) NEXT="$(node scripts/next-version.mjs --bump minor)" ;;
    3) NEXT="$(node scripts/next-version.mjs --bump major)" ;;
    *) die "aborted" ;;
  esac
fi

TAG="${TAG_PREFIX}${NEXT}"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  die "tag $TAG already exists"
fi

# ---------------------------------------------------------------- plan

DRY_NOTE=""
[ -n "${DRY:-}" ] && DRY_NOTE=" ${YELLOW}(dry run — nothing will be written)${RESET}"

cat <<PLAN

  ${BOLD}Release plan${RESET}${DRY_NOTE}

    1. bump $PKG_JSON   $CURRENT ${DIM}->${RESET} ${BOLD}$NEXT${RESET}
    2. refresh the lockfile
    3. build + validate npm packaging (dry-run)
    4. commit  ${DIM}chore(release): cli v$NEXT${RESET}
    5. tag     ${DIM}$TAG${RESET} (annotated)

  Then, when you are ready: ${CYAN}git push --follow-tags${RESET}
  ${DIM}That push is what publishes — release.yml fires on $TAG_PREFIX* tags.${RESET}

PLAN

if [ -z "${YES:-}" ] && [ -z "${DRY:-}" ]; then
  case "$(ask "  Proceed? [y/N] ")" in
    [yY]) ;;
    *) die "aborted" ;;
  esac
fi

# ---------------------------------------------------------------- cut it

info "bumping $PKG_JSON to $NEXT"
node -e "
  const f='$PKG_JSON';
  const p=require('./'+f);
  p.version='$NEXT';
  require('fs').writeFileSync(f, JSON.stringify(p,null,2)+'\n');
"
pnpm install --lockfile-only >/dev/null
ok "bumped"

if [ -z "${NO_VERIFY:-}" ]; then
  info "validating packaging (build + publish --dry-run)"
  pnpm --filter "$PKG_NAME" publish --dry-run --no-git-checks --access public >/dev/null
  ok "packaging is valid"
else
  warn "skipping packaging validation (NO_VERIFY=1)"
fi

if [ -n "${DRY:-}" ]; then
  # Put the version back by rewriting it, NOT with `git checkout -- $PKG_JSON`:
  # that would discard every other uncommitted change to the file too, which
  # under ALLOW_DIRTY=1 is someone else's work.
  info "dry run — restoring $PKG_JSON to $CURRENT"
  node -e "
    const f='$PKG_JSON';
    const p=require('./'+f);
    p.version='$CURRENT';
    require('fs').writeFileSync(f, JSON.stringify(p,null,2)+'\n');
  "
  pnpm install --lockfile-only >/dev/null
  ok "dry run complete: $CURRENT would become $NEXT ($TAG)"
  exit 0
fi

info "committing and tagging"
git add "$PKG_JSON" pnpm-lock.yaml
git commit -m "chore(release): cli v$NEXT" >/dev/null
git tag -a "$TAG" -m "$TAG"
ok "committed and tagged $TAG"

# ---------------------------------------------------------------- postflight

if command -v gh >/dev/null 2>&1; then
  if ! gh secret list 2>/dev/null | grep -q '^NPM_TOKEN'; then
    warn "NPM_TOKEN is not set on the repo — release.yml cannot publish without it"
  fi
fi

cat <<DONE

  ${GREEN}Cut $PKG_NAME v$NEXT.${RESET}

  Publish it:   ${CYAN}git push --follow-tags${RESET}
  Undo it:      ${DIM}git tag -d $TAG && git reset --hard HEAD~1${RESET}

DONE
