import { describe, expect, it } from "vitest";
import {
  firstFamily,
  formatFontStack,
  parseFontStack,
  replaceFirstFamily,
} from "./font-stack";

const REAL = '"Inter", "Inter Fallback", system-ui, -apple-system, sans-serif';

describe("parseFontStack", () => {
  it("splits and unquotes", () => {
    expect(parseFontStack(REAL)).toEqual([
      "Inter",
      "Inter Fallback",
      "system-ui",
      "-apple-system",
      "sans-serif",
    ]);
  });

  it("takes single quotes too", () => {
    expect(parseFontStack("'Times New Roman', serif")).toEqual([
      "Times New Roman",
      "serif",
    ]);
  });

  it("is empty for an empty value", () => {
    expect(parseFontStack("")).toEqual([]);
    expect(parseFontStack("   ")).toEqual([]);
  });
});

describe("formatFontStack", () => {
  it("quotes a name with spaces", () => {
    expect(formatFontStack(["Times New Roman", "serif"])).toBe(
      '"Times New Roman", serif'
    );
  });

  it("leaves a bare identifier alone", () => {
    expect(formatFontStack(["Inter", "sans-serif"])).toBe("Inter, sans-serif");
  });

  it("never quotes a generic family", () => {
    // Quoting one asks for a font *called* `sans-serif`, so the fallback that
    // was the whole point of the last entry stops working.
    expect(formatFontStack(["system-ui", "ui-monospace", "monospace"])).toBe(
      "system-ui, ui-monospace, monospace"
    );
  });

  it("keeps a leading-hyphen vendor family unquoted", () => {
    expect(formatFontStack(["-apple-system"])).toBe("-apple-system");
  });
});

describe("firstFamily", () => {
  it("is what the browser will try first", () => {
    expect(firstFamily(REAL)).toBe("Inter");
  });

  it("is empty when there is no stack", () => {
    expect(firstFamily("")).toBe("");
  });
});

describe("replaceFirstFamily", () => {
  it("keeps every fallback", () => {
    /*
     * The regression this exists for. The field showed `Inter`, committed
     * whatever it held as the whole declaration, and the four fallbacks behind
     * it were gone — on a blur that changed nothing.
     */
    expect(replaceFirstFamily(REAL, "Georgia")).toBe(
      'Georgia, "Inter Fallback", system-ui, -apple-system, sans-serif'
    );
  });

  it("quotes the incoming family when it needs it", () => {
    expect(replaceFirstFamily(REAL, "Times New Roman")).toBe(
      '"Times New Roman", "Inter Fallback", system-ui, -apple-system, sans-serif'
    );
  });

  it("accepts a quoted family and does not double-quote it", () => {
    expect(replaceFirstFamily("Inter, serif", '"Times New Roman"')).toBe(
      '"Times New Roman", serif'
    );
  });

  it("moves a family already further down rather than duplicating it", () => {
    expect(replaceFirstFamily(REAL, "system-ui")).toBe(
      'system-ui, "Inter Fallback", -apple-system, sans-serif'
    );
  });

  it("matches case-insensitively when de-duplicating", () => {
    // `Inter` is gone because it was the family being replaced; `Georgia` is
    // gone because it is the family replacing it, and a stack that names the
    // same font twice is not something anyone means.
    expect(replaceFirstFamily("Inter, Georgia, serif", "georgia")).toBe(
      "georgia, serif"
    );
  });

  it("builds a stack of one when there was nothing", () => {
    expect(replaceFirstFamily("", "Inter")).toBe("Inter");
  });

  it("refuses an empty family rather than blanking the stack", () => {
    expect(replaceFirstFamily(REAL, "   ")).toBe(REAL);
  });

  it("round-trips", () => {
    const once = replaceFirstFamily(REAL, "Georgia");
    expect(replaceFirstFamily(once, "Inter")).toBe(
      'Inter, "Inter Fallback", system-ui, -apple-system, sans-serif'
    );
  });
});
