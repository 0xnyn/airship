import type { DesignToken, TokenScanResult } from "@airship/protocol/tokens";
import { describe, expect, it } from "vitest";
import { mergeScans, tokenPreviewValue, tokenValue } from "./registry";

function cssVar(
  name: string,
  value: string,
  extra: Partial<DesignToken> = {}
): DesignToken {
  return {
    category: "spacing",
    kind: "css-var",
    name,
    origin: "static",
    values: { "": value },
    ...extra,
  };
}

function scan(tokens: DesignToken[]): TokenScanResult {
  return { framework: "unknown", tokens };
}

describe("mergeScans", () => {
  it("keeps static provenance but takes the runtime-resolved value", () => {
    const registry = mergeScans(
      scan([
        cssVar("--space-md", "var(--pk-space-md)", {
          file: "src/app.css",
          line: 12,
        }),
      ]),
      scan([cssVar("--space-md", "16px", { origin: "runtime" })])
    );
    const token = registry.byName["--space-md"];
    // The file is the whole reason the static scan exists...
    expect(token.file).toBe("src/app.css");
    expect(token.line).toBe(12);
    // ...and the resolved value is the whole reason the runtime scan does.
    expect(tokenValue(token)).toBe("16px");
  });

  it("keeps runtime-only tokens (CSS-in-JS is invisible on disk)", () => {
    const registry = mergeScans(
      scan([]),
      scan([cssVar("--emotion-gap", "8px", { origin: "runtime" })])
    );
    expect(registry.byName["--emotion-gap"]).toBeDefined();
  });

  it("collapses an alias onto its primitive, keeping the app-facing name", () => {
    const registry = mergeScans(
      scan([
        cssVar("--pk-radius-md", "8px"),
        cssVar("--radius-md", "8px", { aliasOf: "--pk-radius-md" }),
      ]),
      null
    );
    expect(registry.byName["--radius-md"]).toBeDefined();
    expect(registry.byName["--pk-radius-md"]).toBeUndefined();
    expect(registry.byCategory.spacing).toHaveLength(1);
  });

  it("keeps both when a theme has redefined the alias away from its primitive", () => {
    const registry = mergeScans(
      scan([
        cssVar("--pk-radius-md", "8px"),
        cssVar("--radius-md", "12px", { aliasOf: "--pk-radius-md" }),
      ]),
      null
    );
    expect(registry.byName["--pk-radius-md"]).toBeDefined();
    expect(registry.byName["--radius-md"]).toBeDefined();
  });

  it("indexes a custom property under every property in its category", () => {
    const registry = mergeScans(scan([cssVar("--space-md", "16px")]), null);
    // One declaration, reachable from any spacing control.
    expect(registry.byValue["padding-top:16px"]?.[0].name).toBe("--space-md");
    expect(registry.byValue["margin-left:16px"]?.[0].name).toBe("--space-md");
    expect(registry.byValue["gap:16px"]?.[0].name).toBe("--space-md");
    // But not from a control in a different category.
    expect(registry.byValue["font-size:16px"]).toBeUndefined();
  });

  it("indexes a utility class only under the property it declares", () => {
    const registry = mergeScans(
      scan([
        {
          category: "spacing",
          kind: "utility-class",
          name: ".pt-4",
          origin: "static",
          values: { "padding-top": "16px" },
        },
      ]),
      null
    );
    expect(registry.byValue["padding-top:16px"]?.[0].name).toBe(".pt-4");
    expect(registry.byValue["margin-left:16px"]).toBeUndefined();
  });

  it("sorts numeric scales by value, not by name", () => {
    const registry = mergeScans(
      scan([
        cssVar("--space-4", "16px"),
        cssVar("--space-1", "4px"),
        cssVar("--space-12", "48px"),
        cssVar("--space-2", "8px"),
      ]),
      null
    );
    expect(registry.byCategory.spacing.map((t) => tokenValue(t))).toEqual([
      "4px",
      "8px",
      "16px",
      "48px",
    ]);
  });

  it("normalizes colour formatting so one token is not indexed as two", () => {
    const registry = mergeScans(
      scan([cssVar("--brand", "rgb(0,10,255)", { category: "colors" })]),
      null
    );
    expect(registry.byValue["color:rgb(0, 10, 255)"]).toBeDefined();
  });

  it("survives both scans being absent", () => {
    const registry = mergeScans(null, null);
    expect(registry.framework).toBe("unknown");
    expect(registry.byCategory.spacing).toEqual([]);
  });
});

describe("tokenPreviewValue", () => {
  const utility = {
    category: "spacing",
    kind: "utility-class",
    name: ".pt-4",
    origin: "static",
    values: { "padding-top": "16px" },
  } as const;

  it("previews a custom property as a var() with the value as its fallback", () => {
    /*
     * The fallback is the whole point. A bare `var(--x)` is valid at parse time
     * whatever `--x` holds, so a reference the page does not define wins the
     * cascade and is then thrown out as invalid at computed-value time — which
     * falls back to `unset`. That read as "the colour did not change" on an
     * inherited property and blanked the value on one that is not.
     */
    expect(tokenPreviewValue(cssVar("--space-md", "16px"), "padding-top")).toBe(
      "var(--space-md, 16px)"
    );
  });

  it("previews a channel-triple token as its normalised literal", () => {
    // `--brand: 255 229 202` is a supported colour token, and
    // `background-color: var(--brand)` is invalid even when `--brand` resolves.
    // No fallback rescues that, so the reference is not used at all.
    expect(
      tokenPreviewValue(cssVar("--brand", "255 229 202"), "background-color")
    ).toBe("rgb(255, 229, 202)");
  });

  it("falls back to a bare reference when the token has no value to inline", () => {
    expect(tokenPreviewValue(cssVar("--empty", ""), "color")).toBe(
      "var(--empty)"
    );
  });

  it("previews a utility class as the value it declares, not its name", () => {
    // `.pt-4` is not a CSS value; writing it as one is what the CSSOM used to
    // drop on the floor.
    expect(tokenPreviewValue(utility, "padding-top")).toBe("16px");
  });

  it("picks the declared value for the property being edited", () => {
    const pair = {
      category: "spacing",
      kind: "utility-class",
      name: ".px-4",
      origin: "static",
      values: { "padding-left": "16px", "padding-right": "24px" },
    } as const;
    expect(tokenPreviewValue(pair, "padding-right")).toBe("24px");
  });
});
