import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidatePorts } from "./detect";

function project(pkg: Record<string, unknown> | null): string {
  const root = mkdtempSync(join(tmpdir(), "airship-detect-"));
  if (pkg) {
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  }
  return root;
}

const portsOf = (cwd: string): number[] =>
  candidatePorts(cwd).map((candidate) => candidate.port);

describe("candidatePorts", () => {
  it("takes an explicit --port from the dev script first", () => {
    const cwd = project({
      devDependencies: { vite: "^7" },
      scripts: { dev: "vite dev --port 4000" },
    });
    const [first] = candidatePorts(cwd);
    expect(first).toEqual({
      port: 4000,
      reason: "the port in your dev script",
    });
  });

  it("reads the --port=N form", () => {
    const cwd = project({ scripts: { dev: "next dev --port=4100" } });
    expect(portsOf(cwd)[0]).toBe(4100);
  });

  it("reads the -p form", () => {
    const cwd = project({ scripts: { dev: "astro dev -p 4200" } });
    expect(portsOf(cwd)[0]).toBe(4200);
  });

  it("reads a PORT= prefix", () => {
    const cwd = project({ scripts: { dev: "PORT=4300 remix dev" } });
    expect(portsOf(cwd)[0]).toBe(4300);
  });

  it("falls back to start, then serve", () => {
    expect(portsOf(project({ scripts: { start: "x --port 4400" } }))[0]).toBe(
      4400
    );
    expect(portsOf(project({ scripts: { serve: "x --port 4500" } }))[0]).toBe(
      4500
    );
  });

  it("uses the framework's default port when the script says nothing", () => {
    const cwd = project({
      devDependencies: { vite: "^7" },
      scripts: { dev: "vite dev" },
    });
    expect(candidatePorts(cwd)[0]).toEqual({
      port: 5173,
      reason: "vite's default port",
    });
  });

  it("prefers the more specific framework when both are present", () => {
    const cwd = project({ devDependencies: { next: "^15", vite: "^7" } });
    expect(portsOf(cwd)[0]).toBe(3000);
  });

  it("recognises storybook by its scoped packages", () => {
    const cwd = project({ devDependencies: { "@storybook/react": "^9" } });
    expect(portsOf(cwd)).toContain(6006);
  });

  it("finds frameworks in dependencies as well as devDependencies", () => {
    const cwd = project({ dependencies: { nuxt: "^3" } });
    expect(portsOf(cwd)[0]).toBe(3000);
  });

  it("always offers the common ports as a fallback", () => {
    expect(portsOf(project({}))).toEqual([3000, 5173, 8080, 4321, 4200]);
  });

  it("survives a project with no package.json", () => {
    expect(portsOf(project(null))).toEqual([3000, 5173, 8080, 4321, 4200]);
  });

  it("survives a malformed package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "airship-detect-"));
    writeFileSync(join(root, "package.json"), "{ not json");
    expect(portsOf(root)).toEqual([3000, 5173, 8080, 4321, 4200]);
  });

  it("never repeats a port", () => {
    const cwd = project({
      devDependencies: { vite: "^7" },
      scripts: { dev: "vite dev --port 5173" },
    });
    const ports = portsOf(cwd);
    expect(new Set(ports).size).toBe(ports.length);
    // The reason for the first sighting is kept — it is the more specific one.
    expect(candidatePorts(cwd)[0]?.reason).toBe("the port in your dev script");
  });
});
