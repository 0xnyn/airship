/**
 * Turning one invocation into the merged settings a command runs on.
 *
 * Shared by every command so the precedence chain is applied identically —
 * `doctor` reporting different values from the ones `serve` would use would
 * make it worse than useless.
 */

import { resolve } from "node:path";
import { collectRepeated, specsFor } from "./args";
import {
  envSettings,
  loadConfig,
  mergeSettings,
  type Settings,
} from "./config";
import { CliError, EXIT } from "./errors";

export interface ResolvedContext {
  /** The config file the values came from, for `doctor` and error messages. */
  configSource?: string;
  /** Project root for edits, absolute. */
  cwd: string;
  settings: Settings;
}

/**
 * Pull this command's flags out of citty's parsed args.
 *
 * citty rewrites a string flag given without a value to `""` rather than
 * failing, which would read here as "not set" and silently fall through to the
 * config file — so an empty string is rejected outright.
 */
function flagSettings(
  args: Record<string, unknown>,
  rawArgs: readonly string[],
  names: readonly string[]
): Settings {
  const out: Settings = {};
  for (const spec of specsFor(names)) {
    if (spec.multiple) {
      const values = collectRepeated(rawArgs, spec.name);
      if (values.length > 0) {
        out[spec.name] = values;
      }
      continue;
    }
    const value = args[spec.name];
    if (value === undefined) {
      continue;
    }
    if (spec.type === "boolean") {
      out[spec.name] = value === true;
      continue;
    }
    if (typeof value !== "string" || value === "") {
      throw new CliError(`--${spec.name} needs a value`, {
        exitCode: EXIT.usage,
        hint: `Pass it as --${spec.name} ${spec.hint ?? "<value>"}.`,
      });
    }
    out[spec.name] = value;
  }
  return out;
}

export function resolveSettings(opts: {
  args: Record<string, unknown>;
  names: readonly string[];
  rawArgs: readonly string[];
}): ResolvedContext {
  const flags = flagSettings(opts.args, opts.rawArgs, opts.names);
  const env = envSettings();

  // Config discovery starts from --cwd when one was given, so running
  // `airship --cwd apps/web` from a repo root finds that app's config rather
  // than the root's. Only the two sources that can be known before the file is
  // read may steer it, which is why this is a separate merge.
  const searchRoot = flags.cwd ?? env.cwd;
  const config = loadConfig(
    typeof searchRoot === "string" ? resolve(searchRoot) : process.cwd()
  );

  const settings = mergeSettings(config.values, env, flags);
  const { cwd } = settings;
  return {
    configSource: config.source,
    cwd: typeof cwd === "string" ? resolve(cwd) : process.cwd(),
    settings,
  };
}
