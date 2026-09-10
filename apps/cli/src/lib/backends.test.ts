import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coerce, parseCodexConfig, readOpencodeConfig } from "./backends";
import { CliError } from "./errors";

describe("coerce", () => {
  // The bug this exists for: the SDK serializes a JS string as a quoted TOML
  // string, so a bare "true" would reach Codex as the string "true" where its
  // config expects a boolean.
  it("reads the TOML scalar the text looks like", () => {
    expect(coerce("true")).toBe(true);
    expect(coerce("false")).toBe(false);
    expect(coerce("42")).toBe(42);
    expect(coerce("2.5")).toBe(2.5);
    expect(coerce("-1")).toBe(-1);
  });

  it("keeps a non-scalar as a string", () => {
    expect(coerce("gpt-5")).toBe("gpt-5");
    expect(coerce("")).toBe("");
  });

  it("lets explicit quotes force a string", () => {
    expect(coerce('"true"')).toBe("true");
    expect(coerce('"42"')).toBe("42");
  });

  // The bug this is for: TOML let a number use `_` between digits, so
  // `model_max_output_tokens=100_000` is valid TOML and much easier to read
  // than `100000`. Before this, coerce() did not know that syntax and the
  // value reach Codex as the literal string "100_000" instead of the number
  // 100000.
  it("reads a TOML digit separator in an integer", () => {
    expect(coerce("100_000")).toBe(100_000);
    expect(coerce("1_000_000")).toBe(1_000_000);
  });

  it("reads a TOML digit separator in a float", () => {
    expect(coerce("1_234.5")).toBe(1234.5);
  });

  it("keeps a negative number with a digit separator", () => {
    expect(coerce("-1_000")).toBe(-1000);
  });

  it.each(["_100", "100_", "1__000"])(
    "does not touch an underscore that is not a valid separator: %s",
    (bad) => {
      expect(coerce(bad)).toBe(bad);
    }
  );
});

describe("parseCodexConfig", () => {
  it("splits on the first = so a value may contain one", () => {
    expect(parseCodexConfig(["a=b=c"])).toEqual({ a: "b=c" });
  });

  it("collects every pair", () => {
    expect(parseCodexConfig(["a=1", "b=true"])).toEqual({ a: 1, b: true });
  });

  it("returns nothing for no pairs", () => {
    expect(parseCodexConfig([])).toEqual({});
  });

  it.each(["noequals", "=novalue"])("rejects %o", (pair) => {
    expect(() => parseCodexConfig([pair])).toThrow(CliError);
  });
});

describe("readOpencodeConfig", () => {
  const write = (contents: string): string => {
    const path = join(
      mkdtempSync(join(tmpdir(), "airship-opencode-")),
      "config.json"
    );
    writeFileSync(path, contents);
    return path;
  };

  it("returns nothing when no path is given", () => {
    expect(readOpencodeConfig(undefined)).toBeUndefined();
  });

  it("parses an object", () => {
    expect(readOpencodeConfig(write('{ "model": "x" }'))).toEqual({
      model: "x",
    });
  });

  it("names the missing file", () => {
    let err: CliError | undefined;
    try {
      readOpencodeConfig("/nope/does-not-exist.json");
    } catch (caught) {
      err = caught as CliError;
    }
    expect(err?.message).toContain("not found");
  });

  it("rejects malformed JSON", () => {
    expect(() => readOpencodeConfig(write("{ nope"))).toThrow(CliError);
  });

  it.each(["[]", '"a string"', "null", "42"])("rejects %o", (contents) => {
    expect(() => readOpencodeConfig(write(contents))).toThrow(CliError);
  });
});
