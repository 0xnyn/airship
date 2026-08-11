/**
 * Turning what the browser reports into a path on disk.
 *
 * The input is a dev-server URL path, not a filesystem path, and the two look
 * alike enough to be confused: `/src/App.tsx` is rooted as far as `resolve` is
 * concerned. Getting it wrong is quiet — the agent is handed context from the
 * wrong file, or none at all — so the cases are pinned here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveServerSource } from "./server";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "airship-source-test-"));
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src", "App.tsx"), "const App = () => null;\n");
});

afterEach(() => {
  rmSync(cwd, { force: true, recursive: true });
});

const resolveFile = (file: string, line = 1) =>
  resolveServerSource(cwd, { source: { file, line } })?.file;

describe("resolveServerSource", () => {
  it("resolves a dev-server URL path against the project root", () => {
    expect(resolveFile("/src/App.tsx")).toBe("src/App.tsx");
  });

  it("resolves a project-relative path", () => {
    expect(resolveFile("src/App.tsx")).toBe("src/App.tsx");
  });

  it("resolves a genuinely absolute path inside the project", () => {
    expect(resolveFile(join(cwd, "src", "App.tsx"))).toBe("src/App.tsx");
  });

  it("resolves a /@fs/ path, which Vite uses for files outside its root", () => {
    // Vite collapses `/@fs/` + `/abs/path` into `/@fs/abs/path`, so the
    // remainder has lost its leading slash and has to get it back.
    const abs = join(cwd, "src", "App.tsx");
    expect(resolveFile(`/@fs${abs}`)).toBe("src/App.tsx");
  });

  it("reports the path unchanged when the file cannot be located", () => {
    expect(resolveFile("/src/Missing.tsx")).toBe("/src/Missing.tsx");
  });

  it("attaches surrounding source as context once it locates the file", () => {
    const resolved = resolveServerSource(cwd, {
      source: { file: "/src/App.tsx", line: 1 },
    });
    expect(resolved?.context).toContain("const App");
  });

  it("emits forward slashes for a nested path", () => {
    // This value goes into the edit prompt, into the JSON an MCP tool returns
    // (where a backslash arrives doubled) and into the overlay as a label.
    mkdirSync(join(cwd, "src", "components"), { recursive: true });
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "x\n");
    const file = resolveFile("/src/components/Button.tsx");
    expect(file).toBe("src/components/Button.tsx");
    expect(file).not.toContain("\\");
  });
});
