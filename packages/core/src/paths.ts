/**
 * Path canonicalization, shared by everything that uses a path as an identity.
 *
 * Four places key on paths — the `--safe` containment check, `DiffCapture`'s
 * before/after map, the history store's per-repo directory, and the editor
 * handler's containment check — and all four were comparing paths that Windows
 * considers equal but JavaScript does not.
 *
 * Two distinct hazards, and they need different tools:
 *
 *   1. Symlinks. `/tmp` and `/var` are symlinks on macOS, so `cwd` arrives as
 *      `/var/folders/…` while the agent reports `/private/var/folders/…`.
 *      `realpathSync` handles this and always did.
 *
 *   2. Case. Windows filesystems are case-insensitive, so `C:\Proj` and
 *      `c:\proj` are the same directory — but `===` and `startsWith` say
 *      otherwise, and `realpathSync` does NOT fix it: the JS implementation
 *      resolves links while preserving whatever spelling the caller passed.
 *      `realpathSync.native` does canonicalize case on Windows, because it goes
 *      through `GetFinalPathNameByHandle`. Drive-letter case alone is enough to
 *      trigger this: `process.cwd()` upper-cases it, but `--cwd c:/proj` and an
 *      `airship.config.json` value both pass through untouched.
 *
 * The failures are quiet rather than loud. `--safe` refuses edits inside the
 * project, `DiffCapture` attributes the user's own uncommitted work to the agent
 * and undoes it with the turn, and the history store splits in two so undo and
 * PR-from-session silently find nothing.
 */
import { resolve, sep } from "node:path";
import { canonicalPath } from "@airship/git";

const WIN32 = process.platform === "win32";

// canonicalPath comes from @airship/git and is deliberately NOT re-exported
// here: one implementation, one import path. That package needs the identical
// rule for `fileAtHead`, which derives a repo-relative path from keys this
// module produced, and when a second copy lived here the two drifted on
// Windows — the JS realpathSync leaves an 8.3 short name (`RUNNER~1`) alone
// while the native one expands it (`runneradmin`) — so `relative` returned a
// `..` path and every file read as absent from HEAD.

/**
 * A stable comparison key for a path.
 *
 * Lower-cased on Windows, where the filesystem is case-insensitive. Use this to
 * compare or to key a Map; keep the original string for anything that touches
 * the filesystem, so error messages and editor targets stay in the user's own
 * spelling.
 */
export function pathKey(path: string): string {
  const canon = canonicalPath(path);
  return WIN32 ? canon.toLowerCase() : canon;
}

/**
 * True if `target` resolves to a path at or under `root`.
 *
 * The `+ sep` is what stops `/proj2` matching root `/proj`, so it cannot be
 * dropped — but it has to be applied to a root that does not already end in a
 * separator, or a drive root (`C:\`, `/`) becomes `C:\\` and matches nothing.
 */
export function isPathInside(root: string, target: string): boolean {
  const absRoot = pathKey(resolve(root));
  const abs = pathKey(resolve(resolve(root), target));
  if (abs === absRoot) {
    return true;
  }
  const prefix = absRoot.endsWith(sep) ? absRoot : absRoot + sep;
  return abs.startsWith(prefix);
}

/**
 * Rewrite a native path to forward slashes.
 *
 * For values that leave the filesystem: git pathspecs (backslash is git's
 * wildmatch escape character), anything crossing the wire to the browser, and
 * anything embedded in JSON headed for the model, where every `\` is doubled.
 * A no-op off Windows.
 */
export function toPosixPath(path: string): string {
  return WIN32 ? path.split(sep).join("/") : path;
}
