import { describe, expect, it } from "vitest";
import {
  type DevicePreset,
  framePreset,
  groupOfPreset,
  matchPreset,
  PRESET_GROUPS,
  PRESETS,
  presetById,
} from "./frames";

/*
 * The device list and the three functions that read it.
 *
 * Pure logic, so no `FrameManager` and no DOM — `frames.ts` only reaches for
 * `document` inside `el`, which none of this touches.
 *
 * The list is the interesting part. Four sizes belong to two devices each, which
 * is what `matchPreset`'s `preferId` exists for, and the cases below are written
 * so that removing that argument fails them rather than merely changing them.
 */

const dims = (p: DevicePreset): string => `${p.width}×${p.height}`;

describe("the device list", () => {
  it("flattens to PRESETS in group order", () => {
    expect(PRESETS).toEqual(PRESET_GROUPS.flatMap((g) => g.presets));
  });

  it("gives every preset a unique id", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every group a unique id", () => {
    const ids = PRESET_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every preset in exactly one group", () => {
    for (const preset of PRESETS) {
      const owners = PRESET_GROUPS.filter((g) => g.presets.includes(preset));
      expect(owners).toHaveLength(1);
    }
  });

  it("keeps every preset above the 120px floor `resize` clamps to", () => {
    for (const preset of PRESETS) {
      expect(Math.min(preset.width, preset.height)).toBeGreaterThanOrEqual(120);
    }
  });

  it("carries the ids `shell-app` seeds its first-run layout with", () => {
    expect(presetById("desktop")).not.toBeNull();
    expect(presetById("iphone-16")).not.toBeNull();
  });

  it("resolves an unknown id to null", () => {
    expect(presetById("wide")).toBeNull();
    expect(presetById(null)).toBeNull();
  });
});

describe("groupOfPreset", () => {
  it("finds the bucket a preset lives in", () => {
    expect(groupOfPreset("iphone-16")?.id).toBe("phone");
    expect(groupOfPreset("ipad-pro-11")?.id).toBe("tablet");
    expect(groupOfPreset("macbook-air")?.id).toBe("desktop");
  });

  it("answers null for an id it does not know, including null", () => {
    expect(groupOfPreset("laptop")).toBeNull();
    expect(groupOfPreset(null)).toBeNull();
  });
});

describe("matchPreset", () => {
  it("falls back to the first device of a shared size", () => {
    // Documented precedence, not an accident: the group order is newest-first,
    // so an unpreferred lookup answers with the current name.
    expect(matchPreset(393, 852)?.id).toBe("iphone-16");
    expect(matchPreset(402, 874)?.id).toBe("iphone-17");
    expect(matchPreset(1440, 1024)?.id).toBe("desktop");
  });

  it("honours a preference that still fits", () => {
    expect(matchPreset(393, 852, "iphone-14-pro")?.id).toBe("iphone-14-pro");
    expect(matchPreset(1440, 1024, "wireframe")?.id).toBe("wireframe");
    expect(matchPreset(430, 932, "iphone-14-pro-max")?.id).toBe(
      "iphone-14-pro-max"
    );
  });

  it("ignores a preference the numbers have outgrown", () => {
    // The persisted-layout case: `desktop` used to be 1440 × 900, so a layout
    // saved before it moved carries an id that no longer fits. It must degrade
    // to no device rather than to the wrong one.
    expect(matchPreset(1440, 900, "desktop")).toBeNull();
  });

  it("ignores a preference naming a device that is gone", () => {
    expect(matchPreset(393, 852, "laptop")?.id).toBe("iphone-16");
  });

  it("matches either orientation, with and without a preference", () => {
    expect(matchPreset(852, 393)?.id).toBe("iphone-16");
    expect(matchPreset(852, 393, "iphone-14-pro")?.id).toBe("iphone-14-pro");
  });

  it("lets every device in the list identify itself", () => {
    // The one that would have caught the bug this argument was added for:
    // without `preferId` this fails on exactly the four shared sizes.
    for (const preset of PRESETS) {
      expect(matchPreset(preset.width, preset.height, preset.id)?.id).toBe(
        preset.id
      );
    }
  });
});

describe("rotation", () => {
  it("has no preset whose rotation is another preset", () => {
    // What makes `rotate`'s "leave `presetId` alone" unambiguous even for a
    // frame carrying no preference: a rotated frame can never land exactly on a
    // different device. Fails loudly the day someone adds a landscape twin.
    for (const a of PRESETS) {
      const rotated = `${a.height}×${a.width}`;
      for (const b of PRESETS) {
        if (a !== b) {
          expect(dims(b)).not.toBe(rotated);
        }
      }
    }
  });
});

describe("framePreset", () => {
  it("answers with the frame's own device when the numbers agree", () => {
    expect(
      framePreset({ height: 852, presetId: "iphone-14-pro", width: 393 })?.id
    ).toBe("iphone-14-pro");
  });

  it("falls back to the size when the frame's id no longer fits", () => {
    expect(
      framePreset({ height: 1024, presetId: "iphone-16", width: 1440 })?.id
    ).toBe("desktop");
  });

  it("answers null for a size no device has", () => {
    expect(framePreset({ height: 900, presetId: "desktop", width: 1440 })).toBe(
      null
    );
  });
});
