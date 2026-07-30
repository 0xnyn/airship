/**
 * The path guard's job is to deny what is genuinely outside the project — and,
 * just as importantly, to allow everything inside it. A false deny is not a
 * safe failure: the model burns turns probing why it was refused and then
 * routes around the guard, which costs money and produces a worse edit.
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
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPathInside } from "./sandbox";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "airship-sandbox-test-"));
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
    const link = join(tmpdir(), `airship-sandbox-link-${process.pid}`);
    rmSync(link, { force: true });
    symlinkSync(root, link);
    try {
      expect(isPathInside(link, join(root, "src", "app.ts"))).toBe(true);
      expect(isPathInside(root, join(link, "src", "app.ts"))).toBe(true);
    } finally {
      rmSync(link, { force: true });
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
});
