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
