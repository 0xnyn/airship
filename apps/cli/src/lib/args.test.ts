import { describe, expect, it } from "vitest";
import {
  assertKnownFlags,
  collectRepeated,
  requireAmount,
  requireEnum,
  requireInteger,
  requirePort,
} from "./args";
import { CliError, closest, EXIT } from "./errors";

const NAMES = [
  "target",
  "port",
  "mode",
  "agent",
  "max-turns",
  "max-budget",
  "codex-config",
  "opencode-url",
  "safe",
  "help",
];

/** Run the call and hand back the CliError it raised, for inspection. */
function thrown(fn: () => unknown): CliError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CliError) {
      return err;
    }
    throw err;
  }
  throw new Error("expected a CliError, but nothing was thrown");
}

describe("assertKnownFlags", () => {
  it("accepts long flags, short aliases and values", () => {
    expect(() =>
      assertKnownFlags(["-t", "3000", "--mode", "inline", "--safe"], NAMES)
    ).not.toThrow();
  });

  it("accepts the --flag=value form", () => {
    expect(() => assertKnownFlags(["--target=3000"], NAMES)).not.toThrow();
  });

  it("accepts the camelCase spelling citty also parses", () => {
    expect(() => assertKnownFlags(["--maxTurns", "8"], NAMES)).not.toThrow();
  });

  it("accepts --no- negation of a boolean", () => {
    expect(() => assertKnownFlags(["--no-safe"], NAMES)).not.toThrow();
  });

  it("rejects an unknown flag and suggests the near miss", () => {
    const err = thrown(() => assertKnownFlags(["--targt", "3000"], NAMES));
    expect(err.message).toBe("Unknown flag --targt");
    expect(err.hint).toBe("Did you mean --target?");
    expect(err.exitCode).toBe(EXIT.usage);
  });

  it("falls back to pointing at --help when nothing is close", () => {
    const err = thrown(() => assertKnownFlags(["--wombat"], NAMES));
    expect(err.hint).toContain("--help");
  });

  it("rejects an unknown short alias", () => {
    expect(() => assertKnownFlags(["-z"], NAMES)).toThrow(CliError);
  });

  it("accepts a bundle of known short aliases", () => {
    expect(() => assertKnownFlags(["-ta"], NAMES)).not.toThrow();
  });

  it("stops at -- so a passthrough argument is not ours to judge", () => {
    expect(() =>
      assertKnownFlags(["-t", "3000", "--", "--not-our-flag"], NAMES)
    ).not.toThrow();
  });

  it("ignores values that merely look like flags after a value", () => {
    expect(() => assertKnownFlags(["--target", "3000"], NAMES)).not.toThrow();
  });
});

describe("collectRepeated", () => {
  // The regression this exists for: citty calls node:util parseArgs without
  // `multiple`, so it keeps only the last occurrence and every earlier pair
  // would be dropped silently.
  it("keeps every occurrence, not just the last", () => {
    expect(
      collectRepeated(
        ["--codex-config", "a=1", "--codex-config", "b=2"],
        "codex-config"
      )
    ).toEqual(["a=1", "b=2"]);
  });

  it("reads the --flag=value form", () => {
    expect(collectRepeated(["--codex-config=a=1"], "codex-config")).toEqual([
      "a=1",
    ]);
  });

  it("mixes both forms", () => {
    expect(
      collectRepeated(
        ["--codex-config=a=1", "--codex-config", "b=2"],
        "codex-config"
      )
    ).toEqual(["a=1", "b=2"]);
  });

  it("returns nothing when the flag is absent", () => {
    expect(collectRepeated(["-t", "3000"], "codex-config")).toEqual([]);
  });

  it("does not swallow the next flag as a value", () => {
    expect(() =>
      collectRepeated(["--codex-config", "--safe"], "codex-config")
    ).toThrow(CliError);
  });

  it("stops at --", () => {
    expect(
      collectRepeated(["--", "--codex-config", "a=1"], "codex-config")
    ).toEqual([]);
  });
});

describe("requireEnum", () => {
  it("passes a valid value through", () => {
    expect(requireEnum("inline", "mode")).toBe("inline");
  });

  it("suggests the near miss", () => {
    expect(thrown(() => requireEnum("canvs", "mode")).hint).toBe(
      "Did you mean canvas?"
    );
  });

  it("lists the options when nothing is close", () => {
    expect(thrown(() => requireEnum("zzzzzz", "agent")).hint).toContain(
      "claude, codex, opencode"
    );
  });
});

describe("requirePort", () => {
  it("accepts a port in range", () => {
    expect(requirePort("3000", "target")).toBe(3000);
  });

  it.each(["notaport", "0", "65536", "3000.5", "", "-1"])(
    "rejects %o",
    (value) => {
      expect(() => requirePort(value, "target")).toThrow(CliError);
    }
  );
});

describe("requireInteger", () => {
  it("accepts a whole number", () => {
    expect(requireInteger("24", "max-turns")).toBe(24);
  });

  it.each(["0", "-3", "2.5", "many"])("rejects %o", (value) => {
    expect(() => requireInteger(value, "max-turns")).toThrow(CliError);
  });
});

describe("requireAmount", () => {
  it("accepts a fractional amount", () => {
    expect(requireAmount("2.50", "max-budget")).toBe(2.5);
  });

  // --max-budget never had a NaN check, so `--max-budget lots` meant NaN, which
  // compares false against every threshold: the cap silently did not exist.
  it.each(["lots", "0", "-5", ""])("rejects %o", (value) => {
    expect(() => requireAmount(value, "max-budget")).toThrow(CliError);
  });
});

describe("closest", () => {
  it("matches a one-character typo", () => {
    expect(closest("targt", ["target", "port"])).toBe("target");
  });

  it("declines when nothing is near enough", () => {
    expect(closest("xyz", ["target", "port"])).toBeUndefined();
  });

  it("scales its tolerance to the input length", () => {
    // Two edits on a three-letter word is most of the word, so no suggestion.
    expect(closest("abc", ["port"])).toBeUndefined();
    expect(closest("opencode-ur", ["opencode-url"])).toBe("opencode-url");
  });
});
