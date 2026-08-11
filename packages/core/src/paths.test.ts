/**
 * Path identity, which four separate features key on — `--safe` containment,
 * `DiffCapture`'s before/after map, the history store's per-repo directory, and
 * the editor handler's containment check.
 *
 * The containment cases moved here wholesale when `isPathInside` moved out of
 * `sandbox.ts`; the guard's job has not changed. It must deny what is genuinely
 * outside the project — and, just as importantly, allow everything inside it. A
 * false deny is not a safe failure: the model burns turns probing why it was
 * refused and then routes around the guard, which costs money and produces a
 * worse edit.
 *
 * Some of what these helpers exist for is Windows-only and cannot be exercised
 * from a POSIX runner: `realpathSync.native` case-folding and `toPosixPath`
 * rewriting separators both no-op here. The `windows-latest` leg in checks.yml
 * is what covers those.
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, sep } from "node:path";
import { canonicalPath } from "@airship/git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPathInside, pathKey, toPosixPath } from "./paths";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "airship-paths-test-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "app.ts"), "x");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("isPathInside", () => {
  it("allows a relative path in the project", () => {
    expect(isPathInside(root, "src/app.ts")).toBe(true);
  });

  it("allows an absolute path in the project", () => {
    expect(isPathInside(root, join(root, "src", "app.ts"))).toBe(true);
  });

  it("allows the root itself", () => {
    expect(isPathInside(root, root)).toBe(true);
  });

  it("allows a file that does not exist yet", () => {
    expect(isPathInside(root, join(root, "src", "new.ts"))).toBe(true);
  });

  it("allows the symlink-resolved spelling of an in-project path", () => {
    // On macOS `mkdtemp` hands back `/var/...` while everything that resolves
    // the path reports `/private/var/...`. Both name the same file, and a guard
    // that denies one of them fires on an ordinary project.
    const viaRealpath = join(realpathSync(root), "src", "app.ts");
    expect(isPathInside(root, viaRealpath)).toBe(true);
  });

  it("allows an in-project path reached through a symlinked root", () => {
    const link = join(tmpdir(), `airship-paths-link-${process.pid}`);
    rmSync(link, { force: true, recursive: true });
    // "junction" on Windows: Node's default link type is "file", which does not
    // work for a directory, and unlike a real directory symlink a junction
    // needs neither elevation nor Developer Mode.
    symlinkSync(root, link, process.platform === "win32" ? "junction" : "dir");
    try {
      expect(isPathInside(link, join(root, "src", "app.ts"))).toBe(true);
      expect(isPathInside(root, join(link, "src", "app.ts"))).toBe(true);
    } finally {
      rmSync(link, { force: true, recursive: true });
    }
  });

  it("denies a sibling directory that shares the project's name prefix", () => {
    expect(isPathInside(root, `${root}-evil/secret.txt`)).toBe(false);
  });

  it("denies a traversal out of the project", () => {
    expect(isPathInside(root, "../../etc/hosts")).toBe(false);
  });

  it("denies an unrelated absolute path", () => {
    expect(isPathInside(root, "/etc/hosts")).toBe(false);
  });

  it("handles a root that already ends in a separator", () => {
    // Documentation rather than regression: `resolve` strips a trailing
    // separator, so this case was never the broken one.
    expect(isPathInside(`${root}${sep}`, join(root, "src", "app.ts"))).toBe(
      true
    );
  });

  it("handles the filesystem root, which is nothing but a separator", () => {
    // This is the regression. `resolve` cannot strip the separator here — it is
    // the whole path — so the old `absRoot + sep` built the prefix `//`, which
    // no real path starts with, and every file read as outside the root. The
    // same shape is far more reachable on Windows, where a project checked out
    // at `C:\` is ordinary.
    //
    // `parse(root).root` rather than a bare `sep`: on Windows that resolves
    // against the *current* drive, and CI runs the checkout on D: while the
    // temp directory lives on C:, so the two would be genuinely unrelated.
    expect(isPathInside(parse(root).root, join(root, "src", "app.ts"))).toBe(
      true
    );
  });
});

describe("pathKey", () => {
  it("agrees with itself across spellings of one path", () => {
    const viaJoin = pathKey(join(root, "src", "app.ts"));
    const viaTraversal = pathKey(join(root, "src", "..", "src", "app.ts"));
    expect(viaJoin).toBe(viaTraversal);
  });

  it("resolves a symlinked root to the same key as the real one", () => {
    // This is what stops the history store splitting in two for one project.
    expect(pathKey(root)).toBe(pathKey(realpathSync(root)));
  });
});

describe("canonicalPath", () => {
  it("falls back to the parent directory for a file that does not exist", () => {
    // The create case: the file is absent but its directory is real, so the
    // result still has to be the canonical location it will occupy.
    expect(canonicalPath(join(root, "src", "absent.ts"))).toBe(
      join(canonicalPath(join(root, "src")), "absent.ts")
    );
  });

  it("returns an absolute path even when nothing on the way exists", () => {
    const result = canonicalPath(join(root, "no", "such", "dir", "x.ts"));
    expect(result.endsWith(join("no", "such", "dir", "x.ts"))).toBe(true);
  });
});

describe("toPosixPath", () => {
  it("leaves an already-POSIX path alone", () => {
    expect(toPosixPath("src/components/Button.tsx")).toBe(
      "src/components/Button.tsx"
    );
  });
});
