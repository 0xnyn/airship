import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  asBoolean,
  asList,
  asString,
  envSettings,
  loadConfig,
  mergeSettings,
} from "./config";
import { CliError } from "./errors";

/** Build a throwaway project tree and return its root. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "airship-config-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

/** The hint on the CliError a call raises, for asserting on the guidance. */
function hintOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof CliError) {
      return err.hint;
    }
    throw err;
  }
}

describe("loadConfig", () => {
  it("reads airship.config.json from the directory itself", () => {
    const root = fixture({
      "airship.config.json": '{ "target": 3000, "agent": "codex" }',
    });
    const { source, values } = loadConfig(root);
    expect(source).toBe(join(root, "airship.config.json"));
    // A JSON number is normalised to the string every validator expects.
    expect(values).toEqual({ agent: "codex", target: "3000" });
  });

  it("walks up to find one in a parent", () => {
    const root = fixture({
      ".git/HEAD": "ref: refs/heads/main\n",
      "airship.config.json": '{ "target": 4321 }',
      "apps/web/package.json": "{}",
    });
    expect(loadConfig(join(root, "apps/web")).values.target).toBe("4321");
  });

  it("stops at the repository root", () => {
    // The config sits *above* the repo root, so it belongs to something else.
    const root = fixture({
      "airship.config.json": '{ "target": 9999 }',
      "repo/.git/HEAD": "ref: refs/heads/main\n",
    });
    expect(loadConfig(join(root, "repo")).values).toEqual({});
  });

  it("reads an airship key out of package.json", () => {
    const root = fixture({
      "package.json": '{ "name": "x", "airship": { "mode": "inline" } }',
    });
    const { source, values } = loadConfig(root);
    expect(source).toBe(join(root, "package.json"));
    expect(values.mode).toBe("inline");
  });

  it("prefers airship.config.json over the package.json key", () => {
    const root = fixture({
      "airship.config.json": '{ "target": 1111 }',
      "package.json": '{ "airship": { "target": 2222 } }',
    });
    expect(loadConfig(root).values.target).toBe("1111");
  });

  it("accepts camelCase and stores the flag spelling", () => {
    const root = fixture({ "airship.config.json": '{ "maxTurns": 8 }' });
    expect(loadConfig(root).values["max-turns"]).toBe("8");
  });

  it("accepts the kebab spelling too", () => {
    const root = fixture({ "airship.config.json": '{ "max-turns": 8 }' });
    expect(loadConfig(root).values["max-turns"]).toBe("8");
  });

  it("collects a repeatable setting into a list", () => {
    const root = fixture({
      "airship.config.json": '{ "codexConfig": ["a=1", "b=2"] }',
    });
    expect(loadConfig(root).values["codex-config"]).toEqual(["a=1", "b=2"]);
  });

  it("rejects an unknown key rather than ignoring it", () => {
    const root = fixture({ "airship.config.json": '{ "targt": 3000 }' });
    expect(() => loadConfig(root)).toThrow(CliError);
    expect(hintOf(() => loadConfig(root))).toBe("Did you mean target?");
  });

  // The per-backend model keys are not declared anywhere in this module: they
  // exist in `airship.config.json` only because they are flags, and the schema
  // is the flag registry. These three assert that pipe end to end, which is
  // also what makes `airship init` writing `claudeModel` safe.
  it.each([
    ["claudeModel", "claude-model"],
    ["codexModel", "codex-model"],
    ["opencodeModel", "opencode-model"],
  ])("reads %s as %s", (written, flag) => {
    const root = fixture({
      "airship.config.json": `{ "${written}": "some-model" }`,
    });
    expect(loadConfig(root).values[flag]).toBe("some-model");
  });

  it("accepts the kebab spelling of a per-backend model too", () => {
    const root = fixture({
      "airship.config.json": '{ "claude-model": "opus" }',
    });
    expect(loadConfig(root).values["claude-model"]).toBe("opus");
  });

  it("suggests the near miss on a mistyped model key", () => {
    const root = fixture({ "airship.config.json": '{ "claudModel": "opus" }' });
    expect(hintOf(() => loadConfig(root))).toBe("Did you mean claude-model?");
  });

  it("rejects a non-boolean for a boolean setting", () => {
    const root = fixture({ "airship.config.json": '{ "safe": "yes" }' });
    expect(() => loadConfig(root)).toThrow(CliError);
  });

  it("reports malformed JSON rather than falling through", () => {
    const root = fixture({ "airship.config.json": "{ nope" });
    expect(() => loadConfig(root)).toThrow(CliError);
  });

  it("returns nothing when there is no config anywhere", () => {
    const root = fixture({ ".git/HEAD": "ref: refs/heads/main\n" });
    expect(loadConfig(root)).toEqual({ values: {} });
  });
});

describe("envSettings", () => {
  it("maps AIRSHIP_* onto flag names", () => {
    expect(
      envSettings({ AIRSHIP_MAX_TURNS: "8", AIRSHIP_TARGET: "3000" })
    ).toEqual({ "max-turns": "8", target: "3000" });
  });

  it.each(["1", "true", "yes", "on"])("reads %o as true", (value) => {
    expect(envSettings({ AIRSHIP_SAFE: value }).safe).toBe(true);
  });

  it.each(["0", "false", "no", "off", ""])("reads %o as false", (value) => {
    expect(envSettings({ AIRSHIP_SAFE: value }).safe).toBe(false);
  });

  it("rejects a boolean it cannot read rather than defaulting to true", () => {
    expect(() => envSettings({ AIRSHIP_SAFE: "maybe" })).toThrow(CliError);
  });

  // A shell profile that exported these would make the CLI unable to run.
  it("ignores AIRSHIP_HELP and AIRSHIP_VERSION", () => {
    expect(envSettings({ AIRSHIP_HELP: "1", AIRSHIP_VERSION: "1" })).toEqual(
      {}
    );
  });

  it("leaves unset variables out entirely", () => {
    expect(envSettings({})).toEqual({});
  });
});

describe("mergeSettings", () => {
  it("lets the later source win", () => {
    expect(
      mergeSettings({ target: "1" }, { target: "2" }, { target: "3" }).target
    ).toBe("3");
  });

  // The whole point of the chain: an unset flag has to fall through, not
  // overwrite the config file with nothing.
  it("never lets undefined overwrite a real value", () => {
    expect(
      mergeSettings({ target: "3000" }, { target: undefined }).target
    ).toBe("3000");
  });

  it("keeps keys that only one source has", () => {
    expect(mergeSettings({ agent: "codex" }, { target: "3000" })).toEqual({
      agent: "codex",
      target: "3000",
    });
  });
});

describe("accessors", () => {
  it("treats an empty string as absent", () => {
    expect(asString({ model: "" }, "model")).toBeUndefined();
  });

  it("reads only an exact true as true", () => {
    expect(asBoolean({ safe: true }, "safe")).toBe(true);
    expect(asBoolean({ safe: "true" }, "safe")).toBe(false);
  });

  it("wraps a lone string as a list", () => {
    expect(asList({ "codex-config": "a=1" }, "codex-config")).toEqual(["a=1"]);
  });
});
