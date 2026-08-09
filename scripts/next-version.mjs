// The one place airship's next version is computed.
//
// Both release lanes call this — scripts/release.sh locally and
// .github/workflows/publish.yml in CI — so the two can never disagree about
// what "patch" means. Prints the version to stdout and nothing else, so it
// composes into `NEXT=$(node scripts/next-version.mjs --bump patch)`.
//
//   node scripts/next-version.mjs --bump patch|minor|major [--current x.y.z]
//   node scripts/next-version.mjs --version 1.4.0
//
// --current is for CI, which may want to bump from something other than what
// is on disk. Omitted, it reads apps/cli/package.json.

import { readFileSync } from "node:fs";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BUMPS = new Set(["patch", "minor", "major"]);
const PKG = new URL("../apps/cli/package.json", import.meta.url);

function die(message) {
  process.stderr.write(`next-version: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      die(`unexpected argument "${key}"`);
    }
    const value = argv[i + 1];
    if (value === undefined) {
      die(`${key} needs a value`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function currentVersion(explicit) {
  if (explicit) {
    return explicit;
  }
  try {
    return JSON.parse(readFileSync(PKG, "utf8")).version;
  } catch (error) {
    die(`could not read apps/cli/package.json — ${error.message}`);
  }
}

function bump(version, kind) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (kind === "major") {
    return `${major + 1}.0.0`;
  }
  if (kind === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

const args = parseArgs(process.argv.slice(2));

// An explicit version wins outright — it is the escape hatch for anything the
// three bump kinds cannot express (a first release, a prerelease, a correction).
if (args.version) {
  if (!SEMVER.test(args.version)) {
    die(`"${args.version}" is not a plain x.y.z version`);
  }
  process.stdout.write(`${args.version}\n`);
  process.exit(0);
}

if (!args.bump) {
  die("pass either --bump patch|minor|major or --version x.y.z");
}
if (!BUMPS.has(args.bump)) {
  die(`unknown bump "${args.bump}" — expected patch, minor or major`);
}

const current = currentVersion(args.current);
if (!SEMVER.test(current)) {
  die(`current version "${current}" is not a plain x.y.z version`);
}

process.stdout.write(`${bump(current, args.bump)}\n`);
