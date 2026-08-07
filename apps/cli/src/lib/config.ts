/**
 * Settings resolution: flags > AIRSHIP_* env > config file > defaults.
 *
 * Before this, every setting was a flag, so a project that always runs on the
 * same port with the same agent retyped both on every launch. The precedence is
 * the conventional one — the more specific and more deliberate the source, the
 * higher it wins, with the command line always last word.
 *
 * Everything is normalised to the registry's flag names (kebab-case) so the
 * three sources merge as plain objects and the rest of the CLI only ever reads
 * one shape.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FLAGS, type FlagSpec } from "./args";
import { CliError, didYouMean } from "./errors";

export type SettingValue = string | string[] | boolean;
export type Settings = Record<string, SettingValue | undefined>;

export const CONFIG_FILENAME = "airship.config.json";
/** The `airship` key in a package.json, for projects that prefer one file. */
const PACKAGE_KEY = "airship";

export interface LoadedConfig {
  /** Absolute path of the file the values came from, when there was one. */
  source?: string;
  values: Settings;
}

/** `max-turns` ⇄ `maxTurns` — accept either spelling, store the flag's. */
function toFlagName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function envKey(spec: FlagSpec): string {
  return `AIRSHIP_${spec.name.replace(/-/g, "_").toUpperCase()}`;
}

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off", ""]);

/**
 * Env vars are strings, so a boolean flag needs a spelling convention. Anything
 * unrecognised is an error rather than a silent `true`: `AIRSHIP_SAFE=maybe`
 * quietly enabling the sandbox is worse than being told it is not a boolean.
 */
function envBoolean(raw: string, name: string): boolean {
  const value = raw.trim().toLowerCase();
  if (TRUTHY.has(value)) {
    return true;
  }
  if (FALSY.has(value)) {
    return false;
  }
  throw new CliError(`${name} is not a boolean: '${raw}'`, {
    hint: "Use 1/true/yes/on or 0/false/no/off.",
  });
}

/** Settings from `AIRSHIP_*`, derived from the registry so none can be missed. */
export function envSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const out: Settings = {};
  for (const spec of FLAGS) {
    // Reading AIRSHIP_HELP or AIRSHIP_VERSION from the environment would make a
    // shell profile permanently unable to run anything.
    if (spec.name === "help" || spec.name === "version") {
      continue;
    }
    const key = envKey(spec);
    const raw = env[key];
    if (raw === undefined) {
      continue;
    }
    out[spec.name] = spec.type === "boolean" ? envBoolean(raw, key) : raw;
  }
  return out;
}

function coerceFileValue(
  spec: FlagSpec,
  value: unknown,
  where: string
): SettingValue {
  if (spec.multiple) {
    const list = Array.isArray(value) ? value : [value];
    return list.map((item) => String(item));
  }
  if (spec.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new CliError(`${where}: "${spec.name}" must be true or false`, {
        hint: `Got ${JSON.stringify(value)}.`,
      });
    }
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    // Ports and turn counts read naturally as JSON numbers; the validators
    // downstream all take strings, so normalise here rather than everywhere.
    return String(value);
  }
  throw new CliError(`${where}: "${spec.name}" must be a string`, {
    hint: `Got ${JSON.stringify(value)}.`,
  });
}

function parseConfigObject(raw: unknown, where: string): Settings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CliError(`${where} must contain a JSON object`, {
      hint: `Expected something like { "target": 3000, "agent": "claude" }.`,
    });
  }
  const byName = new Map(FLAGS.map((flag) => [flag.name, flag]));
  const out: Settings = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = toFlagName(key);
    const spec = byName.get(name);
    if (!spec) {
      // Same reasoning as an unknown flag: a typo'd key that is silently
      // ignored looks exactly like a setting that does not work.
      throw new CliError(`${where}: unknown setting "${key}"`, {
        hint:
          didYouMean(
            name,
            FLAGS.map((flag) => flag.name),
            ""
          ) ?? "See `airship --help` for the settings a config file accepts.",
      });
    }
    out[name] = coerceFileValue(spec, value, where);
  }
  return out;
}

/**
 * Walk up from `cwd` looking for a config file.
 *
 * Stops at the repository root: a config found above it belongs to a different
 * project (or to the user's home directory) and would silently change how an
 * unrelated app is served.
 */
export function loadConfig(cwd: string): LoadedConfig {
  let dir = resolve(cwd);
  for (;;) {
    const configPath = join(dir, CONFIG_FILENAME);
    if (existsSync(configPath)) {
      return {
        source: configPath,
        values: parseConfigObject(readJson(configPath), CONFIG_FILENAME),
      };
    }

    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = readJson(pkgPath) as Record<string, unknown> | null;
      const section = pkg?.[PACKAGE_KEY];
      if (section !== undefined) {
        return {
          source: pkgPath,
          values: parseConfigObject(section, `package.json "${PACKAGE_KEY}"`),
        };
      }
    }

    if (existsSync(join(dir, ".git"))) {
      return { values: {} };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return { values: {} };
    }
    dir = parent;
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new CliError(
      `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      {
        cause: err,
        hint: "Fix the file, or delete it to fall back to flags.",
      }
    );
  }
}

/**
 * Merge the sources, highest precedence last.
 *
 * `undefined` never overwrites: an unset flag has to fall through to the env or
 * the file, which is the whole point of having them.
 */
export function mergeSettings(...sources: readonly Settings[]): Settings {
  const out: Settings = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        out[key] = value;
      }
    }
  }
  return out;
}

export function asString(settings: Settings, name: string): string | undefined {
  const value = settings[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function asBoolean(settings: Settings, name: string): boolean {
  return settings[name] === true;
}

export function asList(settings: Settings, name: string): string[] {
  const value = settings[name];
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === "string" ? [value] : [];
}
