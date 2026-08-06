/**
 * The two backend escape hatches, and the value parsing they need.
 *
 * Extracted from the command so they can be tested: every one of these has a
 * coercion rule that is easy to get subtly wrong and impossible to notice from
 * the outside — a boolean silently becoming the string "true" changes what the
 * agent is configured with, not whether it runs.
 */

import { readFileSync } from "node:fs";
import type { CodexConfigValue } from "@airship/server";
import { CliError, EXIT } from "./errors";

/**
 * Interpret a flag value as the TOML scalar it looks like.
 *
 * The SDK serializes a JS string as a quoted TOML string, so passing everything
 * through verbatim would turn `network_access=true` into `network_access="true"`
 * — a string where Codex's config expects a boolean. Since argv has no types,
 * the shape of the text is the only signal available. Quote a value
 * (`k='"true"'`) to force it to stay a string.
 */
export function coerce(raw: string): CodexConfigValue {
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (raw !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  // An explicitly quoted value keeps its quotes stripped but stays a string.
  if (raw.length > 1 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** `--codex-config k=v`, repeatable. Rejects a pair with no `=`. */
export function parseCodexConfig(
  pairs: readonly string[]
): Record<string, CodexConfigValue> {
  const out: Record<string, CodexConfigValue> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 1) {
      throw new CliError(`Invalid --codex-config '${pair}'`, {
        exitCode: EXIT.usage,
        hint: "Expected key=value, e.g. --codex-config network_access=true.",
      });
    }
    out[pair.slice(0, eq)] = coerce(pair.slice(eq + 1));
  }
  return out;
}

/**
 * `--opencode-config <file.json>` — a file path, not `k=v`.
 *
 * Deliberately a different shape from `--codex-config`. Codex's escape hatch is
 * a flat list of TOML scalars, which `k=v` fits exactly. OpenCode's config is a
 * deeply nested JSON document (`provider.anthropic.options.thinking.budget`),
 * and supporting that through `k=v` would mean inventing a dotted-path
 * mini-language plus a value parser. A file fails fast with a real parse error
 * and is the form users already have on disk.
 */
export function readOpencodeConfig(
  path: string | undefined
): Record<string, unknown> | undefined {
  if (!path) {
    return;
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new CliError(`--opencode-config file not found: ${path}`, {
        cause: err,
        hint: "Check the path, or drop the flag to use opencode's own config.",
      });
    }
    throw new CliError(
      `--opencode-config ${path} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliError(
      `--opencode-config ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(`--opencode-config ${path} must contain a JSON object`, {
      hint: "The file is merged into opencode's server config, so it has to be an object.",
    });
  }
  return parsed as Record<string, unknown>;
}
