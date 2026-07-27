import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  invalidateTokenCache,
  scanProjectTokens,
  tokenScanRoot,
} from "./tokens";

/** Build a throwaway project tree and return its root. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "airship-tokens-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  invalidateTokenCache();
  return root;
}

describe("tokenScanRoot", () => {
  it("climbs to the workspace root, not the dev server's cwd", () => {
    // The case this exists for: the app is `apps/web`, and the design tokens
    // are a sibling package. Scanning from the app finds aliases and never
    // finds what they alias to.
    const root = fixture({
      "apps/web/package.json": "{}",
      "apps/web/src/styles.css": ":root { --x: 1px; }",
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    });
    expect(tokenScanRoot(join(root, "apps/web"))).toBe(root);
  });

  it("stops at the nearest marker, not the outermost one", () => {
    // A nested workspace must not escalate to the repo above it and scan a
    // completely unrelated project.
    const root = fixture({
      ".git": "",
      "example/apps/web/package.json": "{}",
      "example/pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    });
    expect(tokenScanRoot(join(root, "example/apps/web"))).toBe(
      join(root, "example")
    );
  });

  it("falls back to cwd when there is no marker anywhere above", () => {
    const root = mkdtempSync(join(tmpdir(), "airship-bare-"));
    mkdirSync(join(root, "a/b/c/d/e/f/g"), { recursive: true });
    const deep = join(root, "a/b/c/d/e/f/g");
    expect(tokenScanRoot(deep)).toBe(deep);
  });
});

describe("scanProjectTokens", () => {
  it("resolves a var() alias chain across packages to its literal", () => {
    const root = fixture({
      "apps/web/src/styles.css":
        '@import "tailwindcss";\n@theme {\n  --radius-md: var(--pk-radius-md);\n  --color-page: var(--pk-color-page);\n}\n',
      // The primitive lives in a sibling package's build output, which is where
      // token packages actually ship it.
      "packages/tokens/dist/tokens.css":
        ":root {\n  --pk-radius-md: 8px;\n  --pk-color-page: #fafaf9;\n}\n",
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
    });
    const scan = scanProjectTokens(join(root, "apps/web"), { refresh: true });
    const byName = Object.fromEntries(scan.tokens.map((t) => [t.name, t]));

    expect(scan.framework).toBe("tailwind");
    expect(byName["--radius-md"].values[""]).toBe("8px");
    expect(byName["--color-page"].values[""]).toBe("#fafaf9");
    // The alias is recorded so the registry can collapse the duplicate pair.
    expect(byName["--radius-md"].aliasOf).toBe("--pk-radius-md");
    // Categorised from the property it is used on, not from its name alone.
    expect(byName["--color-page"].category).toBe("colors");
  });

  it("records a file and line for every token", () => {
    const root = fixture({
      "pnpm-workspace.yaml": "",
      "src/tokens.css":
        "/* a comment\n   spanning lines */\n:root {\n  --gap: 8px;\n}\n",
    });
    const scan = scanProjectTokens(root, { refresh: true });
    const gap = scan.tokens.find((t) => t.name === "--gap");
    expect(gap?.file).toBe("src/tokens.css");
    // Line 4 — comments are blanked in place so offsets stay truthful.
    expect(gap?.line).toBe(4);
  });

  it("skips bundler output but keeps a token package's dist", () => {
    const root = fixture({
      "packages/tokens/dist/tokens.css": ":root { --keep: 4px; }",
      "pnpm-workspace.yaml": "",
      "web/dist/assets/styles-DSZLOMh8.css": ":root { --dropped: 9px; }",
    });
    const names = scanProjectTokens(root, { refresh: true }).tokens.map(
      (t) => t.name
    );
    expect(names).toContain("--keep");
    expect(names).not.toContain("--dropped");
  });

  it("ignores framework-internal custom properties", () => {
    const root = fixture({
      "a.css": ":root { --tw-ring-offset-width: 0px; --real: 4px; }",
      "pnpm-workspace.yaml": "",
    });
    const names = scanProjectTokens(root, { refresh: true }).tokens.map(
      (t) => t.name
    );
    expect(names).toContain("--real");
    expect(names).not.toContain("--tw-ring-offset-width");
  });

  it("picks up single-declaration utility classes", () => {
    const root = fixture({
      "a.css":
        ".pt-4 { padding-top: 16px; }\n.card { padding: 8px; margin: 4px; }\n",
      "pnpm-workspace.yaml": "",
    });
    const scan = scanProjectTokens(root, { refresh: true });
    const utilities = scan.tokens.filter((t) => t.kind === "utility-class");
    expect(utilities.map((t) => t.name)).toEqual([".pt-4"]);
    // `.card` declares two properties, so it is a component, not a token.
  });

  it("ignores the editor's own chrome palette", () => {
    // The scan climbs to the workspace root by design, which in airship's own
    // repo walks straight into the package that emits the inspector's colours.
    // Those were being offered as the user's design system, and applying one
    // wrote a `var()` the app could not resolve.
    const root = fixture({
      "apps/web/package.json": '{"name":"@acme/web"}',
      "apps/web/src/a.css": ":root { --brand: #0af; }",
      "packages/editor-tokens/dist/tokens.css":
        ".ap-mock { --ap-surface-panel: #313131; }",
      "packages/editor-tokens/package.json":
        '{"name":"@airship/editor-tokens"}',
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
    });
    const names = scanProjectTokens(join(root, "apps/web"), {
      refresh: true,
    }).tokens.map((t) => t.name);
    expect(names).toContain("--brand");
    expect(names).not.toContain("--ap-surface-panel");
  });

  it("keeps the app's own tokens even though it shares our scope", () => {
    /*
     * The regression the exact-name list exists to prevent. Excluding
     * "anything scoped `@airship/`" also excluded `@airship/web` — the app being
     * edited — and the scan returned nothing at all. Being scope-mates does not
     * make a package the editor's chrome.
     */
    const root = fixture({
      "apps/web/package.json": '{"name":"@airship/web"}',
      "apps/web/src/a.css": ":root { --brand: #0af; }",
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    });
    const names = scanProjectTokens(join(root, "apps/web"), {
      refresh: true,
    }).tokens.map((t) => t.name);
    expect(names).toContain("--brand");
  });

  it("keeps a design-token package that is a sibling of the app", () => {
    // The whole reason the scan climbs. This must survive the exclusions.
    const root = fixture({
      "apps/web/package.json": '{"name":"@acme/web"}',
      "apps/web/src/a.css": ":root { --radius-md: var(--pk-radius-md); }",
      "packages/tokens/dist/tokens.css": ":root { --pk-radius-md: 8px; }",
      "packages/tokens/package.json": '{"name":"@acme/tokens"}',
      "pnpm-workspace.yaml": "packages:\n  - apps/*\n  - packages/*\n",
    });
    const names = scanProjectTokens(join(root, "apps/web"), {
      refresh: true,
    }).tokens.map((t) => t.name);
    expect(names).toContain("--pk-radius-md");
  });
});
